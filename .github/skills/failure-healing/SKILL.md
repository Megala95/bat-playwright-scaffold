---
name: failure-healing
description: Diagnose and fix failing or flaky Playwright tests from the execution results - classifies each failure (locator, timing, test data, environment, product defect) and fixes the right layer without hiding real problems. Use when tests fail, are flaky or broken, or need triage, stabilization or an explanation after a run.
argument-hint: "[results.json ...] - default test-results/results.json"
user-invocable: true
---

# Failure healing

Healing means finding the real cause of a failure and fixing *that* - not
making the test green. Most failed runs are not what they first look like: a
cluster of "locator" failures is often one outage, and a "text mismatch" is
sometimes a genuine product defect. This skill gives the order of thinking.

The mechanical part is a tool, not guesswork:

```bash
npm run heal-analyze                  # reads test-results/results.json, writes heal-report.json
npm run heal-analyze -- a.json b.json # several shard reports are merged first
```

It classifies every failure against `src/healer/errorCatalog.json` (the single
source of truth - read the entries, do not rely on memory), groups failures
that share a cause, and gives a verdict.

## Tool dependencies

This skill assumes:

- Node.js and npm, with `npm install` run and the `heal-analyze` npm script present (see `package.json`).
- A Playwright JSON results file: `playwright.config.ts` writes `test-results/results.json` (or `BAT_RESULTS_FILE`). No results file means no diagnosis - ask for a run first.
- Optional, for confirming a locator or timing diagnosis against the live page: the Playwright MCP tools (`browser_snapshot`, `browser_navigate`; see `.vscode/mcp.json`). Without them, work from the call log and trace in `attachments` and say the diagnosis is unconfirmed.

## Relationship to Playwright's official Healer

Playwright ships its own Test Agents (`npx playwright init-agents`), whose healer
replays failing steps, inspects the UI, suggests a patch and re-runs until the
test passes or guardrails stop the loop. This skill does not replace it; it
decides *whether and how to heal at all*: classify first (is it the test, the
data, the environment or the product?), fix a whole cluster once, and refuse
the "fixes" that hide problems (sleeps, `force`, weakened assertions). Use this
skill to triage a run, and let a replay-based healer do the live-page work
inside the guardrails below when one is available.

## Workflow

### 1. Read the verdict first

**Priority.** `heal-analyze` emits exactly one verdict, chosen in this order -
`broken-run` > `no-results` > `environment-suspect` > `heal-tests` > `flaky-only` > `healthy` -
so if you are unsure which row applies, the highest-priority one that matches does.
`runErrors` and environment clusters are worth reading under *any* verdict.

| Verdict | Meaning | Do this |
| --- | --- | --- |
| `broken-run` | The run failed outside any test (`runErrors`: globalSetup threw, bad config, crashed before tests ran) | **Nothing to heal in the tests.** Fix what `runErrors` names (credentials, config, environment) and re-run. |
| `no-results` | The report contains no tests | Wrong file, or a `--project`/`--grep` filter that matched nothing. Check, do not "fix" anything. |
| `environment-suspect` | Half or more of the hard failures (and at least two, or all of them) are unreachable app/API, missing browser, unset variables/placeholders, or a missing/expired session | **Stop editing tests.** Report it, fix the environment/config, run the smoke gate (`npm run test:smoke`), then re-run. |
| `heal-tests` | There are failures to address; the reason line says how many are fixable, suspected product defects, unrecognised, or environment | Continue with step 2. Environment clusters are still fixed first. |
| `flaky-only` | Nothing failed, but some tests needed a retry | Diagnose the flaky clusters (step 4). Flaky tests that passed never count towards `environment-suspect`. |
| `healthy` | Nothing failed or flaked | Nothing to heal. |

### 2. Work cluster by cluster, not test by test

`heal-report.json` lists `clusters` - failures with one root cause. Fix a
cluster once, then re-run all its tests. Start with the first one listed
(environment/configuration problems come first, then largest clusters).

### 3. Act on the classification

| `classification` / `healing` | Who acts | What you do |
| --- | --- | --- |
| `environment` / `none` | Not the test | Do not edit tests. Report cause + the catalog's fixes; the environment owner acts. |
| `test-data` | Test or config | Supply the missing value; fail early with a readable message (see the catalog entry). Never hardcode a secret. |
| `locator` | Test | Re-derive the locator from a **fresh** DOM snapshot (Playwright MCP `browser_snapshot`), prefer role/label/test-id. See "Locator changes" below. |
| `synchronization` | Test | Wait for the *condition* with a web-first assertion, never a time. Apply **synchronization-strategy**. |
| `product-defect-suspect` | Human decision | Compare to the manual expected result. If the product deviates, **report a defect; do not change the expectation**. If the test is stale or too strict, fix it and say why. |
| `test-script` | Test | Fix the code at the stack location; `npx tsc --noEmit`. |
| `framework` | Depends - read the entry | Worker crashes (memory, `process.exit`), closed browser/page and screenshot baselines are not "fix the code at the stack location": follow that entry's `fixes`. |
| `unknown` | You, with evidence | Read the call log + trace, follow the closest entry, then log it (step 6). |

Each diagnosis includes `evidence` (what to look at before changing
anything), ordered `fixes` (try the first, re-run, then the next) and
`neverDo` (tempting fixes that hide the problem). Read all three.

### 4. Use the signals in the report

- `consistentAcrossAttempts: false` - attempts failed for *different* reasons:
  timing, shared state or resource contention. Look for ordering dependencies
  between tests and shared data; retries are not the fix. `true` means two or
  more attempts failed identically (deterministic); `null` means only one
  attempt failed, so there is nothing to compare.
- `outcome: "flaky"` - it passed on retry. It is still a defect: diagnose the
  first failure, fix the cause, then prove it (step 5).
- `attachments` - open the trace/screenshot/video before editing.
- `clusters[].count` - many tests sharing one locator/URL means one fix.

### 5. Prove it

- Re-run the affected tests: `npx playwright test <file> -g "<title>"`.
- For timing/flaky fixes, repeat: `npx playwright test <file> -g "<title>" --repeat-each=5`.
  One green run proves nothing about a race.
- Re-run `npm run heal-analyze` and confirm the cluster is gone, not renamed.
- Maximum **3 attempts per cluster**. After that stop and escalate with the
  evidence you gathered; do not keep trying variations.

### 6. Leave the loop better than you found it

- Log the correction against the skill whose guidance would have prevented it:
  `npm run log-correction -- <skillArea> <specFile> "<what was wrong and the fix>"`
  (the catalog entry's `skillArea` tells you which).
- If the failure was `unknown`, or classified wrongly, add or fix the catalog
  entry: put a **real** error message in `example`, keep entries ordered
  most-specific first, run `npm run test:meta`.

## Guardrails (never do these to turn a test green)

- Never add `waitForTimeout()`/sleeps, raise the global or per-action timeout,
  or switch to `networkidle`.
- Never use `{ force: true }` to click through something.
- Never append `.first()` to silence a strict-mode violation.
- Never weaken an assertion (`toHaveText` -> `toContainText`, a RegExp that
  matches anything, removing it) without saying so in the reply and why it is
  still checking the manual expected result.
- Never edit the test to get past an environment or configuration failure.
- Never quarantine on a single occurrence (see **execution-stabilization**).

### Locator changes

Any change to a locator's `primary` or `fallbacks` is reported explicitly in
your reply: what changed, and why it is still scoped to the one intended
element. A more precise locator is fine; a vaguer one needs a reason.

## Reply format

1. **Verdict** and one-line reason.
2. **Per cluster**: cause - classification - what you changed (or why you did not) - evidence used - re-run result.
3. **Needs a human**: suspected product defects, environment actions, decisions you could not make.
4. **Logged**: corrections and catalog changes.

## Related

- **execution-stabilization** - quarantine/retry conventions and reporting.
- **synchronization-strategy** - how to fix timing causes properly.
- **assertion-strategy** / **verification-strategy** - when an assertion, not the app, is wrong.
- **script-review** - the same kind of analysis *before* a run, on the script itself.

## Changelog

History is kept out of this file to save context: [references/changelog.md](./references/changelog.md). Add new entries there.
