---
description: Generate a single, self-contained HTML documentation page for the autopilot-ui framework.
---

<!--
  This was originally an HTML-comment-wrapped instruction embedded inside
  scriptGenerator.contract.md, i.e. already parked/disabled in the source
  contract rather than run on every generation. It's split out here as its
  own on-demand prompt for the same reason it was commented out there:
  documentation generation is a separate concern from generating the
  automation framework itself, and shouldn't run implicitly every time
  script-generator does its main job. Invoke this explicitly with
  `/generate-docs` when you want the doc refreshed.
-->

Read the `autopilot-ui` project and produce one self-contained HTML file,
`Auto-PlayPilot-documentation.html`, in the repository root.

Write it directly to disk (don't just print it in chat) and make sure it is
immediately viewable in a browser with no missing styles, no blank pages,
and no broken tables.

Cover these sections, in this order:

1. **Overview** - purpose and scope of the test framework.
2. **Prerequisites** - required dependencies, tools, and environment setup.
3. **Configuration** - DSL parameters and their descriptions, plus sample
   input configuration test cases.
4. **Test Steps** - a sequential breakdown of test actions.
5. **Expected Results** - validation criteria for each step.
6. **Execution Instructions** - how to run the tests.
7. **Report Generation** - how to generate and interpret reports (per the
   **execution-stabilization** skill's reporting conventions).
8. **Troubleshooting** - common issues and solutions.

Constraints: proper layout with no blank pages; every section contains the
real project details (framework name, DSL field names, actual commands) -
never a placeholder like "TBD"; page length reasonable for a one-page
reference, not a wall of unstructured text; valid, consistent fonts/styles;
any table must have correctly aligned headers and rows.
