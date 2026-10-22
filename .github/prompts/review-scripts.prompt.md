---
description: Review Playwright scripts for synchronization, missing test data, locator fragility and missing verifications, and apply the safe fixes.
argument-hint: optional paths, e.g. tests/example src/pages/LoginPage.ts
---

Run `#script-reviewer` on `${input:paths}` (default: `tests/` and `src/pages/`,
or `output/automation/` if that is where the generated framework lives).

Report findings grouped by category (synchronization, verification, test data,
locators, hygiene, security) with the fix applied or the reason it was not.
Finish with the before/after counts from `npm run review-scripts`.
