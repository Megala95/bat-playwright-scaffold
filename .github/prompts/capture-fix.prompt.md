---
description: Record the fix you just made to a script (locator, fallback, wait, assertion, verification, test data) so it can be learned from and shared.
argument-hint: why the fix was needed, e.g. "save button was renamed in release 4.2"
---

Record the manual fixes in the working tree as learning events, so they can become
shared guidance (see the **fix-knowledge-base** skill).

1. `npm run learn-capture -- --worktree --summary --why "${input:why}"` (preview, nothing is saved).
2. Read the events it lists. If an edit is classed as a **regression** (a sleep added,
   `force: true`, a raised timeout, a weakened or removed assertion, a locator downgraded),
   tell me and propose the proper fix instead - do not record it as a success.
3. If the events describe what I changed, save them: the same command with `--write`.
   If a run failed before this fix and `heal-report.json` exists, it is linked automatically.
4. If nothing learnable was found (the change was not in `tests/`, `src/pages/` or
   `src/locators/`, or it was a new file), say so; do not invent an event.

Reply with the saved file name and the kinds recorded, in one or two sentences.
