import ts from "typescript";
import { Finding, RuleInfo, Severity } from "./types";

/**
 * The "intelligent script reviewer", deterministic half. It reads a
 * Playwright TypeScript file as a syntax tree (not with regexes over text, so
 * it understands "this call is awaited", "this is the last statement of this
 * test", "this string is the argument of fill()") and reports problems in the
 * four areas teams hit most: synchronization, test data, locators and missing
 * verifications - plus hygiene and secrets.
 *
 * It is a reviewer, not a fixer: every finding carries a specific suggestion
 * but nothing is rewritten. The script-review skill
 * (.github/skills/script-review/SKILL.md) layers the judgement a syntax tree
 * cannot have on top - for example comparing the test against the manual
 * test case's expected results.
 *
 * A finding can be suppressed on its own line or the line above with
 *   // review-ignore RULE-ID: <reason>
 * The reason is required; a suppression without one is ignored, so every
 * exception is explained where a reviewer will see it.
 */

export const RULES: RuleInfo[] = [
  // --- synchronization -----------------------------------------------------
  { id: "SYNC-001", category: "synchronization", severity: "error", title: "Hard sleep (waitForTimeout)", why: "A fixed sleep is either too short (flaky) or too long (slow) and never proves the app is ready." },
  { id: "SYNC-002", category: "synchronization", severity: "warning", title: "networkidle wait", why: "networkidle never settles on apps with polling, websockets or analytics, and says nothing about what the user can see." },
  { id: "SYNC-003", category: "synchronization", severity: "warning", title: "Legacy waitForSelector / waitForNavigation", why: "Deprecated, element-handle based waits; locators and web-first assertions re-resolve and retry." },
  { id: "SYNC-004", category: "synchronization", severity: "warning", title: "Non-retrying read inside expect()", why: "expect(await x.isVisible()) reads the state once, immediately, and never retries - the classic source of intermittent failures." },
  { id: "SYNC-005", category: "synchronization", severity: "warning", title: "Control flow on a non-waiting check", why: "if (await x.isVisible()) decides at one instant; whether the element is already there is a race." },
  { id: "SYNC-006", category: "synchronization", severity: "error", title: "Event/response wait registered after the trigger", why: "If the response or popup arrives before the wait starts, the wait times out even though the app behaved correctly." },
  { id: "SYNC-007", category: "synchronization", severity: "info", title: "Very long explicit timeout", why: "A timeout of a minute or more on a single step usually hides a slow screen or a wrong locator." },
  { id: "SYNC-008", category: "synchronization", severity: "warning", title: "Step triggers a result but the next step does not verify it", why: "Saving, submitting, searching or logging in changes the page asynchronously; acting again without checking the outcome builds on an unknown state." },
  { id: "SYNC-009", category: "synchronization", severity: "warning", title: "force: true", why: "force skips Playwright's actionability checks (visible, enabled, not covered) - it turns a real readiness problem into a silent one." },
  // --- verification --------------------------------------------------------
  { id: "VER-001", category: "verification", severity: "error", title: "Test has no assertion", why: "A test that cannot fail proves nothing. (Reported as a warning instead when the test calls page-object helpers or functions whose bodies the reviewer cannot see: they may assert inside.)" },
  { id: "VER-002", category: "verification", severity: "warning", title: "Test ends on an action", why: "The last thing the test does is never checked, so the outcome the manual case describes is not verified." },
  { id: "VER-003", category: "verification", severity: "warning", title: "Only trivial assertions", why: "toBeTruthy/toBeDefined on a value, or expect(true), cannot detect most real defects." },
  { id: "VER-004", category: "verification", severity: "error", title: "Unawaited web-first assertion", why: "Without await the assertion is never waited for; the test can finish (and pass) before it is evaluated." },
  { id: "VER-005", category: "verification", severity: "warning", title: "Only 'nothing is shown' is asserted", why: "Absence of an error is not presence of success; pair it with a positive assertion of the real outcome." },
  // --- test data -----------------------------------------------------------
  { id: "DATA-001", category: "test-data", severity: "error", title: "Hardcoded credential or secret", why: "Secrets in test code end up in source control, logs and traces." },
  { id: "DATA-002", category: "test-data", severity: "warning", title: "Placeholder test data", why: "A REPLACE_/TBD/CHANGEME value means the data was never supplied; the test cannot run meaningfully." },
  { id: "DATA-003", category: "test-data", severity: "warning", title: "Required data read with a non-null assertion", why: "process.env.X! hides a missing variable until it crashes deep in a step with an unhelpful message." },
  { id: "DATA-004", category: "test-data", severity: "warning", title: "Hardcoded absolute URL", why: "A fixed host ties the test to one environment; use baseURL or configuration." },
  { id: "DATA-005", category: "test-data", severity: "info", title: "fill() with an empty literal", why: "Either data is missing or the intent is to clear the field." },
  // --- locators ------------------------------------------------------------
  { id: "LOC-001", category: "locator", severity: "warning", title: "XPath selector", why: "XPath couples the test to document structure; role, label and test-id locators survive layout changes." },
  { id: "LOC-002", category: "locator", severity: "warning", title: "Positional or deeply nested selector", why: "nth-child and long descendant chains break on any markup change." },
  { id: "LOC-003", category: "locator", severity: "warning", title: "Selector looks auto-generated", why: "Hashed class names and numeric ids change on every build." },
  { id: "LOC-004", category: "locator", severity: "info", title: "first()/last()/nth() on an unscoped locator", why: "Picking by position depends on DOM order and silences strict-mode ambiguity warnings." },
  { id: "LOC-005", category: "locator", severity: "warning", title: "Element handle API ($, $$)", why: "Handles go stale when the page re-renders; locators re-resolve on every use." },
  { id: "LOC-006", category: "locator", severity: "info", title: "Legacy text=/css= selector engine string", why: "getByText/getByRole express intent and give better error messages." },
  // --- hygiene / security --------------------------------------------------
  { id: "HYG-001", category: "hygiene", severity: "error", title: ".only left in", why: "A committed .only silently skips every other test." },
  { id: "HYG-002", category: "hygiene", severity: "error", title: "page.pause() left in", why: "pause() blocks forever in CI." },
  { id: "HYG-003", category: "hygiene", severity: "warning", title: "console.log in test code", why: "Debug output; use test.step() or annotations for information that belongs in the report." },
  { id: "HYG-004", category: "hygiene", severity: "warning", title: "Test skipped without a reason", why: "A skipped test with no explanation is lost coverage nobody remembers." },
  { id: "HYG-005", category: "hygiene", severity: "warning", title: "Swallowed failure (empty catch / .catch(() => {}))", why: "Hides the failure the test exists to find." },
  { id: "SEC-001", category: "security", severity: "error", title: "Secret-shaped literal", why: "Looks like an API key, token or private key committed to the repo." },
];

const RULE = new Map(RULES.map((r) => [r.id, r]));

const ACTION_METHODS = new Set([
  "click", "dblclick", "fill", "press", "type", "check", "uncheck", "selectOption", "setInputFiles", "tap", "dragTo", "pressSequentially",
]);
const NON_RETRYING_READS: Record<string, string> = {
  isVisible: "await expect(locator).toBeVisible()",
  isHidden: "await expect(locator).toBeHidden()",
  isEnabled: "await expect(locator).toBeEnabled()",
  isDisabled: "await expect(locator).toBeDisabled()",
  isChecked: "await expect(locator).toBeChecked()",
  textContent: "await expect(locator).toHaveText(...) or toContainText(...)",
  innerText: "await expect(locator).toHaveText(...) or toContainText(...)",
  inputValue: "await expect(locator).toHaveValue(...)",
  count: "await expect(locator).toHaveCount(n)",
  getAttribute: "await expect(locator).toHaveAttribute(name, value)",
  innerHTML: "await expect(locator).toContainText(...) or a role/label assertion",
};
const WEB_FIRST_MATCHERS = new Set([
  "toBeVisible", "toBeHidden", "toBeEnabled", "toBeDisabled", "toBeChecked", "toBeEditable", "toBeEmpty", "toBeFocused", "toBeAttached",
  "toBeInViewport", "toHaveText", "toContainText", "toHaveValue", "toHaveValues", "toHaveCount", "toHaveURL", "toHaveTitle", "toHaveAttribute",
  "toHaveClass", "toContainClass", "toHaveCSS", "toHaveId", "toHaveJSProperty", "toHaveAccessibleName", "toHaveAccessibleDescription", "toHaveRole",
  "toHaveScreenshot", "toMatchAriaSnapshot",
]);
const TRIVIAL_MATCHERS = new Set(["toBeTruthy", "toBeFalsy", "toBeDefined", "toBeUndefined", "toBeNull"]);
// Whole words only (so "Address line 1" is not "add" and "Payment method" is not "pay"); camelCase keys such as
// saveButton are split into words first, see words().
const TRIGGER_TEXT = /\b(submit|save|sign ?in|log ?in|search|next|continue|apply|confirm|create|delete|remove|add|checkout|pay|send|register|update|place order)\b/i;
const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
// Receivers that set data up or talk to a service rather than drive the UI.
const DATA_SETUP_RECEIVER = /(^|\.)(api|request|apiClient|client|db|http|axios|fetch|supertest|fixtures?|seed|data|testData|service|repo|repository|factory|backend|mock)\b|request|[a-z]Api\b/i;
const TRIGGER_METHOD = /^(submit|save|login|logIn|signIn|signin|search|checkout|confirm|create|delete|remove|apply|pay|send|register|update|place)/;
// Names that mean "this helper makes assertions". `check(?!out)` so checkout() (a UI trigger) is not
// one, and Playwright's own locator.check()/uncheck() (actions) are excluded in isAssertionCall().
const ASSERTION_METHOD = /^(expect|verify|assert|should|ensure|validate|check(?!out))/i;
export const SECRET_NAME = /(password|passwd|pwd|secret|token|api[-_]?key|apikey)/i;
// What a field/label must look like for a literal typed into it to be a credential: whole words, so
// "Token amount", "Search tokens" or "Secret santa" are not.
export const SECRET_FIELD = /\b(password|passwd|pwd|passcode|secret|api[-_ ]?key|(access|auth|api|bearer|session|refresh)[-_ ]?token)\b/i;
// A string that is a selector, label or sentence rather than a secret value.
const NOT_A_VALUE = /^([#.\[]|\/\/|[a-z-]+=|data-)|\s{1,}[a-z]+\s/i;
// Variable names that hold a locator, label or message about a secret, not the secret.
const LABEL_NAME = /(input|field|selector|locator|label|hint|text|message|msg|error|placeholder|title|button|btn|link|url|path|heading|header|testid|name|description|rule|policy|prompt|caption)s?$/i;
export const SECRET_SHAPE =
  /AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PLACEHOLDER = /REPLACE_|\bTBD\b|CHANGEME|FIXME|<your[ -]|\bxxx+\b/i;
const SELECTOR_METHODS = new Set(["locator", "waitForSelector", "$", "$$", "$eval", "$$eval"]);

interface Ctx {
  sf: ts.SourceFile;
  file: string;
  out: Finding[];
}

function report(ctx: Ctx, ruleId: string, node: ts.Node, message: string, suggestion: string, severity?: Severity): void {
  const rule = RULE.get(ruleId)!;
  const start = node.getStart(ctx.sf);
  const { line, character } = ctx.sf.getLineAndCharacterOfPosition(start);
  ctx.out.push({
    ruleId,
    category: rule.category,
    severity: severity ?? rule.severity,
    file: ctx.file,
    line: line + 1,
    column: character + 1,
    message,
    suggestion,
    snippet: node.getText(ctx.sf).split("\n")[0].trim().slice(0, 120),
  });
}

// --- small AST helpers -------------------------------------------------------

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression;
  return e;
}

function methodName(call: ts.CallExpression): string | undefined {
  const e = call.expression;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isIdentifier(e)) return e.text;
  return undefined;
}

function receiverText(call: ts.CallExpression, sf: ts.SourceFile): string {
  const e = call.expression;
  return ts.isPropertyAccessExpression(e) ? e.expression.getText(sf) : "";
}

function stringValue(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function isFunctionLike(n: ts.Node): n is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(n) || ts.isFunctionExpression(n);
}

/** The call an awaited statement makes: `await x.y()` or `const r = await x.y()`. */
function awaitedCall(stmt: ts.Statement): ts.CallExpression | undefined {
  let expr: ts.Expression | undefined;
  if (ts.isExpressionStatement(stmt)) expr = stmt.expression;
  else if (ts.isVariableStatement(stmt)) expr = stmt.declarationList.declarations[0]?.initializer;
  if (!expr) return undefined;
  expr = unwrap(expr);
  if (!ts.isAwaitExpression(expr)) return undefined;
  const inner = unwrap(expr.expression);
  return ts.isCallExpression(inner) ? inner : undefined;
}

function isAssertionCall(call: ts.CallExpression): boolean {
  const e = call.expression;
  if (ts.isIdentifier(e) && e.text === "expect") return true;
  if (ts.isPropertyAccessExpression(e)) {
    // expect.soft(...), expect.poll(...)
    if (ts.isIdentifier(e.expression) && e.expression.text === "expect") return true;
    if (ASSERTION_METHOD.test(e.name.text) && !ACTION_METHODS.has(e.name.text)) return true;
  }
  if (ts.isIdentifier(e) && ASSERTION_METHOD.test(e.text) && !ACTION_METHODS.has(e.text)) return true;
  return false;
}

function containsAssertion(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n) && isAssertionCall(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function isActionCall(call: ts.CallExpression): boolean {
  const m = methodName(call);
  // act(key, action, value?) is this scaffold's BasePage action method.
  return !!m && (ACTION_METHODS.has(m) || (m === "act" && ts.isPropertyAccessExpression(call.expression)));
}

function isTriggerCall(call: ts.CallExpression, sf: ts.SourceFile): boolean {
  const m = methodName(call);
  if (!m) return false;
  if (m === "press" && /Enter/.test(call.arguments[0]?.getText(sf) ?? "")) return true;
  if (m === "click" || m === "dblclick") return TRIGGER_TEXT.test(words(receiverText(call, sf)));
  if (m === "act" && ts.isPropertyAccessExpression(call.expression)) {
    const key = stringValue(call.arguments[0]) ?? "";
    const action = stringValue(call.arguments[1]) ?? "";
    return /^(click|dblclick|press)$/.test(action) && TRIGGER_TEXT.test(words(key));
  }
  // Page Object methods: loginPage.submit(), orders.save() - but not API/data-setup helpers.
  if (DATA_SETUP_RECEIVER.test(receiverText(call, sf))) return false;
  return !ACTION_METHODS.has(m) && TRIGGER_METHOD.test(m) && ts.isPropertyAccessExpression(call.expression);
}

function triggerText(call: ts.CallExpression, sf: ts.SourceFile): string {
  const key = methodName(call) === "act" ? (stringValue(call.arguments[0]) ?? "") : "";
  return words(`${methodName(call)} ${key} ${receiverText(call, sf)}`);
}

function suggestVerification(text: string): string {
  const t = text.toLowerCase();
  if (/log ?in|sign ?in/.test(t)) return "the post-login state, e.g. await expect(page).toHaveURL(...) or a landmark (heading, nav) toBeVisible()";
  if (/delete|remove/.test(t)) return "that the item is gone (toHaveCount(0) or toBeHidden()) and any confirmation message";
  if (/search/.test(t)) return "the results, e.g. toHaveCount(n) or the first result's text";
  if (/save|update|create|add|register/.test(t)) return "the success message/toast or the saved item appearing, e.g. toContainText(...) / toBeVisible()";
  if (/pay|checkout|confirm|submit|send|place/.test(t)) return "the confirmation page or message (and its reference number, if the manual case names one)";
  return "the visible outcome the manual expected result describes (heading, message, URL or row)";
}

function bodyOf(call: ts.CallExpression): ts.Block | undefined {
  const fn = [...call.arguments].reverse().find(isFunctionLike);
  return fn && ts.isBlock(fn.body) ? fn.body : undefined;
}

function isTestDeclaration(call: ts.CallExpression, sf: ts.SourceFile): boolean {
  const callee = call.expression.getText(sf);
  if (!/^(test|it)(\.(only|skip|fixme|fail))?$/.test(callee)) return false;
  return call.arguments.length >= 2 && isFunctionLike(call.arguments[call.arguments.length - 1]);
}

// --- rules over every node ---------------------------------------------------

function checkNode(ctx: Ctx, node: ts.Node): void {
  const { sf } = ctx;

  if (ts.isCallExpression(node)) {
    const m = methodName(node);
    const recv = receiverText(node, sf);

    if (m === "waitForTimeout") {
      report(ctx, "SYNC-001", node, "Fixed sleep with waitForTimeout().",
        "Wait for the thing you actually need: await expect(locator).toBeVisible() (or toHaveText/toBeEnabled), or locator.waitFor() for an element state. If you are waiting for a network result, assert what the user sees once it arrives.");
    }
    if (m === "waitForLoadState" && /networkidle/.test(node.arguments[0]?.getText(sf) ?? "")) {
      report(ctx, "SYNC-002", node, "waitForLoadState('networkidle').",
        "Assert a landmark that proves the page is ready: await expect(page.getByRole('heading', { name: '...' })).toBeVisible().");
    }
    if (m === "waitForSelector" || m === "waitForNavigation") {
      report(ctx, "SYNC-003", node, `${m}() is a legacy wait.`,
        m === "waitForSelector"
          ? "Use locator.waitFor() or, better, a web-first assertion: await expect(page.locator(...)).toBeVisible()."
          : "Assert the destination instead: await expect(page).toHaveURL(...), or page.waitForURL(...) registered before the click.");
    }

    // SYNC-004: expect(await x.isVisible())
    if (ts.isIdentifier(node.expression) && node.expression.text === "expect" && node.arguments.length > 0) {
      const arg = unwrap(node.arguments[0]);
      if (ts.isAwaitExpression(arg)) {
        const inner = unwrap(arg.expression);
        if (ts.isCallExpression(inner)) {
          const read = methodName(inner);
          if (read && NON_RETRYING_READS[read]) {
            report(ctx, "SYNC-004", node, `expect(await ...${read}()) reads once and never retries.`, `Use the retrying form: ${NON_RETRYING_READS[read]}.`);
          }
        }
      }
    }

    // SYNC-007: timeout: 60000+
    // (handled on property assignments below)

    // LOC rules on selector-taking calls
    if (m && SELECTOR_METHODS.has(m)) {
      const sel = stringValue(node.arguments[0]);
      if ((m === "$" || m === "$$") && ts.isPropertyAccessExpression(node.expression)) {
        report(ctx, "LOC-005", node, `${recv}.${m}() returns an element handle.`,
          "Use a locator: page.getByRole(...) / page.locator(...). Locators re-resolve on every action, handles go stale after a re-render.");
      }
      if (sel !== undefined) checkSelector(ctx, node, sel);
    }
    if (m === "first" || m === "last" || m === "nth") {
      const r = node.expression as ts.PropertyAccessExpression;
      const base = ts.isPropertyAccessExpression(r) ? r.expression.getText(sf) : "";
      const hops = (base.match(/\.(locator|getBy[A-Za-z]+|frameLocator)\(/g) ?? []).length;
      // One hop from page = unscoped; a chain (page.getByRole('table').getByRole('row')) or a filter() is scoped.
      if (/^page\.(locator|getBy)/.test(base) && hops <= 1 && !/\.filter\(/.test(base)) {
        report(ctx, "LOC-004", node, `${m}() picks by position on an unscoped locator.`,
          "Scope the locator (a parent region or row, filter({ hasText }), or add the accessible name) so it identifies one element by meaning. Keep first()/nth() only if the manual case literally means 'the first one', with a comment.");
      }
    }

    // HYG
    if (m === "pause" && /^page$|\bpage\b/.test(recv)) {
      report(ctx, "HYG-002", node, "page.pause() left in the test.", "Remove it. Use --debug or the trace viewer locally instead.");
    }
    if (m === "log" && recv === "console") {
      report(ctx, "HYG-003", node, "console.log in test code.", "Remove it, or use test.step('...') / testInfo.annotations so the information appears in the report.");
    }
    if (m === "catch" && node.arguments.length === 1) {
      const handler = node.arguments[0];
      if (isFunctionLike(handler) && ts.isBlock(handler.body) && handler.body.statements.length === 0 && !hasComment(handler.body, sf)) {
        report(ctx, "HYG-005", node, "Failure swallowed by .catch(() => {}).",
          "Let it fail. If the element is genuinely optional, handle that explicitly and say why (a comment), instead of hiding every error.");
      }
    }
    if (m === "only" && /^(test|it)(\.describe(\.(parallel|serial))?)?$|^describe$/.test(recv)) {
      report(ctx, "HYG-001", node, `${recv}.only() will skip every other test.`, "Remove .only before committing.");
    }
    if (m === "skip" && /^(test|it)$/.test(recv) && node.arguments.length >= 2 && stringValue(node.arguments[0]) !== undefined && isFunctionLike(node.arguments[node.arguments.length - 1])) {
      report(ctx, "HYG-004", node, "Test is skipped with test.skip(title, fn) and no recorded reason.",
        "Either fix and re-enable it, or use test.fixme(title, fn) / test.skip(condition, 'reason: ticket or cause') so the reason is visible in the report.");
    }

    // DATA: goto with absolute URL
    if (m === "goto" || m === "waitForURL") {
      const url = stringValue(node.arguments[0]);
      if (url && /^https?:\/\//i.test(url)) {
        report(ctx, "DATA-004", node, `Hardcoded absolute URL "${url}".`,
          "Use a relative path with baseURL ( await page.goto('/path') ) and set baseURL via BAT_APP_BASE_URL / the config, so the same test runs in every environment.");
      }
    }
    // DATA-001: fill(secret literal)
    if (m === "fill" || m === "type" || m === "pressSequentially") {
      const lit = stringValue(node.arguments[0]);
      if (lit !== undefined && lit.length > 0 && SECRET_FIELD.test(words(recv)) && !NOT_A_VALUE.test(lit) && !PLACEHOLDER.test(lit)) {
        report(ctx, "DATA-001", node, "A password/secret literal is typed into a field.",
          "Read it from the environment or a secrets store (process.env.X via a helper that fails clearly when unset) - never from the source file.");
      }
      if (m === "fill" && lit === "") {
        report(ctx, "DATA-005", node, "fill() with an empty string.",
          "If the intent is to empty the field use locator.clear(); if data is missing, supply it.");
      }
    }
    // act("password", "fill", "hunter2") - the scaffold's BasePage.act()
    if (m === "act" && ts.isPropertyAccessExpression(node.expression)) {
      const key = stringValue(node.arguments[0]) ?? "";
      const lit = stringValue(node.arguments[2]);
      if (/^(fill|type)$/.test(stringValue(node.arguments[1]) ?? "") && lit && SECRET_FIELD.test(words(key)) && !PLACEHOLDER.test(lit)) {
        report(ctx, "DATA-001", node, "A password/secret literal is typed into a field via act().",
          "Read it from the environment or a secrets store (process.env.X via a helper that fails clearly when unset) - never from the source file.");
      }
    }
    // VER-004: unawaited web-first matcher is checked at statement level below.

    // SYNC-009 force: true
    for (const arg of node.arguments) {
      if (ts.isObjectLiteralExpression(arg)) {
        for (const p of arg.properties) {
          if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
            if (p.name.text === "force" && p.initializer.kind === ts.SyntaxKind.TrueKeyword) {
              report(ctx, "SYNC-009", p, "{ force: true } bypasses actionability checks.",
                "Find out why the element is not actionable (covered, disabled, animating) and wait for that condition with an assertion instead.");
            }
            if (p.name.text === "waitUntil" && /networkidle/.test(p.initializer.getText(sf))) {
              report(ctx, "SYNC-002", p, "waitUntil: 'networkidle'.", "Use 'domcontentloaded' (or the default) and assert a landmark element is visible.");
            }
            if (p.name.text === "timeout" && ts.isNumericLiteral(p.initializer) && Number(p.initializer.text.replace(/_/g, "")) >= 60000) {
              report(ctx, "SYNC-007", p, `Explicit timeout of ${p.initializer.text} ms.`,
                "Find out why this step is slow (wrong locator? slow environment?) rather than waiting longer; if it is genuinely slow, document why in a comment.");
            }
          }
        }
      }
    }
  }

  // DATA / SEC on string literals
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    if (SECRET_SHAPE.test(node.text)) {
      report(ctx, "SEC-001", node, "String literal looks like a real secret (key, token or private key).",
        "Remove it from source, rotate it if it was real, and load it from a secret store or environment variable.");
    }
    // getByPlaceholder('xxx-xxx-xxxx') names a field by its hint text; that is not test data.
    const locatorArg = ts.isCallExpression(node.parent) && /^getBy[A-Z]/.test(methodName(node.parent) ?? "");
    if (PLACEHOLDER.test(node.text) && !ts.isImportDeclaration(node.parent) && !locatorArg) {
      report(ctx, "DATA-002", node, `Placeholder value "${node.text.slice(0, 40)}".`,
        "Supply the real test data (environment variable, fixture or data table). Until then, make the test fail early with a readable message or test.skip() with a reason rather than running on a placeholder.");
    }
  }

  // DATA-001 on declarations: const password = "hunter2"
  if (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) {
    const name = node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : undefined;
    const init = node.initializer;
    const lit = stringValue(init && unwrap(init));
    if (name && lit !== undefined && lit.length > 0 && SECRET_NAME.test(name) && !LABEL_NAME.test(name) && !NOT_A_VALUE.test(lit) && !PLACEHOLDER.test(lit) && !/^(true|false)$/.test(lit)) {
      report(ctx, "DATA-001", node, `"${name}" is assigned a literal value.`,
        "Do not keep credentials or tokens in the source. Read them from process.env (through a helper that throws a clear error when missing) or a secrets store.");
    }
  }

  // DATA-003: process.env.X!
  if (ts.isNonNullExpression(node)) {
    const inner = node.expression;
    if (ts.isPropertyAccessExpression(inner) && inner.expression.getText(sf) === "process.env") {
      report(ctx, "DATA-003", node, `process.env.${inner.name.text}! asserts the variable exists without checking.`,
        `Guard it: test.skip(!process.env.${inner.name.text}, '${inner.name.text} is not set') or a helper that throws "${inner.name.text} is required". A missing value then fails (or skips) with a clear message instead of a crash inside a step.`);
    }
  }

  // HYG-005: empty catch block
  if (ts.isCatchClause(node) && node.block.statements.length === 0 && !hasComment(node.block, sf)) {
    report(ctx, "HYG-005", node, "Empty catch block swallows the failure.", "Let the error propagate, or handle it explicitly and say why.");
  }

  // HYG-001 / test.only as a bare property reference handled via call; also describe.only
  // SYNC-005: if (await x.isVisible())
  if (ts.isIfStatement(node) || ts.isConditionalExpression(node)) {
    const cond = ts.isIfStatement(node) ? node.expression : node.condition;
    const aw = findAwaitedRead(cond);
    if (aw) {
      report(ctx, "SYNC-005", node, `Branching on await ...${aw}() decides at a single instant.`,
        "Make the state deterministic (set it up in the test, or assert it with a retrying matcher). If the element really is optional (cookie banner), wait for it explicitly with a short locator.waitFor({ timeout }) inside try/catch and comment why.");
    }
  }
}

/** A comment inside an otherwise empty block is the explanation the suggestion asks for. */
function hasComment(block: ts.Block, sf: ts.SourceFile): boolean {
  return /\/\/|\/\*/.test(block.getText(sf));
}

function findAwaitedRead(cond: ts.Expression): string | undefined {
  let found: string | undefined;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isAwaitExpression(n)) {
      const inner = unwrap(n.expression);
      if (ts.isCallExpression(inner)) {
        const m = methodName(inner);
        if (m && NON_RETRYING_READS[m]) {
          found = m;
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(cond);
  return found;
}

function checkSelector(ctx: Ctx, node: ts.Node, sel: string): void {
  const s = sel.trim();
  if (/^(text|css|id|data-testid)=/i.test(s) && !/^xpath=/i.test(s)) {
    report(ctx, "LOC-006", node, `Legacy selector engine string "${s.slice(0, 40)}".`, "Use getByText / getByRole / getByTestId, which state intent and fail with clearer messages.");
  }
  const isXPath = /^(xpath=|\/\/|\(\/\/|\.\.\/)/i.test(s);
  if (isXPath) {
    report(ctx, "LOC-001", node, `XPath selector "${s.slice(0, 60)}".`,
      "Prefer page.getByRole(role, { name }), getByLabel(), or getByTestId(). If none exists, add a data-testid to the app, or use a short CSS selector scoped to a stable container.");
    if (/\[\d+\]/.test(s)) {
      report(ctx, "LOC-002", node, "XPath with a positional index.", "Select by content or attribute instead of position.");
    }
    return;
  }
  if (/:nth-(child|of-type)|:first-child|:last-child|:nth\(/.test(s)) {
    report(ctx, "LOC-002", node, `Positional selector "${s.slice(0, 60)}".`, "Select by role/name, label, test-id or content; position changes whenever markup does.");
  } else if (
    !/^(text|role|id|data-testid|internal:)/i.test(s) &&
    ((s.replace(/:(has-text|text|has|not|is|where)\([^)]*\)/g, ":x").replace(/\[[^\]]*\]/g, "[]").replace(/(["']).*?\1/g, '""').match(/\s>\s|\s+(?=[.#\w\[])/g)) ?? []).length >= 4
  ) {
    report(ctx, "LOC-002", node, `Deeply nested selector "${s.slice(0, 60)}".`, "Locate a stable ancestor (role/label/test-id) and chain a short child locator from it.");
  }
  if (/[#.](css|sc|jss|emotion|svelte)-[a-z0-9]{4,}|[#.][A-Za-z]+_[A-Za-z0-9_-]{5,}__?[A-Za-z0-9-]{4,}|[#.][A-Za-z-]*\d{5,}|[#.][A-Za-z]*[a-f0-9]{8,}\b/.test(s)) {
    report(ctx, "LOC-003", node, `Selector "${s.slice(0, 60)}" looks auto-generated.`, "Generated class names and numeric ids change per build. Ask for a data-testid, or use role/label/text locators.");
  }
}

// --- rules over each test body -----------------------------------------------

function checkStatements(ctx: Ctx, statements: readonly ts.Statement[]): void {
  const { sf } = ctx;

  statements.forEach((stmt, i) => {
    // VER-004: unawaited web-first assertion
    if (ts.isExpressionStatement(stmt)) {
      const expr = unwrap(stmt.expression);
      if (ts.isCallExpression(expr)) {
        const m = methodName(expr);
        const recvText = receiverText(expr, sf);
        if (m && WEB_FIRST_MATCHERS.has(m) && /^expect(\.soft)?\(/.test(recvText.replace(/\.not$/, ""))) {
          report(ctx, "VER-004", stmt, `expect(...).${m}() is not awaited.`, "Add await. Web-first assertions return a promise; without await the test can end before it is evaluated and pass without checking anything.");
        }
        // SYNC-006 handled in sequence checks.
      }
    }

    const call = awaitedCall(stmt);
    const next = statements[i + 1];

    // SYNC-006: action then a bare awaited waitForResponse/Request/Event
    if (next) {
      const nextCall = awaitedCall(next);
      const nm = nextCall ? methodName(nextCall) : undefined;
      if (call && isActionCall(call) && nm && /^waitFor(Response|Request|Event)$/.test(nm)) {
        report(ctx, "SYNC-006", next, `${nm}() starts after the action that triggers it.`,
          `Register the wait first, then trigger it: const p = page.${nm}(...); await <action>; await p; (or Promise.all([page.${nm}(...), <action>])). Better still, assert what the user sees once it arrives.`);
      }
    }

    // SYNC-008: trigger followed by another step without verification
    if (call && isTriggerCall(call, sf) && next) {
      const nextCall = awaitedCall(next);
      const nextIsAssertion = (nextCall && isAssertionCall(nextCall)) || containsAssertion(next);
      const nextIsStep = !!nextCall && !isAssertionCall(nextCall) && (isActionCall(nextCall) || isTriggerCall(nextCall, sf) || methodName(nextCall) === "goto");
      if (!nextIsAssertion && nextIsStep) {
        const text = triggerText(call, sf);
        report(ctx, "SYNC-008", stmt, "This step triggers a result, but the next step acts without verifying it.",
          `Add an assertion between them for ${suggestVerification(text)}, so the next step starts from a known state and a failure is reported here.`);
      }
    }
  });
}

interface Check {
  matcher: string;
  negated: boolean;
  trivialSubject: boolean;
  helper: boolean;
}

function collectChecks(body: ts.Node, sf: ts.SourceFile): Check[] {
  const checks: Check[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const name = n.expression.name.text;
      let recv = n.expression.expression.getText(sf);
      const negated = /\.not$/.test(recv);
      recv = recv.replace(/\.(not|resolves|rejects)$/, "");
      if (/^expect(\.soft|\.poll)?\(/.test(recv)) {
        const subject = (n.expression.expression as ts.Expression);
        const inner = ts.isPropertyAccessExpression(subject) ? subject.expression : subject;
        const arg = ts.isCallExpression(inner) ? inner.arguments[0] : undefined;
        const literalSubject = !!arg && (arg.kind === ts.SyntaxKind.TrueKeyword || arg.kind === ts.SyntaxKind.FalseKeyword || ts.isNumericLiteral(arg) || ts.isStringLiteral(arg));
        checks.push({
          matcher: name,
          negated: negated || name === "toBeHidden" || (name === "toHaveCount" && n.arguments[0]?.getText(sf) === "0"),
          trivialSubject: TRIVIAL_MATCHERS.has(name) || literalSubject,
          helper: false,
        });
      } else if (ASSERTION_METHOD.test(name) && !ACTION_METHODS.has(name) && !/^expect(\.|\()/.test(recv)) {
        checks.push({ matcher: name, negated: false, trivialSubject: false, helper: true });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return checks;
}

const PLAYWRIGHT_ROOTS = /^(page|context|browser|request|frame|test|expect|console|Promise|JSON|Math|process|Object|Array|String|Number|Date)$/;
const PLAYWRIGHT_METHODS = /^(goto|reload|goBack|goForward|locator|getBy[A-Za-z]+|frameLocator|first|last|nth|filter|waitFor[A-Za-z]*|evaluate|screenshot|hover|focus|blur|clear|scrollIntoViewIfNeeded|dispatchEvent|then|catch|step|use|setContent|setViewportSize|close|newPage|route|unroute|on|once|get|post|put|delete|patch|fetch)$/;

/** Does the test call code the reviewer cannot see into (a page-object method, a helper function)? Such code may assert internally. */
function callsOpaqueHelper(body: ts.Node, sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) {
        found = true; // helperFn(page)
        return;
      }
      if (ts.isPropertyAccessExpression(e)) {
        let root: ts.Expression = e.expression;
        while (ts.isPropertyAccessExpression(root) || ts.isCallExpression(root) || ts.isNonNullExpression(root) || ts.isElementAccessExpression(root) || ts.isAwaitExpression(root) || ts.isParenthesizedExpression(root)) {
          root = ts.isCallExpression(root) ? root.expression : (root as ts.PropertyAccessExpression).expression;
        }
        const rootText = root.getText(sf);
        const name = e.name.text;
        if (!PLAYWRIGHT_ROOTS.test(rootText) && !ACTION_METHODS.has(name) && !PLAYWRIGHT_METHODS.test(name) && !DATA_SETUP_RECEIVER.test(e.expression.getText(sf))) {
          found = true; // loginPage.signIn()
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return found;
}

function checkTestBody(ctx: Ctx, call: ts.CallExpression, body: ts.Block): void {
  const { sf } = ctx;
  const title = stringValue(call.arguments[0]) ?? "(unnamed test)";
  const callee = call.expression.getText(sf);
  const parked = /\.(skip|fixme)$/.test(callee); // intentionally not running; its body is not reviewed for verification

  if (!parked) {
    const checks = collectChecks(body, sf);
    if (!containsAssertion(body)) {
      const opaque = callsOpaqueHelper(body, sf);
      report(ctx, "VER-001", call, opaque ? `Test "${title}" has no visible assertion; it may rely on helpers that assert inside.` : `Test "${title}" has no assertions.`,
        opaque
          ? "Open the page-object/helper methods this test calls and confirm they assert the outcome (or name them verify*/expect* so the reviewer can tell). If they do not, add an assertion here."
          : "Add an assertion for each expected result in the manual case (visible text/state/URL/count). A test that cannot fail proves nothing.",
        opaque ? "warning" : undefined);
    } else if (checks.length > 0 && checks.every((c) => !c.helper)) {
      if (checks.every((c) => c.trivialSubject)) {
        report(ctx, "VER-003", call, `Test "${title}" only makes trivial assertions (${[...new Set(checks.map((c) => c.matcher))].join(", ")}).`,
          "Assert the real outcome: visible text, element state, URL or count. toBeTruthy()/toBeDefined() or expect(true) rarely fails when the feature is broken.");
      } else if (checks.every((c) => c.negated)) {
        report(ctx, "VER-005", call, `Test "${title}" only asserts that something is absent or hidden.`,
          "Add a positive assertion of the success outcome (the confirmation, the new row, the landing page). Absence of an error does not prove success.");
      }
    }

    const last = body.statements[body.statements.length - 1];
    if (last) {
      const lc = awaitedCall(last);
      if (lc && !isAssertionCall(lc) && (isActionCall(lc) || isTriggerCall(lc, sf))) {
        const text = triggerText(lc, sf);
        report(ctx, "VER-002", last, `Test "${title}" ends on an action; its outcome is never verified.`,
          `Add a final assertion for ${suggestVerification(text)}.`);
      }
    }
  }

  checkStatements(ctx, body.statements);
}

// --- public API --------------------------------------------------------------

export function reviewSource(fileName: string, text: string): Finding[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2021, true, ts.ScriptKind.TS);
  const ctx: Ctx = { sf, file: fileName, out: [] };
  const testBodies = new Set<ts.Block>();

  const walk = (node: ts.Node) => {
    checkNode(ctx, node);
    if (ts.isCallExpression(node) && isTestDeclaration(node, sf)) {
      const body = bodyOf(node);
      if (body) {
        checkTestBody(ctx, node, body);
        testBodies.add(body);
      }
    }
    // Statement-level sequence checks also apply to Page Object methods and helpers.
    // This includes blocks nested inside a test (test.step bodies, if/for/try): an unawaited
    // assertion or an unverified trigger there is just as real. Test bodies themselves are
    // handled by checkTestBody above.
    if (ts.isBlock(node) && !testBodies.has(node)) {
      checkStatements(ctx, node.statements);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);

  return applySuppressions(ctx, dedupe(ctx.out)).sort((a, b) => a.line - b.line || a.column - b.column);
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const k = `${f.ruleId}:${f.line}:${f.column}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function applySuppressions(ctx: Ctx, findings: Finding[]): Finding[] {
  const lines = ctx.sf.text.split("\n");
  return findings.filter((f) => {
    // Same line (trailing comment), or the line above - but only if that line is nothing but a comment,
    // so a trailing suppression on one statement cannot silently cover the next.
    const candidates: Array<[number, boolean]> = [[f.line - 1, false], [f.line - 2, true]];
    for (const [idx, commentOnly] of candidates) {
      const line = lines[idx];
      if (line === undefined || (commentOnly && !/^\s*(\/\/|\/\*|\*)/.test(line))) continue;
      const m = line.match(/review-ignore\s+([A-Z]+-\d{3})\s*:\s*(\S.*)/);
      if (m && m[1] === f.ruleId) return false;
    }
    return true;
  });
}
