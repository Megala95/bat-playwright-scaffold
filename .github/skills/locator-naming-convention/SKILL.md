---
name: locator-naming-convention
description: The naming format and preference order for every locator this project generates or stores. Use whenever naming a new locator key, page-object field, or generated method tied to a UI element.
user-invocable: true
---

# Locator Naming Convention

## Naming format

Every locator gets a clear, consistent, human-readable name in this shape:

```
[ScreenContext_][ActionOrElementType][ElementName]
```

- **ScreenContext** (optional but recommended) - the high-level page or
  screen, e.g. `Login`, `Home`, `Settings`.
- **ActionOrElementType** (required) - the element's type, e.g. `Button`,
  `Input`, `Dropdown`, `Link`, `Checkbox`, `Text`, `RadioButton`.
- **ElementName** (required) - the name of the field/object, e.g.
  `Username`, `Login`, `Country`, `Gender`.

Examples: `LoginButtonSubmit`, `LoginInputUsername`, `SettingsDropdownCountry`.

Apply this consistently in `output/objects-collections/pageobjects.json`,
inside DSL step locator keys, and in generated Page Object method/field
names - the same element should carry the same name everywhere it appears,
so the DSL, the page-object collection, and the generated code all line up.

## Locator preference order

When more than one selector could identify an element, prefer, in this
order:

1. `id` or `data-testid`
2. Name attribute
3. CSS selector
4. Relative XPath using parent-child, sibling, or ancestor relationships

**Never use absolute XPath.** It breaks on any layout change and gives no
signal about *why* it broke.

**Avoid `href` and `aria-label`-based locators** on this project's
applications specifically - they've proven unstable here even though
they're commonly recommended elsewhere; don't reach for them by default.

Always use the correct tag name for the element you're locating - verify it
against the live accessibility snapshot (via the Playwright MCP server, see
`.vscode/mcp.json`) rather than assuming it from the DSL step's plain-English
description.

## Reuse before invention

Before creating a new locator entry, check
`output/objects-collections/pageobjects.json` for an existing one covering
the same element. Reusing a validated locator is always preferable to a
freshly-inferred one, even if the naming doesn't perfectly match this
convention yet - fix the name in place rather than creating a duplicate
entry under a new name.

## Changelog

- 2026-09-22: Initial version.
