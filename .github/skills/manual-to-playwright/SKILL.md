---
name: manual-to-playwright
description: Converts manual test cases (steps + expected results, pasted text, Excel/CSV rows, Jira/ALM/TestRail exports) into runnable Playwright TypeScript automation - Page Objects, spec files, locators, assertions and a traceability table. Use when asked to automate, convert, script or generate Playwright tests from a manual test case, test scenario, test steps or acceptance criteria.
user-invocable: true
---

# Manual test case -> Playwright automation

Turn a manual test case into a Playwright (`@playwright/test`, TypeScript) test
that a reviewer can trace back to the original, that fails for product reasons
rather than test reasons, and that never contains a selector or value nobody
actually verified.

## Before you start

1. Read the repo's existing conventions first - do not impose new ones:
   - `playwright.config.ts`, `package.json`, `tsconfig.json`
   - existing `src/pages/` (or `pages/`) Page Objects, `tests/` layout, fixtures
   - `.github/copilot-instructions.md` if present
2. Pick a mode:
   - **Scaffold mode** - `src/core/BasePage.ts` and `LocatorRepository.ts` exist.
     Generate locator JSON + a Page Object extending `BasePage`; specs call
     `act()` / `verify()`. Also apply the **locator-naming-convention**,
     **assertion-strategy**, **verification-strategy** and
     **synchronization-strategy** skills.
   - **Plain mode** - no such framework. Generate standard Page Objects using
     Playwright's own locators ([templates](./assets/page-object.template.ts)).
3. If the repo has no Playwright setup at all, say so and stop at a short setup
   proposal. Do not scaffold a whole framework unasked.

## Workflow

Work in this order. Do not skip to code.

### 1. Normalize the manual test case

Rewrite the input as a numbered table: `# | Action | Test data | Expected result`.
Keep the original test case ID and title. Details and accepted input formats:
[test-case-intake](./references/test-case-intake.md).

### 2. Resolve ambiguity - ask or assume, never guess silently

- A step you cannot turn into one concrete action ("verify the page works",
  "enter valid data") is an **open question**, not something to invent.
- Missing test data, environment, role/account, or an expected result for a
  step are the same.
- Ask the user when the answer changes what you generate. When you must
  proceed, list each assumption explicitly in the reply and mark the matching
  code with a `// ASSUMPTION:` comment.

### 3. Split preconditions from the test body

Login, seeded data and navigation to the start page are *setup*, not steps.
Put them in `beforeEach`, a fixture, or the project's auth/`storageState`
mechanism. Each manual case becomes **one `test()`**; do not merge cases, do not
split one case into several tests unless it has independent expected outcomes.

### 4. Choose the structure

- One Page Object per page/screen touched. Reuse an existing one if it
  covers the elements; extend it rather than duplicating.
- Page Object methods are named for user intent (`submitOrder()`), not
  mechanics (`clickButton3()`). Assertions about page state live in `expect...`
  methods on the Page Object or in the spec, not hidden inside actions.

### 5. Map every step

Use [step-mapping](./references/step-mapping.md) to convert each action phrase
to a Playwright action, and each expected result to at least one assertion.
Rules that always hold:

- **Every manual expected result becomes an assertion.** An action with no
  expected result still gets a lightweight post-condition (URL, heading,
  element state) if the case implies one; otherwise note it as unverified.
- Assert what the user can observe (visible text, state, URL, count), not CSS
  classes or implementation details.
- Rely on Playwright auto-waiting and web-first assertions. No
  `waitForTimeout`, no sleeps, no raising global timeouts to hide a race.

### 6. Locators - never invent them

Follow [locator-priority](./references/locator-priority.md). In short:
prefer `getByRole` / `getByLabel` / `getByTestId`, then CSS, XPath last; every
locator must come from a real source (DOM/HTML you were given, a crawl, the
Playwright MCP, an existing locator file). If none is available, emit a clearly
marked placeholder and report it - do not fabricate `#submit-btn-1`.

### 7. Test data and secrets

- No hardcoded credentials, URLs, tokens or environment-specific values.
  Read them from environment variables or the project's config/fixtures.
- Keep per-case input data in a typed constant or fixture next to the spec so
  the manual test's data table stays visible.
- Tests must be independent and re-runnable: create their own data or clean up;
  do not depend on another test's side effects.

### 8. Write the files, then verify them

Use the templates in [assets](./assets/) and the layout the repo already uses.
Test title format: `TC-<id>: <manual title>` so reports map back to the source.
Tag with `@smoke` / `@regression` only if the manual case or repo convention
states one.

Verification is part of the job:

1. `npx tsc --noEmit` - must pass.
2. `npx playwright test <new spec> --list` - the test must be discovered.
3. `npm run review-scripts -- <new files>` - fix every error and think about
   every warning (missing waits, missing verifications, placeholder data,
   fragile locators). Apply the **script-review** skill.
4. If a target environment and credentials are available, run it
   (`--headed` the first time). If it fails, do not guess: `npm run heal-analyze`
   and follow the **failure-healing** skill - it tells you whether the test, the
   data, the locator or the environment is at fault.
   If an environment is not available, say the test is **written but not
   executed**. Never claim a test passes that you did not run.

Finish with the [quality-checklist](./references/quality-checklist.md).

## Reply format

End your reply with these three parts, short:

1. **Files created/changed** - paths, one line each.
2. **Traceability table** - `Manual step # -> code location -> assertion`.
   Any manual step without an assertion is listed as *unverified* with the reason.
3. **Open items** - assumptions made, placeholder locators that still need a
   real selector, data you need, and whether the test was executed.

## Hard rules

- No `waitForTimeout()`, `page.pause()`, `test.only`, or `console.log` debugging left in output.
- No hardcoded credentials or production URLs.
- No selector you did not source. No XPath where a role/label/test-id exists.
- No assertion-free tests. A test that cannot fail is not a test.
- Do not change the manual test's intent to make automation easier. If a step
  is not automatable (captcha, physical device, human judgement), say so and
  leave it out of the script with a `// MANUAL:` note instead of faking it.
- Do not edit unrelated files.

## If the repo uses the BAT agent chain

When `.github/agents/step-parser.agent.md` exists, this skill is the single-pass
alternative to the four-agent chain (`/convert-testcase`). Use the chain for
DSL-governed, reviewed conversions at scale; use this skill for a quick,
standalone conversion. If you deviate from another skill's guidance here, log it:
`npm run log-correction -- <skillArea> <file> "<what didn't fit>"`.

## Worked example

See [worked-example](./references/worked-example.md) for a full
manual case -> normalized steps -> Page Object -> spec -> traceability reply.

## Changelog

- 2026-10-06 - Step 8 now runs `review-scripts` and points failing runs at the failure-healing skill.
- 2026-10-06 - Initial version. Single-pass manual-to-Playwright conversion with
  scaffold/plain modes, ambiguity handling, traceability table and mandatory
  verification step.
