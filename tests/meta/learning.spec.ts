import { test, expect } from "@playwright/test";
import crypto from "crypto";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { aggregate, dedupeRecords, loadRecords } from "../../src/learning/aggregate";
import { approve, patternFile, retire, validKey } from "../../src/learning/approve";
import { safeRef, captureCommit, captureRange, captureStaged, captureWorktree, hashAuthor, linkFailures, main as captureMain, recordFileName, repoId, writeRecord } from "../../src/learning/captureGit";
import { classifyChange } from "../../src/learning/classify";
import { loadConfig } from "../../src/learning/config";
import { main as installHook } from "../../src/learning/installHook";
import { KINDS, KIND_BY_ID, kindsMarkdown } from "../../src/learning/kinds";
import { lookup } from "../../src/learning/lookup";
import { expectedFiles, main as publishMain } from "../../src/learning/publish";
import { redact } from "../../src/learning/redact";
import { normalizePattern, normalizeRecord } from "../../src/learning/sanitize";
import { CaptureRecord, LearningEvent, Pattern } from "../../src/learning/types";
import { SKILL_AREAS } from "../../src/utils/skillAreas";

const ROOT = path.join(__dirname, "..", "..");
const wrap = (body: string) => `import { test, expect } from '@playwright/test';\ntest('t', async ({ page }) => {\n${body}\n});\n`;
const kinds = (before: string, after: string, file = "tests/x.spec.ts") => classifyChange(file, wrap(before), wrap(after)).events.map((e) => (e.subkind ? `${e.kind}:${e.subkind}` : e.kind));
const GO = "  await page.getByRole('button', { name: 'Go' }).click();";

/** One row per edit kind: proves the classifier recognises it, and its direction. */
const CASES: Array<{ kind: string; before: string; after: string; expect: string; direction: "improvement" | "regression" | "neutral" }> = [
  { kind: "locator-upgraded", before: "  await page.locator('#btn').click();", after: GO, expect: "locator-upgraded:id->role", direction: "improvement" },
  { kind: "locator-replaced", before: "  await page.locator('#old').click();", after: "  await page.locator('#new').click();", expect: "locator-replaced:id", direction: "neutral" },
  { kind: "locator-downgraded", before: GO, after: "  await page.locator('//div/button[3]').click();", expect: "locator-downgraded:role->xpath", direction: "regression" },
  { kind: "locator-fallback-added", before: GO, after: "  await page.getByRole('button', { name: 'Go' }).or(page.getByTestId('go')).click();", expect: "locator-fallback-added:or()", direction: "improvement" },
  { kind: "locator-scoped", before: "  await page.getByRole('button').nth(2).click();", after: "  await page.getByRole('row').filter({ hasText: 'x' }).getByRole('button').click();", expect: "locator-scoped", direction: "improvement" },
  { kind: "sync-sleep-replaced", before: "  await page.waitForTimeout(2000);", after: "  await page.waitForResponse('**/api');", expect: "sync-sleep-replaced:waitForResponse", direction: "improvement" },
  { kind: "sync-sleep-removed", before: `${GO}\n  await page.waitForTimeout(2000);`, after: GO, expect: "sync-sleep-removed", direction: "improvement" },
  { kind: "sync-wait-added", before: GO, after: `${GO}\n  await page.waitForURL('**/home');`, expect: "sync-wait-added:waitForURL", direction: "improvement" },
  { kind: "sync-sleep-added", before: GO, after: `${GO}\n  await page.waitForTimeout(2000);`, expect: "sync-sleep-added", direction: "regression" },
  { kind: "sync-timeout-raised", before: GO, after: "  await page.getByRole('button', { name: 'Go' }).click({ timeout: 60000 });", expect: "sync-timeout-raised", direction: "regression" },
  { kind: "sync-force-added", before: GO, after: "  await page.getByRole('button', { name: 'Go' }).click({ force: true });", expect: "sync-force-added", direction: "regression" },
  { kind: "sync-force-removed", before: "  await page.getByRole('button', { name: 'Go' }).click({ force: true });", after: GO, expect: "sync-force-removed", direction: "improvement" },
  { kind: "assertion-added", before: "  await expect(page).toHaveURL(/home/);", after: "  await expect(page).toHaveURL(/home/);\n  await expect(page.getByRole('heading')).toHaveText('Home');", expect: "assertion-added:toHaveText", direction: "improvement" },
  { kind: "verification-added", before: `${GO}\n  await page.getByRole('button', { name: 'Next' }).click();`, after: `${GO}\n  await expect(page).toHaveURL(/step2/);\n  await page.getByRole('button', { name: 'Next' }).click();`, expect: "verification-added:toHaveURL", direction: "improvement" },
  { kind: "assertion-strengthened", before: "  await expect(page.getByRole('alert')).toBeVisible();", after: "  await expect(page.getByRole('alert')).toHaveText('Saved');", expect: "assertion-strengthened:toBeVisible->toHaveText", direction: "improvement" },
  { kind: "assertion-weakened", before: "  await expect(page.getByRole('alert')).toHaveText('Saved');", after: "  await expect(page.getByRole('alert')).toBeVisible();", expect: "assertion-weakened:toHaveText->toBeVisible", direction: "regression" },
  { kind: "assertion-removed", before: `${GO}\n  await expect(page.getByRole('alert')).toHaveText('Saved');`, after: GO, expect: "assertion-removed", direction: "regression" },
  { kind: "expectation-updated", before: "  await expect(page.getByRole('alert')).toHaveText('Saved');", after: "  await expect(page.getByRole('alert')).toHaveText('Saved successfully');", expect: "expectation-updated:toHaveText", direction: "neutral" },
  { kind: "data-externalized", before: "  await page.getByLabel('Name').fill('Ada');", after: "  await page.getByLabel('Name').fill(process.env.USER_NAME!);", expect: "data-externalized", direction: "improvement" },
  { kind: "data-hardcoded", before: "  await page.getByLabel('Name').fill(process.env.USER_NAME!);", after: "  await page.getByLabel('Name').fill('Ada');", expect: "data-hardcoded", direction: "regression" },
  { kind: "data-guard-added", before: "  await page.getByLabel('Name').fill('x');", after: "  test.skip(!process.env.USER_NAME, 'USER_NAME not set');\n  await page.getByLabel('Name').fill('x');", expect: "data-guard-added", direction: "improvement" },
];

test.describe("edit classifier @meta", () => {
  for (const c of CASES) {
    test(`${c.kind}: recognised as ${c.direction}`, () => {
      const r = classifyChange("tests/x.spec.ts", wrap(c.before), wrap(c.after));
      const got = r.events.find((e) => e.kind === c.kind);
      expect(got, `${c.kind} not found in: ${r.events.map((e) => e.kind).join(", ") || "(nothing)"}`).toBeTruthy();
      expect(kinds(c.before, c.after)).toContain(c.expect);
      expect(got!.direction).toBe(c.direction);
      expect(got!.area).toBe(KIND_BY_ID.get(c.kind as never)!.area);
    });
  }

  test("locator-fallback-removed is recognised in a locator JSON file (with fallback-added and a primary change)", () => {
    const base = (primary: object, fallbacks: object[]) => JSON.stringify({ elements: { saveButton: { label: "Save", elementClass: "Button", primary, fallbacks } } });
    const css = { strategy: "css", value: "#save" }, role = { strategy: "getByRole", role: "button", name: "Save" }, tid = { strategy: "getByTestId", value: "save" };
    const f = "src/locators/app.locators.json";
    const names = (b: string, a: string) => classifyChange(f, b, a).events.map((e) => (e.subkind ? `${e.kind}:${e.subkind}` : e.kind));
    expect(names(base(css, [role, tid]), base(css, [role]))).toContain("locator-fallback-removed");
    expect(names(base(css, [role]), base(css, [role, tid]))).toContain("locator-fallback-added:+testid");
    expect(names(base(css, [role]), base(role, [role]))).toContain("locator-upgraded:css->role");
    expect(names(base(role, []), base({ strategy: "css", value: "#x" }, []))).toContain("locator-downgraded:role->css");
    expect(names(base(css, []), base({ strategy: "css", value: "#other" }, []))).toContain("locator-replaced:css");
    const e = classifyChange(f, base(css, [role]), base(css, [role, tid])).events[0];
    expect(e.target).toBe("saveButton");
    expect(e.fileKind).toBe("locators");
  });

  test("every edit kind has a classifier case above, and every kind is described once", () => {
    const covered = new Set(CASES.map((c) => c.kind));
    covered.add("locator-fallback-removed"); // covered by the JSON test
    expect([...covered].sort()).toEqual(KINDS.map((k) => k.kind).sort());
    expect(new Set(KINDS.map((k) => k.kind)).size).toBe(KINDS.length);
    expect(KINDS.length).toBe(22);
  });

  test("formatting-only and comment-only changes produce nothing", () => {
    expect(kinds("  await page.getByLabel('Name').fill('x');", "  await   page.getByLabel('Name')\n    .fill('x');")).toEqual([]);
    expect(kinds(GO, `  // click it\n${GO}`)).toEqual([]);
  });

  test("a change inside a test.step is reported once, not also for the step that contains it", () => {
    const step = (body: string) => `  await test.step('s', async () => {\n${body}\n  });`;
    const r = kinds(step("    await page.locator('#a').click();"), step("    await page.getByRole('button', { name: 'A' }).click();"));
    expect(r).toEqual(["locator-upgraded:id->role"]);
  });

  test("non-TypeScript files, unparseable JSON and identical content give no events", () => {
    expect(classifyChange("README.md", "a", "b").events).toEqual([]);
    expect(classifyChange("src/locators/x.locators.json", "{", "}").events).toEqual([]);
    expect(classifyChange("tests/x.spec.ts", wrap(GO), wrap(GO)).events).toEqual([]);
  });

  test("the same edit gets the same id (so hook and CI captures count once); a different file does not", () => {
    const a = classifyChange("tests/a.spec.ts", wrap("  await page.locator('#btn').click();"), wrap(GO)).events[0];
    const b = classifyChange("tests/a.spec.ts", wrap("  await page.locator('#btn').click();"), wrap(GO)).events[0];
    const c = classifyChange("tests/b.spec.ts", wrap("  await page.locator('#btn').click();"), wrap(GO)).events[0];
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });

  test("the reviewer delta lists the rules a change fixed and introduced", () => {
    const fixed = classifyChange("tests/x.spec.ts", wrap(`${GO}\n  await page.waitForTimeout(3000);\n  await expect(page.getByRole('alert')).toBeVisible();`), wrap(`${GO}\n  await expect(page.getByRole('alert')).toBeVisible();`)).review;
    expect(fixed.fixed).toContain("SYNC-001");
    const intro = classifyChange("tests/x.spec.ts", wrap(`${GO}\n  await expect(page.getByRole('alert')).toBeVisible();`), wrap(`${GO}\n  await page.waitForTimeout(3000);\n  await expect(page.getByRole('alert')).toBeVisible();`)).review;
    expect(intro.introduced).toContain("SYNC-001");
  });

  test("events never carry a secret, an e-mail address or a host", () => {
    const r = classifyChange(
      "tests/x.spec.ts",
      wrap("  await page.goto('https://prod.corp.example.com/login');\n  await page.locator('#u').fill('a@b.com');"),
      wrap("  await page.goto('https://prod.corp.example.com/login');\n  await page.getByLabel('User').fill('ada@corp.example.com');"),
    );
    const text = JSON.stringify(r.events);
    expect(text).not.toContain("ada@corp");
    expect(text).not.toContain("corp.example.com");
    expect(text).toContain("<email>");
  });
});


test.describe("edit classifier: shortcuts are never lessons @meta", () => {
  const PROMISE = "  await new Promise((r) => setTimeout(r, 2000));";
  /** Each pair is a regression or a swap of one shortcut for another. None may produce an improvement. */
  const NEVER_IMPROVEMENT: Array<[string, string, string]> = [
    ["sleep disguised as setTimeout", "  await page.waitForTimeout(2000);", PROMISE],
    ["sleep disguised as sleep()", "  await page.waitForTimeout(2000);", "  await sleep(2000);"],
    ["sleep swapped for networkidle", "  await page.waitForTimeout(2000);", "  await page.waitForLoadState('networkidle');"],
    ["sleep swapped for waitForSelector", "  await page.waitForTimeout(2000);", "  await page.waitForSelector('#x');"],
    ["sleep swapped for waitForFunction(() => true)", "  await page.waitForTimeout(2000);", "  await page.waitForFunction(() => true);"],
    ["sleep hidden inside toPass", "  await page.waitForTimeout(2000);", "  await expect(async () => { await page.waitForTimeout(2000); }).toPass();"],
    ["sleep swapped for an assertion that cannot fail", "  await page.waitForTimeout(2000);", "  expect(true).toBe(true);"],
    ["assertion replaced by expect(true)", "  await expect(page.getByRole('alert')).toHaveText('x');", "  expect(true).toBeTruthy();"],
    ["trivial assertion after a click", GO, `${GO}\n  expect(1).toBeTruthy();`],
    ["toBeVisible weakened to match-anything text", "  await expect(page.getByRole('alert')).toBeVisible();", "  await expect(page.getByRole('alert')).toHaveText(/.*/);"],
    ["value weakened to match-anything", "  await expect(page.getByRole('alert')).toHaveText('Welcome back');", "  await expect(page.getByRole('alert')).toHaveText(/.*/);"],
    ["assertion swallowed by catch", "  await expect(page.getByRole('alert')).toBeVisible();", "  await expect(page.getByRole('alert')).toBeVisible().catch(() => {});"],
    ["skip(true) is not a data guard", "  await page.getByLabel('Name').fill('x');", "  test.skip(true, 'flaky');\n  await page.getByLabel('Name').fill('x');"],
    ["skip on browser is not a data guard", "  await page.getByLabel('Name').fill('x');", "  test.skip(browserName === 'webkit');\n  await page.getByLabel('Name').fill('x');"],
    ["primary replaced and an .or() added is a swap, not a fallback", GO, "  await page.getByText('Go').or(page.locator('.go')).click();"],
    ["toBeDefined cannot fail", GO, `${GO}\n  expect(page).toBeDefined();`],
    ["catch-all .or()", GO, "  await page.getByRole('button', { name: 'Go' }).or(page.locator('button')).click();"],
    ["locator upgrade that also adds force and a timeout", "  await page.locator('#b').click();", "  await page.getByRole('button', { name: 'B' }).click({ force: true, timeout: 120000 });"],
    ["timeout from a constant", GO, "  await page.getByRole('button', { name: 'Go' }).click({ timeout: LONG });"],
    ["timeout: 0", GO, "  await page.getByRole('button', { name: 'Go' }).click({ timeout: 0 });"],
    ["test.setTimeout", GO, `  test.setTimeout(600000);\n${GO}`],
    ["quoted force key", GO, "  await page.getByRole('button', { name: 'Go' }).click({ 'force': true });"],
    ["force on a new statement", GO, `${GO}\n  await page.getByRole('button', { name: 'X' }).click({ force: true });`],
  ];
  for (const [name, b, a] of NEVER_IMPROVEMENT) {
    test(`${name}: no improvement is reported`, () => {
      const events = classifyChange("tests/x.spec.ts", wrap(b), wrap(a)).events;
      expect(events.filter((e) => e.direction === "improvement").map((e) => e.kind), JSON.stringify(events.map((e) => e.kind))).toEqual([]);
    });
  }

  test("the shortcuts that can be recognised are reported as regressions", () => {
    const regs = (b: string, a: string) => classifyChange("tests/x.spec.ts", wrap(b), wrap(a)).events.filter((e) => e.direction === "regression").map((e) => e.kind);
    expect(regs(GO, "  await page.getByRole('button', { name: 'Go' }).click({ timeout: LONG });")).toContain("sync-timeout-raised");
    expect(regs(GO, `  test.setTimeout(600000);\n${GO}`)).toContain("sync-timeout-raised");
    expect(regs(GO, "  await page.getByRole('button', { name: 'Go' }).click({ 'force': true });")).toContain("sync-force-added");
    expect(regs(GO, `${GO}\n  await page.getByRole('button', { name: 'X' }).click({ force: true });`)).toContain("sync-force-added");
    expect(regs("  await expect(page.getByRole('alert')).toHaveText('x');", "  expect(true).toBeTruthy();")).toContain("assertion-removed");
    expect(regs("  await expect(page.getByRole('alert')).toHaveText('Welcome back');", "  await expect(page.getByRole('alert')).toHaveText(/.*/);")).toContain("assertion-weakened");
    expect(regs("  await expect(page.getByRole('alert')).toBeVisible();", "  await expect(page.getByRole('alert')).toBeVisible().catch(() => {});")).toContain("assertion-weakened");
    expect(regs(GO, "  await page.getByRole('button', { name: 'Go' }).first().click();")).toContain("locator-downgraded");
  });

  test("a moved statement is not an edit; a deleted or new test is not a fix", () => {
    const A = "  await expect(page.getByRole('alert')).toHaveText('x');";
    expect(kinds(`${A}\n${GO}`, `${GO}\n${A}`)).toEqual([]);
    const two = (a: string) => `import { test, expect } from '@playwright/test';\ntest('a', async ({ page }) => {\n${a}\n});\ntest('b', async ({ page }) => {\n${GO}\n});\n`;
    expect(classifyChange("tests/x.spec.ts", two("  await page.waitForTimeout(2000);"), `import { test } from '@playwright/test';\ntest('b', async ({ page }) => {\n${GO}\n});\n`).events).toEqual([]);
    expect(classifyChange("tests/x.spec.ts", `import { test } from '@playwright/test';\ntest('b', async ({ page }) => {\n${GO}\n});\n`, two("  await page.waitForTimeout(2000);")).events.filter((e) => e.kind === "sync-sleep-added")).toEqual([]);
  });

  test("in a chained locator the LEAF decides: role -> css under an unchanged container is a downgrade", () => {
    const k = (b: string, a: string) => kinds(b, a);
    expect(k("  await page.locator('.row').getByRole('button', { name: 'Del' }).click();", "  await page.getByRole('row').locator('.del-btn').click();")).toContain("locator-downgraded:role->css");
    expect(k("  await page.getByRole('row').locator('.del-btn').click();", "  await page.getByRole('row').getByRole('button', { name: 'Del' }).click();")).toContain("locator-upgraded:css->role");
  });

  test("page.fill(selector, value): the value, not the selector, decides literal vs environment", () => {
    expect(kinds("  await page.fill('#name', 'Ada');", "  await page.fill('#name', process.env.USER_NAME!);")).toContain("data-externalized");
  });

  test("locator JSON: a demoted primary is not also a new fallback; catch-all fallbacks and null elements are harmless; a BOM is tolerated", () => {
    const f = "src/locators/a.locators.json";
    const el = (primary: object, fallbacks: object[]) => ({ elements: { x: { primary, fallbacks } } });
    const names = (b: object, a: object, bom = "") => classifyChange(f, bom + JSON.stringify(b), bom + JSON.stringify(a)).events.map((e) => e.kind);
    const role = { strategy: "getByRole", role: "button", name: "S" };
    expect(names(el(role, []), el({ strategy: "xpath", value: "//div[3]" }, [role]))).toEqual(["locator-downgraded"]);
    expect(names(el({ strategy: "id", value: "a" }, []), el({ strategy: "id", value: "a" }, [{ strategy: "css", value: "button" }]))).toEqual([]);
    expect(names({ elements: { x: null } } as never, { elements: { x: null } } as never)).toEqual([]);
    expect(names(el({ strategy: "css", value: "#a" }, []), el(role, []), "﻿")).toContain("locator-upgraded");
  });

  test("CRLF-only changes are nothing; a syntax-error file does not throw", () => {
    const a = wrap(GO);
    expect(classifyChange("tests/x.spec.ts", a, a.replace(/\n/g, "\r\n")).events).toEqual([]);
    expect(() => classifyChange("tests/x.spec.ts", "const = = ;", wrap(GO))).not.toThrow();
  });

  test("a one-line fix in a very large file is still found, quickly; a huge rewrite is reported as skipped, not silently empty", () => {
    const many = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `  await page.getByRole('button', { name: '${tag}${i}' }).click();`).join("\n");
    const big = (fix: boolean) => wrap(`${many(3500, "k")}\n${fix ? GO : "  await page.locator('#btn').click();"}`);
    const t0 = Date.now();
    const r = classifyChange("tests/big.spec.ts", big(false), big(true));
    expect(r.events.map((e) => e.kind)).toContain("locator-upgraded");
    expect(Date.now() - t0).toBeLessThan(15000);
    const rewrite = classifyChange("tests/big.spec.ts", wrap(many(2300, "a")), wrap(many(2300, "b")));
    expect(rewrite.skipped).toContain("too many changed statements");
  });
});

test.describe("redaction @meta", () => {
  test("removes credentials, addresses, hosts and long numbers; keeps the code", () => {
    expect(redact("token AKIAABCDEFGHIJKLMNOP end")).toContain("<secret>");
    expect(redact("Authorization: Bearer abcdefghijklmnop123")).toContain("Bearer <secret>");
    expect(redact("await page.getByLabel('Password').fill('hunter2')")).toBe("await page.getByLabel('Password').fill('<redacted>')");
    expect(redact("const password = 'p@ss';")).toContain("<redacted>");
    expect(redact("mail ada@example.org now")).toBe("mail <email> now");
    expect(redact("goto('https://secret.internal.corp/path/x?y=1')")).toBe("goto('https://<host>/path/x?y=1')");
    expect(redact("host 10.20.30.40 acct 1234567890123")).toBe("host <ip> acct <number>");
    expect(redact("await page.getByRole('button', { name: 'Save' }).click()")).toBe("await page.getByRole('button', { name: 'Save' }).click()");
  });
  test("collapses whitespace and truncates", () => {
    expect(redact("a   b\n c")).toBe("a b c");
    expect(redact("x".repeat(500))!.length).toBe(240);
    expect(redact(undefined)).toBeUndefined();
  });
});


test.describe("redaction: what real code leaks @meta", () => {
  const gone = (input: string, secret: string) => {
    const out = redact(input)!;
    expect(out, input).not.toContain(secret);
  };
  test("password-like fields in every shape", () => {
    gone("await page.fill('#password', 'S3cr3t!Pass');", "S3cr3t");
    gone("await page.locator('#pw').fill('hunter2');", "hunter2");
    gone("await page.getByLabel('Passwort').fill('geheim99');", "geheim99");
    gone("await page.getByLabel('Kennwort').fill('geheim99');", "geheim99");
    gone("const pw = 'hunter2';", "hunter2");
    gone("const creds = { pass: 'hunter2' };", "hunter2");
    gone("await page.getByLabel('PIN').fill('482913');", "482913");
  });
  test("tokens, headers, query strings, vendor keys", () => {
    gone("headers: { Authorization: 'Token abcdef123456' }", "abcdef123456");
    gone("headers: { authorization: 'bearer abcdef123456' }", "abcdef123456");
    gone("await page.goto('/cb?access_token=abc123xyz&x=1');", "abc123xyz");
    gone("await page.goto('/login?password=hunter2');", "hunter2");
    gone("key: 'AIzaSyA1234567890abcdefghijklmnopqrs'", "AIzaSyA1234");
    gone("const k = 'sk_live_abcdefghijklmnop';", "abcdefghijklmnop");
    gone("const k = 'github_pat_11ABCDEFG0abcdefghijkl_abcdefghijklmn';", "11ABCDEFG0");
    gone("Server=db;AccountKey=abc123def456ghi789==;", "abc123def456");
    gone("const hook = 'https://hooks.slack.com/services/T000/B000/XXXXXXXX';", "XXXXXXXX");
  });
  test("hosts without a scheme, phone-like and card-like numbers", () => {
    gone("page.locator('[href*=\"intranet.corp.zensar.com\"]')", "zensar");
    gone("await page.goto('//uat.corp.zensar.com/x');", "zensar");
    gone("const h = 'bat-uat.internal.zensar.com';", "zensar");
    gone("fill('4111 1111 1111 1111')", "4111 1111");
    gone("fill('555 123 4567')", "555 123");
  });
  test("it does not mangle ordinary code, and a huge blob does not make it slow", () => {
    expect(redact("const mapping = 'abc'; const spinner = 'x';")).toBe("const mapping = 'abc'; const spinner = 'x';");
    expect(redact("expect(page.locator('.a.b.c')).toBeVisible()")).toBe("expect(page.locator('.a.b.c')).toBeVisible()");
    expect(redact("this.page.getByText('Welcome back')")).toBe("this.page.getByText('Welcome back')");
    const t0 = Date.now();
    redact("await page.fill('#x', '" + "a".repeat(200000) + "')");
    expect(Date.now() - t0).toBeLessThan(500);
  });
  test("a captured event has no free-text field outside the redacted ones: target, subkind and file are cleaned too", () => {
    const r = classifyChange(
      "src/locators/a.locators.json",
      JSON.stringify({ elements: { "john.doe@corp.example.com-field": { primary: { strategy: "css", value: "#a" }, fallbacks: [] } } }),
      JSON.stringify({ elements: { "john.doe@corp.example.com-field": { primary: { strategy: "getByRole", role: "button", name: "A" }, fallbacks: [] } } }),
    );
    expect(JSON.stringify(r.events)).not.toContain("john.doe@");
  });
});

// ---------------------------------------------------------------------------------------------------------------------

function tmp(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `bat-learn-${prefix}-`));
}
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}
function repo(email = "a@example.com") {
  const d = tmp("repo");
  git(d, "init", "-q", ".");
  git(d, "config", "user.email", email);
  git(d, "config", "user.name", "x");
  git(d, "remote", "add", "origin", "https://user:pw@github.com/acme/bat.git");
  fs.mkdirSync(path.join(d, "tests"), { recursive: true });
  return d;
}
const put = (d: string, f: string, c: string) => {
  fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
  fs.writeFileSync(path.join(d, f), c);
};
const commit = (d: string, msg: string, email?: string) => {
  git(d, "add", "-A");
  if (email) git(d, "config", "user.email", email);
  git(d, "commit", "-q", "-m", msg);
  return git(d, "rev-parse", "HEAD").trim();
};
const OLD = wrap("  await page.locator('#btn').click();\n  await page.waitForTimeout(3000);");
const NEW = wrap("  await page.getByRole('button', { name: 'Save' }).click();\n  await expect(page.getByRole('alert')).toBeVisible();");

test.describe("git capture @meta", () => {
  test("worktree and staged captures see the edit; commit and range captures see it per commit", () => {
    const d = repo();
    put(d, "tests/a.spec.ts", OLD);
    const base = commit(d, "init");
    put(d, "tests/a.spec.ts", NEW);
    const wt = captureWorktree({ cwd: d });
    expect(wt.source).toBe("worktree");
    expect(wt.events.map((e) => e.kind).sort()).toEqual(["locator-upgraded", "sync-sleep-replaced"]);
    git(d, "add", "-A");
    expect(captureStaged({ cwd: d }).events.map((e) => e.id).sort()).toEqual(wt.events.map((e) => e.id).sort());
    const sha = commit(d, "fix: save button locator");
    const c = captureCommit({ cwd: d }, sha)!;
    expect(c.commit).toBe(sha.slice(0, 12));
    expect(c.events.map((e) => e.id).sort()).toEqual(wt.events.map((e) => e.id).sort());
    expect(c.events[0].why).toBe("fix: save button locator");
    const range = captureRange({ cwd: d }, `${base}..HEAD`);
    expect(range).toHaveLength(1);
    expect(range[0].source).toBe("range");
    expect(range[0].events.map((e) => e.id).sort()).toEqual(wt.events.map((e) => e.id).sort());
  });

  test("new files, excluded paths and non-learnable files are ignored; merge commits are skipped", () => {
    const d = repo();
    put(d, "tests/a.spec.ts", OLD);
    put(d, "tests/meta/m.spec.ts", OLD);
    put(d, "notes.ts", OLD);
    const base = commit(d, "init");
    put(d, "tests/a.spec.ts", NEW);
    put(d, "tests/meta/m.spec.ts", NEW);
    put(d, "notes.ts", NEW);
    put(d, "tests/brand-new.spec.ts", NEW);
    const wt = captureWorktree({ cwd: d });
    expect([...new Set(wt.events.map((e) => e.file))]).toEqual(["tests/a.spec.ts"]);
    // a merge commit is not captured (its changes were captured on the branch)
    git(d, "checkout", "-q", "-b", "feature");
    commit(d, "feature work");
    git(d, "checkout", "-q", "-");
    put(d, "other.txt", "x");
    commit(d, "main work");
    git(d, "merge", "-q", "--no-ff", "-m", "merge", "feature");
    expect(captureCommit({ cwd: d }, "HEAD")).toBeUndefined();
    void base;
  });

  test("the author is a salted hash, the repo id ignores credentials, nothing identifying is in the record", () => {
    const d = repo("ada.lovelace@corp.example.com");
    put(d, "tests/a.spec.ts", OLD);
    commit(d, "init");
    put(d, "tests/a.spec.ts", NEW);
    const r = captureWorktree({ cwd: d });
    const text = JSON.stringify(r);
    expect(text).not.toContain("ada");
    expect(text).not.toContain("corp.example.com");
    expect(text).not.toContain("pw@");
    expect(r.author).toBe(hashAuthor("ada.lovelace@corp.example.com", loadConfig(d).salt));
    expect(r.author).toBe(hashAuthor(" ADA.Lovelace@corp.example.com ", loadConfig(d).salt));
    expect(hashAuthor("ada@x.com", "s1")).not.toBe(hashAuthor("ada@x.com", "s2"));
    // two clones of one repository (one with a token in the URL, one over ssh) are one repo
    const d2 = repo();
    git(d2, "remote", "set-url", "origin", "git@github.com:acme/bat.git");
    expect(repoId(d2)).toBe(repoId(d));
  });

  test("writing is idempotent and records with nothing to learn are not written", () => {
    const d = repo();
    put(d, "tests/a.spec.ts", OLD);
    commit(d, "init");
    put(d, "tests/a.spec.ts", NEW);
    const r = captureWorktree({ cwd: d });
    const p1 = writeRecord(d, r)!;
    const p2 = writeRecord(d, { ...r, capturedAt: "2030-01-01T00:00:00.000Z" })!;
    expect(p1).toBe(p2);
    expect(fs.readdirSync(path.join(d, ".learnings/events"))).toHaveLength(1);
    expect(writeRecord(d, { ...r, events: [], files: [] })).toBeUndefined();
    expect(recordFileName({ ...r, source: "commit", commit: "abc" })).toBe("c-abc.json");
  });

  test("the CLI saves with --write, previews without it, and reports bad usage with exit 2", () => {
    const d = repo();
    put(d, "tests/a.spec.ts", OLD);
    commit(d, "init");
    put(d, "tests/a.spec.ts", NEW);
    const log = console.log, err = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      expect(captureMain(["--worktree", "--quiet"], d)).toBe(0);
      expect(fs.existsSync(path.join(d, ".learnings/events"))).toBe(false);
      expect(captureMain(["--worktree", "--write", "--quiet", "--why", "salt"], d)).toBe(0);
      expect(fs.readdirSync(path.join(d, ".learnings/events"))).toHaveLength(1);
      expect(captureMain([], d)).toBe(2);
      expect(captureMain(["--bogus"], d)).toBe(2);
      expect(captureMain(["--commit"], d)).toBe(2);
      expect(captureMain(["--worktree"], os.tmpdir())).toBe(2); // not a git repository
    } finally {
      console.log = log;
      console.error = err;
    }
  });

  test("a failed run's heal-report links the edit to the failure only when the file had exactly one failure type", () => {
    const ev = (file: string): LearningEvent => ({ id: file, kind: "locator-upgraded", area: "locator-source-strategy", direction: "improvement", file, fileKind: "spec" });
    const report = {
      clusters: [
        { entryId: "locator-not-found-action", title: "Action target never appeared", classification: "locator" },
        { entryId: "response-wait-timeout", title: "Waited for a response", classification: "synchronization" },
      ],
      failures: [
        { file: "tests/a.spec.ts", diagnosis: { entryId: "locator-not-found-action" } },
        { file: "tests/b.spec.ts", diagnosis: { entryId: "locator-not-found-action" } },
        { file: "tests/b.spec.ts", diagnosis: { entryId: "response-wait-timeout" } },
      ],
    };
    const events = [ev("tests/a.spec.ts"), ev("tests/b.spec.ts"), ev("tests/c.spec.ts")];
    linkFailures(events, report as never);
    expect(events[0].resolves?.entryId).toBe("locator-not-found-action");
    expect(events[1].resolves).toBeUndefined(); // two failure types in one file: not guessed
    expect(events[2].resolves).toBeUndefined();
  });

  test("learn-install-hook points core.hooksPath at .githooks, refuses to overwrite another, and can undo", () => {
    const d = repo();
    fs.mkdirSync(path.join(d, ".githooks"));
    fs.copyFileSync(path.join(ROOT, ".githooks/pre-commit"), path.join(d, ".githooks/pre-commit"));
    const log = console.log, err = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      expect(installHook([], d)).toBe(0);
      expect(git(d, "config", "--get", "core.hooksPath").trim()).toBe(".githooks");
      expect(installHook([], d)).toBe(0); // idempotent
      expect(installHook(["--uninstall"], d)).toBe(0);
      git(d, "config", "core.hooksPath", ".husky");
      expect(installHook([], d)).toBe(2);
      expect(git(d, "config", "--get", "core.hooksPath").trim()).toBe(".husky");
    } finally {
      console.log = log;
      console.error = err;
    }
  });

  test("the pre-commit hook is executable, valid shell, never blocks, and can be skipped", () => {
    const f = path.join(ROOT, ".githooks/pre-commit");
    expect(fs.statSync(f).mode & 0o111).not.toBe(0);
    execFileSync("sh", ["-n", f]);
    const body = fs.readFileSync(f, "utf-8");
    expect(body).toContain("BAT_LEARN");
    expect(body.trim().split("\n").pop()).toBe("exit 0");
    // run against a throwaway repo that has no capture code: it must exit 0 and change nothing
    const d = repo();
    put(d, "tests/a.spec.ts", OLD);
    commit(d, "init");
    put(d, "tests/a.spec.ts", NEW);
    git(d, "add", "-A");
    expect(() => execFileSync("sh", [f], { cwd: d })).not.toThrow();
    expect(fs.existsSync(path.join(d, ".learnings"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

let seq = 0;
const hex = (x: string) => crypto.createHash("sha1").update(x).digest("hex").slice(0, 12);
function ev(kind: string, file: string, over: Partial<LearningEvent> = {}): LearningEvent {
  const info = KIND_BY_ID.get(kind.split(":")[0] as never)!;
  return {
    id: hex(`e${++seq}`), kind: info.kind, ...(kind.includes(":") ? { subkind: kind.split(":")[1] } : {}), area: info.area, direction: info.direction, file, fileKind: "spec",
    before: "await page.locator('#a').click()", after: "await page.getByRole('button').click()", ...over,
  };
}
function rec(author: string, events: LearningEvent[], at = "2026-10-01T10:00:00.000Z", over: Partial<CaptureRecord> = {}): CaptureRecord {
  return { schema: 1, capturedAt: at, source: "commit", commit: hex(`c${++seq}`), author: hex(author), repo: hex("r1"), files: [], events, ...over };
}
function store(records: CaptureRecord[]) {
  const d = tmp("store");
  fs.mkdirSync(path.join(d, ".learnings/events"), { recursive: true });
  records.forEach((r, i) => fs.writeFileSync(path.join(d, `.learnings/events/r${i}.json`), JSON.stringify(r)));
  return d;
}

test.describe("aggregation @meta", () => {
  const K = "locator-upgraded:css->role";

  test("a pattern needs enough edits, in enough files, by enough engineers", () => {
    const three = (authors: string[], files: string[]) => store(authors.map((a, i) => rec(a, [ev(K, files[i])])));
    // 3 edits, 3 files, 3 engineers: candidate
    let r = aggregate({ root: three(["a", "b", "c"], ["t/1.ts", "t/2.ts", "t/3.ts"]) });
    expect(r.candidates.map((c) => c.key)).toEqual([K]);
    expect(r.candidates[0].evidence).toMatchObject({ events: 3, files: 3, authors: 3 });
    // one engineer's habit: not a candidate
    r = aggregate({ root: three(["a", "a", "a"], ["t/1.ts", "t/2.ts", "t/3.ts"]) });
    expect(r.candidates).toEqual([]);
    expect(r.emerging[0].missing).toEqual(["1 more engineer(s)"]);
    // one file's quirk: not a candidate
    r = aggregate({ root: three(["a", "b", "c"], ["t/1.ts", "t/1.ts", "t/1.ts"]) });
    expect(r.candidates).toEqual([]);
    // two edits is only emerging
    r = aggregate({ root: three(["a", "b"], ["t/1.ts", "t/2.ts"]) });
    expect(r.candidates).toEqual([]);
    expect(r.emerging.map((c) => c.key)).toEqual([K]);
  });

  test("the same edit captured twice (hook, then CI) is counted once", () => {
    const e = ev(K, "t/1.ts");
    const staged = rec("a", [e], "2026-10-01T10:00:00.000Z", { source: "staged", commit: undefined });
    const commitRec = rec("a", [{ ...e }], "2026-10-01T10:05:00.000Z");
    const d = store([staged, commitRec, rec("b", [ev(K, "t/2.ts")]), rec("c", [ev(K, "t/3.ts")])]);
    const r = aggregate({ root: d });
    expect(r.window.events).toBe(3);
    expect(r.candidates[0].evidence.events).toBe(3);
    expect(dedupeRecords([staged, commitRec])).toHaveLength(1);
  });

  test("regressions are coaching signals and never candidates", () => {
    const bad = "sync-sleep-added";
    const d = store(["a", "b", "c", "d"].map((a, i) => rec(a, [ev(bad, `t/${i}.ts`)])));
    const r = aggregate({ root: d });
    expect(r.candidates).toEqual([]);
    expect(r.coaching.map((c) => c.key)).toEqual([bad]);
    expect(KIND_BY_ID.get(bad as never)!.direction).toBe("regression");
  });

  test("approved patterns leave the candidate list, and recurrence after approval is reported", () => {
    const events = (n: number, at: string, offset = 0) => Array.from({ length: n }, (_, i) => rec(`u${i + offset}`, [ev(K, `t/${i + offset}.ts`)], at));
    const d = store([...events(3, "2026-10-01T10:00:00.000Z")]);
    expect(approve(d, K, "Raj", { now: new Date("2026-10-02T00:00:00Z") }).ok).toBe(true);
    let r = aggregate({ root: d });
    expect(r.candidates).toEqual([]);
    expect(r.known[0]).toMatchObject({ key: K, status: "approved", recurrences: 0 });
    expect(r.recurringAfterApproval).toEqual([]);
    // three more people make the same edit after the approval
    events(3, "2026-10-09T10:00:00.000Z", 10).forEach((x, i) => fs.writeFileSync(path.join(d, `.learnings/events/late${i}.json`), JSON.stringify(x)));
    r = aggregate({ root: d });
    expect(r.recurringAfterApproval).toEqual([{ key: K, since: "2026-10-02T00:00:00.000Z", recurrences: 3, authors: 3 }]);
  });

  test("elements edited repeatedly are listed as unstable", () => {
    const d = store([rec("a", [ev("locator-replaced:css", "src/locators/app.locators.json", { target: "saveButton" })]), rec("b", [ev("locator-replaced:css", "src/locators/app.locators.json", { target: "saveButton", after: "css:#v3" })]), rec("c", [ev("locator-replaced:css", "src/locators/app.locators.json", { target: "other" })])]);
    const r = aggregate({ root: d });
    expect(r.hotspots).toHaveLength(1);
    expect(r.hotspots[0]).toMatchObject({ target: "saveButton", edits: 2, authors: 2 });
    expect(r.hotspots[0].advice).toContain("hybrid locator");
  });

  test("failure-to-fix map, reviewer rules, per-area stats and corrections", () => {
    const res = { entryId: "locator-not-found-action", classification: "locator", title: "Action target never appeared" };
    const d = store([
      rec("a", [ev(K, "t/1.ts", { resolves: res })], undefined, { files: [{ file: "t/1.ts", fixed: ["LOC-004"], introduced: [] }] }),
      rec("b", [ev(K, "t/2.ts", { resolves: res }), ev("sync-sleep-added", "t/2.ts")], undefined, { files: [{ file: "t/2.ts", fixed: ["LOC-004"], introduced: ["SYNC-001"] }] }),
    ]);
    fs.writeFileSync(path.join(d, "skill-corrections.jsonl"), JSON.stringify({ timestamp: "x", skillArea: "assertion-strategy", file: "f", note: "token=abc123 was wrong, contact me@x.com" }) + "\nnot json\n");
    const r = aggregate({ root: d });
    expect(r.failureFixes[0]).toMatchObject({ entryId: "locator-not-found-action", count: 2, fixes: [{ key: K, count: 2 }] });
    expect(r.reviewer.fixed).toEqual({ "LOC-004": 2 });
    expect(r.reviewer.introduced).toEqual({ "SYNC-001": 1 });
    const loc = r.areas.find((a) => a.area === "locator-source-strategy")!;
    expect(loc.improvements).toBe(2);
    expect(Object.values(loc.weekly).reduce((s, n) => s + n, 0)).toBe(2);
    expect(r.areas.find((a) => a.area === "synchronization-strategy")!.regressions).toBe(1);
    expect(r.corrections[0].count).toBe(1);
    expect(JSON.stringify(r.corrections)).not.toContain("me@x.com");
    expect(r.areas.map((a) => a.area)).toEqual([...SKILL_AREAS]);
  });

  test("damaged records are skipped, config overrides apply, a bad config is an error", () => {
    const d = store([rec("a", [ev(K, "t/1.ts")])]);
    fs.writeFileSync(path.join(d, ".learnings/events/broken.json"), "{ not json");
    fs.writeFileSync(path.join(d, ".learnings/events/other-schema.json"), JSON.stringify({ schema: 9 }));
    expect(loadRecords(d)).toHaveLength(1);
    fs.writeFileSync(path.join(d, ".learnings/config.json"), JSON.stringify({ minEvents: 1, minFiles: 1, minAuthors: 1 }));
    expect(aggregate({ root: d }).candidates.map((c) => c.key)).toEqual([K]);
    fs.writeFileSync(path.join(d, ".learnings/config.json"), JSON.stringify({ minEvents: 0 }));
    expect(() => loadConfig(d)).toThrow(/minEvents/);
    fs.writeFileSync(path.join(d, ".learnings/config.json"), JSON.stringify({ include: ["("] }));
    expect(() => loadConfig(d)).toThrow(/regular expression/);
    fs.writeFileSync(path.join(d, ".learnings/config.json"), "nope");
    expect(() => loadConfig(d)).toThrow(/not valid JSON/);
  });

  test("the shipped config is valid", () => {
    expect(() => loadConfig(ROOT)).not.toThrow();
    expect(loadConfig(ROOT).minAuthors).toBeGreaterThanOrEqual(2);
  });
});

test.describe("approve and publish @meta", () => {
  const K = "locator-upgraded:css->role";
  const candidates = (d?: string) => store(["a", "b", "c"].map((a, i) => rec(a, [ev(K, `t/${i}.ts`)])));

  test("approval needs a name, a known key, evidence, and a pattern that can be published", () => {
    const d = candidates();
    expect(approve(d, "nonsense", "Raj").ok).toBe(false);
    expect(approve(d, K, "  ").message).toContain("--by");
    expect(approve(d, "locator-replaced:css", "Raj").message).toContain("never published"); // neutral kind
    expect(approve(d, "locator-upgraded:xpath->role", "Raj").message).toContain("no recorded edits");
    const ok = approve(d, K, "Raj");
    expect(ok.ok).toBe(true);
    expect(ok.pattern).toMatchObject({ type: "pattern", area: "locator-source-strategy", status: "approved", approvedBy: "Raj" });
    expect(ok.pattern!.evidence.authors).toBe(3);
    expect(path.basename(ok.file!)).toBe(patternFile(K));
    expect(approve(d, K, "Raj").message).toContain("already approved");
  });

  test("below the thresholds it refuses unless forced", () => {
    const d = store([rec("a", [ev(K, "t/1.ts")]), rec("b", [ev(K, "t/2.ts")])]);
    expect(approve(d, K, "Raj").message).toContain("below the thresholds");
    expect(approve(d, K, "Raj", { force: true }).ok).toBe(true);
  });

  test("an approved regression is published only as 'Avoid this', with the curated alternative", () => {
    const bad = "sync-sleep-added";
    const d = store(["a", "b", "c"].map((a, i) => rec(a, [ev(bad, `t/${i}.ts`, { after: "await page.waitForTimeout(5000)" })])));
    // a regression is not offered as a candidate, but a person may still approve it as an anti-pattern
    const r = approve(d, bad, "Raj");
    expect(r.ok, r.message).toBe(true);
    expect(r.pattern!.type).toBe("anti-pattern");
    expect(r.pattern!.guidance).toBe(KIND_BY_ID.get(bad as never)!.guidance);
    const md = expectedFiles(d).find((f) => f.file.includes("synchronization-strategy"))!.content;
    expect(md).toContain("## Avoid this");
    expect(md).not.toContain("## Do this");
    expect(md).toContain("**Instead:**");
  });

  test("retire withdraws an approved pattern or rejects a candidate for good", () => {
    const d = candidates();
    expect(approve(d, K, "Raj").ok).toBe(true);
    expect(retire(d, K, "Raj").ok).toBe(true);
    expect(aggregate({ root: d }).candidates).toEqual([]);
    expect(expectedFiles(d).find((f) => f.file.includes("locator-source-strategy"))!.content).toContain("No patterns approved yet");
    expect(approve(d, K, "Raj").message).toContain("retired");
    const d2 = candidates();
    expect(retire(d2, K, "Raj").ok).toBe(true); // reject without approving first
    expect(aggregate({ root: d2 }).candidates).toEqual([]);
  });

  test("keys are validated and file names are safe", () => {
    expect(validKey("locator-upgraded")).toBe(true);
    expect(validKey("locator-upgraded:css->role")).toBe(true);
    expect(validKey("../../etc/passwd")).toBe(false);
    expect(validKey("not-a-kind:x")).toBe(false);
    expect(patternFile("locator-upgraded:css->role")).toMatch(/^locator-upgraded-css-role-[0-9a-f]{6}\.json$/);
    expect(patternFile("locator-upgraded:css->role")).not.toBe(patternFile("locator-upgraded:css+role")); // punctuation-only differences do not collide
    expect(patternFile("../../x")).not.toContain("/");
  });

  test("publish is deterministic, covers every consuming area, and --check catches drift", () => {
    const d = candidates();
    approve(d, K, "Raj", { now: new Date("2026-10-05T00:00:00Z") });
    const a = expectedFiles(d), b = expectedFiles(d);
    expect(a).toEqual(b);
    const areas = new Set(KINDS.map((k) => k.area));
    expect(a.filter((f) => f.file.endsWith("learned-patterns.md"))).toHaveLength(areas.size);
    const loc = a.find((f) => f.file.includes("locator-source-strategy"))!.content;
    expect(loc).toContain(`Key: \`${K}\``);
    expect(loc).toContain("Approved by Raj on 2026-10-05");
    expect(loc).toContain("3 edits in 3 files by 3 engineers");
    const log = console.log, err = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      expect(publishMain(["--check"], d)).toBe(1); // nothing written yet
      expect(publishMain([], d)).toBe(0);
      expect(publishMain(["--check"], d)).toBe(0);
      const f = path.join(d, loc ? a.find((x) => x.file.includes("locator-source-strategy"))!.file : "");
      fs.appendFileSync(f, "\nhand edit\n");
      expect(publishMain(["--check"], d)).toBe(1);
      expect(publishMain(["--nope"], d)).toBe(2);
    } finally {
      console.log = log;
      console.error = err;
    }
  });

  test("the generated files shipped in the repo are current with .learnings/patterns", () => {
    for (const f of expectedFiles(ROOT)) {
      expect(fs.existsSync(path.join(ROOT, f.file)), `${f.file} missing: run npm run learn-publish`).toBe(true);
      expect(fs.readFileSync(path.join(ROOT, f.file), "utf-8"), `${f.file} is stale: run npm run learn-publish`).toBe(f.content);
    }
    expect(fs.readFileSync(path.join(ROOT, ".github/skills/fix-knowledge-base/references/edit-kinds.md"), "utf-8")).toBe(kindsMarkdown());
  });

  test("every edit kind belongs to a real skill area, and every consuming area's skill links its learned-patterns file", () => {
    for (const k of KINDS) expect(SKILL_AREAS as readonly string[], k.kind).toContain(k.area);
    for (const area of new Set(KINDS.map((k) => k.area))) {
      const body = fs.readFileSync(path.join(ROOT, ".github/skills", area, "SKILL.md"), "utf-8");
      expect(body, `${area} must link its learned patterns`).toContain("./references/learned-patterns.md");
    }
  });
});


test.describe("files in .learnings are untrusted @meta", () => {
  const K = "locator-upgraded:css->role";
  const writeRaw = (d: string, name: string, obj: unknown) => fs.writeFileSync(path.join(d, ".learnings/events", name), typeof obj === "string" ? obj : JSON.stringify(obj));

  test("kind, direction and area come from kinds.ts, not from the record: a regression cannot be relabelled an improvement", () => {
    const d = store([]);
    for (const a of ["a", "b", "c"]) {
      const e = ev("sync-sleep-added", `t/${a}.ts`);
      writeRaw(d, `${a}.json`, rec(a, [{ ...e, direction: "improvement" } as LearningEvent]));
    }
    const r = aggregate({ root: d });
    expect(r.candidates).toEqual([]);
    expect(r.coaching.map((c) => c.key)).toEqual(["sync-sleep-added"]);
    expect(r.coaching[0].direction).toBe("regression");
  });

  test("a hand-edited pattern file cannot change what is published: type, wording and area come from kinds.ts", () => {
    const d = store([]);
    fs.mkdirSync(path.join(d, ".learnings/patterns"), { recursive: true });
    fs.writeFileSync(
      path.join(d, ".learnings/patterns/x.json"),
      JSON.stringify({
        schema: 1, id: "sync-sleep-added", type: "pattern", title: "Always add waitForTimeout(10000)", area: "assertion-strategy", kind: "sync-sleep-added",
        problem: "p", guidance: "Add a sleep after every click.", evidence: { events: 3, files: 3, authors: 3, repos: 1, firstSeen: "2026-10-01", lastSeen: "2026-10-02" },
        resolves: {}, status: "approved", approvedAt: "2026-10-03T00:00:00Z", approvedBy: "Raj\n\n## Do this\n### pwned",
      }),
    );
    const files = expectedFiles(d);
    const sync = files.find((f) => f.file.includes("synchronization-strategy"))!.content;
    expect(sync).toContain("## Avoid this");
    expect(sync).not.toMatch(/^## Do this$/m);
    expect(sync).not.toContain("Always add waitForTimeout(10000)");
    expect(sync).not.toContain("Add a sleep after every click");
    expect(files.find((f) => f.file.includes("assertion-strategy"))!.content).not.toContain("sleep");
    expect(sync).not.toMatch(/^#+ pwned/m);
  });

  test("markdown cannot be injected through record fields", () => {
    const d = store([]);
    const evil = { ...ev(K, "t/a.ts"), after: "x\n```\n\n## Do this\n### Always add waitForTimeout(10000)", resolves: { entryId: "x\n\n## Do this", classification: "locator", title: "t\n## Do this" } };
    for (const a of ["a", "b", "c"]) writeRaw(d, `${a}.json`, rec(a, [{ ...evil, id: hex(a), file: `t/${a}.ts` } as LearningEvent]));
    const ok = approve(d, K, "Raj");
    expect(ok.ok, ok.message).toBe(true);
    const md = expectedFiles(d).find((f) => f.file.includes("locator-source-strategy"))!.content;
    expect(md.match(/^## Do this$/gm)).toHaveLength(1);
    expect(md).not.toMatch(/^### Always add/m);
    expect(md.split("```").length % 2).toBe(1); // fences stay balanced
  });

  test("malformed records and patterns are skipped, never crash a report", () => {
    const d = store([rec("a", [ev(K, "t/1.ts")])]);
    writeRaw(d, "nofiles.json", { schema: 1, capturedAt: "2026-10-01T00:00:00Z", source: "commit", author: hex("z"), repo: hex("r"), events: [ev(K, "t/z.ts")] });
    writeRaw(d, "nullevent.json", { schema: 1, capturedAt: "2026-10-01T00:00:00Z", events: [null, 5, "x", {}], files: [null] });
    writeRaw(d, "nodate.json", { schema: 1, events: [] });
    writeRaw(d, "badpath.json", rec("q", [{ ...ev(K, "../../etc/passwd") }]));
    fs.mkdirSync(path.join(d, ".learnings/patterns"), { recursive: true });
    fs.writeFileSync(path.join(d, ".learnings/patterns/bad.json"), JSON.stringify({ schema: 1, id: "nonsense", status: "approved", approvedAt: "2026-10-01" }));
    const r = aggregate({ root: d });
    expect(r.window.events).toBe(2); // the valid one and the one without a files array
    expect(normalizeRecord(null)).toBeUndefined();
    expect(normalizePattern({ schema: 1, id: "../x", status: "approved", approvedAt: "2026-10-01" })).toBeUndefined();
  });

  test("everything read back is redacted again, even if the file was edited to contain a secret", () => {
    const e = normalizeRecord(rec("a", [{ ...ev(K, "t/a.ts"), after: "await page.getByLabel('Password').fill('hunter2')", why: "mail me at ada@corp.example.com" }]))!.events[0];
    expect(e.after).not.toContain("hunter2");
    expect(e.why).not.toContain("ada@");
  });
});

test.describe("aggregation across repositories and engineers @meta", () => {
  const K = "locator-upgraded:css->role";
  test("the same edit to the same file by different engineers or in different repositories is counted separately", () => {
    const e = ev(K, "tests/example/login.spec.ts");
    const mk = (author: string, repo: string) => ({ ...rec(author, [{ ...e }]), repo: hex(repo) });
    const r = aggregate({ root: store([mk("a", "r1"), mk("b", "r2"), mk("c", "r3")]) });
    expect(r.window).toMatchObject({ events: 3, authors: 3, repos: 3 });
    expect(r.emerging[0].evidence).toMatchObject({ events: 3, files: 1, authors: 3, repos: 3 });
    expect(r.candidates).toEqual([]); // still one file: not a pattern
  });
  test("learn-approve reads the same extra event folders as learn-report (the CI data branch)", () => {
    const d = tmp("approve-extra");
    const extra = path.join(d, "learning-store/events");
    fs.mkdirSync(extra, { recursive: true });
    ["a", "b", "c"].forEach((a, i) => fs.writeFileSync(path.join(extra, `${a}.json`), JSON.stringify(rec(a, [ev(K, `t/${i}.ts`)]))));
    expect(approve(d, K, "Raj").ok).toBe(false);
    expect(approve(d, K, "Raj", { extraDirs: ["learning-store/events"] }).ok).toBe(true);
  });
  test("a branch that adds a debug sleep and removes it has no net edit", () => {
    const d = repo();
    put(d, "tests/a.spec.ts", OLD);
    const base = commit(d, "init");
    put(d, "tests/a.spec.ts", OLD.replace("3000", "9000"));
    commit(d, "debug");
    put(d, "tests/a.spec.ts", OLD);
    commit(d, "undo debug");
    expect(captureRange({ cwd: d }, `${base}..HEAD`)).toEqual([]);
  });
  test("records with reviewer changes only get distinct file names", () => {
    const base: CaptureRecord = { schema: 1, capturedAt: "2026-10-01T00:00:00Z", source: "staged", author: hex("a"), repo: hex("r"), events: [], files: [{ file: "tests/a.spec.ts", fixed: ["SYNC-001"], introduced: [] }] };
    const other: CaptureRecord = { ...base, files: [{ file: "tests/b.spec.ts", fixed: ["VER-001"], introduced: [] }] };
    expect(recordFileName(base)).not.toBe(recordFileName(other));
  });
});

test.describe("command-line input is not trusted @meta", () => {
  test("a git ref can never turn into an option", () => {
    expect(() => safeRef("--output=/tmp/x")).toThrow();
    expect(() => safeRef("-n")).toThrow();
    expect(() => safeRef("main..HEAD x")).toThrow();
    expect(safeRef("origin/main..HEAD")).toBe("origin/main..HEAD");
    const d = repo();
    put(d, "tests/a.spec.ts", OLD);
    commit(d, "init");
    const victim = path.join(d, "victim.txt");
    fs.writeFileSync(victim, "keep me");
    const err = console.error;
    console.error = () => {};
    try {
      expect(captureMain(["--commit", `--output=${victim}`], d)).toBe(2);
      expect(captureMain(["--range", `--output=${victim}`], d)).toBe(2);
    } finally {
      console.error = err;
    }
    expect(fs.readFileSync(victim, "utf-8")).toBe("keep me");
  });
  test("refs that look like shell are inert", () => {
    const d = repo();
    put(d, "tests/a.spec.ts", OLD);
    commit(d, "init");
    const err = console.error;
    console.error = () => {};
    try {
      expect(captureMain(["--commit", "HEAD;touch pwned"], d)).toBe(2);
      expect(captureMain(["--commit", "HEAD$(touch pwned)"], d)).toBe(2);
    } finally {
      console.error = err;
    }
    expect(fs.existsSync(path.join(d, "pwned"))).toBe(false);
  });
  test("lookup-fix survives words that are also JavaScript object keys", () => {
    expect(() => lookup("TypeError: x is not a constructor toString hasOwnProperty __proto__", { patterns: [] })).not.toThrow();
  });
});

test.describe("what a record may contain @meta", () => {
  test("no branch name; statements can be switched off entirely; the author hash is 12 hex characters", () => {
    const d = repo("a@example.com");
    put(d, "tests/a.spec.ts", OLD);
    commit(d, "init");
    git(d, "checkout", "-q", "-b", "feature/john.doe-fix-password=hunter2");
    put(d, "tests/a.spec.ts", NEW);
    const r = captureWorktree({ cwd: d });
    expect(JSON.stringify(r)).not.toContain("hunter2");
    expect(r.branch).toBeUndefined();
    expect(r.author).toMatch(/^[0-9a-f]{12}$/);
    fs.mkdirSync(path.join(d, ".learnings"), { recursive: true });
    fs.writeFileSync(path.join(d, ".learnings/config.json"), JSON.stringify({ storeStatements: false }));
    const bare = captureWorktree({ cwd: d });
    expect(bare.events.length).toBeGreaterThan(0);
    for (const e of bare.events) expect(e.before ?? e.after ?? e.target).toBeUndefined();
  });
  test("BAT_LEARN_SALT overrides the committed salt", () => {
    const d = tmp("salt");
    const prev = process.env.BAT_LEARN_SALT;
    process.env.BAT_LEARN_SALT = "private";
    try {
      expect(loadConfig(d).salt).toBe("private");
    } finally {
      if (prev === undefined) delete process.env.BAT_LEARN_SALT; else process.env.BAT_LEARN_SALT = prev;
    }
  });
  test("publish --check treats a Windows checkout (CRLF) as current", () => {
    const d = tmp("crlf");
    const log = console.log;
    console.log = () => {};
    try {
      expect(publishMain([], d)).toBe(0);
      for (const f of expectedFiles(d)) {
        const p = path.join(d, f.file);
        fs.writeFileSync(p, fs.readFileSync(p, "utf-8").replace(/\n/g, "\r\n"));
      }
      expect(publishMain(["--check"], d)).toBe(0);
    } finally {
      console.log = log;
    }
  });
  test(".gitattributes keeps the hook and the generated files on LF", () => {
    const body = fs.readFileSync(path.join(ROOT, ".gitattributes"), "utf-8");
    expect(body).toContain(".githooks/* text eol=lf");
    expect(body).toContain("references/*.md text eol=lf");
  });
});

test.describe("lookup-fix @meta", () => {
  const sleepPattern: Pattern = {
    schema: 1, id: "sync-sleep-replaced:waitForResponse", type: "pattern", title: "Replace a hard sleep with a condition", area: "synchronization-strategy", kind: "sync-sleep-replaced", subkind: "waitForResponse",
    problem: "A waitForTimeout() was replaced by a wait for the response it stood in for.", guidance: "Wait for the response or the visible result, never for a duration.",
    evidence: { events: 4, files: 3, authors: 3, repos: 1, firstSeen: "2026-10-01", lastSeen: "2026-10-05" }, resolves: { "locator-not-found-action": 3 }, status: "approved", approvedAt: "2026-10-06T00:00:00Z", approvedBy: "Raj",
  };

  test("a pasted error message ranks its catalog entry first", () => {
    const hits = lookup("Error: locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Save' })", { patterns: [] });
    expect(hits[0].source).toBe("catalog");
    expect(hits[0].id).toBe("locator-not-found-action");
    expect(hits[0].why.join(" ")).toContain("matches this catalog entry");
  });

  test("plain words find the learned pattern, and learned fixes are attached to the catalog entry they resolved", () => {
    const hits = lookup("hard sleep delay instead of waiting for the response", { patterns: [sleepPattern] });
    expect(hits.some((h) => h.id === sleepPattern.id)).toBe(true);
    const cat = lookup("Timeout waiting for getByRole('button', { name: 'Save' })", { patterns: [sleepPattern] }).find((h) => h.id === "locator-not-found-action")!;
    expect(cat.learned).toEqual([{ key: sleepPattern.id, count: 3 }]);
    // learned patterns that resolved the failing entry surface next to it
    const withLink = lookup("Error: locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Save' })", { patterns: [sleepPattern], top: 5 });
    expect(withLink.some((h) => h.id === sleepPattern.id)).toBe(true);
  });

  test("--area filters, retired patterns are never returned, empty and unmatched queries are empty", () => {
    expect(lookup("wait for the response", { patterns: [sleepPattern], area: "assertion-strategy" }).every((h) => h.area === "assertion-strategy")).toBe(true);
    expect(lookup("replace hard sleep", { patterns: [{ ...sleepPattern, status: "retired" }] }).some((h) => h.source === "pattern")).toBe(false);
    expect(lookup("", { patterns: [] })).toEqual([]);
    expect(lookup("zzzzqqqq xylophone", { patterns: [] })).toEqual([]);
  });

  test("results are deterministic and respect --top", () => {
    const a = lookup("locator not found timeout", { patterns: [sleepPattern], top: 3 });
    expect(a).toHaveLength(3);
    expect(lookup("locator not found timeout", { patterns: [sleepPattern], top: 3 })).toEqual(a);
  });
});
