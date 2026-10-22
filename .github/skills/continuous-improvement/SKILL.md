---
name: continuous-improvement
description: How every agent logs a correction signal, how those signals turn into ranked skill-attention data, and how the skill-curator agent turns that into reviewed SKILL.md updates. Use whenever any agent deviates from a skill's guidance, has to fix its own output, or is corrected by a human reviewer.
user-invocable: true
---

# Continuous Improvement Loop

This is the mechanism that makes every skill in `.github/skills/` a living
document instead of a write-once prompt. It closes item 2.5 (the
SME-correction feedback loop) and generalizes it to any signal that a skill
was wrong, incomplete, or ambiguous - not just SME edits, but an agent's own
retries, `stabilizer`'s fix loops, and execution-report failures.

## The ten skill areas

Every correction gets tagged with exactly one of these, so signals
aggregate into something actionable rather than a pile of untagged notes:

| Skill area | Owns |
| --- | --- |
| `dsl-governance` | Schema/policy compliance of `.dsl.json` files |
| `locator-source-strategy` | Which of Options 1/2/3 to use and when |
| `locator-naming-convention` | Locator naming format and preference order |
| `framework-scaffolding` | Folder structure, logging, env config, test data |
| `assertion-strategy` | How a step's outcome gets written as Playwright `expect()` calls |
| `verification-strategy` | Whether a DSL expected-result is actually checkable, and by what signal |
| `synchronization-strategy` | Waiting, timing, and retry semantics in generated code |
| `execution-stabilization` | Fix/retry/quarantine decisions and reporting |
| `failure-healing` | Diagnosing failed runs; the known-error catalog (`src/healer/errorCatalog.json`) |
| `script-review` | Static review rules (`src/reviewer`) and what they miss or over-flag |

## Logging a correction

Any time `step-parser`, `locator-strategist`, `script-generator`, or
`stabilizer` has to deviate from what a skill said, fix something a skill
should have prevented, or gets corrected by a human reviewer, log it:

```bash
npm run log-correction -- <skillArea> <testFileOrDslFile> "<one-line note>"
```

This appends one line to `skill-corrections.jsonl` (append-only, never
edited or pruned by hand - it's the raw signal). Log the correction
*immediately*, in the same turn you make the fix, not as a batch at the end
of a session - a correction you meant to log and forgot is a correction the
loop never sees.

`stabilizer` additionally has the `.flaky-trend/` directory (one small JSON
file per test run, written by `FlakyQuarantineReporter`) as a second,
automatic signal source - no skill-area tag needed there, since
`analyze-skills` infers relevance from which tests keep needing retries.
It's a directory of per-run files rather than one shared file specifically
so parallel/sharded CI runs never race each other on a single write - see
`FlakyQuarantineReporter.ts` for why that mattered in practice, not just in
theory.

## Turning signals into action

`npm run analyze-skills` reads both `skill-corrections.jsonl` and every
file under `.flaky-trend/`, counts occurrences per skill area over the
requested window, and writes `skill-attention-report.json` ranked
highest-first. This
is the input the **skill-curator** agent (`.github/agents/skill-curator.agent.md`)
reads to decide which `SKILL.md` to propose changes to, and in what order -
run `/curate-skills` after enough signal has accumulated (weekly or
biweekly, matching the cadence in the GitHub Copilot playbook's Continuous
Improvement Loop section), not after every single correction.

## Learning from engineers' fixes

Corrections logged by agents are one signal. The other is what engineers actually
change in generated scripts to make them pass: new locators, hybrid fallbacks,
waits, assertions, verifications, data guards. The **fix-knowledge-base** skill
captures those edits from git and CI, counts a pattern only when several engineers
repeat it in several files, and publishes approved patterns to
`references/learned-patterns.md` in the five skills they belong to. `skill-curator`
reads `learning-report.md` next to `skill-attention-report.json`: the report says
which patterns are approved but still being fixed by hand, which elements keep
being re-edited, and which reviewer rules engineers resolve manually.

## The changelog convention

Every `SKILL.md` ends with a `## Changelog` section, newest entry first. A skill may keep the entries in `references/changelog.md` instead (to keep `SKILL.md` short); its `## Changelog` section then just links to it, and new entries go in that file:

```markdown
## Changelog

- 2026-10-12: Added \"Learning from engineers' fixes\": the capture, aggregate, approve and publish loop (`fix-knowledge-base` skill; commands `learn-capture`, `learn-report`, `learn-approve`, `learn-publish`).
- 2026-09-30: Added rule about X after 4 corrections tagged
  `synchronization-strategy` in the last two weeks (see
  skill-corrections.jsonl entries around that date).
```

This is what lets a reviewer - or a future skill-curator run - see not just
what a skill says today, but why it says it, without archaeology through git
blame.

## What this loop does not do

It never edits or merges a `SKILL.md` without a human reviewing the diff
first (Section 8 of the playbook: "changes go through review, like code").
`skill-curator` proposes; the automation lead approves. The loop makes
proposals well-informed and well-prioritized - it does not make them
automatic.

## Changelog

- 2026-10-07: `failure-healing` and `script-review` keep their changelog in `references/changelog.md` (a one-line pointer stays in `SKILL.md`); see "The changelog convention".
- 2026-10-06: Added the `failure-healing` and `script-review` skill areas (now ten). Unrecognised error messages and noisy or missing reviewer rules are logged under these, and become catalog entries / rule changes.
- 2026-09-22: `FlakyQuarantineReporter` moved from one shared
  `flaky-trend.json` to one file per run under `.flaky-trend/`, after an
  architecture review identified a real read-modify-write race under this
  project's own sharded CI configs. `analyze-skills` now reads the whole
  directory (plus the old single file, for one release of backward
  compatibility) - no change to how a correction is logged or tagged.
- 2026-09-22: Initial version.
