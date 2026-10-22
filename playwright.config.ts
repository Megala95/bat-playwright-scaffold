import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import path from "path";
import { AUTH_STATE_FILE, authCredentialsProvided } from "./src/core/AuthScaffold";

/**
 * Wires together the resilience decisions from items 3.2/3.3/4.1/4.3:
 *
 * - "smoke" project runs first and gates everything else (item 3.3 health
 *   checks). Wire your CI (Jenkins - item 4.1) to fail the build fast if
 *   this project fails, without even starting the main suite.
 * - "main" project is where generated/example specs live. `--shard` support
 *   is native to Playwright, ready for the Jenkins sharding work in item
 *   4.1 - run e.g. `playwright test --project=main --shard=1/4` per worker.
 * - Timeout note (item 3.2 finding): some elements take 2-3 minutes to
 *   render under load against a default ~60-120s timeout. Resist the urge
 *   to just raise the global timeout - that hides real slow-render bugs and
 *   makes every test slower to fail. Instead, use a targeted
 *   `locator.waitFor({ timeout: ... })` on the specific slow element, and
 *   feed repeated occurrences into the item 3.2 evidence pack.
 * - Quarantine list (item 3.3): tests listed in quarantine.json are excluded
 *   from the gating "main" run via `grepInvert`, so a known-flaky test
 *   doesn't block merges while it's being root-caused, but still shows up
 *   if you run the full suite deliberately.
 * - BAT_RESULTS_FILE overrides where the json report is written. Parallel shards that
 *   share ONE workspace (the Jenkinsfile's `parallel` stage) must each set a different
 *   value, or they overwrite each other's results.json; `npm run heal-analyze` accepts
 *   several files and merges them.
 * - Reporters: "list" for local runs, "json" + "html" for the CI reporting
 *   aggregation described in item 4.3 (Jenkins can pick up the JSON output
 *   and merge it across shards). In CI, "blob" is added too - that's the
 *   format `playwright merge-reports` consumes to combine per-shard results
 *   into one HTML report; see .github/workflows/playwright.yml / Jenkinsfile
 *   for the merge step.
 * - `globalSetup` runs AuthScaffold's login-once-and-reuse-storageState flow
 *   (item 2.4) before any project starts. It no-ops with a warning if
 *   BAT_APP_USERNAME/PASSWORD aren't set, so it's safe to leave wired in
 *   even for environments that don't need authenticated tests yet. The
 *   "main" project's `storageState` below is what actually consumes the
 *   saved session - see AuthScaffold.ts for why that's gated on
 *   `authCredentialsProvided()` rather than checking whether the file exists
 *   yet (it doesn't, at the point this config module is evaluated).
 * - "meta" project runs framework-level checks that don't touch a real
 *   app at all (currently: the generator regression test) - it has no
 *   `dependencies`, so it runs even when the target environment is down,
 *   and CI should run it first as the cheapest possible signal.
 */
const quarantineFile = path.join(__dirname, "quarantine.json");
const quarantinedTitles: string[] = fs.existsSync(quarantineFile)
  ? JSON.parse(fs.readFileSync(quarantineFile, "utf-8"))
  : [];
const quarantinePattern = quarantinedTitles.length
  ? new RegExp(quarantinedTitles.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"))
  : undefined;

export default defineConfig({
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? undefined : 1, // let CI decide sharding/workers (item 4.1)
  globalSetup: path.join(__dirname, "src/core/AuthScaffold.ts"),
  reporter: [
    ["list"],
    ["json", { outputFile: process.env.BAT_RESULTS_FILE ?? "test-results/results.json" }],
    ["html", { open: "never" }],
    [path.join(__dirname, "src/core/FlakyQuarantineReporter.ts")],
    ...(process.env.CI ? ([["blob"]] as const) : []),
  ],
  use: {
    baseURL: process.env.BAT_APP_BASE_URL ?? "https://REPLACE_WITH_APP_BASE_URL",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure", // item 3.2 evidence pack
  },
  projects: [
    {
      name: "meta",
      testDir: "./tests/meta",
      // No `dependencies` and no real browser/app needed - pure logic
      // checks (currently: the generator regression test) that should run
      // even when the target environment is unreachable.
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "smoke",
      testDir: "./tests/smoke",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "main",
      testDir: "./tests/example",
      dependencies: ["smoke"],
      grepInvert: quarantinePattern,
      use: {
        ...devices["Desktop Chrome"],
        // Reuse the session AuthScaffold's globalSetup logged in once, so
        // generated specs start authenticated instead of re-running login
        // per test (item 2.4). Only set when a login was actually attempted
        // this run - otherwise AUTH_STATE_FILE doesn't exist and Playwright
        // would fail every test in this project trying to load it, instead
        // of the existing, clearer "not authenticated" failure. A spec that
        // needs to start UNauthenticated (see tests/example/login.spec.ts)
        // overrides this per-file with `test.use({ storageState: ... })`.
        storageState: authCredentialsProvided() ? AUTH_STATE_FILE : undefined,
      },
    },
  ],
});
