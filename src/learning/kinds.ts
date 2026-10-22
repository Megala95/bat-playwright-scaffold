import { SkillArea } from "../utils/skillAreas";
import { Direction, EventKind } from "./types";

export interface KindInfo {
  kind: EventKind;
  title: string;
  area: SkillArea;
  /** Default direction; locator edits are refined per event from the strategy ranking. */
  direction: Direction;
  /** When an engineer ends up making this edit. */
  problem: string;
  /** Pattern: what to do from the start. Regression: what to do instead. */
  guidance: string;
}

/**
 * Curated meaning of each edit kind. It is the text published to the skills
 * once a cluster is approved (the evidence and an example come from real
 * events); nothing here is invented from data. tests/meta/learning.spec.ts
 * checks that every kind is described here exactly once.
 */
export const KINDS: KindInfo[] = [
  { kind: "locator-upgraded", title: "Move to a more stable locator strategy", area: "locator-source-strategy", direction: "improvement",
    problem: "A CSS, XPath, id or text selector kept breaking or matched the wrong element, and was replaced by a role, label, test-id or placeholder locator.",
    guidance: "Start from getByRole (with name), getByLabel or getByTestId. Use CSS or XPath only when none exists, and say why in a comment. When a locator has to be derived from the DOM, rank candidates in that order." },
  { kind: "locator-replaced", title: "Selector updated after it went stale", area: "locator-source-strategy", direction: "neutral",
    problem: "The same kind of locator was given a new value because the app changed.",
    guidance: "Not a pattern by itself. Many of these on one element means that element is unstable: give it a hybrid locator (a primary plus fallbacks) or ask for a data-testid." },
  { kind: "locator-downgraded", title: "Moved to a less stable locator strategy", area: "locator-source-strategy", direction: "regression",
    problem: "A role, label or test-id locator was replaced by CSS, XPath or text, usually to make a failing step pass.",
    guidance: "Find out why the stable locator failed (wrong name, hidden duplicate, not yet rendered) and fix that. If the app genuinely has no accessible name, record it as an app defect or ask for a test-id instead of falling back to structure." },
  { kind: "locator-fallback-added", title: "Hybrid locator: primary plus fallback", area: "locator-source-strategy", direction: "improvement",
    problem: "One locator was not reliable across builds or environments, so an alternative was added (a fallbacks entry in the locator repository, or .or() in code).",
    guidance: "For elements that are known to vary, declare the primary and at least one independent fallback (different strategy) in the locator repository. Keep every fallback scoped to the same single element; a fallback that can match something else turns a failure into a false pass." },
  { kind: "locator-fallback-removed", title: "Fallback removed", area: "locator-source-strategy", direction: "neutral",
    problem: "A fallback locator was deleted.",
    guidance: "Usually clean-up after the primary was fixed. Not promoted." },
  { kind: "locator-scoped", title: "Scope a locator instead of picking by position", area: "locator-source-strategy", direction: "improvement",
    problem: "A positional .first()/.nth()/.last() locator was replaced by one scoped to a region, row or filter.",
    guidance: "Scope to the container (a row, dialog or form) and add filter({ hasText }) or an accessible name, so the locator identifies one element by meaning rather than DOM order." },
  { kind: "sync-sleep-replaced", title: "Replace a hard sleep with a condition", area: "synchronization-strategy", direction: "improvement",
    problem: "A waitForTimeout() was replaced by a web-first assertion or a wait for the condition it was standing in for.",
    guidance: "Wait for the observable result of the previous step: await expect(locator).toBeVisible()/toHaveText(), or wait for the specific response or URL. Never wait for a duration." },
  { kind: "sync-sleep-removed", title: "Remove a hard sleep", area: "synchronization-strategy", direction: "improvement",
    problem: "A waitForTimeout() was deleted; Playwright's auto-waiting covered it.",
    guidance: "Trust actionability checks and web-first assertions; add an explicit wait only for something Playwright cannot see (a network result the UI does not show)." },
  { kind: "sync-wait-added", title: "Add an explicit wait for a specific signal", area: "synchronization-strategy", direction: "improvement",
    problem: "A step raced an asynchronous result (a response, navigation, popup or polled value) and a targeted wait was added.",
    guidance: "Register the wait before the action that triggers it (const p = page.waitForResponse(...); await click; await p) or use expect.poll / toPass for values that settle. Prefer asserting what the user sees once it arrives." },
  { kind: "sync-sleep-added", title: "Hard sleep added", area: "synchronization-strategy", direction: "regression",
    problem: "waitForTimeout() was added to make a step pass.",
    guidance: "A sleep hides the cause and makes the suite slower and flaky. Identify the missing condition (use heal-analyze and the trace) and wait for that instead." },
  { kind: "sync-timeout-raised", title: "Timeout raised", area: "synchronization-strategy", direction: "regression",
    problem: "A per-step or per-assertion timeout was increased to make a slow step pass.",
    guidance: "Raise a timeout only for a genuinely slow, documented operation, on that one step, with a comment. Otherwise find why it is slow (wrong locator, missing earlier step, slow environment)." },
  { kind: "sync-force-added", title: "force: true added", area: "synchronization-strategy", direction: "regression",
    problem: "An action was forced to click through something that was not actionable.",
    guidance: "Find what covers or disables the element and wait for that to clear (assert it is gone). force skips the checks that make the test meaningful." },
  { kind: "sync-force-removed", title: "force: true removed", area: "synchronization-strategy", direction: "improvement",
    problem: "A forced action was made normal again.",
    guidance: "Keep actions unforced; wait for the blocking condition instead." },
  { kind: "assertion-added", title: "Assertion added", area: "assertion-strategy", direction: "improvement",
    problem: "A step or screen had no check of its outcome and a web-first assertion was added.",
    guidance: "For each expected result in the manual case, assert the observable outcome with a web-first matcher (toBeVisible, toHaveText, toHaveURL, toHaveCount)." },
  { kind: "verification-added", title: "Verify the result of an action", area: "verification-strategy", direction: "improvement",
    problem: "An action that changes the page (save, submit, login, delete, search) was followed by another step without checking its outcome; an assertion was added right after it.",
    guidance: "After every action that triggers a result, verify the result before the next step: the success message, the new row, the landing URL or the removed item. This is both a verification and a synchronization point." },
  { kind: "assertion-strengthened", title: "Assertion made more precise", area: "assertion-strategy", direction: "improvement",
    problem: "A weak matcher (toBeVisible, toContainText, toBeTruthy) was replaced by one that checks the actual value.",
    guidance: "Assert the value the manual case names (toHaveText, toHaveValue, toHaveCount) rather than only that something exists." },
  { kind: "assertion-weakened", title: "Assertion weakened", area: "assertion-strategy", direction: "regression",
    problem: "A precise matcher was replaced by a looser one, usually to get past a failure.",
    guidance: "A failing precise assertion is information: check the manual expected result. If the product is wrong, report a defect; if the expectation is stale or over-specific, change it and say why in the commit." },
  { kind: "assertion-removed", title: "Assertion removed", area: "assertion-strategy", direction: "regression",
    problem: "An assertion was deleted.",
    guidance: "Do not delete a check to turn a test green. Fix the cause or move the test to quarantine with a ticket." },
  { kind: "expectation-updated", title: "Expected value updated", area: "assertion-strategy", direction: "neutral",
    problem: "The same assertion now expects a different value.",
    guidance: "Legitimate when the requirement changed; confirm against the manual case. Not promoted." },
  { kind: "data-externalized", title: "Move a hardcoded value to configuration", area: "framework-scaffolding", direction: "improvement",
    problem: "A literal (URL, account, id) was replaced by an environment variable or config value.",
    guidance: "Keep environment-specific values and credentials out of specs: baseURL for URLs, process.env through a helper that fails clearly when unset, test-data fixtures for records." },
  { kind: "data-hardcoded", title: "Value hardcoded in the test", area: "framework-scaffolding", direction: "regression",
    problem: "A configuration or environment value was replaced by a literal.",
    guidance: "Never inline credentials, hosts or environment-specific ids. Use the config or environment layer." },
  { kind: "data-guard-added", title: "Guard for missing test data", area: "framework-scaffolding", direction: "improvement",
    problem: "A test crashed deep inside a step because required data was not provided; a skip or clear failure was added up front.",
    guidance: "Check required environment variables and data at the start of the test (test.skip(!process.env.X, 'X is not set') or a helper that throws a readable error)." },
];

export const KIND_BY_ID = new Map(KINDS.map((k) => [k.kind, k]));

export function kindsMarkdown(): string {
  const rows = KINDS.map((k) => `| \`${k.kind}\` | ${k.direction} | ${k.area} | ${k.title} | ${k.problem} |`);
  return [
    "# Edit kinds",
    "",
    "Generated by `npm run learn-publish -- --kinds-md` from `src/learning/kinds.ts` - do not edit by hand;",
    "`tests/meta/learning.spec.ts` fails if this file drifts from the code.",
    "",
    "| Kind | Direction | Skill area | What it is | When engineers make this edit |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
