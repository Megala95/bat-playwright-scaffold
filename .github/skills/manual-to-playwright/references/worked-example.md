# Worked example (plain mode)

## 1. Manual test case as received

```
TC-2301 - Reset password with a valid email
Preconditions: a registered user exists; mail capture is not required (UI only)
1. Open the login page.                        -> Login page is displayed
2. Click "Forgot password?".                   -> Reset page with an email field is displayed
3. Enter the registered email, click "Send".   -> Message "Check your inbox" is shown
4. Click "Back to login".                      -> Login page is displayed
```

## 2. Normalized + decisions

| # | Action                    | Data                  | Expected                                  |
|---|---------------------------|-----------------------|-------------------------------------------|
| 1 | Open login page           | -                     | Login page displayed (setup: `goto`)      |
| 2 | Click "Forgot password?"  | -                     | Reset page, email field visible           |
| 3 | Enter email, click "Send" | `RESET_USER_EMAIL`    | Message contains "Check your inbox"       |
| 4 | Click "Back to login"     | -                     | Login page displayed                      |

Decisions: step 1 is navigation -> `beforeEach`. Email comes from an env var,
not a literal. "Check your inbox" is a message, not an error code -> `toContainText`.
Locators below are **unverified** (no DOM supplied) -> marked `LOCATOR-TODO`.

## 3. Page Objects

```ts
// src/pages/LoginPage.ts
import { Page, expect } from '@playwright/test';

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto() { await this.page.goto('/login'); }

  // LOCATOR-TODO(TC-2301 step 2): confirm accessible name against the real page
  async openForgotPassword() {
    await this.page.getByRole('link', { name: 'Forgot password?' }).click();
  }

  async expectDisplayed() {
    await expect(this.page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  }
}

// src/pages/ResetPasswordPage.ts
import { Page, expect } from '@playwright/test';

export class ResetPasswordPage {
  constructor(private readonly page: Page) {}

  // LOCATOR-TODO(TC-2301 step 3): confirm label text
  private get email() { return this.page.getByLabel('Email'); }

  async expectDisplayed() { await expect(this.email).toBeVisible(); }

  async requestReset(email: string) {
    await this.email.fill(email);
    await this.page.getByRole('button', { name: 'Send' }).click();
  }

  async expectConfirmation() {
    await expect(this.page.getByRole('status')).toContainText('Check your inbox');
  }

  async backToLogin() {
    await this.page.getByRole('link', { name: 'Back to login' }).click();
  }
}
```

## 4. Spec

```ts
// tests/auth/reset-password.spec.ts
import { test } from '@playwright/test';
import { LoginPage } from '../../src/pages/LoginPage';
import { ResetPasswordPage } from '../../src/pages/ResetPasswordPage';

const email = process.env.RESET_USER_EMAIL;

test.describe('Reset password @regression', () => {
  test.skip(!email, 'RESET_USER_EMAIL is not set');

  test.beforeEach(async ({ page }) => {
    await new LoginPage(page).goto();
  });

  test('TC-2301: Reset password with a valid email', async ({ page }) => {
    const login = new LoginPage(page);
    const reset = new ResetPasswordPage(page);

    await login.expectDisplayed();                 // step 1 expected
    await login.openForgotPassword();              // step 2
    await reset.expectDisplayed();                 // step 2 expected
    await reset.requestReset(email!);              // step 3
    await reset.expectConfirmation();              // step 3 expected
    await reset.backToLogin();                     // step 4
    await login.expectDisplayed();                 // step 4 expected
  });
});
```

## 5. Reply (what the user sees at the end)

**Files:** `src/pages/LoginPage.ts`, `src/pages/ResetPasswordPage.ts`, `tests/auth/reset-password.spec.ts`

**Traceability**

| Manual step | Code                                   | Assertion                          |
|-------------|----------------------------------------|------------------------------------|
| 1           | `beforeEach` goto, `login.expectDisplayed` | Sign in button visible         |
| 2           | `login.openForgotPassword`             | email field visible                |
| 3           | `reset.requestReset`                   | status contains "Check your inbox" |
| 4           | `reset.backToLogin`                    | Sign in button visible             |

**Open items:** 4 locators are unverified (`LOCATOR-TODO`) - need the real DOM or an MCP snapshot.
`RESET_USER_EMAIL` must be set. `tsc --noEmit` passed; test discovered with `--list`; **not executed** (no environment).
