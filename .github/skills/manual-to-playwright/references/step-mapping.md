# Step mapping: manual phrase -> Playwright

## Actions

| Manual step says                      | Playwright (plain mode)                                   | Scaffold mode (`act`)        |
|---------------------------------------|-----------------------------------------------------------|------------------------------|
| Navigate to / open page               | `await page.goto('/path')` (use `baseURL`)                 | Page Object `goto()`         |
| Click / press / tap a button or link  | `await locator.click()`                                    | `act(key, "click")`          |
| Enter / type / input text             | `await locator.fill(value)`                                | `act(key, "fill", value)`    |
| Clear a field                         | `await locator.clear()`                                    | `act(key, "clear")`          |
| Select "X" from a dropdown            | `await locator.selectOption({ label: 'X' })`               | `act(key, "selectOption", v)`|
| Tick / untick a checkbox or radio     | `await locator.check()` / `.uncheck()`                     | `act(key, "check"/"uncheck")`|
| Upload a file                         | `await locator.setInputFiles(path)`                        | Page Object method           |
| Hover                                 | `await locator.hover()`                                    | Page Object method           |
| Press a key                           | `await page.keyboard.press('Enter')`                       | Page Object method           |
| Accept / dismiss a dialog             | register `page.once('dialog', d => d.accept())` **before** the triggering click | Page Object method |
| Wait for a result after an action     | usually nothing - assert the result (auto-wait)            | `verify(...)`                |
| Switch tab / popup                    | `const [popup] = await Promise.all([page.waitForEvent('popup'), locator.click()])` | Page Object method |
| Switch frame                          | `page.frameLocator(...)` then normal locators              | Page Object method           |

## Expected results

| Manual expected result                | Assertion                                                   |
|---------------------------------------|-------------------------------------------------------------|
| "X is displayed / visible / shown"    | `await expect(locator).toBeVisible()`                       |
| "X is not displayed / removed"        | `await expect(locator).toBeHidden()` (or `toHaveCount(0)`)  |
| Text equals "..." (exact wording matters, e.g. error code) | `await expect(locator).toHaveText('...')` |
| Message contains "..."                | `await expect(locator).toContainText('...')`                |
| Field shows value "..."               | `await expect(locator).toHaveValue('...')`                  |
| Button/field enabled / disabled       | `toBeEnabled()` / `toBeDisabled()`                          |
| Checkbox is checked                   | `toBeChecked()`                                             |
| N rows / results / items              | `await expect(rows).toHaveCount(n)`                         |
| Row/cell contains data                | `await expect(rows.nth(i)).toContainText('...')`            |
| User lands on page X                  | `await expect(page).toHaveURL(/path/)` **and** a landmark `toBeVisible()` |
| Page title is "..."                   | `await expect(page).toHaveTitle('...')`                     |
| File downloaded                       | `const dl = await page.waitForEvent('download')` then check `dl.suggestedFilename()` |
| API/network call made                 | `page.waitForResponse(...)` registered before the trigger; assert status/body |
| Several independent checks on one screen | `expect.soft(...)` for each, then one hard assertion that gates the next step |

## Reminders

- Pair "no error shown" with a positive success assertion; absence of an error is not success.
- Don't assert on a thing you just acted on if the action already required it to exist; assert the *result*.
- `toHaveText` vs `toContainText`: default to `toContainText`; use exact only when wording is the point.
- Dynamic text (timestamps, IDs, totals): use a `RegExp` or assert a computed value.
- A step with no observable outcome: add a minimal post-condition if clearly implied, otherwise report it unverified.
