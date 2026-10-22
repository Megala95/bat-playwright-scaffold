import { Page, expect } from "@playwright/test";
import { LocatorRepository } from "./LocatorRepository";
import loginLocators from "../locators/login.locators.json";

/**
 * Item 3.3: "Add environment health-check/smoke tests ahead of the main
 * suite ... so they don't mask genuine failures."
 *
 * Run this as its own project (see playwright.config.ts "smoke" project)
 * that must pass before the main suite is allowed to run in CI. A failure
 * here means "the environment is down", not "the product has a defect" -
 * exactly the ambiguity item 3.1's RCA work is trying to eliminate.
 *
 * The login-page check used to be "does <body> have any content at all",
 * which a 404/error page or a generic maintenance page would pass just as
 * easily as a real login page - a false "healthy" that then lets the main
 * suite run against a broken environment and produce a wall of confusing,
 * unrelated failures. It now resolves the same `usernameField` locator the
 * main suite depends on, through the same LocatorRepository fallback path -
 * so this check fails, specifically and immediately, the moment the login
 * page's shape changes, instead of the main suite discovering it fifteen
 * tests later.
 *
 * TRADE-OFF this introduces: `login.locators.json` ships with placeholder
 * selectors (`REPLACE_ID_username`, etc. - see README "What's real vs.
 * placeholder"), so out of the box this smoke gate - which both CI configs
 * treat as a hard prerequisite for the main suite - WILL fail until real
 * selectors are filled in. That's a real, if obvious, dependency, so this
 * check detects the placeholder case specifically and fails with a
 * distinct, actionable message instead of the generic "no selector
 * matched" a first-time user would otherwise have to puzzle out.
 */
const loginLocatorRepo = LocatorRepository.load(loginLocators);

function isPlaceholderLocatorFile(): boolean {
  return JSON.stringify(loginLocators).includes("REPLACE_ID_");
}

export async function checkEnvironmentHealthy(page: Page, baseUrl: string): Promise<void> {
  if (isPlaceholderLocatorFile()) {
    throw new Error(
      "src/locators/login.locators.json still has placeholder selectors (REPLACE_ID_username / " +
        "REPLACE_ID_password / REPLACE_ID_signin). This smoke gate resolves those locators against a " +
        "real page, so it can't pass until you fill in real, validated selectors - this is expected on a " +
        "fresh checkout, not a bug. See README 'Using this with a real test case' (npm run crawl / " +
        "npm run extract-html), then re-run."
    );
  }

  const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  expect(response, `No response from ${baseUrl} - environment may be down`).not.toBeNull();
  expect(response!.status(), `Unexpected status from ${baseUrl}`).toBeLessThan(500);

  await page.goto(`${baseUrl.replace(/\/$/, "")}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });

  const usernameField = await loginLocatorRepo.resolveWithFallback(page, "usernameField");
  await expect(
    usernameField,
    "Login page did not render its username field - possible deployment, outage, or " +
      "locator-drift issue (if this trips while the app looks fine to a human, the login page's " +
      "shape likely changed - update src/locators/login.locators.json, don't just retry)"
  ).toBeVisible();
}
