---
name: script-review
description: Review Playwright test scripts and page objects and suggest changes - missing waits and synchronization, missing test data, fragile locators, missing verifications, hardcoded secrets, leftover debug code. Use before running or merging automation, after generating scripts, or when asked to review, audit, lint or improve a test.
argument-hint: "[file or folder ...] - default tests/ and src/pages/"
user-invocable: true
---

# Script review

A review has two layers. **Do both, in this order.** The first is a tool and
is exact; the second is judgement the tool cannot have.

## Tool dependencies

This skill assumes Node.js and npm, the `review-scripts` npm script (see
`package.json`) and `npm install` having been run. It needs no browser and no
MCP server: the review is static. If `npm run review-scripts` is missing, say
so and do the Layer 2 review only.

## Layer 1 - run the reviewer (deterministic)

```bash
npm run review-scripts                         # tests/ and src/pages/
npm run review-scripts -- tests/auth/login.spec.ts
npm run review-scripts -- --min warning        # hide info-level notes
npm run review-scripts -- --strict             # exit 1 on any error (CI gate)
npm run review-scripts -- --rules              # list every rule
```

It parses the TypeScript syntax tree (it knows what is awaited, which
statement is last in a test, what a string is the argument of) and writes
`script-review-report.json`. Rules and why each matters:
[rules](./references/rules.md). Every finding already carries a specific
suggestion - use it.

Triage by severity: **error** blocks merge, **warning** should be fixed or
explained, **info** is a prompt to think.

## Rule source

The rule catalog is [references/rules.md](./references/rules.md), **generated** by
`npm run review-scripts -- --rules-md`. **Do not edit it by hand** - a meta test
fails if it drifts. To add or change a rule, edit `RULES` and the check in
`src/reviewer/reviewSource.ts`, add a bad-snippet test in `tests/meta/reviewer.spec.ts`,
then regenerate the file.

## Layer 2 - judgement (what a syntax tree cannot know)

Read the script **against its source** (the manual test case or DSL file) and
answer the questions in [semantic-review](./references/semantic-review.md):

1. **Verifications** - does every manual *expected result* have an assertion?
   Which steps trigger a result nobody checks (save, submit, search, login,
   delete)? Propose the specific assertion.
2. **Synchronization** - where does the next step depend on something
   asynchronous that nothing waits for? Propose a web-first assertion, never
   a delay.
3. **Test data** - list every value the test needs (inputs, accounts,
   seeded records, environment variables). Which are missing, placeholders,
   hardcoded, or shared with other tests? Say what must be provided and where.
4. **Locators** - which are fragile (see LOC rules), unverified, or lack a
   fallback? Which could match more than one element once data changes?
5. **Independence** - could this test run alone, twice, or in parallel?

## Output: a review, not a rewrite

Produce, in this order:

1. **Summary** - verdict (`ready` / `ready with changes` / `not ready`) and
   counts by severity and category.
2. **Findings** - grouped by category (synchronization, test data, locators,
   verifications, hygiene). Each: file:line, what is wrong, **why it matters
   here**, and the **suggested change as a short before/after snippet**.
3. **Missing verifications table** - `manual step -> proposed assertion`.
4. **Test data needed** - `value -> status (provided / missing / placeholder) -> where it should come from`.
5. **Questions** - anything you could not decide without the author.

### Suggest mode vs. fix mode

Default is **suggest**: change nothing. Only if asked to fix, apply the
mechanical, behaviour-preserving ones - remove `.only`, `page.pause()`,
`console.log`; add a missing `await`; replace an obvious `waitForTimeout`
with the assertion the next step already implies. Leave everything that needs
a decision (new assertions, locator changes, test data) as suggestions with a
snippet, and list them.

## Rules for the reviewer itself

- Do not invent a locator or a value to "fix" a finding. A missing selector is a question for the author or a fresh DOM snapshot.
- Do not suppress a finding to make the report clean. A suppression is
  `// review-ignore RULE-ID: <reason>` and the reason must say *why this case is
  different*; without a reason it is ignored.
- A rule firing wrongly is a signal: note it, and log it so the rule can be
  tightened: `npm run log-correction -- script-review <file> "<rule and why it was wrong>"`.

## Related

- **manual-to-playwright** - generates scripts; run this review on its output.
- **assertion-strategy** / **verification-strategy** - how to choose the assertion you suggest.
- **synchronization-strategy** - the principle behind the SYNC rules.
- **failure-healing** - the same analysis *after* a run, from the failure itself.

## Changelog

History is kept out of this file to save context: [references/changelog.md](./references/changelog.md). Add new entries there.
