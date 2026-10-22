---
description: Run the continuous-improvement loop - analyze accumulated correction signals and propose reviewed SKILL.md updates.
---

Run `#skill-curator` to review accumulated signal since the last curation
pass and propose skill updates.

Run `npm run learn-report` first so `learning-report.md` is current, and tell `#skill-curator` to use it alongside
`skill-attention-report.json`. List the candidates in it for me to approve; do not approve them yourself.

Before it starts, confirm `skill-corrections.jsonl` has entries since the
last `/curate-skills` run (check `skill-attention-report.json`'s
`generatedAt` against the corrections file's most recent line) - if there's
been no new signal, say so and stop rather than re-proposing the same
changes from last time.

Run this on the team's normal biweekly improvement-review cadence (see the
GitHub Copilot playbook), or on demand after a particularly rough
stabilization run worth investigating sooner.
