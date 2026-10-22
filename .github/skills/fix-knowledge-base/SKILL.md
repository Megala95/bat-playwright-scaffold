---
name: fix-knowledge-base
description: How engineers' manual fixes to generated scripts (locator changes, hybrid locators, added waits, assertions, verifications, test-data guards) are captured, learned from and fed back into the skills. Use before fixing a failing or flaky script (look up what is already known), right after you fix one (capture it), and when reviewing the learning report.
argument-hint: a problem or error message to look up, e.g. "save button not found after redesign"
user-invocable: true
---

# Fix Knowledge Base

Generated scripts need hand fixes, and engineers across projects make the same
fixes over and over: replace a CSS selector with a role locator, add a
fallback to an element that keeps changing, swap a sleep for a real wait, add
the assertion the generator skipped. This skill is how those fixes stop being
private. They are **captured** from git and CI, **classified** into a fixed
set of edit kinds, **aggregated** across files and engineers, **approved by a
person**, and **published** into the other skills as learned patterns that
every agent reads from then on.

```
engineer fixes a script
  -> capture   (pre-commit hook, PR in CI, Copilot session)   npm run learn-capture
  -> classify  (what kind of edit was it?)                    src/learning/classify.ts
  -> store     (.learnings/events/, redacted, committed)
  -> aggregate (several files AND several engineers?)         npm run learn-report
  -> approve   (a named person decides)                       npm run learn-approve
  -> publish   (references/learned-patterns.md of 5 skills)   npm run learn-publish
  -> consume   (agents read it; lookup-fix retrieves it)      npm run lookup-fix
  -> measure   (is the same edit still being made by hand?)   learning-report.md
```

## Before you fix something

Look up what is already known instead of re-deriving it:

```bash
npm run lookup-fix -- "<the problem in your words, or paste the error>"
```

It searches the healer's error catalog and the approved learned patterns and
returns the likeliest causes and fixes, with how engineers here fixed the same
failure before. Treat the result as evidence, not an order: check it against
the actual DOM, trace and error.

## After you fix something

Capture the fix while you still remember why. Usually this happens by itself:

- with the git hook installed (`npm run learn-install-hook`), a commit that
  touches `tests/`, `src/pages/` or `src/locators/` records its learning events;
- without it, CI captures the same edits from the pull request;
- after a Copilot session that edited files, run the **capture-fix** prompt, or
  `npm run learn-capture -- --worktree --write --why "<what was wrong>"`.

The `--why` is worth the five seconds: it is stored with the events and is how a
reviewer tells "the selector went stale" from "the generator picked the wrong
element".

What is recorded: the kind of edit, the statement before and after (redacted), the file
path, a salted hash of the author and the reviewer rules the change fixed. A pull request or
push is captured as one net change, so a debug sleep added and removed on the same branch
leaves nothing behind.

Redaction is pattern-based, so it is best effort: it removes common secret shapes (keys,
tokens, `Authorization` values, query-string secrets, values typed into password-like
fields, connection strings), e-mail addresses, URL and host names, IP addresses and
long numbers. It **cannot** recognise a person's name or free text inside a string. Records
are reviewed in the pull request that adds them; look at them. In a project whose code must
not be copied at all, set `"storeStatements": false` in `.learnings/config.json` and only
the kind of edit is kept. The author hash is pseudonymous, not anonymous (someone with the
salt and a list of e-mail addresses can check membership): in a private repository set
`BAT_LEARN_SALT` instead of relying on the committed salt. Branch names are not recorded.

## What counts as a learning

Edits are classified from the statements before and after (what they wait for, which locator they use, what they assert), not from the text diff. The 22
kinds are listed in [references/edit-kinds.md](./references/edit-kinds.md)
(generated from `src/learning/kinds.ts`). Each one belongs to one skill area:

| Edit | Example | Skill that should have prevented it |
| --- | --- | --- |
| Locator upgraded / replaced / scoped | `#save` becomes `getByRole('button', { name: 'Save' })`; `.first()` becomes a scoped locator | `locator-source-strategy` |
| Hybrid locator (fallback added) | a fallback is added in the locator JSON or with `.or()` | `locator-source-strategy` |
| Synchronization | `waitForTimeout(3000)` becomes `waitForResponse` or a web-first assertion | `synchronization-strategy` |
| Assertion added / strengthened / expectation updated | `toBeVisible` becomes `toHaveText('Saved')` | `assertion-strategy` |
| Verification added | an assertion after the click that changes the page | `verification-strategy` |
| Test data | a literal moves to an environment variable; a skip guard is added | `framework-scaffolding` |

## Regressions are coaching signals, never lessons

Some edits make a test pass by hiding the problem: a sleep added, `force: true`,
a raised timeout, a weakened or deleted assertion, a locator downgraded to XPath.
These are recorded as **regressions**. They never become candidates and are never
published as something to do. They appear in the report as coaching signals, and
an approved regression is published only as an *Avoid this* entry with the
curated alternative. This is the reason the system cannot teach the team its own
bad habits.

## From events to guidance

`npm run learn-report` writes `learning-report.md` and `learning-report.json`.
A pattern is a **candidate** when the same edit shows up at least 3 times, in at
least 2 files, by at least 2 engineers (`.learnings/config.json` changes this).
One person's habit, or one file's quirk, is not a pattern. The report also shows:

- **recurring after approval** - an approved pattern that engineers still make by
  hand. The guidance exists but is not being found or followed; fix that;
- **unstable elements** - the same element edited repeatedly: give it a hybrid
  locator or ask for a stable `data-testid`;
- **how failures were actually fixed** - catalog entry to the edits that resolved it;
- **reviewer rules fixed by hand** - rules whose findings engineers act on.

A reviewer approves with `npm run learn-approve -- <key> --by "<name>"` (or
rejects with `--retire`; add `--events-dir learning-store/events` when the events live on the
`bat-learning` data branch that CI maintains: `git fetch origin bat-learning && git worktree add learning-store bat-learning`), then `npm run learn-publish` regenerates the
`references/learned-patterns.md` files. The result goes through a normal pull
request, like any skill change. Nothing is published automatically.

## What this does not do

- It does not know *why* an edit was made unless the engineer says so. Kinds and
  thresholds are heuristics; read the example in each candidate before approving.
- It sees one statement at a time. Known blind spots: an assertion wrapped in `try/catch` or
  `if (false)`, `test.slow()`, a timeout set in config, a locator changed inside a helper
  function, and a test that was renamed (its edits are skipped). A shortcut it does
  recognise (sleeps of any kind, `networkidle`, `force`, a raised or unreadable timeout,
  assertions that cannot fail or match anything, `.catch()` on an assertion) is never
  reported as an improvement, even inside a statement that also contains a real fix.
- Many edits by one person (a codemod) can still reach the thresholds with a second
  engineer's single edit. Look at the example and the file list before approving.
- It links an edit to a failure only when a `heal-report.json` from the earlier
  run names the same test file and exactly one failure type. Otherwise the link
  is left out rather than guessed.
- It does not change `SKILL.md` text. It publishes to `references/learned-patterns.md`;
  rewording a skill is still the **skill-curator** agent's job, from the same report.

## Changelog

- 2026-10-12: Initial version (independently reviewed; shortcut detection, redaction, untrusted-file handling and CI flow hardened).
