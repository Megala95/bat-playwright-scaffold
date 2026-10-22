import crypto from "crypto";
import fs from "fs";
import path from "path";
import { aggregate, Cluster } from "./aggregate";
import { PATTERNS_DIR, loadConfig } from "./config";
import { KIND_BY_ID } from "./kinds";
import { redact } from "./redact";
import { Pattern } from "./types";

/**
 * The human gate. Nothing the system observed becomes guidance until a
 * named person runs this, after reading learning-report.md.
 *
 *   npm run learn-approve -- <key> --by "<name>"            approve a candidate (refuses below the thresholds unless --force)
 *   npm run learn-approve -- <key> --by "<name>" --retire   withdraw an approved pattern, or reject a candidate for good
 *
 * Approved patterns are small JSON files in .learnings/patterns/ and reach
 * the skills through `npm run learn-publish`. The wording of a pattern is the
 * curated text in src/learning/kinds.ts - data supplies only the evidence
 * and an example - so a bad habit can only ever be published as "avoid this".
 */

/** Readable slug plus a short hash of the exact key, so keys that differ only in punctuation never share a file. */
export const patternFile = (key: string) =>
  `${key.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60)}-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 6)}.json`;

export function validKey(key: string): boolean {
  const [kind] = key.split(":");
  return /^[a-z][a-z0-9-]*(:[A-Za-z0-9_.\-> +()]+)?$/.test(key) && KIND_BY_ID.has(kind as never);
}

export interface ApproveResult {
  ok: boolean;
  message: string;
  pattern?: Pattern;
  file?: string;
}

function save(root: string, p: Pattern): string {
  const dir = path.join(root, PATTERNS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, patternFile(p.id));
  fs.writeFileSync(file, JSON.stringify(p, null, 2) + "\n");
  return file;
}

function readExisting(root: string, key: string): Pattern | undefined {
  const f = path.join(root, PATTERNS_DIR, patternFile(key));
  if (!fs.existsSync(f)) return undefined;
  try { return JSON.parse(fs.readFileSync(f, "utf-8")) as Pattern; } catch { return undefined; }
}

export function approve(root: string, key: string, by: string, opts: { force?: boolean; now?: Date; extraDirs?: string[] } = {}): ApproveResult {
  if (!validKey(key)) return { ok: false, message: `"${key}" is not a known pattern key. Use a key from learning-report.md (kind or kind:subkind).` };
  const who = redact(by.trim(), 60) ?? "";
  if (!who) return { ok: false, message: '--by "<your name>" is required: approval is a named person\'s decision.' };
  const existing = readExisting(root, key);
  if (existing?.status === "approved") return { ok: false, message: `${key} is already approved. Retire it first (--retire) if you want to re-approve with fresh evidence.` };
  if (existing?.status === "retired") return { ok: false, message: `${key} was retired or rejected. Delete .learnings/patterns/${patternFile(key)} if you really want to reconsider it.` };

  const cfg = loadConfig(root);
  const report = aggregate({ root, config: cfg, now: opts.now, extraDirs: opts.extraDirs });
  const cluster: Cluster | undefined = [...report.candidates, ...report.emerging, ...report.coaching].find((c) => c.key === key);
  const info = KIND_BY_ID.get(key.split(":")[0] as never)!;
  if (info.direction === "neutral") return { ok: false, message: `${info.kind} is counted but never published: it is not a pattern by itself (see its guidance in kinds.ts).` };
  if (!cluster) return { ok: false, message: `${key} has no recorded edits that qualify (is it listed in learning-report.md?).` };
  const isCandidate = report.candidates.some((c) => c.key === key);
  if (!isCandidate && info.direction === "improvement" && !opts.force) {
    const m = report.emerging.find((c) => c.key === key)?.missing?.join(", ");
    return { ok: false, message: `${key} is below the thresholds (needs ${m ?? "more evidence"}). Use --force only if you know it is a real pattern.` };
  }
  const subkind = key.includes(":") ? key.slice(key.indexOf(":") + 1) : undefined;
  const p: Pattern = {
    schema: 1, id: key, type: info.direction === "regression" ? "anti-pattern" : "pattern", title: cluster.title, area: info.area, kind: info.kind, ...(subkind ? { subkind } : {}),
    problem: info.problem, guidance: info.guidance, ...(cluster.example ? { example: cluster.example } : {}),
    evidence: cluster.evidence, resolves: cluster.resolves, status: "approved", approvedAt: (opts.now ?? new Date()).toISOString(), approvedBy: who,
  };
  return { ok: true, message: `Approved ${key} (${p.type}) for ${p.area}. Run npm run learn-publish to update the skill.`, pattern: p, file: save(root, p) };
}

export function retire(root: string, key: string, by: string, now = new Date()): ApproveResult {
  if (!validKey(key)) return { ok: false, message: `"${key}" is not a known pattern key.` };
  const who = redact(by.trim(), 60) ?? "";
  if (!who) return { ok: false, message: '--by "<your name>" is required.' };
  const info = KIND_BY_ID.get(key.split(":")[0] as never)!;
  const subkind = key.includes(":") ? key.slice(key.indexOf(":") + 1) : undefined;
  const existing = readExisting(root, key);
  const p: Pattern = existing
    ? { ...existing, status: "retired" }
    : {
        schema: 1, id: key, type: info.direction === "regression" ? "anti-pattern" : "pattern", title: info.title, area: info.area, kind: info.kind, ...(subkind ? { subkind } : {}),
        problem: info.problem, guidance: info.guidance,
        evidence: { events: 0, files: 0, authors: 0, repos: 0, firstSeen: now.toISOString(), lastSeen: now.toISOString() }, resolves: {}, status: "retired", approvedAt: now.toISOString(), approvedBy: who,
      };
  return { ok: true, message: `Retired ${key}. It no longer appears in the skill after learn-publish, and will not be proposed again.`, pattern: p, file: save(root, p) };
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()): number {
  const pos: string[] = [];
  let by = "", force = false, doRetire = false;
  const extra: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--by") by = argv[++i] ?? "";
    else if (a === "--force") force = true;
    else if (a === "--events-dir") { const v = argv[++i]; if (!v) { console.error("--events-dir needs a value"); return 2; } extra.push(v); }
    else if (a === "--retire" || a === "--reject") doRetire = true;
    else if (a.startsWith("--")) { console.error(`Unknown option ${a}`); return 2; }
    else pos.push(a);
  }
  if (pos.length !== 1) { console.error('Usage: learn-approve <key> --by "<name>" [--retire] [--force] [--events-dir <dir>]'); return 2; }
  const r = doRetire ? retire(cwd, pos[0], by) : approve(cwd, pos[0], by, { force, extraDirs: extra });
  (r.ok ? console.log : console.error)(r.message);
  return r.ok ? 0 : 1;
}

if (require.main === module) process.exit(main());
