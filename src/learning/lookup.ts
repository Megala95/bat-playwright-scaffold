import catalogJson from "../healer/errorCatalog.json";
import { classifyError, stripAnsi } from "../healer/analyzeResults";
import { CatalogEntry } from "../healer/types";
import { loadPatterns } from "./aggregate";
import { Pattern } from "./types";

/**
 * lookup-fix: retrieval over what this project already knows about a problem.
 *
 *   npm run lookup-fix -- "locator not found on the save button" [--area <skill-area>] [--top 5] [--json]
 *   npm run lookup-fix -- "<paste the Playwright error>"
 *
 * The corpus is small and structured: the healer's error catalog (what a
 * failure means and how to fix it) and the approved learned patterns (what
 * engineers here actually did). Ranking is keyword relevance (BM25-style) plus
 * two boosts that make it more than a text search: a pasted error message that
 * matches a catalog entry's patterns ranks that entry first, and learned
 * patterns that have resolved that failure type rank next to it. It is the
 * lightweight retrieval an agent calls instead of loading everything - no
 * vector database, runs offline, deterministic.
 */

const CATALOG = catalogJson as CatalogEntry[];

export interface Hit {
  source: "catalog" | "pattern";
  id: string;
  title: string;
  score: number;
  area?: string;
  summary: string;
  steps?: string[];
  neverDo?: string[];
  /** For catalog hits: learned patterns that resolved this failure, most used first. */
  learned?: Array<{ key: string; count: number }>;
  why: string[];
}

const STOP = new Set(["the", "a", "an", "is", "are", "to", "of", "in", "on", "for", "and", "or", "with", "it", "this", "that", "my", "i", "not", "be", "at", "by", "when", "how", "do", "does", "can", "from"]);

export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const raw of stripAnsi(s).toLowerCase().replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.push(raw);
    // crude stemming so "locators" finds "locator" and "waiting" finds "wait"
    const stem = raw.replace(/(ing|ed|es|s)$/, "");
    if (stem.length >= 3 && stem !== raw) out.push(stem);
  }
  return out;
}

/** Words engineers use for a problem that the skills name differently; applied to the query only. */
const SYNONYMS: Record<string, string> = {
  seconds: "sleep timeout", delay: "sleep timeout", pause: "sleep timeout", hardcoded: "sleep literal", sleep: "timeout waitfortimeout",
  selector: "locator", xpath: "locator css", css: "locator", element: "locator", button: "locator role",
  hybrid: "fallback or locator", fallback: "hybrid or locator", dynamic: "wait sync", sync: "wait synchronization", synchronization: "wait sync",
  verify: "assertion verification", verification: "assertion", check: "assertion", expect: "assertion",
  credentials: "secret data", password: "secret data", missing: "data guard", flaky: "wait retry",
};

function expandQuery(q: string[]): string[] {
  const out = [...q];
  for (const t of q) if (Object.prototype.hasOwnProperty.call(SYNONYMS, t)) out.push(...tokenize(SYNONYMS[t]));
  return out;
}

interface Doc {
  hit: Omit<Hit, "score" | "why">;
  fields: Array<{ weight: number; tokens: string[] }>;
  resolvesIds: string[];
  entry?: CatalogEntry;
}

function buildDocs(patterns: Pattern[]): Doc[] {
  const docs: Doc[] = [];
  const learnedFor = new Map<string, Array<{ key: string; count: number }>>();
  for (const p of patterns) {
    if (p.status !== "approved") continue;
    for (const [id, n] of Object.entries(p.resolves)) learnedFor.set(id, [...(learnedFor.get(id) ?? []), { key: p.id, count: n }]);
  }
  for (const e of CATALOG) {
    docs.push({
      hit: {
        source: "catalog", id: e.id, title: e.title, area: e.skillArea, summary: e.diagnosis, steps: e.fixes, neverDo: e.neverDo,
        learned: (learnedFor.get(e.id) ?? []).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
      },
      fields: [
        { weight: 3, tokens: tokenize(`${e.title} ${e.id}`) },
        { weight: 2, tokens: tokenize(`${e.classification} ${e.skillArea}`) },
        { weight: 1, tokens: tokenize(`${e.diagnosis} ${e.fixes.join(" ")}`) },
      ],
      resolvesIds: [], entry: e,
    });
  }
  for (const p of patterns) {
    if (p.status !== "approved") continue;
    docs.push({
      hit: { source: "pattern", id: p.id, title: `${p.type === "anti-pattern" ? "Avoid: " : ""}${p.title}`, area: p.area, summary: p.guidance, steps: [p.problem] },
      fields: [
        { weight: 3, tokens: tokenize(`${p.title} ${p.id}`) },
        { weight: 2, tokens: tokenize(`${p.kind} ${p.subkind ?? ""} ${p.area}`) },
        { weight: 1, tokens: tokenize(`${p.problem} ${p.guidance} ${p.example?.before ?? ""} ${p.example?.after ?? ""}`) },
      ],
      resolvesIds: Object.keys(p.resolves),
    });
  }
  return docs;
}

export interface LookupOptions {
  root?: string;
  area?: string;
  top?: number;
  patterns?: Pattern[];
}

export function lookup(query: string, opts: LookupOptions = {}): Hit[] {
  const patterns = opts.patterns ?? loadPatterns(opts.root ?? process.cwd());
  const docs = buildDocs(patterns);
  const q = expandQuery(tokenize(query));
  if (!q.length) return [];
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d.fields.flatMap((f) => f.tokens))) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const avg = docs.reduce((s, d) => s + d.fields.reduce((x, f) => x + f.tokens.length, 0), 0) / Math.max(1, N);
  const direct = query.length > 20 ? classifyError(query) : undefined; // a pasted error message
  const directId = direct && direct.id !== "unknown" ? direct.id : undefined;

  const hits: Hit[] = [];
  for (const d of docs) {
    if (opts.area && d.hit.area !== opts.area) continue;
    let score = 0;
    const why: string[] = [];
    const len = d.fields.reduce((x, f) => x + f.tokens.length, 0);
    for (const t of new Set(q)) {
      const n = df.get(t) ?? 0;
      if (!n) continue;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      for (const f of d.fields) {
        const tf = f.tokens.filter((x) => x === t).length;
        if (!tf) continue;
        const s = (idf * tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (len / avg)));
        score += s * f.weight;
      }
    }
    if (score > 0) why.push("keywords");
    if (d.entry && directId === d.entry.id) { score += 100; why.push("the error message matches this catalog entry"); }
    if (directId && d.resolvesIds.includes(directId)) { score += 40; why.push(`engineers resolved ${directId} with this`); }
    if (score <= 0) continue;
    if (d.hit.learned?.length) why.push(`${d.hit.learned.length} learned fix(es) recorded`);
    hits.push({ ...d.hit, score: Math.round(score * 100) / 100, why });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return hits.slice(0, opts.top ?? 5);
}

export function formatHits(hits: Hit[]): string {
  if (!hits.length) return "No match. Try different words, or paste the error message; if this really is new, it will be learned from the fix (npm run learn-capture).";
  const L: string[] = [];
  hits.forEach((h, i) => {
    L.push(`${i + 1}. [${h.source}] ${h.title}  (${h.id}${h.area ? `, ${h.area}` : ""}; ${h.why.join("; ")})`);
    L.push(`   ${h.summary}`);
    if (h.steps?.length) for (const s of h.steps.slice(0, 3)) L.push(`   - ${s}`);
    if (h.learned?.length) L.push(`   learned here: ${h.learned.slice(0, 3).map((x) => `${x.key} ×${x.count}`).join(", ")}`);
    if (h.neverDo?.length) L.push(`   never: ${h.neverDo.slice(0, 2).join(" / ")}`);
  });
  return L.join("\n");
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()): number {
  const words: string[] = [];
  let area: string | undefined, top = 5, json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--area") area = argv[++i];
    else if (a === "--top") { top = Number(argv[++i]); if (!Number.isInteger(top) || top < 1) { console.error("--top needs a positive integer"); return 2; } }
    else if (a === "--json") json = true;
    else if (a.startsWith("--")) { console.error(`Unknown option ${a}`); return 2; }
    else words.push(a);
  }
  const query = words.join(" ").trim();
  if (!query) { console.error('Usage: lookup-fix "<problem or error message>" [--area <skill-area>] [--top N] [--json]'); return 2; }
  const hits = lookup(query, { root: cwd, area, top });
  console.log(json ? JSON.stringify(hits, null, 2) : formatHits(hits));
  return 0;
}

if (require.main === module) process.exit(main());
