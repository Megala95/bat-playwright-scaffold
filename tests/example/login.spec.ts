import { test } from "@playwright/test";
import { LoginPage } from "../../src/pages/LoginPage";

/**
 * Worked example demonstrating the full pattern from the Solution Approach
 * sheet end to end:
 *   - Page Object built on BasePage (item 2.3)
 *   - locate -> classify -> act -> verify (item 2.2)
 *   - shared locator repository with fallbacks (item 2.2)
 *
 * This is the template to hand to the Copilot "test-generator" sub-agent
 * (see the GitHub Copilot playbook doc) as the shape every new generated
 * spec should follow. Replace with a real manual test case once one is
 * shared - the Page Object and locator-repository pattern underneath does
 * not need to change, only the JSON locator entries and the steps here.
 */
test.describe("Login @example", () => {
  // This spec IS the login flow, so it must not inherit the "main" project's
  // storageState (playwright.config.ts / AuthScaffold.ts) - every test here
  // needs a genuinely unauthenticated context to exercise login itself,
  // both the success and failure paths. A generated spec that assumes it's
  // already logged in (the normal case once AuthScaffold has real
  // credentials) does NOT need this override.
  test.use({ storageState: { cookies: [], origins: [] } });

  const baseUrl = process.env.BAT_APP_BASE_URL ?? "https://REPLACE_WITH_APP_BASE_URL";

  test("valid credentials reach the authenticated app shell", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto(baseUrl);
    await login.login(
      process.env.BAT_APP_USERNAME ?? "REPLACE_USERNAME",
      process.env.BAT_APP_PASSWORD ?? "REPLACE_PASSWORD"
    );
    await login.expectAuthenticated();
  });

  test("invalid credentials show the login error banner", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto(baseUrl);
    await login.login("invalid-user", "invalid-password");
    await login.expectLoginError("Invalid username or password");
  });
});
