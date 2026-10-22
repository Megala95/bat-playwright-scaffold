import crypto from "crypto";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { classifyChange } from "./classify";
import { EVENTS_DIR, isLearnable, loadConfig } from "./config";
import { redact } from "./redact";
import { CaptureRecord, CaptureSource, FileReview, LearningConfig, LearningEvent } from "./types";
import type { HealReport } from "../healer/types";

/**
 * Capture: turn a git change into a CaptureRecord (events + reviewer delta).
 *
 *   npm run learn-capture -- --staged   [--write]       what is about to be committed (pre-commit hook)
 *   npm run learn-capture -- --worktree [--write]       local edits against HEAD (after a Copilot session, before staging)
 *   npm run learn-capture -- --commit <sha> [--write]   one commit
 *   npm run learn-capture -- --range <a>..<b> [--write] every non-merge commit in a PR / push (CI)
 *
 * Options: --why "<text>"  --heal-report <file>  --out-dir <dir>  --dry-run  --quiet  --summary
 *
 * Only MODIFIED files that match the include/exclude patterns are learned
 * from (.learnings/config.json): a brand-new test file says nothing about
 * what an engineer had to correct.
 */

function git(cwd: string, args: string[], allowFail = false): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    if (allowFail) return "";
    throw new Error(`git ${args.join(" ")} failed: ${((e as { stderr?: Buffer | string }).stderr ?? "").toString().trim() || (e as Error).message}`);
  }
}

/**
 * Pseudonymous, not anonymous: anyone holding the salt and a list of e-mail addresses can check who is in
 * the data. In a private repository set BAT_LEARN_SALT so the salt itself is not committed.
 */
export const hashAuthor = (email: string, salt: string) =>
  crypto.createHash("sha256").update(`${salt}\u0001${email.trim().toLowerCase()}`).digest("hex").slice(0, 12);

/** A git ref from the command line must not be able to turn into an option (git rev-list --output=/some/file). */
export function safeRef(ref: string): string {
  if (!ref || ref.startsWith("-") || /[\s\0]/.test(ref)) throw new Error(`"${ref}" is not a valid git ref or range`);
  return ref;
}

/** Repository identity without credentials or host-specific noise, so two clones of one repo hash the same. */
export function repoId(cwd: string): string {
  const remote = git(cwd, ["config", "--get", "remote.origin.url"], true).trim();
  const basis = remote
    ? remote.replace(/^[a-z+]+:\/\//i, "").replace(/^[^@/]*@/, "").replace(/:/, "/").replace(/\.git$/, "").toLowerCase()
    : path.basename(git(cwd, ["rev-parse", "--show-toplevel"], true).trim() || cwd);
  return crypto.createHash("sha1").update(basis).digest("hex").slice(0, 8);
}

const showBlob = (cwd: string, spec: string): string | undefined => {
  try {
    return execFileSync("git", ["show", spec], { cwd, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
};

const splitZ = (s: string) => s.split("\0").filter(Boolean);

interface Source {
  files: string[];
  before: (f: string) => string | undefined;
  after: (f: string) => string | undefined;
}

function sourceFor(cwd: string, kind: "staged" | "worktree" | "commit" | "range", ref?: string, base?: string): Source {
  if (kind === "staged") {
    return {
      files: splitZ(git(cwd, ["diff", "--cached", "--name-only", "--no-renames", "--diff-filter=M", "-z"])),
      before: (f) => showBlob(cwd, `HEAD:${f}`),
      after: (f) => showBlob(cwd, `:${f}`),
    };
  }
  if (kind === "worktree") {
    return {
      files: splitZ(git(cwd, ["diff", "HEAD", "--name-only", "--no-renames", "--diff-filter=M", "-z"])),
      before: (f) => showBlob(cwd, `HEAD:${f}`),
      after: (f) => {
        try { return fs.readFileSync(path.join(cwd, f), "utf-8"); } catch { return undefined; }
      },
    };
  }
  if (kind === "range") {
    return {
      files: splitZ(git(cwd, ["diff-tree", "-r", "--no-commit-id", "--name-only", "--no-renames", "--diff-filter=M", "-z", base!, ref!])),
      before: (f) => showBlob(cwd, `${base}:${f}`),
      after: (f) => showBlob(cwd, `${ref}:${f}`),
    };
  }
  return {
    files: splitZ(git(cwd, ["diff-tree", "-r", "--no-commit-id", "--name-only", "--no-renames", "--diff-filter=M", "-z", `${ref}^`, ref!])),
    before: (f) => showBlob(cwd, `${ref}^:${f}`),
    after: (f) => showBlob(cwd, `${ref}:${f}`),
  };
}

export interface CaptureOptions {
  cwd: string;
  why?: string;
  config?: LearningConfig;
  healReport?: HealReport;
  /** Where warnings go (default: stderr). */
  warn?: (msg: string) => void;
}

function build(source: CaptureSource, src: Source, opts: CaptureOptions, meta: { commit?: string; email: string; why?: string }): CaptureRecord {
  const cfg = opts.config ?? loadConfig(opts.cwd);
  const events: LearningEvent[] = [];
  const files: FileReview[] = [];
  const why = redact(meta.why ?? opts.why, 160);
  for (const f of src.files) {
    if (!isLearnable(f, cfg)) continue;
    const before = src.before(f), after = src.after(f);
    if (before === undefined || after === undefined) continue;
    let r: ReturnType<typeof classifyChange>;
    try {
      r = classifyChange(f, before, after);
    } catch (e) {
      // one file the classifier cannot handle must not lose the rest of the commit
      (opts.warn ?? console.error)(`learn-capture: skipped ${f}: ${(e as Error).message}`);
      continue;
    }
    if (r.skipped) (opts.warn ?? console.error)(`learn-capture: ${f}: ${r.skipped}`);
    for (const e of r.events) {
      const ev = cfg.storeStatements ? e : { ...e, before: undefined, after: undefined, target: undefined };
      events.push(why ? { ...ev, why } : ev);
    }
    if (r.review.fixed.length || r.review.introduced.length) files.push(r.review);
  }
  if (opts.healReport) linkFailures(events, opts.healReport);
  return {
    schema: 1, capturedAt: new Date().toISOString(), source, commit: meta.commit,
    author: hashAuthor(meta.email, cfg.salt), repo: repoId(opts.cwd), files, events,
  };
}

export function captureStaged(opts: CaptureOptions): CaptureRecord {
  const email = git(opts.cwd, ["config", "user.email"], true).trim() || "unknown";
  return build("staged", sourceFor(opts.cwd, "staged"), opts, { email });
}

export function captureWorktree(opts: CaptureOptions): CaptureRecord {
  const email = git(opts.cwd, ["config", "user.email"], true).trim() || "unknown";
  return build("worktree", sourceFor(opts.cwd, "worktree"), opts, { email });
}

/** Returns undefined for the root commit and for merge commits (their changes were captured on the branch). */
export function captureCommit(opts: CaptureOptions, ref: string): CaptureRecord | undefined {
  safeRef(ref);
  const [sha, ...parents] = git(opts.cwd, ["rev-list", "--parents", "-n", "1", ref]).trim().split(/\s+/);
  if (parents.length !== 1) return undefined;
  const [email, subject] = git(opts.cwd, ["log", "-1", "--format=%ae%x00%s", sha]).split("\0");
  return build("commit", sourceFor(opts.cwd, "commit", sha), opts, { commit: sha.slice(0, 12), email: email.trim(), why: subject?.trim() });
}

/**
 * A pull request or a push, captured as ONE net change (merge base to tip), not commit by commit:
 * a branch that adds a debug sleep and removes it two commits later has no net edit, and a squash
 * merge and a branch of small commits come out the same. The author is the tip commit's author.
 */
export function captureRange(opts: CaptureOptions, range: string): CaptureRecord[] {
  safeRef(range);
  const m = /^(.+?)(\.\.\.?)(.+)$/.exec(range);
  if (!m) throw new Error(`"${range}" is not a range: use <base>..<head>`);
  const [, a, , b] = m;
  safeRef(a);
  safeRef(b);
  const tip = git(opts.cwd, ["rev-parse", "--verify", `${b}^{commit}`]).trim();
  const base = git(opts.cwd, ["merge-base", a, tip], true).trim() || git(opts.cwd, ["rev-parse", "--verify", `${a}^{commit}`]).trim();
  if (base === tip) return [];
  const [email] = git(opts.cwd, ["log", "-1", "--format=%ae", tip]).split("\n");
  const subjects = git(opts.cwd, ["log", "--no-merges", "--format=%s", "-n", "3", `${base}..${tip}`], true).split("\n").filter(Boolean);
  const r = build("range", sourceFor(opts.cwd, "range", tip, base), opts, { commit: tip.slice(0, 12), email: email.trim(), why: subjects.join("; ") || undefined });
  return r.events.length || r.files.length ? [r] : [];
}

/**
 * Failure -> fix link. A heal-report from the run BEFORE the fix says which
 * tests failed and why (catalog entry); an edit to that test's file is, with
 * good odds, the fix for it. Matching is by file only (and a single catalog
 * entry per file; when a file had several kinds of failure the link is
 * skipped rather than guessed), which is stated in the skill so nobody
 * over-reads it.
 */
export function linkFailures(events: LearningEvent[], report: HealReport): void {
  const byFile = new Map<string, Map<string, { entryId: string; classification: string; title: string }>>();
  for (const c of report.clusters ?? []) {
    for (const t of report.failures ?? []) {
      if (t.diagnosis?.entryId !== c.entryId) continue;
      const file = t.file.replace(/\\/g, "/");
      const m = byFile.get(file) ?? new Map();
      m.set(c.entryId, { entryId: c.entryId, classification: c.classification, title: c.title });
      byFile.set(file, m);
    }
  }
  for (const e of events) {
    const m = byFile.get(e.file);
    if (m && m.size === 1) e.resolves = [...m.values()][0];
  }
}

export function recordFileName(r: CaptureRecord): string {
  if (r.commit && (r.source === "commit" || r.source === "range")) return `c-${r.commit}.json`;
  const h = crypto.createHash("sha1").update([...r.events.map((e) => e.id).sort(), ...r.files.map((f) => `${f.file}|${f.fixed}|${f.introduced}`).sort(), r.author].join(",")).digest("hex").slice(0, 12);
  return `${r.source}-${h}.json`;
}

/** Writes a record (idempotently: the same capture twice writes the same file). Returns the path, or undefined when there was nothing to learn. */
export function writeRecord(root: string, r: CaptureRecord, outDir = EVENTS_DIR): string | undefined {
  if (r.events.length === 0 && r.files.length === 0) return undefined;
  const dir = path.isAbsolute(outDir) ? outDir : path.join(root, outDir);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, recordFileName(r));
  fs.writeFileSync(p, JSON.stringify(r, null, 2) + "\n");
  return p;
}

export function summarize(records: CaptureRecord[]): string {
  const events = records.flatMap((r) => r.events);
  if (events.length === 0) return "no learnable changes";
  const by = new Map<string, number>();
  for (const e of events) by.set(`${e.kind}${e.subkind ? `:${e.subkind}` : ""}`, (by.get(`${e.kind}${e.subkind ? `:${e.subkind}` : ""}`) ?? 0) + 1);
  const regressions = events.filter((e) => e.direction === "regression").length;
  return `${events.length} learning event(s)${regressions ? `, ${regressions} regression(s)` : ""}: ` + [...by].map(([k, n]) => `${k}×${n}`).join(", ");
}

// --- CLI ------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const o: { mode?: "staged" | "worktree" | "commit" | "range"; ref?: string; write: boolean; dry: boolean; quiet: boolean; summary: boolean; why?: string; heal?: string; outDir?: string } = {
    write: false, dry: false, quiet: false, summary: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--staged") o.mode = "staged";
    else if (a === "--worktree") o.mode = "worktree";
    else if (a === "--commit") { o.mode = "commit"; o.ref = safeRef(val()); }
    else if (a === "--range") { o.mode = "range"; o.ref = safeRef(val()); }
    else if (a === "--write") o.write = true;
    else if (a === "--dry-run") o.dry = true;
    else if (a === "--quiet") o.quiet = true;
    else if (a === "--summary") o.summary = true;
    else if (a === "--why") o.why = val();
    else if (a === "--heal-report") o.heal = val();
    else if (a === "--out-dir") o.outDir = val();
    else throw new Error(`Unknown option ${a}`);
  }
  if (!o.mode) throw new Error("Choose a source: --staged, --worktree, --commit <sha> or --range <a>..<b>");
  return o;
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()): number {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  try {
    const top = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
    let healReport: HealReport | undefined;
    // An explicit --heal-report is always used. A heal-report lying in the working directory is picked up only on an
    // engineer's machine and only when it is recent: in CI it would be this build's own report, and an old one would
    // link edits to failures they did not fix.
    const local = path.join(top, "heal-report.json");
    const inCi = !!(process.env.CI || process.env.JENKINS_URL);
    const healPath = o.heal ?? (!inCi && fs.existsSync(local) ? local : undefined);
    if (healPath) {
      try {
        healReport = JSON.parse(fs.readFileSync(healPath, "utf-8"));
        const age = Date.now() - new Date(healReport?.generatedAt ?? 0).getTime();
        if (!o.heal && !(age >= 0 && age < 48 * 3600 * 1000)) healReport = undefined;
      } catch (e) {
        if (o.heal) throw new Error(`--heal-report ${o.heal}: ${(e as Error).message}`);
      }
    }
    const opts: CaptureOptions = { cwd: top, why: o.why ?? process.env.LEARN_WHY, healReport };
    const records: CaptureRecord[] =
      o.mode === "staged" ? [captureStaged(opts)]
      : o.mode === "worktree" ? [captureWorktree(opts)]
      : o.mode === "commit" ? [captureCommit(opts, o.ref!)].filter((x): x is CaptureRecord => !!x)
      : captureRange(opts, o.ref!);
    const written: string[] = [];
    if (o.write && !o.dry) for (const r of records) { const p = writeRecord(top, r, o.outDir); if (p) written.push(path.relative(top, p)); }
    if (!o.quiet) {
      console.log(`learn-capture (${o.mode}): ${summarize(records)}`);
      if (o.summary) for (const e of records.flatMap((r) => r.events)) console.log(`  ${e.direction === "regression" ? "!" : "+"} ${e.kind}${e.subkind ? `:${e.subkind}` : ""}  ${e.file}${e.line ? `:${e.line}` : ""}`);
      for (const w of written) console.log(`  wrote ${w}`);
      if (!o.write && records.some((r) => r.events.length)) console.log("  (not saved - add --write to keep it)");
    }
    return 0;
  } catch (e) {
    console.error(`learn-capture: ${(e as Error).message}`);
    return 2;
  }
}

if (require.main === module) process.exit(main());
