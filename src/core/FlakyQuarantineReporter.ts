import type { Reporter, TestCase, TestResult, FullResult } from "@playwright/test/reporter";
import fs from "fs";
import path from "path";

/**
 * Item 3.3: "controlled retry-with-reporting" and "track flaky tests
 * separately (quarantine list + trend view) so they don't mask genuine
 * failures."
 *
 * Playwright's built-in `retries` config (see playwright.config.ts) handles
 * the retry mechanics. This reporter adds the visibility layer on top: any
 * test that only passed after at least one retry gets logged as a flaky
 * "trend" entry instead of silently showing green. Feed this into the
 * biweekly improvement review described in the GitHub Copilot playbook's
 * "Continuous Improvement Loop" section (via `npm run analyze-skills`).
 *
 * Promote a test from "flaky" to the quarantine.json list (read by
 * playwright.config.ts to exclude it from the main gating run) once it has
 * shown up a few times, per item 3.1's RCA process - never quarantine on a
 * single occurrence without at least looking at it.
 *
 * ONE FILE PER RUN, NOT ONE SHARED FILE: this used to read-modify-write a
 * single flaky-trend.json, which is safe for one process but corrupts
 * silently under the concurrency this project's own CI configs introduce -
 * both `.github/workflows/playwright.yml`'s matrix shards and the
 * Jenkinsfile's `parallel` stage run several `npx playwright test`
 * processes against the same workspace at once, each with its own
 * in-memory `onEnd()` doing an unlocked read-modify-write on the same file.
 * Writing each run's entries to its own uniquely-named file under
 * `.flaky-trend/` instead makes that race structurally impossible - there's
 * nothing to lose, because nothing is shared. `analyzeSkillSignals.ts`
 * reads every file in the directory and merges them at analysis time,
 * which is a safe place to do it: one reader, run on demand, not N writers
 * racing each other.
 */
const TREND_DIR = path.join(__dirname, "..", "..", ".flaky-trend");
/** Read (not written) for one release, so upgrading doesn't lose history. */
const LEGACY_TREND_FILE = path.join(__dirname, "..", "..", "flaky-trend.json");

/**
 * Each run's own shard file is small (typically a handful of entries) and
 * never rewritten, so there's no per-write pruning to do here - unlike the
 * old single-file design. What still needs bounding is the DIRECTORY: a
 * long-lived repo would otherwise accumulate one file per CI run forever.
 * Each run's `onEnd()` also deletes any shard file older than
 * MAX_AGE_DAYS. This is safe under concurrency - `unlinkSync` on an
 * already-deleted file just throws ENOENT, which is caught and ignored -
 * and only ever targets files old enough that no concurrent run is still
 * writing them.
 */
const MAX_AGE_DAYS = 90;

interface FlakyEntry {
  title: string;
  file: string;
  retries: number;
  finalStatus: string;
  runAt: string;
}

function pruneOldShards(): void {
  if (!fs.existsSync(TREND_DIR)) return;
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(TREND_DIR)) {
    const full = path.join(TREND_DIR, name);
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
      }
    } catch {
      // Already removed by a concurrent run, or a transient race on stat -
      // either way, nothing left to prune here.
    }
  }
}

export default class FlakyQuarantineReporter implements Reporter {
  private entries: FlakyEntry[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.retry > 0) {
      this.entries.push({
        title: test.titlePath().join(" > "),
        file: test.location.file,
        retries: result.retry,
        finalStatus: result.status,
        runAt: new Date().toISOString(),
      });
    }
  }

  onEnd(_result: FullResult): void {
    pruneOldShards();
    if (this.entries.length === 0) return;

    fs.mkdirSync(TREND_DIR, { recursive: true });
    const shardFile = path.join(TREND_DIR, `run-${Date.now()}-${process.pid}.json`);
    fs.writeFileSync(shardFile, JSON.stringify(this.entries, null, 2));

    console.warn(
      `[FlakyQuarantineReporter] ${this.entries.length} test(s) needed a retry this run - ` +
        `wrote ${shardFile}. Run "npm run analyze-skills" to aggregate across all runs. ` +
        `Recurring entries are candidates for quarantine.json (item 3.3).`
    );
  }
}

/** Exported so analyzeSkillSignals.ts (and the legacy file) share one source of truth. */
export { TREND_DIR, LEGACY_TREND_FILE };
