import fs from "fs";
import path from "path";
import { SKILL_AREAS, SkillArea } from "./skillAreas";
import { TREND_DIR, LEGACY_TREND_FILE } from "../core/FlakyQuarantineReporter";

/**
 * The read/aggregate side of the continuous-improvement loop
 * (.github/skills/continuous-improvement/SKILL.md). Turns raw signal
 * (skill-corrections.jsonl + the .flaky-trend/ shard files) into a ranked
 * report the skill-curator agent uses to decide which SKILL.md to work on
 * first.
 *
 * Usage: npm run analyze-skills [-- --days 30]
 */
const CORRECTIONS_FILE = path.join(__dirname, "..", "..", "skill-corrections.jsonl");
const REPORT_FILE = path.join(__dirname, "..", "..", "skill-attention-report.json");
/** Very generous cap on how much flaky history one report will ever summarize. */
const MAX_FLAKY_ENTRIES = 10_000;

interface CorrectionEntry {
  timestamp: string;
  skillArea: string;
  file: string;
  note: string;
}

interface FlakyEntry {
  title: string;
  file: string;
  retries: number;
  finalStatus: string;
  runAt: string;
}

interface AttentionRow {
  skillArea: SkillArea;
  count: number;
  sources: { corrections: number; flakyTrend: number };
}

function readJsonLines<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

function readJsonArray<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T[];
}

/**
 * Reads every per-run shard FlakyQuarantineReporter wrote to .flaky-trend/,
 * plus the legacy single flaky-trend.json if one is still around from
 * before that reporter switched to per-run files (kept for one release so
 * upgrading doesn't silently lose history). A shard that fails to parse
 * (e.g. truncated by a killed CI job mid-write) is skipped with a warning
 * rather than crashing the whole analysis.
 */
function readAllFlakyEntries<T>(): T[] {
  const all: T[] = [];

  if (fs.existsSync(TREND_DIR)) {
    for (const name of fs.readdirSync(TREND_DIR)) {
      if (!name.endsWith(".json")) continue;
      const full = path.join(TREND_DIR, name);
      try {
        all.push(...(JSON.parse(fs.readFileSync(full, "utf-8")) as T[]));
      } catch (err) {
        console.warn(`[analyze-skills] skipping unreadable flaky-trend shard ${full}: ${(err as Error).message}`);
      }
    }
  }

  all.push(...readJsonArray<T>(LEGACY_TREND_FILE));
  return all;
}

/** Exported for tests/meta/unit.spec.ts. */
export function withinWindow(iso: string, days: number | null): boolean {
  if (days === null) return true;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(iso).getTime() >= cutoff;
}

/**
 * Caps a chronologically-sortable list to its most recent `max` entries.
 * Exported for tests/meta/unit.spec.ts; used above to bound how much flaky
 * history a single report will ever summarize.
 */
export function capToMostRecent<T>(sortedOldestFirst: T[], max: number): T[] {
  return sortedOldestFirst.length > max ? sortedOldestFirst.slice(sortedOldestFirst.length - max) : sortedOldestFirst;
}

function main() {
  const daysArgIndex = process.argv.indexOf("--days");
  const days = daysArgIndex !== -1 ? Number(process.argv[daysArgIndex + 1]) : null;

  const corrections = readJsonLines<CorrectionEntry>(CORRECTIONS_FILE).filter((c) =>
    withinWindow(c.timestamp, days)
  );
  const flakyAll = readAllFlakyEntries<FlakyEntry>()
    .filter((f) => withinWindow(f.runAt, days))
    .sort((a, b) => a.runAt.localeCompare(b.runAt));
  const flaky = capToMostRecent(flakyAll, MAX_FLAKY_ENTRIES);

  const counts: Record<SkillArea, AttentionRow> = Object.fromEntries(
    SKILL_AREAS.map((area) => [area, { skillArea: area, count: 0, sources: { corrections: 0, flakyTrend: 0 } }])
  ) as Record<SkillArea, AttentionRow>;

  for (const c of corrections) {
    const row = counts[c.skillArea as SkillArea];
    if (!row) continue; // unrecognized tag - log-correction should have rejected this already
    row.count += 1;
    row.sources.corrections += 1;
  }

  // A retried-but-eventually-passing test is weak, general evidence of a
  // timing/stability issue - it doesn't know which specific skill area is
  // at fault, so it nudges the two most likely candidates rather than
  // being force-attributed to one. See continuous-improvement/SKILL.md.
  for (const _f of flaky) {
    counts["synchronization-strategy"].count += 1;
    counts["synchronization-strategy"].sources.flakyTrend += 1;
    counts["execution-stabilization"].count += 1;
    counts["execution-stabilization"].sources.flakyTrend += 1;
  }

  const ranked = Object.values(counts).sort((a, b) => b.count - a.count);

  const report = {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    totalCorrections: corrections.length,
    totalFlakyEntries: flaky.length,
    ranked,
  };

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  console.log(`[analyze-skills] ${corrections.length} correction(s), ${flaky.length} flaky-trend entr(y/ies) analyzed.`);
  console.log("[analyze-skills] Ranked skill attention:");
  for (const row of ranked) {
    if (row.count === 0) continue;
    console.log(`  ${row.skillArea.padEnd(28)} ${row.count} (corrections: ${row.sources.corrections}, flaky: ${row.sources.flakyTrend})`);
  }
  console.log(`[analyze-skills] Wrote ${REPORT_FILE}`);
}

if (require.main === module) {
  main();
}
