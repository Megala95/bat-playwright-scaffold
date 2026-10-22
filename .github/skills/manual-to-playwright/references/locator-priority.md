# Locator priority

## Order of preference

1. `getByRole(role, { name })` - how users and assistive tech find it
2. `getByLabel` / `getByPlaceholder` for form fields
3. `getByText` for static, stable text (not for dynamic content)
4. `getByTestId` when the app exposes `data-testid` (check `testIdAttribute` in config)
5. CSS - short, semantic (`[name='email']`), never positional chains (`div > div:nth-child(3)`)
6. XPath - last resort, only when nothing above can reach the element

Scope with a parent locator or `filter({ hasText })` instead of long selectors.
For lists/tables, locate the row by its content, then act within the row.

## Where locators may come from

| Source                                               | OK? |
|------------------------------------------------------|-----|
| HTML/DOM, a repo export, or a crawl you were given    | Yes |
| Playwright MCP snapshot of the live page              | Yes |
| Existing page objects / locator JSON in the repo      | Yes - reuse |
| The manual test's wording ("click Submit")            | Only as the accessible *name*, and only if you can confirm it |
| Your memory of what the app probably looks like       | **No** |

## When you have no source

Do not guess. Emit a placeholder that fails loudly and is easy to grep:

```ts
// LOCATOR-TODO(TC-1042 step 3): no source available - confirm against the real page
readonly addToCart = this.page.getByRole('button', { name: 'Add to cart' }); // unverified
```

List every such locator under **Open items** in the reply.

## Stability rules

- Prefer a locator that survives a copy or layout change over one that matches today's DOM exactly.
- Strict-mode: if a locator can match more than one element, narrow it; never `.first()` just to silence the error unless the manual case means "the first".
- Never loosen a failing locator to make a test pass without telling the user what changed and why.
- In scaffold mode, put primary + fallbacks in the page's `*.locators.json` and follow `locator-naming-convention`.
