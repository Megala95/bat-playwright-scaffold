import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { reviewSource, RULES } from "../../src/reviewer/reviewSource";
import { buildReport, collectFiles, rulesMarkdown } from "../../src/reviewer/reviewScripts";

/**
 * One deliberately-bad snippet per rule (proves the rule fires) and, where it
 * matters, a good twin (proves it does not cry wolf). The last test checks
 * that every rule in RULES has a bad snippet here, so adding a rule without a
 * test fails the suite.
 */
const wrap = (body: string, title = "TC-1: example") =>
  `import { test, expect } from '@playwright/test';\ntest('${title}', async ({ page }) => {\n${body}\n});\n`;

const ids = (src: string) => reviewSource("x.spec.ts", src).map((f) => f.ruleId);
const has = (src: string, id: string) => ids(src).includes(id);

const OK_END = "\n  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();";

const BAD: Record<string, string> = {
  "SYNC-001": wrap("  await page.waitForTimeout(3000);" + OK_END),
  "SYNC-002": wrap("  await page.waitForLoadState('networkidle');" + OK_END),
  "SYNC-003": wrap("  await page.waitForSelector('#a');" + OK_END),
  "SYNC-004": wrap("  expect(await page.locator('#a').isVisible()).toBe(true);"),
  "SYNC-005": wrap("  if (await page.locator('#b').isVisible()) { await page.locator('#b').click(); }" + OK_END),
  "SYNC-006": wrap("  await page.getByRole('button', { name: 'Go' }).click();\n  await page.waitForResponse('**/api/x');" + OK_END),
  "SYNC-007": wrap("  await page.getByRole('button', { name: 'Go' }).click({ timeout: 90000 });" + OK_END),
  "SYNC-008": wrap("  await page.getByRole('button', { name: 'Save' }).click();\n  await page.getByRole('link', { name: 'Home' }).click();" + OK_END),
  "SYNC-009": wrap("  await page.getByRole('button', { name: 'Go' }).click({ force: true });" + OK_END),
  "VER-001": wrap("  await page.getByLabel('Name').fill('Ada');"),
  "VER-002": wrap("  await expect(page).toHaveURL(/x/);\n  await page.getByRole('button', { name: 'Save' }).click();"),
  "VER-003": wrap("  await page.goto('/x');\n  expect(true).toBe(true);"),
  "VER-004": wrap("  expect(page.locator('#a')).toBeVisible();"),
  "VER-005": wrap("  await page.goto('/x');\n  await expect(page.locator('.error')).not.toBeVisible();"),
  "DATA-001": wrap("  await page.getByLabel('Password').fill('hunter2');" + OK_END),
  "DATA-002": wrap("  await page.getByLabel('Name').fill('REPLACE_ME');" + OK_END),
  "DATA-003": wrap("  await page.getByLabel('Email').fill(process.env.USER_EMAIL!);" + OK_END),
  "DATA-004": wrap("  await page.goto('https://prod.example.com/login');" + OK_END),
  "DATA-005": wrap("  await page.getByLabel('Name').fill('');" + OK_END),
  "LOC-001": wrap("  await page.locator('//div[@id=\"a\"]').click();" + OK_END),
  "LOC-002": wrap("  await page.locator('ul > li:nth-child(3)').click();" + OK_END),
  "LOC-003": wrap("  await page.locator('.css-1x2y3z4').click();" + OK_END),
  "LOC-004": wrap("  await page.getByRole('button').first().click();" + OK_END),
  "LOC-005": wrap("  const el = await page.$('#a');" + OK_END),
  "LOC-006": wrap("  await page.locator('text=Hello').click();" + OK_END),
  "HYG-001": `import { test } from '@playwright/test';\ntest.only('x', async ({ page }) => {\n  await page.goto('/x');\n});\n`,
  "HYG-002": wrap("  await page.pause();" + OK_END),
  "HYG-003": wrap("  console.log('here');" + OK_END),
  "HYG-004": `import { test } from '@playwright/test';\ntest.skip('later', async ({ page }) => {\n  await page.goto('/x');\n});\n`,
  "HYG-005": wrap("  await page.getByRole('button', { name: 'Close' }).click().catch(() => {});" + OK_END),
  "SEC-001": wrap("  const key = 'AKIAIOSFODNN7EXAMPLE';" + OK_END),
};

test.describe("every rule fires on its bad snippet @meta", () => {
  for (const [id, src] of Object.entries(BAD)) {
    test(id, () => {
      expect(has(src, id), `${id} did not fire. Got: ${ids(src).join(", ") || "nothing"}`).toBe(true);
    });
  }

  test("every rule in RULES has a test snippet (adding a rule without a test fails here)", () => {
    expect(Object.keys(BAD).sort()).toEqual(RULES.map((r) => r.id).sort());
  });
});

test.describe("good twins do not trigger the rule @meta", () => {
  const GOOD: Array<[string, string]> = [
    ["SYNC-001", wrap("  await expect(page.getByText('Ready')).toBeVisible();")],
    ["SYNC-002", wrap("  await page.waitForLoadState('domcontentloaded');" + OK_END)],
    ["SYNC-004", wrap("  await expect(page.locator('#a')).toBeVisible();")],
    ["SYNC-006", wrap("  const p = page.waitForResponse('**/api/x');\n  await page.getByRole('button', { name: 'Go' }).click();\n  await p;" + OK_END)],
    ["SYNC-008", wrap("  await page.getByRole('button', { name: 'Save' }).click();\n  await expect(page.getByText('Saved')).toBeVisible();\n  await page.getByRole('link', { name: 'Home' }).click();" + OK_END)],
    ["VER-002", wrap("  await page.getByRole('button', { name: 'Save' }).click();\n  await expect(page.getByText('Saved')).toBeVisible();")],
    ["VER-004", wrap("  await expect(page.locator('#a')).toBeVisible();")],
    ["VER-005", wrap("  await expect(page.locator('.error')).not.toBeVisible();\n  await expect(page).toHaveURL(/dashboard/);")],
    ["DATA-001", wrap("  await page.getByLabel('Password').fill(process.env.APP_PASSWORD ?? '');" + OK_END)],
    ["DATA-004", wrap("  await page.goto('/login');" + OK_END)],
    ["LOC-001", wrap("  await page.getByRole('button', { name: 'Save' }).click();" + OK_END)],
    ["LOC-004", wrap("  await page.getByRole('row').filter({ hasText: 'Ada' }).first().click();" + OK_END)],
    ["HYG-004", `import { test } from '@playwright/test';\ntest.skip(!process.env.X, 'X is not set');\n`],
  ];
  for (const [id, src] of GOOD) {
    test(id, () => {
      expect(has(src, id), `${id} fired on code that is fine: ${JSON.stringify(reviewSource("x.ts", src).filter((f) => f.ruleId === id).map((f) => f.snippet))}`).toBe(false);
    });
  }

  test("a clean, idiomatic spec produces no findings at all", () => {
    const src = `import { test, expect } from '@playwright/test';
import { LoginPage } from '../src/pages/LoginPage';
test('TC-1: valid login', async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto('/');
  await login.login(process.env.U ?? '', process.env.P ?? '');
  await login.expectAuthenticated();
  await expect(page).toHaveURL(/dashboard/);
});
`;
    expect(reviewSource("clean.spec.ts", src)).toEqual([]);
  });

  test("checkout() is a UI trigger, not an assertion helper; locator.check() is an action, not an assertion", () => {
    expect(has(wrap("  await cart.checkout();\n  await page.goto('/x');" + OK_END), "SYNC-008")).toBe(true);
    expect(has(wrap("  await page.getByLabel('Agree').check();"), "VER-001")).toBe(true);
  });

  test("API/data-setup calls are not treated as UI triggers", () => {
    const src = wrap("  await api.createUser({ name: 'a' });\n  await page.goto('/users');" + OK_END);
    expect(has(src, "SYNC-008")).toBe(false);
  });

  test("a helper that asserts internally (verify*/check*/ensure*) counts as an assertion", () => {
    expect(has(wrap("  await checkEnvironmentHealthy(page, '/');"), "VER-001")).toBe(false);
    expect(has(wrap("  await dashboard.verifyLoaded();"), "VER-001")).toBe(false);
  });
});

test.describe("suggestions are specific, not generic @meta", () => {
  test("a login step is told to verify the post-login state", () => {
    const f = reviewSource("x.spec.ts", wrap("  await login.signIn('a', 'b');\n  await page.goto('/orders');" + OK_END)).find((x) => x.ruleId === "SYNC-008");
    expect(f?.suggestion).toMatch(/toHaveURL|landmark/);
  });

  test("a delete step is told to verify removal", () => {
    const f = reviewSource("x.spec.ts", wrap("  await page.getByRole('button', { name: 'Delete' }).click();")).find((x) => x.ruleId === "VER-002");
    expect(f?.suggestion).toMatch(/gone|toHaveCount\(0\)|toBeHidden/);
  });

  test("non-retrying reads are mapped to the matching web-first matcher", () => {
    const f = reviewSource("x.spec.ts", wrap("  expect(await page.locator('#a').inputValue()).toBe('x');")).find((x) => x.ruleId === "SYNC-004");
    expect(f?.suggestion).toContain("toHaveValue");
  });

  test("findings carry the right line number", () => {
    const f = reviewSource("x.spec.ts", wrap("  await page.goto('/x');\n  await page.waitForTimeout(1000);")).find((x) => x.ruleId === "SYNC-001");
    expect(f?.line).toBe(4); // import(1), test(2), goto(3), waitForTimeout(4)
  });
});

test.describe("suppression needs a reason @meta", () => {
  test("// review-ignore RULE: reason suppresses that finding", () => {
    const src = wrap("  // review-ignore SYNC-001: vendor widget has no observable ready state, ticket ABC-1\n  await page.waitForTimeout(500);" + OK_END);
    expect(has(src, "SYNC-001")).toBe(false);
  });

  test("a suppression without a reason is ignored", () => {
    const src = wrap("  // review-ignore SYNC-001\n  await page.waitForTimeout(500);" + OK_END);
    expect(has(src, "SYNC-001")).toBe(true);
  });

  test("a suppression for a different rule does not hide this one", () => {
    const src = wrap("  // review-ignore LOC-001: not relevant here\n  await page.waitForTimeout(500);" + OK_END);
    expect(has(src, "SYNC-001")).toBe(true);
  });
});

test.describe("the scaffold reviews itself @meta", () => {
  test("the shipped example specs and page objects have no error-level findings", () => {
    const root = path.join(__dirname, "..", "..");
    const files = ["tests/example", "tests/smoke", "src/pages"].flatMap((t) => collectFiles(path.join(root, t)));
    expect(files.length).toBeGreaterThan(2);
    const report = buildReport(files);
    const errors = report.findings.filter((f) => f.severity === "error");
    expect(errors, JSON.stringify(errors, null, 1)).toEqual([]);
  });

  test("the example's placeholder data is reported (as a warning), not hidden", () => {
    const root = path.join(__dirname, "..", "..");
    const report = buildReport(collectFiles(path.join(root, "tests/example")));
    expect(report.findings.some((f) => f.ruleId === "DATA-002" && f.severity === "warning")).toBe(true);
  });
});

test.describe("documentation cannot drift from the code @meta", () => {
  test("the script-review skill's rules.md is exactly what the code generates", () => {
    const file = path.join(__dirname, "..", "..", ".github", "skills", "script-review", "references", "rules.md");
    expect(fs.readFileSync(file, "utf-8").trim()).toBe(rulesMarkdown().trim());
  });
});

/** False positives and false negatives found by an independent review, each kept as a regression test. */
test.describe("precision: things that are fine must stay quiet @meta", () => {
  const quiet = (src: string, id: string) => expect(has(src, id), `${id} fired: ${JSON.stringify(reviewSource("x.ts", src).filter((f) => f.ruleId === id).map((f) => f.snippet))}`).toBe(false);

  test("DATA-001: selector constants, labels and sentences are not credentials", () => {
    quiet("class P { private passwordInput = '#password'; }", "DATA-001");
    quiet("const sel = { password: '#password', token: '[data-test=token]' };", "DATA-001");
    quiet("const PASSWORD_HINT = 'Enter your password';", "DATA-001");
    quiet(wrap("  await page.getByLabel('Token amount').fill('100');" + OK_END), "DATA-001");
    quiet(wrap("  await page.getByPlaceholder('Search tokens').fill('abc');" + OK_END), "DATA-001");
  });

  test("DATA-001: real credentials are still caught (fill, act, declaration)", () => {
    expect(has(wrap("  await page.getByLabel('Password').fill('hunter2');" + OK_END), "DATA-001")).toBe(true);
    expect(has(wrap("  await page.locator('#password').fill('hunter2');" + OK_END), "DATA-001")).toBe(true);
    expect(has(wrap("  await po.act('password', 'fill', 'hunter2');" + OK_END), "DATA-001")).toBe(true);
    expect(has("const apiKey = 'abc123def456';", "DATA-001")).toBe(true);
    expect(has(wrap("  await page.getByLabel('API key').fill('abc123def456');" + OK_END), "DATA-001")).toBe(true);
  });

  test("SYNC-008: 'Address line' is not add, 'Payment method' is not pay, data setup is not a UI trigger", () => {
    quiet(wrap("  await page.getByLabel('Address line 1').click();\n  await page.getByLabel('City').fill('Oslo');" + OK_END), "SYNC-008");
    quiet(wrap("  await page.getByRole('combobox', { name: 'Payment method' }).click();\n  await page.getByRole('option', { name: 'Card' }).click();" + OK_END), "SYNC-008");
    quiet(wrap("  await testData.createUser();\n  await page.goto('/users');" + OK_END), "SYNC-008");
    quiet(wrap("  await this.api.deleteOrders();\n  await page.goto('/orders');" + OK_END), "SYNC-008");
  });

  test("LOC-004 / LOC-002 / LOC-003 / HYG-005 / DATA-002 edge cases", () => {
    quiet(wrap("  await page.getByRole('table').getByRole('row').nth(2).click();" + OK_END), "LOC-004");
    quiet(wrap("  await page.locator('text=Sign in to your account today').click();" + OK_END), "LOC-002");
    quiet(wrap("  await page.locator('button:has-text(\"Save the changes now please\")').click();" + OK_END), "LOC-002");
    quiet(wrap("  await page.locator('.price-2024').click();" + OK_END), "LOC-003");
    quiet(wrap("  await page.getByRole('button').click().catch(() => { /* the banner is optional */ });" + OK_END), "HYG-005");
    quiet(wrap("  try { await page.goto('/x'); } catch { // site is optional in this env\n  }" + OK_END), "HYG-005");
    quiet(wrap("  await page.getByPlaceholder('xxx-xxx-xxxx').fill(process.env.PHONE ?? '');" + OK_END), "DATA-002");
    quiet(wrap("  await expect(page.getByText('Lorem ipsum')).toBeVisible();"), "DATA-002");
  });

  test("a helper-only test is a warning to check, not an error that fails --strict", () => {
    const f = reviewSource("x.spec.ts", wrap("  const d = new Dashboard(page);\n  await d.open();\n  await d.isLoaded();")).find((x) => x.ruleId === "VER-001");
    expect(f?.severity).toBe("warning");
    const bare = reviewSource("x.spec.ts", wrap("  await page.getByLabel('Name').fill('Ada');")).find((x) => x.ruleId === "VER-001");
    expect(bare?.severity).toBe("error");
  });
});

test.describe("recall: things that are wrong must be caught where they hide @meta", () => {
  test("nested blocks: test.step bodies, loops and branches are reviewed too", () => {
    expect(has(wrap("  await test.step('check', async () => {\n    expect(page.getByText('a')).toBeVisible();\n  });" + OK_END), "VER-004")).toBe(true);
    expect(has(wrap("  for (const n of [1, 2]) {\n    await page.getByRole('button', { name: 'Save' }).click();\n    await page.getByRole('link', { name: 'Home' }).click();\n  }" + OK_END), "SYNC-008")).toBe(true);
    expect(has(wrap("  if (process.env.X) {\n    await page.waitForResponse('**/a');\n  }" + OK_END), "SYNC-006")).toBe(false); // alone, nothing triggers it
  });

  test("the scaffold's own act()/verify() DSL is understood", () => {
    const src = wrap("  await po.act('saveButton', 'click');\n  await po.act('homeLink', 'click');" + OK_END);
    expect(has(src, "SYNC-008")).toBe(true);
    expect(has(wrap("  await po.act('saveButton', 'click');\n  await po.verify('toast', 'visible');\n  await po.act('homeLink', 'click');" + OK_END), "SYNC-008")).toBe(false);
    expect(has(wrap("  await po.act('saveButton', 'click');"), "VER-002")).toBe(true);
  });

  test("describe.parallel.only is caught", () => {
    expect(has("import { test } from '@playwright/test';\ntest.describe.parallel.only('g', () => { test('t', async ({ page }) => { await page.goto('/x'); }); });", "HYG-001")).toBe(true);
  });
});

test.describe("suppression scope @meta", () => {
  test("a trailing suppression covers its own line only, not the next statement", () => {
    const src = wrap("  await page.waitForTimeout(100); // review-ignore SYNC-001: vendor widget, ticket ABC-1\n  await page.waitForTimeout(200);" + OK_END);
    expect(reviewSource("x.spec.ts", src).filter((f) => f.ruleId === "SYNC-001")).toHaveLength(1);
  });
});

test.describe("CLI guards @meta", () => {
  test("a mistyped --min is refused instead of hiding everything", () => {
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const r = spawnSync("npx", ["ts-node", "src/reviewer/reviewScripts.ts", "--min", "warn", "--out", path.join(require("os").tmpdir(), "x.json")], { cwd: path.join(__dirname, "..", ".."), encoding: "utf-8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--min must be one of/);
  });
});
