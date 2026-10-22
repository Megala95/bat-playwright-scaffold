import fs from "fs";
import path from "path";
import catalogJson from "./errorCatalog.json";
import {
  CatalogEntry,
  Cluster,
  Diagnosis,
  FailedTest,
  HealReport,
  RunError,
  Verdict,
} from "./types";

/**
 * The "intelligent healer", analysis half. Reads a Playwright JSON report
 * (test-results/results.json, written by playwright.config.ts's json
 * reporter), and for every failed or flaky test:
 *
 *   1. classifies the error against a catalog of KNOWN failure patterns
 *      (src/healer/errorCatalog.json - validated against real Playwright
 *      output by tests/meta/healer.spec.ts), deciding WHO should act;
 *   2. checks whether the attempts failed the same way (deterministic) or
 *      differently (timing / shared state);
 *   3. groups failures that share a root cause, so one fix is applied once;
 *   4. decides whether the run looks like an ENVIRONMENT problem - in which
 *      case the right move is to stop editing tests at all.
 *
 * This file only diagnoses. It never edits a test. The failure-healing skill
 * (.github/skills/failure-healing/SKILL.md) tells the agent how to act on the
 * report, including the guardrails (no loosening, no sleeping, no force).
 *
 * Usage: npm run heal-analyze [-- <results.json> [<more.json> ...]] [-- --out heal-report.json]
 * (several files = the per-shard reports of one sharded run; they are merged first)
 */

const CATALOG = catalogJson as CatalogEntry[];

/**
 * Configuration problems that look like test failures but are fixed outside the test
 * (in addition to everything classified "environment"): an unset variable or a
 * placeholder is fixed by supplying the value, not by editing the test.
 */
const CONFIG_ENTRY_IDS = new Set(["placeholder-in-error", "invalid-url", "auth-session-redirect", "test-data-undefined"]);

const UNKNOWN: CatalogEntry = {
  id: "unknown",
  title: "Unrecognised failure",
  classification: "unknown",
  healing: "assisted",
  confidence: "low",
  match: [],
  diagnosis: "The error does not match any known pattern in the catalog.",
  evidence: ["Full error, call log and trace", "Last successful step"],
  fixes: [
    "Read the call log to see what Playwright was doing, then follow the closest catalog entry.",
    'Log it so the catalog learns this pattern: npm run log-correction -- failure-healing <file> "<error>"',
  ],
  neverDo: ["Guessing a fix without evidence.", "Raising timeouts."],
  skillArea: "failure-healing",
  example: "",
};

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

function compile(entry: CatalogEntry): { all: RegExp[]; none: RegExp[] } {
  return {
    all: entry.match.map((m) => new RegExp(m, "im")),
    none: (entry.exclude ?? []).map((m) => new RegExp(m, "im")),
  };
}

const COMPILED = new Map<string, { all: RegExp[]; none: RegExp[] }>(CATALOG.map((e) => [e.id, compile(e)]));

/** Exported for tests. The first catalog entry whose patterns all match (and none of whose excludes match) wins - so order in the file is priority. */
export function classifyError(rawMessage: string): CatalogEntry {
  const message = stripAnsi(rawMessage ?? "");
  if (!message.trim()) return UNKNOWN;
  for (const entry of CATALOG) {
    const c = COMPILED.get(entry.id)!;
    if (c.all.every((r) => r.test(message)) && !c.none.some((r) => r.test(message))) {
      return entry;
    }
  }
  return UNKNOWN;
}

/** Pulls out what the failure was about (locator, URL, event) so failures can be grouped and the fix aimed. */
export function extractTarget(rawMessage: string): string | undefined {
  const message = stripAnsi(rawMessage ?? "");
  const patterns: RegExp[] = [
    /^Locator:\s*(.+)$/m,
    /strict mode violation:\s*(.+?)\s+resolved to/m,
    /waiting for (getBy[A-Za-z]+\(.*\)|locator\(.*\))(?: to be \w+)?\s*$/m,
    /navigating to "([^"]+)"/m,
    /waiting for event "([^"]+)"/m,
    /waiting for response "([^"]+)"/m,
    /^Expected (?:pattern|string):\s*(.+)$/m,
  ];
  for (const p of patterns) {
    const m = message.match(p);
    if (m) return m[1].trim();
  }
  return undefined;
}

function toDiagnosis(e: CatalogEntry): Diagnosis {
  return {
    entryId: e.id,
    title: e.title,
    classification: e.classification,
    healing: e.healing,
    confidence: e.confidence,
    diagnosis: e.diagnosis,
    evidence: e.evidence,
    fixes: e.fixes,
    neverDo: e.neverDo,
    skillArea: e.skillArea,
  };
}

// --- Playwright JSON reporter shapes (only what is read) --------------------

interface PwResult {
  status?: string;
  retry?: number;
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
  attachments?: Array<{ name?: string; path?: string }>;
}
interface PwTest {
  projectName?: string;
  status?: string;
  results?: PwResult[];
}
interface PwSpec {
  title: string;
  file?: string;
  line?: number;
  tests?: PwTest[];
}
interface PwSuite {
  title?: string;
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}
export interface PwReport {
  suites?: PwSuite[];
  /** Errors that belong to the run, not to a test - e.g. globalSetup threw. */
  errors?: Array<{ message?: string }>;
}

interface Flat {
  title: string;
  file: string;
  line?: number;
  test: PwTest;
}

function flatten(suites: PwSuite[] | undefined, trail: string[], out: Flat[]): void {
  for (const s of suites ?? []) {
    // The top-level suite is the file itself; only describe() blocks belong in the title.
    const isFileSuite = !!s.file && s.title === s.file;
    const next = isFileSuite || !s.title ? trail : [...trail, s.title];
    for (const spec of s.specs ?? []) {
      for (const test of spec.tests ?? []) {
        out.push({
          title: [...next, spec.title].join(" › "),
          file: spec.file ?? s.file ?? "",
          line: spec.line,
          test,
        });
      }
    }
    flatten(s.suites, next, out);
  }
}

function messageOf(r: PwResult): string {
  return r.error?.message || r.errors?.[0]?.message || "";
}

/** First meaningful line, with volatile parts (numbers, quoted values, addresses) normalised, so unrelated errors with no extractable target are not lumped together. */
function signature(message: string): string {
  const first = stripAnsi(message).split("\n").map((l) => l.trim()).find((l) => l) ?? "";
  return first.replace(/0x[0-9a-f]+/gi, "0x#").replace(/\d+/g, "#").replace(/(["'`]).*?\1/g, "$1…$1").slice(0, 120);
}

function snippet(message: string): string {
  const clean = stripAnsi(message).split("\n").filter((l) => l.trim()).slice(0, 3).join(" | ");
  return clean.length > 240 ? clean.slice(0, 237) + "..." : clean;
}

/** Combines the per-shard reports a sharded CI run produces into one, so the verdict and clusters see the whole run. */
export function mergeReports(reports: PwReport[]): PwReport {
  return {
    suites: reports.flatMap((r) => r?.suites ?? []),
    errors: reports.flatMap((r) => r?.errors ?? []),
  };
}

export function analyzeReport(input: PwReport | null | undefined, source = "report"): HealReport {
  const report: PwReport = input ?? {};
  const flat: Flat[] = [];
  flatten(report.suites, [], flat);

  const runErrors: RunError[] = (report.errors ?? [])
    .map((e) => e?.message ?? "")
    .filter((m) => m.trim())
    .map((m) => ({ snippet: snippet(m), diagnosis: toDiagnosis(classifyError(m)) }));

  const totals = { tests: flat.length, passed: 0, failed: 0, flaky: 0, skipped: 0 };
  const failures: FailedTest[] = [];

  for (const { title, file, line, test } of flat) {
    const results = test.results ?? [];
    const failing = results.filter((r) => r.status && r.status !== "passed" && r.status !== "skipped");

    if (test.status === "skipped") totals.skipped++;
    else if (test.status === "expected") totals.passed++;
    else if (test.status === "flaky") totals.flaky++;
    else if (test.status === "unexpected") totals.failed++;
    else continue;

    if (test.status !== "unexpected" && test.status !== "flaky") continue;
    if (failing.length === 0) continue;

    // For a flaky test the interesting error is the first failure (the last attempt passed).
    const representative = test.status === "flaky" ? failing[0] : failing[failing.length - 1];
    const message = messageOf(representative);
    const entry = classifyError(message);
    const ids = new Set(failing.map((r) => classifyError(messageOf(r)).id));

    failures.push({
      title,
      file,
      line,
      project: test.projectName,
      outcome: test.status === "flaky" ? "flaky" : "failed",
      attempts: results.length,
      errorSnippet: snippet(message),
      target: extractTarget(message),
      diagnosis: toDiagnosis(entry),
      consistentAcrossAttempts: failing.length < 2 ? null : ids.size === 1,
      attachments: failing
        .flatMap((r) => r.attachments ?? [])
        .map((a) => a.path)
        .filter((p): p is string => !!p),
    });
  }

  // --- clusters: one root cause, one fix -----------------------------------
  const map = new Map<string, Cluster>();
  for (const f of failures) {
    // Failures share a root cause when they hit the same pattern on the same target. With no
    // target (a TypeError, an unknown error) the normalised first line stands in for it.
    const key = `${f.diagnosis.entryId}|${f.target ?? signature(f.errorSnippet)}`;
    const c = map.get(key);
    if (c) {
      c.count++;
      c.tests.push(c.tests.includes(f.title) ? `${f.title} [${f.project ?? "?"}]` : f.title);
    } else {
      map.set(key, {
        key,
        entryId: f.diagnosis.entryId,
        title: f.diagnosis.title,
        classification: f.diagnosis.classification,
        healing: f.diagnosis.healing,
        target: f.target,
        count: 1,
        tests: [f.title],
        fixes: f.diagnosis.fixes,
        neverDo: f.diagnosis.neverDo,
      });
    }
  }
  const isConfig = (c: { classification: string; entryId: string }) =>
    c.classification === "environment" || CONFIG_ENTRY_IDS.has(c.entryId);
  const clusters = [...map.values()].sort(
    (a, b) => Number(isConfig(b)) - Number(isConfig(a)) || b.count - a.count
  );

  // --- verdict: is this a test problem, an environment problem, or no test problem at all? ----
  const isConfigFailure = (f: FailedTest) => isConfig({ classification: f.diagnosis.classification, entryId: f.diagnosis.entryId });
  // A flaky test passed in the end: it must not be able to declare the whole run an outage.
  const hard = failures.filter((f) => f.outcome === "failed");
  const configCount = hard.filter(isConfigFailure).length;
  let verdict: Verdict;
  let verdictReason: string;
  if (totals.tests === 0) {
    if (runErrors.length > 0) {
      verdict = "broken-run";
      verdictReason =
        `The run failed before any test ran: ${runErrors[0].diagnosis.classification === "unknown" ? runErrors[0].snippet : `${runErrors[0].diagnosis.title} (${runErrors[0].snippet})`}. ` +
        `There is nothing to heal in the tests; fix this first (globalSetup, config, credentials, environment).`;
    } else {
      verdict = "no-results";
      verdictReason =
        "The report contains no tests. Check that the right results file was passed, that the test directory and any --project/--grep filter match something, and that the run actually started.";
    }
  } else if (hard.length === 0 && runErrors.length > 0) {
    verdict = "broken-run";
    verdictReason = `${runErrors.length} error(s) were reported outside any test (setup or teardown): ${runErrors[0].snippet}. Tests passed, but the run is not clean.`;
  } else if (hard.length === 0) {
    if (failures.length === 0) {
      verdict = "healthy";
      verdictReason = "No failed or flaky tests.";
    } else {
      verdict = "flaky-only";
      verdictReason = `No test failed, but ${failures.length} needed a retry to pass. Treat flaky tests as failures: find the cause (clusters below) before they start failing for real.`;
    }
  } else if (configCount / hard.length >= 0.5 && (configCount >= 2 || configCount === hard.length)) {
    verdict = "environment-suspect";
    verdictReason =
      `${configCount} of ${hard.length} failures are environment or configuration problems ` +
      `(unreachable app or API, missing browser, unset variables/placeholders, missing or expired session). ` +
      `Fix those first and re-run; do not edit tests to get past them.`;
  } else {
    verdict = "heal-tests";
    const nonConfig = hard.filter((f) => !isConfigFailure(f));
    const count = (cl: string) => nonConfig.filter((f) => f.diagnosis.classification === cl).length;
    const defects = count("product-defect-suspect");
    const unknown = count("unknown");
    const fixable = nonConfig.length - defects - unknown;
    const parts: string[] = [];
    if (fixable) parts.push(`${fixable} addressable in the tests, data or locators`);
    if (defects) parts.push(`${defects} suspected product defect(s) to report rather than fix`);
    if (unknown) parts.push(`${unknown} not recognised (read the call log; log the pattern so the catalog learns it)`);
    if (configCount) parts.push(`${configCount} environment/configuration problem(s) to fix first`);
    verdictReason = `${hard.length} failed: ${parts.join("; ")}.`;
  }

  const byClassification: Record<string, number> = {};
  for (const f of failures) {
    byClassification[f.diagnosis.classification] = (byClassification[f.diagnosis.classification] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    source,
    totals,
    verdict,
    verdictReason,
    byClassification,
    clusters,
    failures,
    runErrors,
  };
}

export function formatSummary(report: HealReport): string {
  const t = report.totals;
  const lines: string[] = [];
  lines.push(
    `[heal] ${t.tests} tests: ${t.passed} passed, ${t.failed} failed, ${t.flaky} flaky, ${t.skipped} skipped. Verdict: ${report.verdict}.`
  );
  lines.push(`[heal] ${report.verdictReason}`);
  for (const e of report.runErrors) lines.push(`  - [run error/${e.diagnosis.classification}] ${e.diagnosis.title}: ${e.snippet}`);
  for (const c of report.clusters) {
    lines.push(
      `  - [${c.classification}/${c.healing}] ${c.title} x${c.count}${c.target ? `  (${c.target})` : ""}`
    );
    lines.push(`      first fix: ${c.fixes[0]}`);
  }
  return lines.join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outFile = outIdx !== -1 ? args[outIdx + 1] : path.join(__dirname, "..", "..", "heal-report.json");
  let inputs = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
  if (inputs.length === 0) inputs = [path.join(__dirname, "..", "..", "test-results", "results.json")];

  const missing = inputs.filter((f) => !fs.existsSync(f));
  if (missing.length > 0) {
    console.error(`[heal] No report at ${missing.join(", ")}. Run the tests first (the json reporter writes test-results/results.json, or BAT_RESULTS_FILE).`);
    process.exit(1);
  }
  // One truncated or empty shard file (a runner that died mid-write) must not hide every other shard.
  const reports: PwReport[] = [];
  const unreadable: string[] = [];
  for (const f of inputs) {
    try {
      reports.push(JSON.parse(fs.readFileSync(f, "utf-8")) as PwReport);
    } catch (err) {
      unreadable.push(f);
      console.error(`[heal] Could not read ${f}: ${(err as Error).message}`);
      reports.push({ errors: [{ message: `Results file ${f} is empty or not valid JSON - the run that wrote it probably crashed.` }] });
    }
  }
  if (unreadable.length === inputs.length) {
    console.error("[heal] None of the results files could be read.");
    process.exit(1);
  }
  const report = analyzeReport(reports.length === 1 ? reports[0] : mergeReports(reports), inputs.join(", "));
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(formatSummary(report));
  console.log(`[heal] Wrote ${outFile}`);
}

if (require.main === module) {
  main();
}
