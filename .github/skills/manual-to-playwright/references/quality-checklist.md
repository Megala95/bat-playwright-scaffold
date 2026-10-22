# Quality checklist (run before replying)

## Fidelity
- [ ] One `test()` per manual case; title is `TC-<id>: <original title>`.
- [ ] Every manual step appears in the traceability table.
- [ ] Every manual expected result has an assertion, or is listed as unverified with a reason.
- [ ] Preconditions are in setup, not repeated as steps (unless the case tests them).
- [ ] The intent of the case is unchanged; non-automatable steps are `// MANUAL:` notes.

## Robustness
- [ ] No `waitForTimeout`, sleeps, `page.pause()`, `test.only`, `console.log`.
- [ ] Only web-first assertions (`await expect(locator)...`), no `expect(await ...)` on state.
- [ ] No selector without a real source; placeholders marked `LOCATOR-TODO`.
- [ ] No positional or style-based selectors; XPath only with a reason.
- [ ] Dynamic values (dates, IDs, totals) asserted by pattern or computation.
- [ ] Test is independent, re-runnable, and cleans up or isolates its data.

## Security and config
- [ ] No hardcoded credentials, tokens, or environment URLs; values come from env/config/fixtures.
- [ ] No secrets in test titles, logs, or screenshots paths.

## Maintainability
- [ ] Page Object methods are named for intent; duplicated locators reuse an existing Page Object.
- [ ] Follows the repo's folder layout, naming and lint rules.
- [ ] Assumptions are marked `// ASSUMPTION:` in code and listed in the reply.

## Verified
- [ ] `npx tsc --noEmit` passed.
- [ ] `npx playwright test <spec> --list` discovers the test.
- [ ] Executed against a real environment - or the reply says clearly "written, not executed".

## Common anti-patterns to reject in your own output

| Anti-pattern                                   | Replace with                                       |
|------------------------------------------------|----------------------------------------------------|
| `await page.waitForTimeout(3000)`              | an assertion on the result, or `locator.waitFor()` on the specific element |
| `expect(await el.isVisible()).toBe(true)`      | `await expect(el).toBeVisible()`                   |
| Copying the whole manual login into every test | one setup / `storageState`                          |
| One giant test for many manual cases           | one test per case                                  |
| Assertion on a class name or pixel position    | assertion on visible text, state or URL            |
| `try/catch` that swallows a failure            | let it fail                                        |
