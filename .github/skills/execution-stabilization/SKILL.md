---
name: execution-stabilization
description: How to decide between fixing, retrying, and quarantining a failing generated test, and how to produce the configured execution report. Use when running or re-running anything under output/automation/.
user-invocable: true
---

# Execution Stabilization

## Order of operations for a failing test

1. **Run it headed** via the Playwright MCP server and actually look at what
   happened - a stack trace alone under-diagnoses UI timing issues.
2. **Classify the failure**: a real product defect (the app is wrong), a
   script defect (wrong locator, wrong assertion, missing wait), or
   environment noise (the app was down or slow, not the test).
3. **Fix script defects directly** and return the full updated file, per the
   stabilizer agent's contract - never a partial diff.
4. **Re-run at least once more** after any fix, before calling a test
   stable. A single green run after a change is not proof; a second one is
   the minimum bar.
5. **Only quarantine after repeated, confirmed flakiness** - not on the
   first failure, and not without having attempted a real fix first. A
   quarantined test still exists and still runs; it's excluded from the
   pass/fail gate, not deleted.

## Reporting

Generate the execution report in whichever format is configured in
`autopilot-ui/configs/new/config.json` (for example: HTML, JSON, or a
specific CI-native format). Treat that config value as authoritative -
don't default to Playwright's built-in HTML reporter if the config specifies
something else.

Every report should make it possible to answer, without re-running anything:
which tests ran, which passed/failed/were quarantined, and - for anything
that needed a fix this run - what was changed and why.

## What "stable" means here

A test is stable when it passes twice in a row, in headed mode, with no
change to its code between runs. A test that passes once after a fix is
"fixed, pending confirmation" - say so explicitly rather than reporting it
as done.

## Changelog

- 2026-09-22: Initial version.
