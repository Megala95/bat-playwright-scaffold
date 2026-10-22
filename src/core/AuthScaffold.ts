import { chromium, FullConfig } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";
import fs from "fs";
import path from "path";

/**
 * Item 2.4: "the same recurring scaffolding - navigation, login,
 * authorization/token handling, common setup - solved once and reused
 * rather than rebuilt per script."
 *
 * PLACEHOLDER: Mohamed Rifas owns the detailed test-script refinement plan
 * for this area (navigation, login, authorization/token handling, common
 * login setup). This file is a working skeleton so Phase-1 test authoring
 * isn't blocked on that plan landing - swap in Rifas's specifics once
 * delivered, without changing the call sites in tests (they only ever call
 * `ensureAuthenticated`).
 *
 * Pattern: log in once via the UI (through LoginPage, so it exercises the
 * same locator repository as everything else), save the authenticated
 * browser storage state to disk, and have every spec reuse that state
 * instead of re-running the login flow per test. This is what Playwright's
 * own docs recommend for auth reuse, and it directly reduces the number of
 * server round-trips per run - relevant to the item 3.2 timeout/auto-scaling
 * investigation, since fewer redundant logins means less load per run.
 *
 * WIRED IN, NOT JUST WRITTEN: an earlier version of this scaffold wrote
 * AUTH_STATE_FILE here but no project in playwright.config.ts ever set
 * `use.storageState` to it - every spec still did its own fresh UI login,
 * so the "reuse" half of this pattern was dead code (a September 2026
 * independent re-review flagged this directly). playwright.config.ts's
 * "main" project now sets `storageState: AUTH_STATE_FILE` whenever
 * `authCredentialsProvided()` is true, so specs under tests/example/ get an
 * already-authenticated context for free. The one exception is
 * tests/example/login.spec.ts itself, which exercises the login flow and
 * therefore deliberately opts back out with `test.use({ storageState: {
 * cookies: [], origins: [] } })` - see that file.
 *
 * Note on staleness: this cache never expires on its own (`ensureAuthenticated`
 * reuses AUTH_STATE_FILE forever once it exists). That's acceptable for a
 * single CI run (the file starts fresh in a clean checkout/workspace) but
 * would go stale in a long-lived local `.auth/` directory reused across
 * days - delete the file (or add a max-age check here) if login starts
 * failing in a way that looks like an expired session rather than a real
 * regression.
 */
const AUTH_STATE_DIR = path.join(__dirname, "..", "..", ".auth");
const AUTH_STATE_FILE = path.join(AUTH_STATE_DIR, "session.json");

export interface Credentials {
  username: string;
  password: string;
}

/**
 * Whether AuthScaffold will actually attempt a login this run - mirrors the
 * exact env-var check globalSetup() uses below. Exported so
 * playwright.config.ts can decide, at config-parse time, whether it's safe
 * to point a project's `storageState` at AUTH_STATE_FILE: that file doesn't
 * exist yet when the config module first evaluates (globalSetup hasn't run
 * yet), but Playwright only actually reads a project's `storageState` path
 * when it creates that project's first browser context, which always
 * happens after globalSetup has finished. So checking the same env vars
 * globalSetup checks - not `fs.existsSync(AUTH_STATE_FILE)` - is what keeps
 * this decision consistent with whether a login (and therefore a fresh
 * state file) is actually going to happen this run.
 */
export function authCredentialsProvided(): boolean {
  return Boolean(process.env.BAT_APP_USERNAME && process.env.BAT_APP_PASSWORD);
}

export async function ensureAuthenticated(baseUrl: string, creds: Credentials): Promise<string> {
  if (fs.existsSync(AUTH_STATE_FILE)) {
    return AUTH_STATE_FILE;
  }

  fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const loginPage = new LoginPage(page);
  await loginPage.goto(baseUrl);
  await loginPage.login(creds.username, creds.password);
  await loginPage.expectAuthenticated();

  await context.storageState({ path: AUTH_STATE_FILE });
  await browser.close();
  return AUTH_STATE_FILE;
}

/**
 * Global setup hook (wired in playwright.config.ts) so every project runs
 * this once per test-run, not once per test file.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const baseUrl = process.env.BAT_APP_BASE_URL ?? "https://REPLACE_WITH_APP_BASE_URL";
  const username = process.env.BAT_APP_USERNAME ?? "";
  const password = process.env.BAT_APP_PASSWORD ?? "";

  if (!username || !password) {
    console.warn(
      "[AuthScaffold] BAT_APP_USERNAME / BAT_APP_PASSWORD not set - skipping global login. " +
        "Tests that need an authenticated session will fail until these are provided (e.g. via CI secrets)."
    );
    return;
  }

  await ensureAuthenticated(baseUrl, { username, password });
}

/** Exported so playwright.config.ts and any spec that needs the raw path share one source of truth. */
export { AUTH_STATE_FILE };
