import ts from "typescript";

/**
 * Facts about ONE statement (what it waits for, which locator it uses, what it
 * asserts, which literals it feeds into the page). The classifier compares the
 * facts of a statement before an edit with the facts after it; it never
 * guesses from raw text.
 */

export type Strategy = "role" | "label" | "testid" | "placeholder" | "text" | "id" | "css" | "xpath" | "other";

/** Higher = more stable, i.e. survives layout and styling changes better. */
export const STRATEGY_RANK: Record<Strategy, number> = {
  role: 5, label: 5, testid: 5, placeholder: 4, text: 3, id: 3, css: 2, other: 2, xpath: 1,
};

export interface LocatorFact {
  method: string;
  strategy: Strategy;
  arg: string;
}

export interface AssertionFact {
  matcher: string;
  negated: boolean;
  subject: string;
  expected: string;
  /** Cannot fail (constant subject) or matches anything. */
  trivial: boolean;
}

export interface Facts {
  locators: LocatorFact[];
  hasOr: boolean;
  hasFilter: boolean;
  hasPositional: boolean;
  sleeps: number;
  networkIdle: number;
  /** Targeted waits: "waitForResponse", "locator.waitFor", "expect.poll", "toPass"... */
  waits: string[];
  assertions: AssertionFact[];
  /** Largest explicit timeout in the statement, 0 if none. */
  timeout: number;
  force: boolean;
  actions: string[];
  /** String literals typed or navigated to (fill/type/goto/selectOption), i.e. test data written into the statement. */
  literalInputs: number;
  /** References to environment/config instead of literals. */
  envRefs: number;
  /** test.skip(<condition>, reason) where the condition reads the environment or configuration (a missing-data guard). */
  skipGuard: boolean;
  /** A locator that matches almost anything (a bare tag, "*", "//*"): a fallback that hides the problem. */
  genericLocator: boolean;
  /** Assertions that cannot fail or whose result is swallowed: expect(true).toBe(true), toHaveText(/.*\/), .catch(() => {}). Counted anywhere in the statement. */
  trivial: number;
  /**
   * Shortcuts anywhere in the statement, nested function bodies included (sleeps of any kind, networkidle, trivial
   * assertions, force, an explicit timeout). An improvement is never reported for a statement where this went up.
   */
  bad: number;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function strategyOfSelector(selector: string): Strategy {
  const s = selector.trim();
  if (/^(xpath=|\/\/|\(\/\/|\.\.\/)/i.test(s)) return "xpath";
  if (/^text=/i.test(s) || /^:text\(/i.test(s)) return "text";
  if (/^role=/i.test(s)) return "role";
  if (/^(id=)/i.test(s) || /^#[\w-]+$/.test(s)) return "id";
  if (/\[data-(testid|test-id|test|qa|cy)\b/i.test(s)) return "testid";
  return "css";
}

const ACTIONS = new Set(["click", "dblclick", "fill", "press", "type", "check", "uncheck", "selectOption", "setInputFiles", "tap", "dragTo", "pressSequentially", "hover", "goto", "act", "focus"]);
const WAITS = /^(waitForResponse|waitForRequest|waitForURL|waitForEvent|waitForFunction|waitForLoadState|waitFor|toPass)$/;

const SLEEP_NAMES = new Set(["waitForTimeout", "setTimeout", "setInterval", "sleep", "delay", "pause"]);
const isTrivialExpected = (text: string) => /^(\/\.\*\/[a-z]*|\/\^?\.\*\$?\/[a-z]*|['"`]{2})$/.test(text.replace(/\s+/g, ""));
const isConstant = (e: ts.Expression | undefined) =>
  !!e && (ts.isLiteralExpression(e) || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword || ts.isNumericLiteral(e));
const GENERIC = /^(\*|[a-z][a-z0-9]*|\/\/\*|\/\/[a-z]+)$/i;

function calleeName(call: ts.CallExpression): string | undefined {
  const e = call.expression;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isIdentifier(e)) return e.text;
  return undefined;
}

function firstString(call: ts.CallExpression): string | undefined {
  const a = call.arguments[0];
  if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) return a.text;
  return undefined;
}

export function factsOf(node: ts.Node, sf: ts.SourceFile): Facts {
  const f: Facts = {
    locators: [], hasOr: false, hasFilter: false, hasPositional: false, sleeps: 0, networkIdle: 0, waits: [],
    assertions: [], timeout: 0, force: false, actions: [], literalInputs: 0, envRefs: 0, skipGuard: false,
    genericLocator: false, trivial: 0, bad: 0,
  };
  const found: Array<{ pos: number; fact: LocatorFact }> = [];
  let swallowed = false;

  const visit = (n: ts.Node) => {
    if (ts.isFunctionLike(n) && ts.isBlock((n as ts.FunctionLikeDeclaration).body ?? ({} as ts.Node))) return; // nested bodies are their own units
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      const text = n.getText(sf);
      if (name === "locator" || name === "$" || name === "$$") {
        const s = firstString(n);
        if (s !== undefined) {
          found.push({ pos: n.getEnd(), fact: { method: name, strategy: strategyOfSelector(s), arg: norm(s) } });
          if (GENERIC.test(s.trim())) f.genericLocator = true;
        }
      } else if (name && /^getBy/.test(name)) {
        const strategy: Strategy =
          name === "getByRole" ? "role" : name === "getByLabel" ? "label" : name === "getByTestId" ? "testid" :
          name === "getByPlaceholder" ? "placeholder" : "text";
        found.push({ pos: n.getEnd(), fact: { method: name, strategy, arg: norm(n.arguments.map((a) => a.getText(sf)).join(",")) } });
      }
      if (name === "or") f.hasOr = true;
      if (name === "filter") f.hasFilter = true;
      if (name === "first" || name === "last" || name === "nth") f.hasPositional = true;
      const recvText = ts.isPropertyAccessExpression(n.expression) ? n.expression.expression.getText(sf) : "";
      if (name === "setTimeout" && /^(test|testInfo)$/.test(recvText)) {
        const a = n.arguments[0];
        f.timeout = Math.max(f.timeout, a && ts.isNumericLiteral(a) ? Number(a.text.replace(/_/g, "")) || 1e9 : 1e6);
      } else if (name && SLEEP_NAMES.has(name) && (name === "waitForTimeout" || n.arguments.length > 0)) {
        // waitForTimeout on any receiver, and the home-made sleeps: sleep(1000), delay(1000), new Promise(r => setTimeout(r, 1000))
        f.sleeps++;
      }
      if (name === "waitForLoadState" && /networkidle/.test(text)) f.networkIdle++;
      if (name === "waitForFunction" && n.arguments[0] && /^\(?\s*\)?\s*=>\s*(true|1)\s*$/.test(n.arguments[0].getText(sf).trim())) f.trivial++;
      if (name === "catch" && /\bexpect\s*[.(]/.test(text)) { f.trivial++; swallowed = true; } // an assertion whose failure is swallowed
      if (name === "waitForSelector" || name === "waitForNavigation") f.waits.push("legacy-wait");
      else if (name && WAITS.test(name) && !(name === "waitForLoadState" && /networkidle/.test(text))) {
        f.waits.push(name === "waitFor" ? "locator.waitFor" : name);
      }
      if (ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "expect" && n.expression.name.text === "poll") f.waits.push("expect.poll");
      if (name && ACTIONS.has(name)) f.actions.push(name);
      // assertions: expect(subject)[.not].toX(expected)
      if (ts.isPropertyAccessExpression(n.expression) && /^to[A-Z]/.test(n.expression.name.text)) {
        let recv: ts.Expression = n.expression.expression;
        let negated = false;
        if (ts.isPropertyAccessExpression(recv) && recv.name.text === "not") {
          negated = true;
          recv = recv.expression;
        }
        if (ts.isPropertyAccessExpression(recv) && /^(resolves|rejects)$/.test(recv.name.text)) recv = recv.expression;
        let root = recv;
        if (ts.isCallExpression(root)) {
          const c = root.expression;
          const isExpect = (ts.isIdentifier(c) && c.text === "expect") || (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === "expect");
          if (isExpect) {
            const expected = norm(n.arguments.map((a) => a.getText(sf)).join(","));
            const trivial = isConstant(root.arguments[0]) || isTrivialExpected(expected) || n.expression.name.text === "toBeDefined";
            f.assertions.push({ matcher: n.expression.name.text, negated, subject: norm(root.arguments[0]?.getText(sf) ?? ""), expected, trivial });
            if (trivial) f.trivial++;
            if (n.expression.name.text === "toPass") f.waits.push("toPass");
          }
        }
      }
      // literals written into the page
      if (name && /^(fill|type|pressSequentially|selectOption|goto)$/.test(name)) {
        // locator.fill(value, opts) vs page.fill(selector, value, opts)
        const second = n.arguments[1];
        const a = name !== "goto" && second && !ts.isObjectLiteralExpression(second) ? second : n.arguments[0];
        if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && a.text.length > 0) f.literalInputs++;
        if (a && /process\.env|\benv\(|\bgetEnv\(|\brequireEnv\(|\bconfig\./.test(a.getText(sf))) f.envRefs++;
      }
      if (name === "skip" && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText(sf) === "test" && n.arguments.length >= 1 && !ts.isStringLiteral(n.arguments[0]) && !ts.isFunctionLike(n.arguments[0]) && /process\.env|\benv\(|\bgetEnv\(|\bconfig\b|\bsecrets?\b/i.test(n.arguments[0].getText(sf))) {
        f.skipGuard = true;
      }
    }
    if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) {
      const key = n.name.text;
      if (key === "timeout") {
        // 0 means "no timeout" in Playwright; a value we cannot read is assumed to be a raised one
        const v = ts.isNumericLiteral(n.initializer) ? Number(n.initializer.text.replace(/_/g, "")) : NaN;
        f.timeout = Math.max(f.timeout, Number.isNaN(v) ? 1e6 : v === 0 ? 1e9 : v);
      }
      if (key === "force" && n.initializer.kind === ts.SyntaxKind.TrueKeyword) f.force = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  found.sort((a, b) => a.pos - b.pos);
  f.locators = found.map((x) => x.fact);
  if (swallowed) for (const a of f.assertions) a.trivial = true;
  f.bad = deepBad(node, sf);
  return f;
}

/** Shortcuts anywhere under `node`, including inside nested function bodies that `factsOf` leaves to their own units. */
function deepBad(node: ts.Node, sf: ts.SourceFile): number {
  let bad = 0;
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      const text = n.getText(sf);
      if (name === "waitForTimeout" || ((name === "setTimeout" || name === "setInterval" || name === "sleep" || name === "delay" || name === "pause") && n.arguments.length > 0 && !(ts.isPropertyAccessExpression(n.expression) && /^(test|testInfo)$/.test(n.expression.expression.getText(sf))))) bad++;
      if (name === "waitForLoadState" && /networkidle/.test(text)) bad++;
      if (name === "catch" && /\bexpect\s*[.(]/.test(text)) bad++;
      if (name === "waitForFunction" && n.arguments[0] && /^\(?\s*\)?\s*=>\s*(true|1)\s*$/.test(n.arguments[0].getText(sf).trim())) bad++;
      if (ts.isPropertyAccessExpression(n.expression) && /^to[A-Z]/.test(n.expression.name.text)) {
        let recv: ts.Expression = n.expression.expression;
        if (ts.isPropertyAccessExpression(recv) && recv.name.text === "not") recv = recv.expression;
        if (ts.isCallExpression(recv) && ts.isIdentifier(recv.expression) && recv.expression.text === "expect") {
          const expected = norm(n.arguments.map((a) => a.getText(sf)).join(","));
          if (isConstant(recv.arguments[0]) || isTrivialExpected(expected) || n.expression.name.text === "toBeDefined") bad++;
        }
      }
    }
    if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) {
      if (n.name.text === "force" && n.initializer.kind === ts.SyntaxKind.TrueKeyword) bad++;
      if (n.name.text === "timeout") bad++;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return bad;
}

/** The locator the statement acts on: the last one in the chain (page.getByRole('row').getByRole('button') -> the button). */
export function targetOf(f: Facts): LocatorFact | undefined {
  return f.locators[f.locators.length - 1];
}
