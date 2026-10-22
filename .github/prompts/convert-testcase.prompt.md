---
description: Run the full manual-to-automated pipeline for one test case, end to end.
argument-hint: fileName env (e.g. TC-1042.docx qa)
---

Convert `${input:fileName}` into a stable, production-ready automated test.

Run this as a chain, in order, handing off between agents rather than doing
the work yourself:

1. `#step-parser` - parse `autopilot-ui/uploads/${input:fileName}` into
   `output/dsl/testcases/${input:fileName}.dsl.json`.
2. `#locator-strategist` - enrich that DSL file with real, validated
   locators via the Playwright MCP server.
3. `#script-generator` - generate the automation framework into
   `output/automation/`, using environment `${input:env}`.
4. `#script-reviewer` - statically review the generated scripts (waits,
   verifications, test data, locators) and fix what is safe, before running.
5. `#stabilizer` - run it headed, diagnose failures with `heal-analyze`, fix
   anything that is the test's fault, and report the result.

Stop and report back if any step fails validation (schema, locator
resolution, or a test that can't be stabilized after a real fix attempt) -
don't silently continue to the next step on a known-bad artifact.
