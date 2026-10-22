# Test case intake

## Accepted inputs

Pasted text, a Markdown/CSV/Excel row set, or an export from Jira (Xray/Zephyr),
Azure Test Plans, TestRail or ALM. Whatever the source, normalize to the same shape.

## Normalized shape

```
Test case: TC-1042 - Place an order with a saved card
Priority / tags: P1, regression
Preconditions: user has an active account; at least one saved card; cart is empty
Test data: product = "Router X200", qty = 2, card = saved Visa ending 4242

| # | Action                                   | Test data          | Expected result                          |
|---|------------------------------------------|--------------------|------------------------------------------|
| 1 | Log in as a standard user                | env credentials    | Dashboard is displayed                   |
| 2 | Search for the product                   | "Router X200"      | Result list shows "Router X200"          |
| 3 | Add 2 units to the cart                  | qty = 2            | Cart badge shows 2                       |
| 4 | Check out using the saved card           | saved Visa         | Order confirmation page with an order ID |
```

Keep the **original ID, title, step numbers and wording**. Traceability depends on it.

## Splitting setup from steps

| Looks like                                    | Treat as                              |
|-----------------------------------------------|---------------------------------------|
| "Log in", "Open the app", "Navigate to X" at the start | Precondition / `beforeEach` / `storageState` |
| Data that must already exist                  | Fixture or API/DB seeding, not UI steps |
| The thing the case is actually testing         | Test body                              |

Exception: if the case *is* about login (or navigation), those steps stay in the body.

## Ambiguity triage

| Problem in the manual case              | Do this                                                         |
|-----------------------------------------|-----------------------------------------------------------------|
| "Enter valid data" / "fill the form"    | Ask for the field list and values; otherwise list as open item  |
| Expected result is vague ("works fine") | Ask what is observable; otherwise assert the most specific signal the step implies and flag it |
| Step bundles several actions            | Split into separate actions, keep one traceability row for the original step |
| Expected result missing                 | Add a minimal post-condition only if clearly implied; else mark unverified |
| Depends on external system/email/SMS    | Ask for a test double or API hook; otherwise `// MANUAL:` note   |
| Cosmetic checks ("looks right")         | Not automatable as written; suggest a visual-comparison test or leave manual |
| Data volatile (dates, IDs, totals)      | Assert a pattern or a computed value, not a literal copy         |

## Out of scope for this skill

Performance, accessibility audits, and visual design review are separate test
types. Convert only the functional behavior the manual case describes.
