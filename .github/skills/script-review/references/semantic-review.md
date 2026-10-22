# Semantic review checklist

Questions a syntax tree cannot answer. Work through them with the manual test
case (or DSL) open next to the script.

## 1. Verifications

| Ask | Typical gap | Suggest |
| --- | --- | --- |
| Does each manual *expected result* map to an assertion? | Steps with an expected result in the manual case but no `expect` in the script | The assertion, with the exact wording from the manual case |
| After a trigger (save, submit, search, login, delete, pay) is the *outcome* checked? | Test moves on or ends | Confirmation message/toast, landing URL/heading, new or removed row, count |
| Is the final state checked, not just the last click? | Ends on an action | A final web-first assertion on the result |
| Is the assertion as strong as the manual wording? | `toContainText` where exact wording matters (error codes, totals); or exact where a stable substring is meant | Match the manual case; say which you chose |
| Is success asserted positively? | Only "no error shown" | Add the positive outcome |
| Are negative/boundary expectations in the case covered? | Manual case says "error for empty field" and the script only does the happy path | A test or step for the stated negative |

## 2. Synchronization

| Ask | Typical gap | Suggest |
| --- | --- | --- |
| What does the next step depend on? | Next step needs data/DOM produced asynchronously by the previous one | Assert that dependency first (web-first assertion) |
| Does the step navigate or re-render a region? | Locators or handles captured before the change | Re-locate after, assert a landmark |
| Are there waits on time or network idle? | `waitForTimeout`, `networkidle` | Wait for the visible condition |
| Are response/popup/download waits registered *before* the trigger? | Registered after | Promise first, then trigger |
| Any "if visible then click" logic? | Racy branching | Make the state deterministic or wait explicitly with a justified timeout |

## 3. Test data

For each value the script uses, decide its status:

| Status | Meaning | Action |
| --- | --- | --- |
| provided | In an env var, fixture or data table with a clear source | none |
| hardcoded | Literal in the test | Move to data; never for credentials |
| placeholder | `REPLACE_*`, `TBD`, `CHANGEME` | Ask for the real value; guard so the test fails early with a readable message |
| missing | The manual case mentions it (account, role, record, file) but the script has nothing | Say what is needed: a seeded record, an account with role X, a file |
| shared | Depends on data other tests also change | Create/own the data in setup, or make the assertion relative |
| volatile | Dates, ids, totals, counts | Assert a pattern or computed value |

Also check: environment variables required and documented? Cleanup of data
the test creates? Does the test rely on a specific environment's data?

## 4. Locators

| Ask | Typical gap | Suggest |
| --- | --- | --- |
| Where did each locator come from? | No source: guessed from the manual wording | Verify against a fresh snapshot; mark `LOCATOR-TODO` until then |
| Does it identify one element by meaning? | Position, structure or generated class names | role+name, label, test-id; scope to a parent |
| Could it match two elements once data grows? | Row/card locators without content filtering | `filter({ hasText })` on the row |
| Is there a fallback for the critical ones? | Single selector on a login or checkout path | A second strategy in the locator file |
| Frames/shadow DOM? | Locator works in the DOM view but not at runtime | `frameLocator`, or ask for a test-id |

## 5. Independence and design

- Runs alone, twice, and in parallel? (no order dependence, no leftover data)
- Setup in `beforeEach`/fixtures, not repeated as steps?
- One manual case = one test; page logic in Page Objects; names say intent?
- Test title traces to the manual case id?
