---
name: dsl-governance
description: How to validate a DSL test-case file against governance/dsl-schema.json and governance/ai-policy.md before writing or enriching it. Use when generating, editing, or reviewing any file under output/dsl/testcases/.
user-invocable: true
argument-hint: path to the DSL file to validate (defaults to the one just written)
---

# DSL Governance

Both **step-parser** and **locator-strategist** must leave every
`output/dsl/testcases/*.dsl.json` file schema-valid and policy-compliant.
Rather than each agent re-deriving these rules from scratch, this skill is
the single place that procedure lives.

## Validating against the schema

1. Read `governance/dsl-schema.json` in full before writing or editing a DSL
   file - do not rely on a remembered shape from a previous run, the schema
   can change.
2. After writing/editing, re-read the DSL file back and check it against
   every required field, enum, and nesting rule in the schema - not just the
   fields you touched. An enrichment step (adding locators) can still break
   schema compliance if, for example, the schema requires a `locator` object
   with a specific shape and you wrote a bare string.
3. If the file fails validation, fix it before handing off - never pass a
   known-invalid DSL file to the next agent in the chain "for them to fix."

## Applying governance/ai-policy.md

Read `governance/ai-policy.md` before every run, not just the first one in a
session - policy documents change independently of code, and a stale cached
understanding of it is a compliance gap, not a shortcut.

## Comments vs. valid JSON

DSL output files are pure JSON and must stay parseable - JSON has no comment
syntax. Explanations, rationale, and inferred-vs-reused notes belong in:

- your chat reply for that turn, and
- a sibling `<fileName>.dsl.notes.md` file, so the reasoning survives after
  the chat session ends and a reviewer can see why a step was parsed or
  enriched the way it was.

Never embed `//` or `/* */` comments inside a `.dsl.json` file - it will fail
to parse.

## Keeping this skill current

When `governance/dsl-schema.json` or `governance/ai-policy.md` changes in a
way that affects how an agent should behave (a new required field, a new
policy rule), update this file in the same pull request as that governance
change, so the two never drift apart. This skill describes *how to check*
compliance - it is not a cached copy of the schema/policy content itself,
which always stays the single source of truth.

## Changelog

- 2026-09-22: Initial version.
