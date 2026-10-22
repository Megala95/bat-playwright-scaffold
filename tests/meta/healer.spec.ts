import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import catalogJson from "../../src/healer/errorCatalog.json";
import { CatalogEntry } from "../../src/healer/types";
import { analyzeReport, classifyError, extractTarget, mergeReports, stripAnsi, PwReport } from "../../src/healer/analyzeResults";
import { isSkillArea } from "../../src/utils/skillAreas";

const catalog = catalogJson as CatalogEntry[];
const realReport: PwReport = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "results.real.json"), "utf-8")
);

/**
 * tests/fixtures/results.real.json is a trimmed copy of a REAL Playwright
 * JSON report, produced by deliberately breaking ~30 small specs in each of
 * the ways the catalog claims to understand. The healer is therefore tested
 * against genuine Playwright error text (ANSI codes included), not messages
 * typed from memory - that is what keeps the regexes honest across Playwright
 * upgrades. If a new Playwright version rewords a message, this file is where
 * it shows up.
 */

test.describe("error catalog integrity @meta", () => {
  test("ids are unique and every entry is complete", () => {
    const ids = catalog.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of catalog) {
      expect(e.title, e.id).toBeTruthy();
      expect(e.diagnosis, e.id).toBeTruthy();
      expect(e.match.length, `${e.id} has no match patterns`).toBeGreaterThan(0);
      expect(e.fixes.length, `${e.id} has no fixes`).toBeGreaterThan(0);
      expect(e.neverDo.length, `${e.id} has no neverDo`).toBeGreaterThan(0);
      expect(e.evidence.length, `${e.id} has no evidence`).toBeGreaterThan(0);
      expect(isSkillArea(e.skillArea), `${e.id}: "${e.skillArea}" is not a known skill area`).toBe(true);
    }
  });

  test("every regex compiles", () => {
    for (const e of catalog) {
      for (const m of [...e.match, ...(e.exclude ?? [])]) {
        expect(() => new RegExp(m, "im"), `${e.id}: ${m}`).not.toThrow();
      }
    }
  });

  test("every example classifies back to its own entry (catches shadowing by an earlier entry)", () => {
    for (const e of catalog) {
      expect(classifyError(e.example).id, `example of "${e.id}" was claimed by another entry`).toBe(e.id);
    }
  });

  test("entries that say 'do not edit the test' are environment problems", () => {
    for (const e of catalog.filter((x) => x.healing === "none")) {
      expect(e.classification, e.id).toBe("environment");
    }
  });
});

test.describe("classification against real Playwright output @meta", () => {
  const report = analyzeReport(realReport, "fixture");
  const byTitle = (t: string) => {
    const f = report.failures.find((x) => x.title === t);
    expect(f, `no failure titled "${t}" in the fixture`).toBeTruthy();
    return f!;
  };

  test("totals match the fixture", () => {
    expect(report.totals).toEqual({ tests: 31, passed: 3, failed: 27, flaky: 1, skipped: 0 });
    expect(report.failures.length).toBe(28);
  });

  test("no failure in the fixture is left unclassified", () => {
    const unknown = report.failures.filter((f) => f.diagnosis.entryId === "unknown").map((f) => f.title);
    expect(unknown).toEqual([]);
  });

  const expected: Record<string, string> = {
    "strict violation": "strict-mode-violation",
    "locator not found click": "locator-not-found-action",
    "iframe": "locator-not-found-action",
    "visible not found": "assertion-target-not-found",
    "visible hidden": "assertion-hidden",
    "text mismatch": "assertion-text-mismatch",
    "contain mismatch": "assertion-text-mismatch",
    "flaky then pass": "assertion-text-mismatch",
    "flaky real": "assertion-text-mismatch",
    "value mismatch": "assertion-value-mismatch",
    "count mismatch": "assertion-count-mismatch",
    "not enabled": "element-not-enabled",
    "toBeEnabled": "element-not-enabled",
    "not checked": "assertion-state-mismatch",
    "select option missing": "select-option-missing",
    "fill undefined": "test-data-undefined",
    "url mismatch": "url-mismatch",
    "goto refused": "env-network-error",
    "goto dns": "placeholder-in-error",
    "goto invalid": "placeholder-in-error",
    "waitForResponse timeout": "response-wait-timeout",
    "popup event timeout": "event-wait-timeout",
    "waitFor timeout": "wait-for-locator-timeout",
    "whole test timeout": "test-timeout",
    "type error": "script-runtime-error",
    "intercepted real": "click-intercepted",
    detached: "element-detached",
    "page closed": "browser-closed",
  };
  for (const [title, id] of Object.entries(expected)) {
    test(`"${title}" -> ${id}`, () => {
      expect(byTitle(title).diagnosis.entryId).toBe(id);
    });
  }

  test("a flaky test is reported as flaky, with its first failure diagnosed", () => {
    const f = byTitle("flaky real");
    expect(f.outcome).toBe("flaky");
    expect(f.attempts).toBe(2);
  });

  test("ANSI colour codes are stripped from the report", () => {
    for (const f of report.failures) expect(f.errorSnippet).not.toContain("\u001b");
    expect(stripAnsi("\u001b[31mred\u001b[39m")).toBe("red");
  });

  test("the real fixture is mostly test-fixable, so the verdict is heal-tests", () => {
    expect(report.verdict).toBe("heal-tests");
  });

  test("failures that share a root cause collapse into one cluster", () => {
    const text = report.clusters.find((c) => c.entryId === "assertion-text-mismatch" && c.target === "locator('#t')");
    expect(text?.count).toBe(4);
    expect(report.clusters.length).toBeLessThan(report.failures.length);
  });

  test("environment/configuration clusters are listed first", () => {
    const firstTwo = report.clusters.slice(0, 3).map((c) => c.entryId);
    expect(firstTwo).toContain("env-network-error");
    expect(firstTwo).toContain("placeholder-in-error");
  });
});

test.describe("classification priority @meta", () => {
  test("a placeholder in a network error is a configuration problem, not an outage", () => {
    const msg = "Error: page.goto: net::ERR_NAME_NOT_RESOLVED at https://REPLACE_WITH_APP_BASE_URL/login";
    expect(classifyError(msg).id).toBe("placeholder-in-error");
  });

  test("a redirect to login is an expired session, not a product defect", () => {
    const msg = 'Error: expect(page).toHaveURL(expected) failed\n\nExpected pattern: /dashboard/\nReceived string:  "https://x.com/signin?next=/dashboard"';
    expect(classifyError(msg).id).toBe("auth-session-redirect");
  });

  test("strict mode violations are not mistaken for a missing element", () => {
    const msg = "locator.click: Error: strict mode violation: getByRole('button') resolved to 3 elements\nCall log:\n  - waiting for getByRole('button')";
    expect(classifyError(msg).id).toBe("strict-mode-violation");
  });

  test("empty and unmatched messages fall back to unknown", () => {
    expect(classifyError("").id).toBe("unknown");
    expect(classifyError("something nobody has seen before").id).toBe("unknown");
  });
});

test.describe("report intelligence @meta", () => {
  const mk = (title: string, message: string, extra: Partial<{ status: string; results: any[] }> = {}) => ({
    title,
    file: "a.spec.ts",
    line: 1,
    tests: [
      {
        projectName: "main",
        status: extra.status ?? "unexpected",
        results: extra.results ?? [{ status: "failed", retry: 0, error: { message } }],
      },
    ],
  });
  const report = (...specs: any[]): PwReport => ({ suites: [{ title: "a.spec.ts", file: "a.spec.ts", specs }] });

  test("a majority of environment failures flips the verdict to environment-suspect", () => {
    const refused = "Error: page.goto: net::ERR_CONNECTION_REFUSED at https://app/login";
    const r = analyzeReport(
      report(mk("t1", refused), mk("t2", refused), mk("t3", refused), mk("t4", "Error: expect(locator).toHaveText(expected) failed\nExpected: \"a\"\nReceived: \"b\""))
    );
    expect(r.verdict).toBe("environment-suspect");
    expect(r.verdictReason).toMatch(/do not edit tests/i);
  });

  test("a clean run is healthy", () => {
    const r = analyzeReport(report({ title: "ok", file: "a.spec.ts", tests: [{ status: "expected", results: [{ status: "passed" }] }] }));
    expect(r.verdict).toBe("healthy");
    expect(r.failures).toEqual([]);
  });

  test("attempts that fail for different reasons are flagged as non-deterministic", () => {
    const r = analyzeReport(
      report(
        mk("wobbly", "", {
          results: [
            { status: "failed", retry: 0, error: { message: "locator.click: Timeout 2000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Go' })" } },
            { status: "failed", retry: 1, error: { message: "Error: expect(locator).toHaveText(expected) failed\nLocator: locator('#x')\nExpected: \"a\"\nReceived: \"b\"" } },
          ],
        })
      )
    );
    expect(r.failures[0].consistentAcrossAttempts).toBe(false);
  });

  test("trace and screenshot paths are collected as evidence", () => {
    const r = analyzeReport(
      report(
        mk("with evidence", "", {
          results: [
            {
              status: "failed",
              retry: 0,
              error: { message: "Error: expect(locator).toBeVisible() failed\nLocator: locator('#x')\nExpected: visible\nError: element(s) not found" },
              attachments: [{ name: "trace", path: "test-results/x/trace.zip" }, { name: "screenshot", path: "test-results/x/s.png" }],
            },
          ],
        })
      )
    );
    expect(r.failures[0].attachments).toEqual(["test-results/x/trace.zip", "test-results/x/s.png"]);
  });

  test("target extraction pulls out the locator, URL and event", () => {
    expect(extractTarget("Locator: getByText('Hi')\nExpected: visible")).toBe("getByText('Hi')");
    expect(extractTarget('navigating to "https://a.b/c", waiting until "load"')).toBe("https://a.b/c");
    expect(extractTarget('Timeout 1ms exceeded while waiting for event "popup"')).toBe("popup");
    expect(extractTarget("nothing useful")).toBeUndefined();
  });
});

test.describe("sharded runs @meta", () => {
  const shard = (title: string, message: string): PwReport => ({
    suites: [
      {
        title: "a.spec.ts",
        file: "a.spec.ts",
        specs: [
          {
            title,
            file: "a.spec.ts",
            tests: [
              { projectName: "main", status: "unexpected", results: [{ status: "failed", retry: 0, error: { message } }] },
            ],
          },
        ],
      },
    ],
  });

  test("per-shard reports are merged, so the verdict and clusters see the whole run", () => {
    const net = "Error: page.goto: net::ERR_CONNECTION_REFUSED at https://app.example.com/";
    const merged = mergeReports([shard("one", net), shard("two", net), shard("three", net)]);
    const report = analyzeReport(merged);
    expect(report.totals.failed).toBe(3);
    expect(report.verdict).toBe("environment-suspect");
    expect(report.clusters).toHaveLength(1);
    expect(report.clusters[0].count).toBe(3);
  });

  test("one shard alone can look healthy while the merged run is not (why merging matters)", () => {
    const healthy: PwReport = { suites: [{ title: "ok.spec.ts", file: "ok.spec.ts", specs: [{ title: "fine", file: "ok.spec.ts", tests: [{ projectName: "main", status: "expected", results: [{ status: "passed", retry: 0 }] }] }] }] };
    const failing = shard("broken", "Error: page.goto: net::ERR_CONNECTION_REFUSED at https://app.example.com/");
    expect(analyzeReport(healthy).verdict).toBe("healthy");
    expect(analyzeReport(mergeReports([healthy, failing])).totals.failed).toBe(1);
  });

  test("merging nothing is an empty 'no-results' report rather than a crash or a false 'healthy'", () => {
    expect(analyzeReport(mergeReports([])).verdict).toBe("no-results");
  });
});

const fixture = (name: string): PwReport => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf-8"));
const one = (title: string, message: string, status = "unexpected", extra: Partial<{ results: unknown[] }> = {}): PwReport => ({
  suites: [{ title: "a.spec.ts", file: "a.spec.ts", specs: [{ title, file: "a.spec.ts", tests: [{ projectName: "main", status, results: (extra.results ?? [{ status: "failed", retry: 0, error: { message } }]) as never }] }] }],
});

test.describe("second real capture: more errors, classified from genuine Playwright output @meta", () => {
  const real2 = fixture("results.real2.json");
  const byTitle = new Map(analyzeReport(real2).failures.map((f) => [f.title, f]));
  const id = (title: string) => byTitle.get(title)?.diagnosis.entryId;
  const cl = (title: string) => byTitle.get(title)?.diagnosis.classification;

  const EXPECTED: Array<[string, string, string]> = [
    ["title mismatch", "assertion-attribute-mismatch", "product-defect-suspect"],
    ["attribute mismatch", "assertion-attribute-mismatch", "product-defect-suspect"],
    ["hidden expected but visible", "assertion-unexpectedly-visible", "product-defect-suspect"],
    ["not visible expected but visible", "assertion-unexpectedly-visible", "product-defect-suspect"],
    ["generic toBe", "assertion-generic-value", "product-defect-suspect"],
    ["generic toEqual", "assertion-generic-value", "product-defect-suspect"],
    ["poll fail", "assertion-generic-value", "product-defect-suspect"],
    ["click invisible", "element-not-visible", "synchronization"],
    ["click disabled", "element-not-enabled", "synchronization"],
    ["toBeEnabled fail", "element-not-enabled", "synchronization"],
    ["toBeVisible fail", "assertion-hidden", "synchronization"],
    ["toHaveClass fail", "assertion-attribute-mismatch", "product-defect-suspect"],
    ["toHaveURL authors", "url-mismatch", "product-defect-suspect"],
    ["execution context destroyed", "navigation-context-destroyed", "synchronization"],
    ["api ECONNREFUSED", "api-connection-error", "environment"],
    ["api ENOTFOUND", "api-connection-error", "environment"],
    ["goto empty response", "env-network-error", "environment"],
    ["fill undefined", "test-data-undefined", "test-data"],
    ["missing storage state", "storage-state-missing", "environment"],
    ["process exit", "worker-crashed", "framework"],
    ["download wait timeout", "event-wait-timeout", "synchronization"],
    ["hook-like: cannot read props", "script-runtime-error", "test-script"],
    ["toHaveCount fail", "assertion-count-mismatch", "product-defect-suspect"],
    ["toContainText fail", "assertion-text-mismatch", "product-defect-suspect"],
    ["toBeChecked fail", "assertion-state-mismatch", "product-defect-suspect"],
    ["test timeout while waiting", "test-timeout", "synchronization"],
  ];
  for (const [title, entry, classification] of EXPECTED) {
    test(`${title} -> ${entry}`, () => {
      expect(id(title), `${title}: got ${id(title)}`).toBe(entry);
      expect(cl(title)).toBe(classification);
    });
  }

  test("nothing in this capture is left unclassified", () => {
    expect([...byTitle.values()].filter((f) => f.diagnosis.classification === "unknown").map((f) => f.title)).toEqual([]);
  });

  test("the product-defect failures are not counted as environment, so the verdict is not 'do not edit tests'", () => {
    const r = analyzeReport(real2);
    expect(r.verdict).toBe("heal-tests");
    expect(r.verdictReason).toMatch(/suspected product defect/);
  });
});

test.describe("an environment problem is recognised as one @meta", () => {
  test("a real missing/invalid browser launch gives environment-suspect, not 'heal-tests'", () => {
    const r = analyzeReport(fixture("results.real-env.json"));
    expect(r.failures.map((f) => f.diagnosis.entryId).sort()).toEqual(["browser-launch-failed", "browser-launch-failed"]);
    expect(r.verdict).toBe("environment-suspect");
  });

  test("a real globalSetup failure (no tests, errors[] only) is a broken run, never 'healthy'", () => {
    const r = analyzeReport(fixture("results.real-globalsetup.json"));
    expect(r.totals.tests).toBe(0);
    expect(r.verdict).toBe("broken-run");
    expect(r.runErrors).toHaveLength(1);
    expect(r.verdictReason).toContain("Login failed during globalSetup");
  });

  test("an empty or nonsense report is 'no-results', and null does not crash", () => {
    expect(analyzeReport({}).verdict).toBe("no-results");
    expect(analyzeReport({ suites: [] }).verdict).toBe("no-results");
    expect(analyzeReport(null).verdict).toBe("no-results");
  });

  test("run-level errors survive merging shard reports", () => {
    const merged = mergeReports([{ suites: [] }, { errors: [{ message: "boom" }] }]);
    expect(merged.errors).toHaveLength(1);
  });
});

test.describe("verdict edge cases @meta", () => {
  const net = "Error: page.goto: net::ERR_CONNECTION_REFUSED at https://app.example.com/";
  const flakyThenPass = (message: string): PwReport =>
    one("flaky one", message, "flaky", { results: [{ status: "failed", retry: 0, error: { message } }, { status: "passed", retry: 1 }] });

  test("a flaky test that passed on retry cannot declare an outage", () => {
    const green: PwReport = mergeReports([
      flakyThenPass(net),
      one("ok-1", "", "expected", { results: [{ status: "passed", retry: 0 }] }),
      one("ok-2", "", "expected", { results: [{ status: "passed", retry: 0 }] }),
    ]);
    const r = analyzeReport(green);
    expect(r.totals.failed).toBe(0);
    expect(r.verdict).toBe("flaky-only");
  });

  test("a single environment failure among two does not stop all test editing", () => {
    const r = analyzeReport(mergeReports([one("a", net), one("b", "Error: expect(locator).toBeVisible() failed\n\nLocator: locator('#x')\nExpected: visible\nReceived: <element(s) not found>")]));
    expect(r.verdict).toBe("heal-tests");
    expect(r.verdictReason).toMatch(/environment\/configuration problem/);
  });

  test("a single failing test that is an environment problem is still environment-suspect", () => {
    expect(analyzeReport(one("a", net)).verdict).toBe("environment-suspect");
  });

  test("an unset variable (fill got undefined) counts as configuration", () => {
    const r = analyzeReport(mergeReports([one("a", "Error: locator.fill: value: expected string, got undefined"), one("b", "Error: locator.fill: value: expected string, got undefined")]));
    expect(r.verdict).toBe("environment-suspect");
  });

  test("unrecognised errors are reported as unrecognised, not as 'addressable'", () => {
    const r = analyzeReport(one("a", "Error: something nobody has seen before"));
    expect(r.verdict).toBe("heal-tests");
    expect(r.verdictReason).toMatch(/not recognised/);
    expect(r.verdictReason).not.toMatch(/addressable/);
  });
});

test.describe("classification traps found in review @meta", () => {
  const url = (received: string) => `Error: expect(page).toHaveURL(expected) failed\n\nExpected pattern: /\\/books\\/42/\nReceived string:  "${received}"\nTimeout: 1000ms`;

  test("'auth' inside a word of the URL (authors, authentic-deals) is not a login redirect", () => {
    expect(classifyError(url("https://shop.example.com/authors/42")).id).toBe("url-mismatch");
    expect(classifyError(url("https://authentic-deals.example.com/books/7")).id).toBe("url-mismatch");
  });

  test("real login/SSO redirects still are", () => {
    for (const u of ["https://app.example.com/login?next=%2Fx", "https://login.microsoftonline.com/tenant/oauth2", "https://sso.corp.example.com/", "https://app.example.com/auth/callback", "https://dev-1.okta.com/app"]) {
      expect(classifyError(url(u)).id, u).toBe("auth-session-redirect");
    }
  });

  test("a test timeout whose tail says the page was closed is a timeout (the closing is its consequence)", () => {
    const m = "Test timeout of 30000ms exceeded.\n\nError: locator.click: Target page, context or browser has been closed";
    expect(classifyError(m).id).toBe("test-timeout");
    expect(classifyError("Error: page.goto: Target page, context or browser has been closed").id).toBe("browser-closed");
  });

  test("an error that exists only in errors[] (empty error.message) is still classified", () => {
    const r = analyzeReport({
      suites: [{ title: "a.spec.ts", file: "a.spec.ts", specs: [{ title: "t", file: "a.spec.ts", tests: [{ projectName: "p", status: "unexpected", results: [{ status: "failed", error: { message: "" }, errors: [{ message: "TypeError: x is not a function" }] }] }] }] }],
    });
    expect(r.failures[0].diagnosis.entryId).toBe("script-runtime-error");
  });

  test("unrelated errors with no target are not lumped into one cluster", () => {
    const r = analyzeReport(mergeReports([one("a", "TypeError: Cannot read properties of undefined (reading 'x')"), one("b", "ReferenceError: foo is not defined")]));
    expect(r.clusters).toHaveLength(2);
  });

  test("the same error in many tests is still one cluster", () => {
    const r = analyzeReport(mergeReports([one("a", "TypeError: Cannot read properties of undefined (reading 'x')"), one("b", "TypeError: Cannot read properties of undefined (reading 'y')")]));
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0].count).toBe(2);
  });

  test("consistentAcrossAttempts is null when there is nothing to compare", () => {
    expect(analyzeReport(one("a", "TypeError: x")).failures[0].consistentAcrossAttempts).toBeNull();
  });
});
