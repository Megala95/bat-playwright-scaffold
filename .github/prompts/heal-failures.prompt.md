---
description: Analyze the latest test results, diagnose failures against the known-error catalog and fix what is a test problem (not an environment or product problem).
argument-hint: optional results file(s), e.g. test-results/results-1.json test-results/results-2.json
---

Run `#healer` on the latest execution results.

1. `npm run heal-analyze ${input:resultsFiles}` (default `test-results/results.json`).
2. Lead your reply with the verdict. If it is `environment-suspect`, `broken-run`
   or `no-results`, report that and stop - do not edit tests.
3. Otherwise heal cluster by cluster, with evidence, using the **failure-healing**
   skill's guardrails.

If there are no results file, say so and ask for a run first - do not invent a
diagnosis.
