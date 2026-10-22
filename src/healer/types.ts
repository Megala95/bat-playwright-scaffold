/**
 * What kind of problem a failure is. This is the most important decision the
 * healer makes, because it decides WHO should act: only "locator",
 * "synchronization", "test-data" and "test-script" are fixed by editing the
 * test. "environment" is fixed outside the repo, and "product-defect-suspect"
 * must be reported to a human - editing the test to make it pass would hide
 * a real bug.
 */
export type Classification =
  | "locator"
  | "synchronization"
  | "test-data"
  | "test-script"
  | "environment"
  | "product-defect-suspect"
  | "framework"
  | "unknown";

/**
 * "auto"     - a mechanical, behaviour-preserving edit exists; an agent may apply it, then re-run.
 * "assisted" - a fix exists but needs evidence first (DOM snapshot, trace, a decision); gather it, then fix.
 * "none"     - do not edit the test. Report it / fix the environment / escalate.
 */
export type Healing = "auto" | "assisted" | "none";

export type Confidence = "high" | "medium" | "low";

export interface CatalogEntry {
  id: string;
  title: string;
  classification: Classification;
  healing: Healing;
  confidence: Confidence;
  /** Regex sources (case-insensitive, multiline). ALL must match. */
  match: string[];
  /** Regex sources. If ANY matches, this entry does not apply. */
  exclude?: string[];
  diagnosis: string;
  /** What to look at before changing anything. */
  evidence: string[];
  /** Ordered: try the first, re-run, then the next. */
  fixes: string[];
  /** Fixes that look tempting but hide the problem. */
  neverDo: string[];
  /** The skill whose guidance to improve if this keeps happening (see src/utils/skillAreas.ts). */
  skillArea: string;
  /** A real or representative message; the catalog test checks it classifies back to this id. */
  example: string;
}

export interface Diagnosis {
  entryId: string;
  title: string;
  classification: Classification;
  healing: Healing;
  confidence: Confidence;
  diagnosis: string;
  evidence: string[];
  fixes: string[];
  neverDo: string[];
  skillArea: string;
}

export interface FailedTest {
  title: string;
  file: string;
  line?: number;
  project?: string;
  /** "failed" = failed every attempt; "flaky" = failed, then passed on retry. */
  outcome: "failed" | "flaky";
  attempts: number;
  /** Cleaned (ANSI-stripped) first line(s) of the final failing error, for the report. */
  errorSnippet: string;
  /** Locator / URL / event the failure was about, when it could be extracted. */
  target?: string;
  diagnosis: Diagnosis;
  /**
   * true  = at least two attempts failed and all failed the same way (deterministic -> a real defect in test, data, or app)
   * false = attempts failed for different reasons (non-deterministic -> timing, shared state, resource contention)
   * null  = only one attempt failed (a single try, or a flaky test whose retry passed), so there is nothing to compare
   */
  consistentAcrossAttempts: boolean | null;
  attachments: string[];
}

export interface Cluster {
  key: string;
  entryId: string;
  title: string;
  classification: Classification;
  healing: Healing;
  target?: string;
  count: number;
  tests: string[];
  /** One fix usually resolves the whole cluster - heal it once, not per test. */
  fixes: string[];
  neverDo: string[];
}

/**
 * healthy             - every test passed.
 * flaky-only          - nothing failed, but some tests needed a retry to pass.
 * heal-tests          - there are failures that editing tests, data or locators can address (some may need reporting instead).
 * environment-suspect - most failures are environment/configuration problems: stop editing tests, fix those first.
 * broken-run          - the run failed outside any test (globalSetup, config, a crashed worker pool): there is nothing to heal in the tests.
 * no-results          - the report contains no tests and no errors (wrong file, filter matched nothing).
 */
export type Verdict = "healthy" | "flaky-only" | "heal-tests" | "environment-suspect" | "broken-run" | "no-results";

/** An error reported for the run as a whole (globalSetup throwing, a config error), not for any one test. */
export interface RunError {
  snippet: string;
  diagnosis: Diagnosis;
}

export interface HealReport {
  generatedAt: string;
  source: string;
  totals: { tests: number; passed: number; failed: number; flaky: number; skipped: number };
  verdict: Verdict;
  verdictReason: string;
  byClassification: Record<string, number>;
  clusters: Cluster[];
  failures: FailedTest[];
  /** Errors outside any test (e.g. globalSetup failed). Empty when the run itself was sound. */
  runErrors: RunError[];
}
