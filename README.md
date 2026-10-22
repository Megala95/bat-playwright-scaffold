# BAT AI Automation Solution — Playwright Scaffold

A reference implementation of the technical approach in *BAT AI Automation
Solution Approach V1.3*, specifically Challenge 2 (Enhance Playwright Script
Generation) and the resilience half of Challenge 3. It is meant to be the
concrete pattern that Copilot agents/skills (see the companion GitHub
Copilot playbook) generate against, and the starting point for automating
real test cases once one is shared.

## Before you run this

Four things to change before trusting a real run, pulled up front because
they used to be buried at the bottom of this file:

1. **`model: gpt-5`** in every `.github/agents/*.agent.md` frontmatter
   (including `skill-curator`) is a placeholder - set it to whatever your
   Copilot plan/org policy actually allows, or remove the line to use the
   chat's default model.
2. **The `tools:` list** in each agent (`edit`, `search`, `runCommands`,
   `playwright`) uses common VS Code tool-group names - open the `/agents`
   tools picker in your VS Code version and adjust them to whatever it
   actually lists; they can differ release to release.
3. **`governance/dsl-schema.json`, `governance/ai-policy.md`,
   `config/frameworks/folder-structure/`, and
   `autopilot-ui/configs/new/config.json`** are assumed to already exist in
   the target repo (autopilot-ui) - the agents read those files at run
   time rather than having their contents baked in here, since none of
   them were included in what was shared when this scaffold was built.
4. **`htmlRepoLocatorExtractor.ts`** expects `autopilot-ui/configs/new/config.json`
   to carry an `htmlSourcePath` (or set `BAT_HTML_EXPORT_DIR` directly)
   once Cisco grants DevGit/repo access - until then, `locator-strategist`
   falls through to Option 1 (crawling).

Full detail, including the `skill-curator` evidence threshold, is in
"GitHub Copilot agent chain" below.

## What's real vs. placeholder

| Area | Status |
| --- | --- |
| `BasePage` locate→classify→act→verify pattern (2.2) | Working, ready to use as-is |
| `LocatorRepository` with primary + fallback resolution (2.2) | Working, ready to use as-is |
| `ElementTypes` action guard (2.2) | Working; extend the enum as new UI patterns turn up beyond CCW |
| `crawlOnce.ts` (2.1, Option 1) | Working crawler; **output is unvalidated** — review before trusting |
| `htmlRepoLocatorExtractor.ts` (2.1, Option 3) | Working static-HTML extractor; needs `BAT_HTML_EXPORT_DIR` pointing at an export/checkout once Cisco grants access — **output is unvalidated** the same as Option 1 |
| `locatorCandidate.ts` (2.1, shared) | Working; the classification logic both crawlOnce and htmlRepoLocatorExtractor share, so Options 1 and 3 (and manually-recorded Option 2/MCP finds) produce the same candidate shape |
| `login.locators.json`, `LoginPage.ts` (2.3) | Structurally real, but selector **values are placeholders** — swap in real, validated selectors once available (Option 3 access, or a validated crawl); `elementClass` and `getByRole` `role` values are now validated against real enums at load time, not just checked to be strings |
| `AuthScaffold.ts` (2.4) | Working, and genuinely wired in: `globalSetup` logs in once, and the `main` project's `storageState` (`playwright.config.ts`) reuses that session for every spec except `login.spec.ts` itself, which deliberately opts back out — **swap in Mohamed Rifas's plan** once delivered; call sites (`ensureAuthenticated`) shouldn't need to change |
| `HealthCheck.ts`, `FlakyQuarantineReporter.ts`, `quarantine.json` (3.3) | Working; health check now verifies the login page's `usernameField` renders (and fails fast with a distinct message while locators are still placeholders), and flaky-trend data is one file per run under `.flaky-trend/` (race-free under sharded CI) with 90-day self-cleanup |
| `playwright.config.ts` sharding/timeout notes (3.2, 4.1, 4.3), `.github/workflows/playwright.yml`, `Jenkinsfile` (4.1) | Working config; both CI files are runnable starting-point stubs demonstrating meta → smoke → sharded main → merge - adapt the credentials/agent labels to your real CI; both now also collect `.flaky-trend/` shards from the run and feed them into `npm run analyze-skills` instead of discarding them (see "Response to the second independent re-review" below) |
| `src/generator/generateSpec.ts` + `tests/meta/generator-regression.spec.ts` (auditability) | Working golden-file regression test - a deterministic reference generator, not the live Copilot agent, but it pins down the code *shape* script-generator must produce so a prompt change can't silently drift it |

## Layout

```
bat-playwright-scaffold/
├── .gitignore                   # node_modules, test artifacts, .auth/ (live session state!), .flaky-trend/
├── playwright.config.ts        # meta/smoke-gates-main, sharding-ready, quarantine-aware, storageState reuse
├── Jenkinsfile                  # item 4.1/4.3: CI stub - meta -> smoke -> sharded main -> merge -> analyze-skills
├── .github/workflows/playwright.yml  # same shape as a GitHub Actions workflow
├── .github/workflows/learning.yml    # learning loop in CI: capture PR fixes, store merged ones, build the learning report
├── .githooks/pre-commit              # opt-in (npm run learn-install-hook): records learning events; never blocks a commit
├── .learnings/                       # events/ + patterns/ (committed), config.json - see .learnings/README.md
├── src/
│   ├── core/
│   │   ├── ElementTypes.ts          # item 2.2: element classes + valid-action guard
│   │   ├── LocatorRepository.ts     # item 2.2: locator repo loader/resolver + fallbacks
│   │   ├── BasePage.ts              # item 2.2/2.3: the reusable pattern every page extends
│   │   ├── AuthScaffold.ts          # item 2.4: nav/login/auth scaffolding; wired as globalSetup
│   │   ├── HealthCheck.ts           # item 3.3: pre-suite environment check (login-page-specific)
│   │   └── FlakyQuarantineReporter.ts  # item 3.3: retry visibility; one file per run under .flaky-trend/
│   ├── healer/                      # intelligent healer: errorCatalog.json (37 known failure patterns) + analyzeResults.ts (npm run heal-analyze)
│   ├── reviewer/                    # intelligent script review: reviewSource.ts (AST rules) + reviewScripts.ts (npm run review-scripts)
│   ├── learning/                    # learning loop: classify.ts (AST edit classifier), captureGit.ts, aggregate.ts, approve.ts, publish.ts, lookup.ts (npm run learn-* / lookup-fix)
│   ├── generator/
│   │   ├── dslTypes.ts               # illustrative DSL shape for the reference generator
│   │   └── generateSpec.ts           # deterministic reference impl. of script-generator's output shape
│   ├── locators/login.locators.json # item 2.1/2.2: example locator repository file
│   ├── pages/LoginPage.ts           # item 2.3: worked Page Object example
│   └── utils/
│       ├── locatorCandidate.ts          # item 2.1: shared candidate shape + classifier (all 3 options)
│       ├── crawlOnce.ts                 # item 2.1, Option 1: crawl-once-per-project
│       └── htmlRepoLocatorExtractor.ts  # item 2.1, Option 3: static HTML/repo export parsing
├── tests/
│   ├── meta/generator-regression.spec.ts  # golden-file check on src/generator/
│   ├── meta/unit.spec.ts             # isSafeFileRef, withinWindow/capToMostRecent, classifyElement, parseLocatorFile
│   ├── meta/healer.spec.ts           # catalog checked against real Playwright 1.63 error text (two captures + env/globalSetup captures); clustering; verdicts; shard merge
│   ├── meta/reviewer.spec.ts         # every rule fires on a bad snippet, good twins stay quiet; rules.md cannot drift
│   ├── meta/learning.spec.ts         # edit classifier (every kind, regressions), redaction, git capture in a temp repo, aggregation thresholds, approve/publish drift, lookup
│   ├── meta/copilot-assets.spec.ts   # agents/skills/prompts: names, handoff chain, links, npm scripts all resolve
│   ├── fixtures/login.dsl.json, login.spec.golden.txt  # frozen input/output pair for the above
│   ├── fixtures/results.real*.json  # genuine Playwright JSON reports (real errors, a missing browser, a failed globalSetup) the healer tests run against
│   ├── smoke/health-check.spec.ts   # gates the main suite
│   └── example/login.spec.ts        # worked end-to-end example
└── quarantine.json                  # item 3.3: known-flaky test titles, excluded from gating
```

## Using this with a real test case

Once you have a manual test case to automate:

1. Add or extend a `*.locators.json` file under `src/locators/` for the
   screens it touches (crawl a starting point with `npm run crawl`, then
   validate every entry by hand — see the comment at the top of
   `crawlOnce.ts`).
2. Add a Page Object under `src/pages/` extending `BasePage`, following the
   shape of `LoginPage.ts`.
3. Write the spec under `tests/example/` (or a new folder per feature) as a
   sequence of `act()`/`verify()` calls — never raw `page.locator(...)` calls
   in the spec itself, so the element-class guard and fallback resolution
   stay in effect.

## Setup

```bash
npm install
npx playwright install --with-deps chromium
npm run test:meta                    # no app needed - generator regression only
BAT_APP_BASE_URL=https://your-app.example.com \
BAT_APP_USERNAME=... BAT_APP_PASSWORD=... \
npm run test:smoke && npm run test:main
```

## Traceability

Every source comment cites the item number it implements (e.g. "item 2.2",
"item 3.3") so this scaffold can be checked directly against the
*Solution Approach* and *Locator Options Comparison* tabs of
`BAT_AI_Automation_Solution_Approach_V1.3.xlsx`.

## GitHub Copilot agent chain (`.github/agents/`, `.github/skills/`)

`.github/agents/` and `.github/skills/` are a direct, native-format
translation of your team's four existing "autopilot-ui" contract files
(`stepParser.agent.md`, `locatorStrategy.contract.md`,
`scriptGenerator.contract.md`, `stabilization.contract.md`) into GitHub
Copilot's own custom-agent (`.agent.md`) and Agent Skill (`SKILL.md`)
formats, chained with `handoffs` so running `/convert-testcase` drives all
four in sequence:

```
step-parser → locator-strategist → script-generator → script-reviewer → stabilizer
(DSL parse)   (locators via Option   (generate the       (static review:    (run headed, triage
               3 HTML/repo → Option   framework)          waits, verifies,   with heal-analyze,
               1 crawl → Option 2                         data, locators)    fix, report)
               MCP, in that order)
```

`script-reviewer` and `healer` are additions to the original four contracts
(see "Healer and script reviewer" below); `healer` can also be run on its own
with `/heal-failures` after any run.

| Original contract | Native Copilot agent | Notes |
| --- | --- | --- |
| `stepParser.agent.md` | `.github/agents/step-parser.agent.md` | Same ROLE/TASK/INPUT/OUTPUT; DSL comments moved out of the `.dsl.json` into a sibling `.dsl.notes.md` + chat reply, since JSON has no comment syntax |
| `locatorStrategy.contract.md` | `.github/agents/locator-strategist.agent.md` | Uses **all three** item 2.1 options, not MCP alone — Option 3 (HTML/repo access, via `htmlRepoLocatorExtractor.ts`) first when configured, Option 1 (`crawlOnce.ts`) as the fallback, Option 2 (Playwright MCP) for targeted, dynamic-content cases only — see the `locator-source-strategy` skill for the decision order |
| `scriptGenerator.contract.md` | `.github/agents/script-generator.agent.md` | Core framework-generation task carried over as-is; the embedded HTML-documentation instruction (already parked in an HTML comment in the source file) became its own `.github/prompts/generate-docs.prompt.md`, run on demand rather than every generation |
| `stabilization.contract.md` | `.github/agents/stabilizer.agent.md` | Same task; "return full updated file" and "fix + re-execute" constraints carried over verbatim; now starts failed runs with `npm run heal-analyze` |
| *(new)* | `.github/agents/script-reviewer.agent.md` | Static review before anything runs; uses the **script-review** skill and `npm run review-scripts` |
| *(new)* | `.github/agents/healer.agent.md` | Triage of a finished run; uses the **failure-healing** skill and `npm run heal-analyze` |

Shared conventions that all four contracts referenced independently
(`governance/dsl-schema.json`, which locator-sourcing option to use, the
locator naming format, log4j/folder structure, retry/quarantine/report
rules, and now also assertion/verification/synchronization judgment) were
pulled out into twelve Skills so they're written once and loaded by whichever
agent needs them, instead of re-explained in every agent's prompt body:

- `.github/skills/dsl-governance/` — schema + `governance/ai-policy.md` compliance
- `.github/skills/locator-source-strategy/` — the Option 3 → Option 1 → Option 2 decision order from the 'Locator Options Comparison' tab
- `.github/skills/locator-naming-convention/` — the `[ScreenContext_][ActionOrElementType][ElementName]` format and locator preference order
- `.github/skills/framework-scaffolding/` — folder structure, log4j-by-default, environment config, test-data format
- `.github/skills/execution-stabilization/` — fix/retry/quarantine decision order and reporting
- `.github/skills/assertion-strategy/` — matcher choice (`toBeVisible`/`toContainText` vs. `toHaveText`/`toHaveValue`/`toHaveCount`/state matchers), soft vs. hard assertions, what not to assert on
- `.github/skills/verification-strategy/` — requirement-level verification vs. code-level assertion, UI/state/persistence signal categories, ties back to item 6.4 acceptance criteria and the item 6.3 human-in-the-loop checkpoint
- `.github/skills/synchronization-strategy/` — trusting Playwright auto-waiting by default, when an explicit wait is actually justified, why `waitForTimeout()`/sleeps and wider global timeouts are never the fix
- `.github/skills/manual-to-playwright/` — standalone, single-pass alternative to the four-agent chain: manual test case → normalized steps → Page Objects + spec + traceability table, with scaffold/plain modes, an ask-or-assume rule for ambiguous steps, no-invented-locators, and a mandatory `tsc`/`--list`/run verification step (has its own `references/` and `assets/`)
- `.github/skills/failure-healing/` — diagnose failed/flaky runs from the results, classify against the known-error catalog, fix the right layer (locator, synchronization, data, script) or report environment / product defects instead of hiding them
- `.github/skills/script-review/` — review scripts for missing synchronization, missing verifications, absent test data, fragile locators and hygiene; `references/rules.md` is generated from the code
- `.github/skills/continuous-improvement/` — the mechanism described below; read this one first if you're wiring the loop into a new repo

`.vscode/mcp.json` wires up the official Playwright MCP server
(`@playwright/mcp`) that `locator-strategist` and `stabilizer` both depend
on — start it from VS Code's MCP panel before running either agent.

## Healer and script reviewer

Two tools, each with a skill and an agent, because the most common ways a
generated test goes wrong are predictable.

**Script reviewer** (`npm run review-scripts [-- paths] [--strict] [--min warning]`)
reads Playwright specs and page objects with the TypeScript compiler API and
reports, with a line number and a specific suggestion: 

- *synchronization* - hard sleeps, `networkidle`, legacy waits, non-retrying reads inside `expect`, branching on a non-waiting check, a wait registered after its trigger, huge timeouts, `force: true`, and an action that changes the page and is not followed by a verification;
- *verification* - tests with no assertion, ending on an action, trivial assertions, a web-first matcher that is not awaited, only absence asserted;
- *test data* - hardcoded credentials, placeholder values, `process.env.X!`, absolute URLs, `fill('')`;
- *locators* - XPath, positional/nested CSS, auto-generated class names, unscoped `.first()`, element handles, `text=` strings;
- *hygiene and security* - `.only`, `page.pause`, `console.log`, `skip` without a reason, swallowed failures, secret-shaped literals.

`--rules` lists all 31 rules; `references/rules.md` in the skill is generated from
them and a meta test fails if it drifts. A finding is suppressed with
`// review-ignore RULE-ID: <reason>` - no reason, no suppression. `--strict`
exits non-zero on error-level findings and is wired into both CI files.

**Healer** (`npm run heal-analyze [-- a.json b.json] [--out heal-report.json]`)
reads the Playwright JSON results and, for each failed or flaky test: matches
the error against `src/healer/errorCatalog.json`, says who should act
(locator / synchronization / test-data / test-script / environment /
product-defect-suspect / framework / unknown) and whether the fix can be automatic, assisted or
none, checks whether the attempts failed the same way, and groups failures
with a shared root cause. The verdict comes first: when half or more of the
hard failures (and at least two, or all of them) are environment or configuration problems
(unreachable app or API, missing browser, unset variables or `REPLACE_` placeholders, missing or
expired session) it says `environment-suspect` and the agent must not edit tests.
A run that died before any test (a `globalSetup` that threw) is `broken-run`, an
empty report is `no-results`, and a run where nothing failed but tests needed a retry is
`flaky-only` - a retried-and-passed test can never declare an outage. Failures that look
like product defects (a text, count or URL that differs) are reported, not "fixed". Sharded runs write one file each (`BAT_RESULTS_FILE`) and are
merged before analysis.

How to extend: add an entry to `errorCatalog.json` (order is priority; the first
match wins) with a real `example` message - the meta tests fail if an entry's
example does not classify back to itself, and the catalog was checked against
genuine Playwright 1.63 output (`tests/fixtures/results.real.json`), not guessed
messages. Unrecognised errors are logged with
`npm run log-correction -- failure-healing ...` and the skill-curator loop
turns them into entries.

Limitations, stated plainly: the reviewer is static and heuristic - it can
miss things (it does not know the app) and can flag legitimate code, which is
why suppressions exist; "assertion helpers" are recognised by name
(names starting with `expect`, `verify`, `assert`, `should`, `ensure`, `validate` or `check` - but not `checkout`). The healer only
diagnoses and recommends; the agent applies fixes under the skill's
guardrails (no loosening, no sleeping, no `force`). Neither has been run
against your application - the tests prove the logic, not your suite.

## Continuous improvement loop

Every agent above now ends its run by logging what it had to work around —
not just `stabilizer` on a flaky test, but `step-parser` on an
unverifiable expected result, `locator-strategist` on a naming convention
that didn't fit, `script-generator` on an assertion or sync pattern the
skill didn't cover. That closes the loop the original four contracts didn't
have: corrections and execution-report signal flow back into the skill set
itself, instead of staying tribal knowledge in someone's head.

```
agent hits a gap
  → npm run log-correction -- <skillArea> <file> "<what happened>"
  → skill-corrections.jsonl   (append-only; FlakyQuarantineReporter also
                                writes one file per run to .flaky-trend/)
      → npm run analyze-skills
          → skill-attention-report.json   (ranked: which skill area has
                                            the most unresolved signal)
              → skill-curator agent (via /curate-skills, biweekly or
                on demand) reads the top-ranked areas, proposes dated
                SKILL.md diffs citing the evidence
                  → human-reviewed PR, never auto-merged
                      → ## Changelog entry in the updated SKILL.md
```

- **`src/utils/skillAreas.ts`** — the 10-area taxonomy every correction must
  tag against: `dsl-governance`, `locator-source-strategy`,
  `locator-naming-convention`, `framework-scaffolding`,
  `assertion-strategy`, `verification-strategy`,
  `synchronization-strategy`, `execution-stabilization`.
- **`npm run log-correction -- <skillArea> <file> "<note>"`**
  (`src/utils/logCorrection.ts`) — any agent or reviewer can call this;
  rejects an unknown skill area instead of silently mis-tagging it.
- **`npm run analyze-skills [-- --days N]`**
  (`src/utils/analyzeSkillSignals.ts`) — aggregates `skill-corrections.jsonl`
  plus every file under `.flaky-trend/` (a flaky-test entry counts toward
  both `synchronization-strategy` and `execution-stabilization`) into a
  ranked `skill-attention-report.json`.
- **`.github/agents/skill-curator.agent.md`** + **`.github/prompts/curate-skills.prompt.md`**
  — the agent that turns that ranked report into proposed, evidence-cited
  SKILL.md diffs (`/curate-skills` in Copilot Chat). It requires at least 3
  corrections as evidence (fewer is flagged as an "early signal" only) and
  never merges its own changes.
- **`## Changelog`** — every SKILL.md now ends with one; `skill-curator`
  appends a dated entry whenever it proposes a change that gets merged, so
  the skill set's history is visible in the file itself, not just in git
  blame.

This is intentionally generalized beyond the original four agents — the
same `log-correction` → `analyze-skills` → `skill-curator` path is what
keeps `assertion-strategy`, `verification-strategy`, and
`synchronization-strategy` current too, as real test cases surface gaps
those skills didn't anticipate.

**Open items to adapt for your environment:** the four biggest ones are
pulled up to "Before you run this" near the top of this file. One more,
specific to the continuous-improvement loop: `skill-curator`'s "≥3
corrections as evidence" threshold is a starting point, not a fixed rule —
tune it once you see real correction volume; too low and it proposes on
noise, too high and slow-moving skill areas never get attention.

## Learning from engineers' fixes

Many engineers use this scaffold, and the fixes they make to get a generated script green (a new locator, a hybrid fallback, a dynamic wait, an assertion, a verification, a data guard) are the best evidence of what the skills got wrong. This loop collects them, finds the ones that recur across files and people, and - after a person approves - writes them into the skills. Full explanation: `.github/skills/fix-knowledge-base/SKILL.md`.

```
fix made by an engineer → learn-capture → .learnings/events/  (redacted, committed)
   sources: pre-commit hook · pull request in CI · Copilot session · Jenkins/CI re-run (linked to the failure)
→ learn-report  (≥3 edits, ≥2 files, ≥2 engineers → candidate; regressions → coaching only)
→ learn-approve (a named person)  → .learnings/patterns/
→ learn-publish → .github/skills/<area>/references/learned-patterns.md  (via pull request)
→ agents read it; `lookup-fix` retrieves catalog + learned fixes
→ learning-report.md shows what is still being fixed by hand
```

| Command | What it does |
| --- | --- |
| `npm run learn-install-hook` | Opt in, per clone: commits that touch `tests/`, `src/pages/`, `src/locators/` record their learning events (`BAT_LEARN=0 git commit` skips one). |
| `npm run learn-capture -- --worktree` / `--staged` / `--commit <sha>` / `--range a..b` | Classify a change into events. Add `--write` to save, `--why "<reason>"`, `--heal-report heal-report.json` to link edits to the failure they fixed, `--summary` to list events. |
| `npm run learn-report` | `learning-report.md/json`: candidates, emerging patterns, approved patterns still fixed by hand, coaching signals, unstable elements, failure→fix map, reviewer rules fixed by hand, per-area trend. |
| `npm run learn-approve -- <key> --by "<name>"` | Approve a candidate (`--retire` rejects or withdraws one). |
| `npm run learn-publish` (`-- --check` in CI) | Regenerates the learned-patterns files and the edit-kinds reference. |
| `npm run lookup-fix -- "<problem or error>"` | Ranked answers from the healer catalog and approved patterns, with "learned here" fixes. |

What it recognises (22 edit kinds, `src/learning/kinds.ts`): locator upgraded / replaced / downgraded / scoped, hybrid fallback added or removed, sleep replaced or removed, wait added, timeout raised, force added or removed, assertion added / strengthened / weakened / removed, expectation updated, verification added, data externalised or hardcoded, skip guard added. Edits are classified from a statement-level AST comparison of the file before and after, not from the text diff. Shortcuts that hide a problem are recorded as regressions and are never offered as guidance.

Where things live: `.learnings/events/` and `.learnings/patterns/` are committed (reviewed like code); `.learnings/config.json` holds the thresholds. `.github/workflows/learning.yml` also appends merged edits to a `bat-learning` data branch, so history outlives CI artifact retention; replace that step with a central store when the team picks one. Privacy: records contain the redacted statement, the file path and a salted hash of the author, never whole files or branch names. Redaction is pattern-based and best effort (secret shapes, e-mail addresses, hosts, values typed into password-like fields); it cannot recognise a person's name inside a string, so review records in the pull request, and set `storeStatements: false` to keep only the kind of edit. The author hash is pseudonymous, not anonymous; use `BAT_LEARN_SALT` in a private repository.

Limits: classification is heuristic and was validated on synthetic and adversarial edits (`tests/meta/learning.spec.ts`) and an independent review, not on real engineer history; it reads one statement at a time (see the skill for known blind spots) - read the example in each candidate before approving, and tune the thresholds after the first month of data. An edit is linked to a failure only through a `heal-report.json` naming the same file.

## Response to the Sept 2026 architecture review

An internal review scored this scaffold 7.8/10 and named five gaps as the
path to 9+. All five are addressed as of this revision:

| Review finding | What changed |
| --- | --- |
| No generator regression test — the agent chain was unauditable | Added `src/generator/generateSpec.ts` (a deterministic reference implementation of script-generator's output contract) plus `tests/meta/generator-regression.spec.ts`, a golden-file test against a frozen DSL fixture. It's honest about scope: it pins down generated-code *shape*, not the live LLM agent's judgment — see that file's header comment. |
| `LocatorRepository.resolve()` was a fallback-bypassing footgun | Renamed to `resolvePrimary()` with an explicit no-fallback warning in its docstring; `resolveWithFallback()` (used everywhere else) is unchanged. |
| Fragile `getByRole` string parsing (`"button:Sign In"`, breaks on a colon in the name) | `LocatorRef` is now a discriminated union — `getByRole` carries structured `{ role, name? }` instead of a colon-delimited string. `login.locators.json` updated to match. |
| `flaky-trend.json` grows forever | `FlakyQuarantineReporter` originally pruned a single shared file on every write; a follow-up independent review found that design races under this project's own sharded CI (see the next section) — it now writes one file per run to `.flaky-trend/`, self-cleaned after 90 days. |
| No CI workflow file | Added `.github/workflows/playwright.yml` (runnable as-is) and a `Jenkinsfile` stub (since this project's own comments assume Jenkins - item 4.1), both demonstrating meta → smoke gate → sharded main → merged report. |

The remaining review items were also addressed: `BasePage.verify()` now
accepts an `{ exact: true }` option (or a `RegExp`) so a step can opt into
`toHaveText` without changing the `toContainText` default the
assertion-strategy skill deliberately prefers; `checkEnvironmentHealthy()`
now resolves the login page's real `usernameField` locator instead of
checking `<body>` isn't empty; `AuthScaffold`'s `globalSetup` is now
actually wired into `playwright.config.ts`; `htmlRepoLocatorExtractor.ts`
documents its Shadow-DOM/iframe blind spot alongside `crawlOnce.ts`'s;
`log-correction` rejects absolute paths and `..` segments in its `file`
argument; and `stabilizer.agent.md` now explicitly forbids silently
widening a locator to force a pass (see its Constraints section).

On the review's three "what to check before trusting the chain" questions:
handoffs between agents already pass typed artifacts, not prose — each
agent's Input/Output section names an exact file path (e.g.
`output/dsl/testcases/${input:fileName}.dsl.json`), which the next agent in
the chain reads directly. `locator-strategist` already enforces Option 3 →
Option 1 → Option 2 as an explicit numbered decision order in its Task
section, not just in the README. `stabilizer` does have write access to
`src/locators/*.json` (it needs it, to fix genuinely stale selectors) - the
new Constraint above is what keeps that from becoming a hidden failure
mode.

## Response to the independent re-review (7.8 → 8.05/10)

A second, independent review verified the changes above by actually trying
to break them - reintroducing bugs, running the tests, re-deriving the
pruning math - rather than trusting the claims. It confirmed all 12 items
genuinely hold up, scored the repo 8.05/10, and found one real regression
plus several thin spots. All are fixed as of this revision:

| Finding | What changed |
| --- | --- |
| **(High) A `LocatorRepository.load(loginLocators as any)` cast silently defeated the new `getByRole` union** — reintroducing the old `{strategy:"getByRole", value:"button:Sign In"}` shape compiled clean under `as any`, so the "fixed" item 4 didn't actually hold for the one real call site | `LocatorRepository.load()` now takes `unknown` and runs a real runtime validator, `parseLocatorFile()`, against every entry - regardless of any cast at the call site. `LoginPage.ts` and `HealthCheck.ts` no longer cast at all. `tests/meta/unit.spec.ts` reintroduces the exact old shape and asserts it throws. |
| **(Medium) `FlakyQuarantineReporter`'s single-file read-modify-write races under the very sharded CI this revision added** — the GH Actions matrix and the Jenkinsfile's `parallel` stage both run several `playwright test` processes against the same workspace at once | Rewritten to write one file per run under `.flaky-trend/` instead of rewriting a shared file - structurally race-free, since nothing is shared at write time. `analyze-skills` aggregates the directory at read time instead (one reader, on demand, not N racing writers). Old `flaky-trend.json` is still read for one release, so no history is lost on upgrade. |
| **(Medium) The golden-fixture regression test never exercised the `{exact:true}`/RegExp `verify()` branch** it was partly built to guard | `tests/fixtures/login.dsl.json` now includes both a contains-mode and an exact-mode `assertText` step; the golden file was regenerated from the real generator (not hand-typed) to avoid transcription drift. |
| **(Medium) `checkEnvironmentHealthy()` now hard-depends on real locators, but fails with the same generic "no selector matched" message as any other resolution failure** — confusing on a fresh checkout where the smoke gate is *expected* to fail until locators are filled in | It now detects the placeholder case (`REPLACE_ID_...`) up front and throws a distinct, actionable error pointing at `npm run crawl` / `npm run extract-html`, instead of letting a first-time user debug a generic locator-resolution failure. |
| **(Low) No unit coverage for cheap-to-test pure logic** (`isSafeFileRef`, the time-window/capping math, `classifyElement`) | Added `tests/meta/unit.spec.ts` - 15 tests, all passing, all in the browser-free `meta` project. |

Not changed: the review's one remaining "Low" item — that `stabilizer`'s
anti-locator-loosening guardrail is prompt-only, with no CI-side diff check
on `src/locators/*.json` — is a real, correctly-scoped gap. Enforcing it in
CI needs a real test case and a real target app to generate a meaningful
diff against, which this scaffold doesn't have yet; it's tracked as a
follow-up rather than solved with something that would just be for show
here.

## Response to the second independent re-review (8.05 → 8.1/10, then this revision)

A third independent pass ran `npm install`, `tsc --noEmit`, and the real test
suite rather than trusting the prior write-up, re-verified all 5 items from
the round above, confirmed 4 of them cleanly and found a real residual gap
in the 5th, and surfaced several issues nobody had flagged yet. It scored
the repo 8.1/10. The four highest-impact new findings are fixed as of this
revision:

| Finding | What changed |
| --- | --- |
| **(Medium-High) `AuthScaffold`'s saved session was written but never consumed** — `globalSetup` logs in and writes `.auth/session.json`, but no Playwright project ever set `use.storageState` to it, so every spec still did a fresh UI login. The README called this "Working" when the reuse half of the pattern was dead code. | `playwright.config.ts`'s `main` project now sets `storageState: AUTH_STATE_FILE` whenever `authCredentialsProvided()` is true (a new export from `AuthScaffold.ts`, checked at config-parse time — not `fs.existsSync()`, which would race against `globalSetup` writing the file). `tests/example/login.spec.ts`, which exercises the login flow itself, explicitly opts back out with `test.use({ storageState: { cookies: [], origins: [] } })` so it still starts unauthenticated. See the updated docstring in `AuthScaffold.ts` for the full reasoning, including the config-parse-time-vs-runtime ordering issue this had to avoid. |
| **(Medium) `parseLocatorFile()`'s validator had a gap in exactly the area it claims to close** — `elementClass` was checked to be *a string*, not a *valid `ElementClass` value*, and `getByRole`'s `role` was checked to be *a string*, not a *real ARIA role* — both typos would pass validation and only fail later with a confusing raw error (`TypeError: Cannot read properties of undefined`) or need an `as any` at the `getByRole()` call site to compile. | `isLocatorEntry()` now checks `elementClass` against `Object.values(ElementClass)`. `LocatorRef`'s `role` field is now typed `AriaRole`, a union of Playwright's own accepted ARIA roles (`ARIA_ROLES` in `LocatorRepository.ts`, copied from `@playwright/test`'s own `getByRole()` type), and `isLocatorRef()` validates against it — which also let the two remaining `role as any` casts at the `getByRole()` call site be removed entirely, since `candidate.role` is now the exact type Playwright expects. Two new tests in `tests/meta/unit.spec.ts` reproduce both typo scenarios and assert they're rejected. |
| **(Medium) No `.gitignore`** — a real risk given `.auth/session.json` holds live authenticated browser state, plus no exclusion for `node_modules/`, test output, or the continuous-improvement loop's generated files. | Added, with comments explaining why each entry matters (especially `.auth/`). |
| **(Medium) The `.flaky-trend/` race fix from the prior round was real, but neither shipped CI config actually got the data anywhere useful** — the GitHub Actions matrix runs each shard on a separate ephemeral VM with no upload step for `.flaky-trend/`, so it was discarded when the runner tore down; the Jenkinsfile's `post.always` block still archived the old pre-sharding `flaky-trend.json` path, which the reporter no longer writes to. Net effect: the continuous-improvement loop's flaky signal was silently empty in both pipelines this repo ships, even though the underlying write-race bug was genuinely fixed. | `playwright.yml`: each `main` shard now uploads its `.flaky-trend/` shard as an artifact; `merge-reports` downloads and merges them back into a local `.flaky-trend/`, runs `npm run analyze-skills`, and uploads `skill-attention-report.json`. `Jenkinsfile`: since its `parallel` shards already run in one shared workspace (no download step needed there), it now archives `.flaky-trend/**` (not the stale single-file path) and has a new `Analyze skill signals` stage that runs `analyze-skills` after the merge step, with `skill-attention-report.json` archived too. Noted honestly in both files: this gives a real, analyzable signal for the current (and recent) run(s) within each CI system's own artifact-retention window — it is not indefinite trend storage. Longer-lived history would need a durable store (a dedicated branch, an external system), which is called out as a deliberate follow-up, not solved here for show. |

Not changed in this pass (lower severity, left as explicitly documented
rather than silently ignored): `HealthCheck.ts`'s placeholder-detection
message still names all three login locators even when only one is still a
placeholder (a precision issue, not a false-pass — see the comment in
`HealthCheck.ts`); the element-action vocabulary is still hand-duplicated
across `ElementTypes.ts` and `src/generator/dslTypes.ts`/`generateSpec.ts`
with nothing to catch drift between them if a new action is added; and
`AuthScaffold`'s cached session has no expiry/staleness check (documented
directly in its docstring above the cache-check line) — all three are real,
but small enough, and clear enough once flagged, that fixing them for real
this round would mostly have been fixing the same category of issue twice
rather than closing new ground.
