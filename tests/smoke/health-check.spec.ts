import { test } from "@playwright/test";
import { checkEnvironmentHealthy } from "../../src/core/HealthCheck";

/**
 * Item 3.3: runs in the "smoke" project (see playwright.config.ts), gating
 * the main suite. If this fails, the environment is the suspect, not the
 * product - stop here rather than letting the main suite produce a wall of
 * confusing red.
 */
test("environment is reachable and serving the login page @smoke", async ({ page }) => {
  const baseUrl = process.env.BAT_APP_BASE_URL ?? "https://REPLACE_WITH_APP_BASE_URL";
  await checkEnvironmentHealthy(page, baseUrl);
});
