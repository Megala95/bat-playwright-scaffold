# Changelog - failure-healing

Newest first. Add an entry here (not in SKILL.md) whenever this skill changes.

- 2026-10-07 - After a second (external) evaluation: shorter, keyword-led `description`; `argument-hint` added; changelog moved here from `SKILL.md`; verdict priority order stated (and checked against the code by a meta test); "Tool dependencies" and "Relationship to Playwright's official Healer" sections added.
- 2026-10-06 - After an independent review: 37 catalog entries (added browser launch, API connection, storage-state, worker crash, hidden-element, navigation-destroyed and attribute/value assertion patterns, each from captured real output); new verdicts `broken-run`, `no-results` and `flaky-only`; a flaky test that passed can no longer declare an outage; `auth` must be a whole URL segment to count as a login redirect; run-level `errors[]` (globalSetup) are read; clusters without a target no longer merge unrelated errors.
- 2026-10-06 - Initial version. Catalog-driven classification validated against real Playwright output;
  environment-first verdict; cluster-level fixing; explicit guardrails against loosening.
