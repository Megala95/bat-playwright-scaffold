import crypto from "crypto";
import fs from "fs";
import path from "path";
import { EVENTS_DIR, PATTERNS_DIR, loadConfig } from "./config";
import { KIND_BY_ID } from "./kinds";
import { oneLine } from "./redact";
import { normalizePattern, normalizeRecord, titleOfKind } from "./sanitize";
import { CaptureRecord, LearningConfig, LearningEvent, Pattern } from "./types";
import { SKILL_AREAS, SkillArea } from "../utils/skillAreas";

/**
 * Aggregate: many engineers' capture records -> what is worth teaching.
 *
 * The rules that keep the output trustworthy:
 *  - an edit is counted once (event id), however many times it was captured;
 *  - a pattern needs evidence from several FILES and several ENGINEERS, not
 *    one person's habit (thresholds in .learnings/config.json);
 *  - regressions (sleeps, force clicks, raised timeouts, weakened assertions)
 *    are never candidates: they are reported as coaching signals;
 *  - nothing reaches a skill without a human running learn-approve.
 */

export const clusterKey = (e: Pick<LearningEvent, "kind" | "subkind">) => (e.subkind ? `${e.kind}:${e.subkind}` : e.kind);

export interface Evidence {
  events: number;
  files: number;
  authors: number;
  repos: number;
  firstSeen: string;
  lastSeen: string;
}

export interface Cluster {
  key: string;
  kind: string;
  subkind?: string;
  area: SkillArea;
  direction: string;
  title: string;
  evidence: Evidence;
  /** Catalog entry id -> times an edit of this kind resolved that failure. */
  resolves: Record<string, number>;
  example?: { before?: string; after?: string };
  files: string[];
}

export interface Candidate extends Cluster {
  /** Shown in the report so the reviewer sees at a glance what is missing, for clusters that are close but not there yet. */
  missing?: string[];
}

export interface Hotspot {
  file: string;
  target: string;
  edits: number;
  authors: number;
  kinds: string[];
  advice: string;
}

export interface FailureFix {
  entryId: string;
  classification: string;
  title: string;
  count: number;
  fixes: Array<{ key: string; count: number }>;
}

export interface AreaStat {
  area: SkillArea;
  improvements: number;
  regressions: number;
  neutral: number;
  corrections: number;
  approvedPatterns: number;
  /** ISO week (YYYY-Www) -> improvement events; the Measure step looks for these falling after a pattern is published. */
  weekly: Record<string, number>;
}

export interface LearningReport {
  generatedAt: string;
  thresholds: Pick<LearningConfig, "minEvents" | "minFiles" | "minAuthors" | "watchEvents">;
  window: { records: number; events: number; authors: number; repos: number; from?: string; to?: string };
  candidates: Candidate[];
  /** Close to the thresholds but not there yet. */
  emerging: Candidate[];
  /** Approved patterns, with how often they showed up again after approval. */
  known: Array<{ key: string; type: string; status: string; approvedAt: string; recurrences: number }>;
  /** Approved, yet engineers kept making the same edit afterwards: the guidance is not being found or followed. */
  recurringAfterApproval: Array<{ key: string; since: string; recurrences: number; authors: number }>;
  coaching: Cluster[];
  hotspots: Hotspot[];
  reviewer: { fixed: Record<string, number>; introduced: Record<string, number> };
  failureFixes: FailureFix[];
  areas: AreaStat[];
  corrections: Array<{ skillArea: string; count: number; latest: string[] }>;
}

// --- loading ------------------------------------------------------------------------

export function loadRecords(root: string, extraDirs: string[] = []): CaptureRecord[] {
  const dirs = [path.join(root, EVENTS_DIR), ...extraDirs.map((d) => (path.isAbsolute(d) ? d : path.join(root, d)))];
  const out: CaptureRecord[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith(".json")) continue;
      try {
        const r = normalizeRecord(JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8")));
        if (r) out.push(r);
      } catch {
        /* a half-written or hand-mangled record must not stop the report */
      }
    }
  }
  return out;
}

export function loadPatterns(root: string): Pattern[] {
  const dir = path.join(root, PATTERNS_DIR);
  if (!fs.existsSync(dir)) return [];
  const out: Pattern[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    try {
      const p = normalizePattern(JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8")));
      if (p) out.push(p);
    } catch {
      /* skip */
    }
  }
  return out;
}

/** One capture can arrive several times (hook, then CI): identical event sets are one record. */
export function dedupeRecords(records: CaptureRecord[]): CaptureRecord[] {
  const sorted = [...records].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const seen = new Set<string>();
  const out: CaptureRecord[] = [];
  for (const r of sorted) {
    // same repository, same engineer, same set of edits = the same capture seen twice (hook, then CI)
    const k = r.events.length
      ? `e:${r.repo}:${r.author}:` + crypto.createHash("sha1").update(r.events.map((e) => e.id).sort().join(",")).digest("hex")
      : "f:" + [r.repo, r.commit ?? "", r.author, ...r.files.map((f) => `${f.file}|${f.fixed}|${f.introduced}`)].join(";");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

interface Flat {
  e: LearningEvent;
  author: string;
  repo: string;
  at: string;
}

function flatten(records: CaptureRecord[]): Flat[] {
  const byId = new Map<string, Flat>();
  for (const r of records) {
    for (const e of r.events) {
      const dk = `${r.repo}|${r.author}|${e.id}`;
      const prev = byId.get(dk);
      // the same edit seen again: keep the earliest sighting, but keep the failure link if only a later capture had it
      if (prev) {
        if (!prev.e.resolves && e.resolves) prev.e = { ...prev.e, resolves: e.resolves };
        continue;
      }
      byId.set(dk, { e, author: r.author, repo: r.repo, at: r.capturedAt });
    }
  }
  return [...byId.values()];
}

// --- helpers --------------------------------------------------------------------------

const isoWeek = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "unknown";
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
};

const titleOf = titleOfKind;

/** The clearest real example of a cluster: the shortest one (least noise), latest on ties. */
function pickExample(items: Flat[]): { before?: string; after?: string } | undefined {
  const withText = items.filter((f) => f.e.before || f.e.after);
  if (!withText.length) return undefined;
  withText.sort((a, b) => (a.e.before?.length ?? 0) + (a.e.after?.length ?? 0) - ((b.e.before?.length ?? 0) + (b.e.after?.length ?? 0)) || b.at.localeCompare(a.at));
  const f = withText[0].e;
  return { before: f.before, after: f.after };
}

function makeCluster(key: string, items: Flat[]): Cluster {
  const first = items[0].e;
  const times = items.map((i) => i.at).sort();
  const resolves: Record<string, number> = {};
  for (const i of items) if (i.e.resolves) resolves[i.e.resolves.entryId] = (resolves[i.e.resolves.entryId] ?? 0) + 1;
  const files = [...new Set(items.map((i) => i.e.file))].sort();
  return {
    key, kind: first.kind, subkind: first.subkind, area: first.area, direction: first.direction, title: titleOf(first.kind, first.subkind),
    evidence: {
      events: items.length, files: files.length, authors: new Set(items.map((i) => i.author)).size, repos: new Set(items.map((i) => i.repo)).size,
      firstSeen: times[0], lastSeen: times[times.length - 1],
    },
    resolves, example: pickExample(items), files,
  };
}

const meets = (c: Cluster, cfg: LearningConfig) => c.evidence.events >= cfg.minEvents && c.evidence.files >= cfg.minFiles && c.evidence.authors >= cfg.minAuthors;

function missing(c: Cluster, cfg: LearningConfig): string[] {
  const m: string[] = [];
  if (c.evidence.events < cfg.minEvents) m.push(`${cfg.minEvents - c.evidence.events} more edit(s)`);
  if (c.evidence.files < cfg.minFiles) m.push(`${cfg.minFiles - c.evidence.files} more file(s)`);
  if (c.evidence.authors < cfg.minAuthors) m.push(`${cfg.minAuthors - c.evidence.authors} more engineer(s)`);
  return m;
}

function readCorrections(root: string): Array<{ skillArea: string; note: string }> {
  const p = path.join(root, "skill-corrections.jsonl");
  if (!fs.existsSync(p)) return [];
  const out: Array<{ skillArea: string; note: string }> = [];
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line) as { skillArea?: string; note?: string };
      if (j.skillArea && j.note) out.push({ skillArea: j.skillArea, note: j.note });
    } catch {
      /* skip */
    }
  }
  return out;
}

// --- the report ---------------------------------------------------------------------

export interface AggregateOptions {
  root: string;
  extraDirs?: string[];
  config?: LearningConfig;
  now?: Date;
}

export function aggregate(opts: AggregateOptions): LearningReport {
  const cfg = opts.config ?? loadConfig(opts.root);
  const records = dedupeRecords(loadRecords(opts.root, opts.extraDirs));
  const flat = flatten(records);
  const patterns = loadPatterns(opts.root);
  const byKey = new Map<string, Flat[]>();
  for (const f of flat) {
    const k = clusterKey(f.e);
    byKey.set(k, [...(byKey.get(k) ?? []), f]);
  }
  const clusters = [...byKey].map(([k, items]) => makeCluster(k, items));
  const patternByKey = new Map(patterns.map((p) => [p.id, p]));

  const candidates: Candidate[] = [];
  const emerging: Candidate[] = [];
  const coaching: Cluster[] = [];
  for (const c of clusters) {
    if (patternByKey.has(c.key)) continue; // approved or rejected: not a candidate
    if (c.direction === "improvement") {
      if (meets(c, cfg)) candidates.push(c);
      else if (c.evidence.events >= 2) emerging.push({ ...c, missing: missing(c, cfg) });
    } else if (c.direction === "regression" && c.evidence.events >= cfg.watchEvents) coaching.push(c);
  }
  const rank = (a: Cluster, b: Cluster) => b.evidence.authors - a.evidence.authors || b.evidence.events - a.evidence.events || a.key.localeCompare(b.key);
  candidates.sort(rank);
  emerging.sort(rank);
  coaching.sort(rank);

  // approved patterns: did engineers keep making the edit AFTER approval?
  const known: LearningReport["known"] = [];
  const recurring: LearningReport["recurringAfterApproval"] = [];
  for (const p of patterns) {
    const after = (byKey.get(p.id) ?? []).filter((f) => f.at > p.approvedAt);
    known.push({ key: p.id, type: p.type, status: p.status, approvedAt: p.approvedAt, recurrences: after.length });
    // only "improvement" patterns can recur in the sense that matters: engineers still hand-fixing what the skill now teaches
    if (p.status === "approved" && p.type === "pattern" && after.length >= cfg.watchEvents) {
      recurring.push({ key: p.id, since: p.approvedAt, recurrences: after.length, authors: new Set(after.map((f) => f.author)).size });
    }
  }
  known.sort((a, b) => a.key.localeCompare(b.key));
  recurring.sort((a, b) => b.recurrences - a.recurrences || a.key.localeCompare(b.key));

  // unstable elements: the same element (JSON key or selector) edited again and again
  const hot = new Map<string, Flat[]>();
  for (const f of flat) {
    if (!f.e.kind.startsWith("locator-") || !f.e.target) continue;
    const k = `${f.e.file}\u0001${f.e.target}`;
    hot.set(k, [...(hot.get(k) ?? []), f]);
  }
  const hotspots: Hotspot[] = [];
  for (const [k, items] of hot) {
    if (items.length < 2) continue;
    const [file, target] = k.split("\u0001");
    hotspots.push({
      file, target, edits: items.length, authors: new Set(items.map((i) => i.author)).size,
      kinds: [...new Set(items.map((i) => clusterKey(i.e)))].sort(),
      advice: file.endsWith(".json")
        ? "Edited repeatedly: give this element a hybrid locator (primary plus 2 fallbacks of different strategies), or ask the app team for a stable data-testid."
        : "Edited repeatedly: move this locator into the locator repository with fallbacks, or ask the app team for a stable data-testid.",
    });
  }
  hotspots.sort((a, b) => b.edits - a.edits || a.file.localeCompare(b.file) || a.target.localeCompare(b.target));

  // reviewer rules: which findings engineers fixed by hand / introduced while fixing something else
  const fixed: Record<string, number> = {}, introduced: Record<string, number> = {};
  for (const r of records) for (const f of r.files) {
    for (const id of f.fixed) fixed[id] = (fixed[id] ?? 0) + 1;
    for (const id of f.introduced) introduced[id] = (introduced[id] ?? 0) + 1;
  }

  // failure -> fix: what engineers actually did for each failure type
  const ff = new Map<string, { info: { entryId: string; classification: string; title: string }; fixes: Map<string, number>; count: number }>();
  for (const f of flat) {
    const r = f.e.resolves;
    if (!r) continue;
    const x = ff.get(r.entryId) ?? { info: r, fixes: new Map(), count: 0 };
    x.count++;
    const k = clusterKey(f.e);
    x.fixes.set(k, (x.fixes.get(k) ?? 0) + 1);
    ff.set(r.entryId, x);
  }
  const failureFixes: FailureFix[] = [...ff.values()]
    .map((x) => ({ ...x.info, count: x.count, fixes: [...x.fixes].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)) }))
    .sort((a, b) => b.count - a.count || a.entryId.localeCompare(b.entryId));

  // per area
  const corr = readCorrections(opts.root);
  const areas: AreaStat[] = SKILL_AREAS.map((area) => {
    const inArea = flat.filter((f) => f.e.area === area);
    const weekly: Record<string, number> = {};
    for (const f of inArea) if (f.e.direction === "improvement" && isoWeek(f.at) !== "unknown") weekly[isoWeek(f.at)] = (weekly[isoWeek(f.at)] ?? 0) + 1;
    const last8 = Object.fromEntries(Object.entries(weekly).sort(([a], [b]) => a.localeCompare(b)).slice(-8));
    return {
      area,
      improvements: inArea.filter((f) => f.e.direction === "improvement").length,
      regressions: inArea.filter((f) => f.e.direction === "regression").length,
      neutral: inArea.filter((f) => f.e.direction === "neutral").length,
      corrections: corr.filter((c) => c.skillArea === area).length,
      approvedPatterns: patterns.filter((p) => p.area === area && p.status === "approved").length,
      weekly: last8,
    };
  });
  const corrByArea = new Map<string, string[]>();
  for (const c of corr) corrByArea.set(c.skillArea, [...(corrByArea.get(c.skillArea) ?? []), oneLine(c.note, 160)]);
  const corrections = [...corrByArea].map(([skillArea, notes]) => ({ skillArea, count: notes.length, latest: notes.slice(-3).reverse() })).sort((a, b) => b.count - a.count || a.skillArea.localeCompare(b.skillArea));

  const times = records.map((r) => r.capturedAt).sort();
  return {
    generatedAt: (opts.now ?? new Date()).toISOString(),
    thresholds: { minEvents: cfg.minEvents, minFiles: cfg.minFiles, minAuthors: cfg.minAuthors, watchEvents: cfg.watchEvents },
    window: {
      records: records.length, events: flat.length, authors: new Set(records.map((r) => r.author)).size, repos: new Set(records.map((r) => r.repo)).size,
      from: times[0], to: times[times.length - 1],
    },
    candidates, emerging, known, recurringAfterApproval: recurring, coaching, hotspots, reviewer: { fixed, introduced }, failureFixes, areas, corrections,
  };
}

// --- markdown -------------------------------------------------------------------------

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");

export function reportMarkdown(r: LearningReport): string {
  const L: string[] = [];
  L.push("# BAT learning report", "");
  L.push(`Generated ${r.generatedAt}. ${r.window.events} distinct edit(s) from ${r.window.authors} engineer(s) in ${r.window.repos} repo(s), across ${r.window.records} capture(s)${r.window.from ? ` (${r.window.from.slice(0, 10)} to ${r.window.to!.slice(0, 10)})` : ""}.`, "");
  L.push(`A pattern becomes a candidate at ${r.thresholds.minEvents}+ edits in ${r.thresholds.minFiles}+ files by ${r.thresholds.minAuthors}+ engineers. Nothing is published until a person runs \`npm run learn-approve -- <key> --by "<name>"\`.`, "");

  const section = (title: string, empty: string, rows: string[]) => {
    L.push(`## ${title}`, "");
    L.push(...(rows.length ? rows : [empty]), "");
  };
  const cand = (c: Candidate) => {
    const out = [`### \`${c.key}\` - ${c.title}`, "", `Area: ${c.area}. ${c.evidence.events} edits, ${c.evidence.files} files, ${c.evidence.authors} engineers (${c.evidence.firstSeen.slice(0, 10)} to ${c.evidence.lastSeen.slice(0, 10)}).${c.missing?.length ? ` Needs ${c.missing.join(", ")}.` : ""}`];
    const res = Object.entries(c.resolves).sort((a, b) => b[1] - a[1]);
    if (res.length) out.push(`Fixed these failures: ${res.map(([id, n]) => `${id} (${n})`).join(", ")}.`);
    if (c.example) out.push("", "```ts", `// before: ${c.example.before ?? "(none)"}`, `// after:  ${c.example.after ?? "(removed)"}`, "```");
    out.push("");
    return out;
  };
  section("Candidates to approve", "None yet.", r.candidates.flatMap(cand));
  section("Emerging (not at the threshold yet)", "None.", r.emerging.slice(0, 10).flatMap(cand));
  section("Approved patterns still being fixed by hand", "None - approved guidance is holding.", r.recurringAfterApproval.map((x) => `- \`${x.key}\`: ${x.recurrences} more edit(s) by ${x.authors} engineer(s) since ${x.since.slice(0, 10)}. The skill says this, but it is not being found or followed: move it higher in the skill, make the generator do it by default, or add a reviewer rule.`));
  section("Coaching signals (regressions: never published as guidance)", "None.", r.coaching.map((c) => `- \`${c.key}\` - ${c.title}: ${c.evidence.events} edits, ${c.evidence.authors} engineers. ${KIND_BY_ID.get(c.kind as never)?.guidance ?? ""}`));
  section("Unstable elements", "None.", r.hotspots.slice(0, 15).map((h) => `- \`${h.target}\` in ${h.file}: ${h.edits} edits by ${h.authors} engineer(s) (${h.kinds.join(", ")}). ${h.advice}`));
  section("How failures were actually fixed", "No edits could be linked to a failure yet (pass --heal-report to learn-capture).", r.failureFixes.slice(0, 15).map((f) => `- ${f.entryId} (${f.classification}) - ${f.title}: ${f.count} fix(es); most often ${f.fixes.slice(0, 3).map((x) => `${x.key} ×${x.count}`).join(", ")}.`));

  const rk = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([k, n]) => `${k} ×${n}`).join(", ") || "none";
  L.push("## Reviewer rules", "", `Fixed by hand most often: ${rk(r.reviewer.fixed)}.`, "", `Introduced while editing: ${rk(r.reviewer.introduced)}.`, "");
  L.push("## By skill area", "", "| Area | Improvements | Regressions | Corrections logged | Approved patterns | Weekly (improvements) |", "|---|---:|---:|---:|---:|---|");
  for (const a of r.areas) L.push(`| ${a.area} | ${a.improvements} | ${a.regressions} | ${a.corrections} | ${a.approvedPatterns} | ${Object.entries(a.weekly).map(([w, n]) => `${w}:${n}`).join(" ") || "-"} |`);
  L.push("");
  const total = r.areas.reduce((s, a) => s + a.improvements + a.regressions + a.neutral, 0);
  L.push(`Share of edits that were regressions: ${pct(r.areas.reduce((s, a) => s + a.regressions, 0), total)}.`, "");
  return L.join("\n");
}

// --- CLI ------------------------------------------------------------------------------

export function main(argv = process.argv.slice(2), cwd = process.cwd()): number {
  let json = true, md = true, stdout = false;
  const extra: string[] = [];
  let outDir = cwd;
  let strictRecurring = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stdout") stdout = true;
    else if (a === "--no-json") json = false;
    else if (a === "--no-md") md = false;
    else if (a === "--strict") strictRecurring = true;
    else if (a === "--events-dir" || a === "--out-dir") {
      const v = argv[++i];
      if (!v) { console.error(`${a} needs a value`); return 2; }
      if (a === "--events-dir") extra.push(v); else outDir = path.resolve(cwd, v);
    } else { console.error(`Unknown option ${a}`); return 2; }
  }
  try {
    const report = aggregate({ root: cwd, extraDirs: extra });
    const text = reportMarkdown(report);
    if (stdout) console.log(text);
    else {
      fs.mkdirSync(outDir, { recursive: true });
      if (json) fs.writeFileSync(path.join(outDir, "learning-report.json"), JSON.stringify(report, null, 2) + "\n");
      if (md) fs.writeFileSync(path.join(outDir, "learning-report.md"), text);
      console.log(`learn-report: ${report.window.events} edit(s) from ${report.window.authors} engineer(s); ${report.candidates.length} candidate(s) to approve, ${report.recurringAfterApproval.length} approved pattern(s) still recurring, ${report.coaching.length} coaching signal(s).`);
    }
    return strictRecurring && report.recurringAfterApproval.length ? 1 : 0;
  } catch (e) {
    console.error(`learn-report: ${(e as Error).message}`);
    return 2;
  }
}

if (require.main === module) process.exit(main());
