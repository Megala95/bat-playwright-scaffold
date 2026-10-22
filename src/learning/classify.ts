import crypto from "crypto";
import ts from "typescript";
import { reviewSource } from "../reviewer/reviewSource";
import { Facts, STRATEGY_RANK, Strategy, factsOf, targetOf } from "./facts";
import { KIND_BY_ID } from "./kinds";
import { redact } from "./redact";
import { Direction, EventKind, FileKind, FileReview, LearningEvent } from "./types";

/**
 * Turns "this file before" and "this file after" into learning events.
 *
 * Both versions are parsed; every statement is reduced to a unit (its own
 * text, with nested function bodies cut out so a change deep inside a
 * test.step is not also reported for the statement that contains it). The two
 * unit lists are aligned with a longest-common-subsequence diff, removed and
 * added units in the same hunk are paired by similarity, and each pair, or
 * lone addition/removal, is classified from the FACTS of the two statements
 * (see facts.ts) - never from a text diff.
 */

interface Unit {
  text: string;
  node: ts.Node;
  line: number;
  /** Title of the enclosing test("...") / it("..."), so edits in a test that was added or deleted are not "fixes". */
  test?: string;
}

function enclosingTest(n: ts.Node, sf: ts.SourceFile): string | undefined {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const e = p.expression;
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && /^(test|it)$/.test(e.expression.text) ? e.expression.text : undefined;
      const callee = ts.isPropertyAccessExpression(e) ? e.expression.getText(sf) : name;
      const first = p.arguments[0];
      if ((callee === "test" || callee === "it") && first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) && p.arguments.some((a) => ts.isFunctionLike(a))) return first.text;
    }
  }
  return undefined;
}

const normText = (s: string) => s.replace(/\s+/g, " ").trim();

function isUnitNode(n: ts.Node): boolean {
  return (
    ts.isExpressionStatement(n) || ts.isVariableStatement(n) || ts.isReturnStatement(n) ||
    ts.isPropertyDeclaration(n)
  );
}

function collectUnits(text: string, fileName: string): { units: Unit[]; sf: ts.SourceFile } {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2021, true, ts.ScriptKind.TS);
  const units: Unit[] = [];
  const visit = (n: ts.Node) => {
    if (isUnitNode(n)) {
      // cut the bodies of nested functions out of the unit's text
      const ranges: Array<[number, number]> = [];
      const cut = (c: ts.Node) => {
        if ((ts.isArrowFunction(c) || ts.isFunctionExpression(c)) && ts.isBlock(c.body)) ranges.push([c.body.getStart(sf), c.body.getEnd()]);
        ts.forEachChild(c, cut);
      };
      ts.forEachChild(n, cut);
      let s = n.getText(sf);
      const base = n.getStart(sf);
      for (const [a, b] of ranges.sort((x, y) => y[0] - x[0])) s = s.slice(0, a - base) + "{…}" + s.slice(b - base);
      s = normText(s).replace(/;$/, "");
      if (!/^import /.test(s)) units.push({ text: s, node: n, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, test: enclosingTest(n, sf) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { units, sf };
}

interface Op {
  type: "equal" | "remove" | "add";
  a?: Unit;
  b?: Unit;
}

/** Aligns the unit lists. Common prefix and suffix are trimmed first so a one-line fix in a long file stays cheap. Returns undefined when the changed middle is still too big to diff. */
function diffUnits(before: Unit[], after: Unit[]): Op[] | undefined {
  let lo = 0;
  while (lo < before.length && lo < after.length && before[lo].text === after[lo].text) lo++;
  let hiB = before.length, hiA = after.length;
  while (hiB > lo && hiA > lo && before[hiB - 1].text === after[hiA - 1].text) { hiB--; hiA--; }
  const a = before.slice(lo, hiB), b = after.slice(lo, hiA);
  if (a.length * b.length > 4_000_000) return undefined;
  const ops: Op[] = before.slice(0, lo).map((u, i) => ({ type: "equal" as const, a: u, b: after[i] }));
  const n = a.length, m = b.length;
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = a[i].text === b[j].text ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i].text === b[j].text) { ops.push({ type: "equal", a: a[i], b: b[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ type: "remove", a: a[i++] });
    else ops.push({ type: "add", b: b[j++] });
  }
  while (i < n) ops.push({ type: "remove", a: a[i++] });
  while (j < m) ops.push({ type: "add", b: b[j++] });
  for (let k = 0; k < before.length - hiB; k++) ops.push({ type: "equal", a: before[hiB + k], b: after[hiA + k] });
  return ops;
}

/** A statement that was only moved (removed in one place, added in another) is not an edit: cancel such pairs. */
function cancelMoves(ops: Op[]): Op[] {
  const added = new Map<string, number>();
  for (const o of ops) if (o.type === "add") added.set(o.b!.text, (added.get(o.b!.text) ?? 0) + 1);
  const removed = new Map<string, number>();
  for (const o of ops) if (o.type === "remove" && (added.get(o.a!.text) ?? 0) > 0) { removed.set(o.a!.text, (removed.get(o.a!.text) ?? 0) + 1); added.set(o.a!.text, added.get(o.a!.text)! - 1); }
  const out: Op[] = [];
  const toDropAdds = new Map(removed);
  for (const o of ops) {
    if (o.type === "remove" && (removed.get(o.a!.text) ?? 0) > 0) { removed.set(o.a!.text, removed.get(o.a!.text)! - 1); continue; }
    if (o.type === "add" && (toDropAdds.get(o.b!.text) ?? 0) > 0) { toDropAdds.set(o.b!.text, toDropAdds.get(o.b!.text)! - 1); continue; }
    out.push(o);
  }
  return out;
}

const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z_$][\w$]*|\d+/g) ?? []);
function similarity(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Pair removed and added units of one hunk by similarity (best first); the rest stay lone. */
function pairUp(removed: Unit[], added: Unit[]): { pairs: Array<[Unit, Unit]>; loneRemoved: Unit[]; loneAdded: Unit[] } {
  if (removed.length * added.length > 250_000) {
    // very large rewrite: pair by position only rather than compare every combination
    const k = Math.min(removed.length, added.length);
    return { pairs: Array.from({ length: k }, (_, i) => [removed[i], added[i]] as [Unit, Unit]), loneRemoved: removed.slice(k), loneAdded: added.slice(k) };
  }
  const cands: Array<{ i: number; j: number; s: number }> = [];
  const lastCall = (t: string) => /\.(\w+)\([^()]*\)\s*$/.exec(t)?.[1] ?? "";
  removed.forEach((r, i) => added.forEach((a, j) => {
    // token overlap + same terminating action + staying in order (small penalty for distance)
    const s = similarity(r.text, a.text) + (lastCall(r.text) && lastCall(r.text) === lastCall(a.text) ? 0.2 : 0) - 0.03 * Math.abs(i - j);
    cands.push({ i, j, s });
  }));
  cands.sort((x, y) => y.s - x.s || x.i - y.i);
  const usedR = new Set<number>(), usedA = new Set<number>();
  const pairs: Array<[Unit, Unit]> = [];
  for (const c of cands) {
    if (c.s < 0.25 || usedR.has(c.i) || usedA.has(c.j)) continue;
    usedR.add(c.i); usedA.add(c.j);
    pairs.push([removed[c.i], added[c.j]]);
  }
  return { pairs, loneRemoved: removed.filter((_, i) => !usedR.has(i)), loneAdded: added.filter((_, j) => !usedA.has(j)) };
}

// --- classification of units ---------------------------------------------------

/** How much an assertion proves. Value-only checks that do not retry (toBe, toEqual, toBeTruthy) are the weakest. */
const ASSERTION_RANK: Record<string, number> = {
  toBeTruthy: 0, toBeFalsy: 0, toBeDefined: 0, toBeUndefined: 0, toBe: 0, toEqual: 0, toStrictEqual: 0, toBeNull: 0,
  toBeAttached: 1, toBeVisible: 2, toBeHidden: 2, toBeEnabled: 2, toBeDisabled: 2,
  toContainText: 3, toBeChecked: 3, toBeEditable: 3, toHaveText: 4, toHaveValue: 4, toHaveCount: 4, toHaveURL: 4, toHaveAttribute: 4, toHaveTitle: 4,
};
const rankOf = (a: { matcher: string; trivial: boolean }) => (a.trivial ? 0 : ASSERTION_RANK[a.matcher] ?? 3);
const modern = (f: Facts) => f.waits.filter((w) => w !== "legacy-wait");
const realCount = (f: Facts) => f.assertions.filter((x) => !x.trivial).length;

const SAFE_SUB = /[^A-Za-z0-9_.\->+()$]/g;

function mk(kind: EventKind, file: string, fileKind: FileKind, line: number, before: string | undefined, after: string | undefined, extra: Partial<LearningEvent> = {}): LearningEvent {
  const info = KIND_BY_ID.get(kind)!;
  const b = redact(before), a = redact(after);
  const subkind = extra.subkind ? extra.subkind.replace(SAFE_SUB, "").slice(0, 40) || undefined : undefined;
  const target = extra.target ? redact(extra.target, 60) : undefined;
  const id = crypto.createHash("sha1").update([kind, subkind ?? "", file, b ?? "", a ?? ""].join("\u0001")).digest("hex").slice(0, 12);
  return { id, kind, area: info.area, direction: info.direction, file, fileKind, line, before: b, after: a, ...(subkind ? { subkind } : {}), ...(target ? { target } : {}) };
}

const key = (l: { strategy: Strategy; arg: string }) => `${l.strategy}:${l.arg}`;

/** Improvements are never reported for a statement that picked up a shortcut (sleep, force, raised timeout, networkidle, an assertion that cannot fail). */
const dropImprovements = (events: LearningEvent[], veto: boolean) => (veto ? events.filter((e) => e.direction !== "improvement") : events);

function classifyPair(r: Unit, a: Unit, rf: Facts, af: Facts, file: string, fk: FileKind): LearningEvent[] {
  const out: LearningEvent[] = [];
  const ev = (kind: EventKind, extra: Partial<LearningEvent> = {}) => out.push(mk(kind, file, fk, a.line, r.text, a.text, extra));
  const worse = af.bad > rf.bad || (af.force && !rf.force) || af.timeout > rf.timeout;

  // synchronization
  const sleepGone = rf.sleeps > af.sleeps;
  const slippedToIdle = af.networkIdle > rf.networkIdle || af.trivial > rf.trivial;
  if (sleepGone && !slippedToIdle) {
    if (realCount(af) > realCount(rf) || modern(af).length > modern(rf).length) ev("sync-sleep-replaced", { subkind: modern(af)[0] ?? "web-first-assertion" });
    else if (af.waits.length > rf.waits.length) { /* replaced by waitForSelector and the like: not a lesson */ }
    else ev("sync-sleep-removed");
  } else if (af.sleeps > rf.sleeps) ev("sync-sleep-added");
  const newWait = modern(af).find((w) => !modern(rf).includes(w));
  if (newWait && rf.sleeps <= af.sleeps) ev("sync-wait-added", { subkind: newWait });
  if (af.timeout > 0 && af.timeout > rf.timeout) ev("sync-timeout-raised");
  if (af.force && !rf.force) ev("sync-force-added");
  if (rf.force && !af.force) ev("sync-force-removed");

  // assertions
  const ra = rf.assertions, aa = af.assertions;
  if (ra.length === 1 && aa.length === 1 && ra[0].subject === aa[0].subject) {
    const x = ra[0], y = aa[0];
    const d = rankOf(y) - rankOf(x);
    if (x.matcher !== y.matcher || x.trivial !== y.trivial) {
      if (d < 0) ev("assertion-weakened", { subkind: `${x.matcher}->${y.matcher}` });
      else if (d > 0) ev("assertion-strengthened", { subkind: `${x.matcher}->${y.matcher}` });
    } else if (x.expected !== y.expected || x.negated !== y.negated) {
      if (rankOf(y) < rankOf(x)) ev("assertion-weakened", { subkind: `${x.matcher}->${y.matcher}` });
      else ev("expectation-updated", { subkind: y.matcher });
    }
  } else if (realCount(rf) > realCount(af) && modern(af).length <= modern(rf).length && !sleepGone) {
    ev("assertion-removed");
  } else if (realCount(af) > realCount(rf) && !sleepGone) {
    const last = af.assertions.filter((q) => !q.trivial).pop()!;
    ev("assertion-added", { subkind: last.matcher });
  }

  // locators
  const rt = targetOf(rf), at = targetOf(af);
  if (rt && at) {
    const rk = rf.locators.map(key), ak = af.locators.map(key);
    const same = rk.length === ak.length && rk.every((k, i) => k === ak[i]);
    if (!same) {
      const extension = rk.every((k) => ak.includes(k)) && ak.length > rk.length;
      if (af.hasOr && !rf.hasOr) {
        // a fallback only when everything that was there is still there; an .or() that came with a replaced primary is a swap
        if (extension && !af.genericLocator) ev("locator-fallback-added", { subkind: "or()", target: rt.arg.slice(0, 60) });
      }
      else if (extension && rf.hasPositional && !af.hasPositional) ev("locator-scoped", { target: rt.arg.slice(0, 60) });
      else if (!extension && rf.hasPositional && !af.hasPositional && (af.hasFilter || ak.length > rk.length) && !af.genericLocator) ev("locator-scoped", { target: rt.arg.slice(0, 60) });
      else {
        const delta = STRATEGY_RANK[at.strategy] - STRATEGY_RANK[rt.strategy];
        const sub = `${rt.strategy}->${at.strategy}`;
        if (rt.strategy !== at.strategy && delta > 0) ev("locator-upgraded", { subkind: sub, target: rt.arg.slice(0, 60) });
        else if (rt.strategy !== at.strategy && delta < 0) ev("locator-downgraded", { subkind: sub, target: rt.arg.slice(0, 60) });
        else if (rt.strategy === at.strategy && !(rf.hasPositional !== af.hasPositional)) ev("locator-replaced", { subkind: at.strategy, target: rt.arg.slice(0, 60) });
      }
    } else if (!rf.hasPositional && af.hasPositional) {
      ev("locator-downgraded", { subkind: "positional", target: rt.arg.slice(0, 60) });
    }
  }

  // data
  if (rf.literalInputs > af.literalInputs && af.envRefs > rf.envRefs) ev("data-externalized");
  else if (af.literalInputs > rf.literalInputs && rf.envRefs > af.envRefs) ev("data-hardcoded");
  return dropImprovements(out, worse);
}

const TRIGGERING = new Set(["click", "dblclick", "press", "check", "uncheck", "selectOption", "setInputFiles", "act", "dragTo", "fill", "goto"]);

function classifyLoneAdded(a: Unit, af: Facts, prevFacts: Facts | undefined, file: string, fk: FileKind): LearningEvent[] {
  const out: LearningEvent[] = [];
  const ev = (kind: EventKind, extra: Partial<LearningEvent> = {}) => out.push(mk(kind, file, fk, a.line, undefined, a.text, extra));
  if (af.sleeps > 0) ev("sync-sleep-added");
  if (af.force) ev("sync-force-added");
  if (af.timeout > 0) ev("sync-timeout-raised");
  const w = modern(af)[0];
  if (w) ev("sync-wait-added", { subkind: w });
  if (af.skipGuard) ev("data-guard-added");
  const real = af.assertions.filter((x) => !x.trivial);
  if (real.length > 0 && !w) {
    const afterAction = !!prevFacts && prevFacts.actions.some((x) => TRIGGERING.has(x)) && prevFacts.assertions.length === 0;
    ev(afterAction ? "verification-added" : "assertion-added", { subkind: real[0].matcher });
  }
  return dropImprovements(out, af.bad > 0 || af.force || af.timeout > 0);
}

function classifyLoneRemoved(r: Unit, rf: Facts, file: string, fk: FileKind, hunkAddsShortcut: boolean): LearningEvent[] {
  const out: LearningEvent[] = [];
  const ev = (kind: EventKind) => out.push(mk(kind, file, fk, r.line, r.text, undefined));
  // a sleep that disappeared next to a new shortcut (networkidle, an assertion that cannot fail...) was swapped, not fixed
  if (rf.sleeps > 0 && !hunkAddsShortcut) ev("sync-sleep-removed");
  if (rf.assertions.some((x) => !x.trivial) && modern(rf).length === 0) ev("assertion-removed");
  return out;
}

export function fileKindOf(file: string): FileKind {
  if (/\.json$/.test(file) && /locators?/i.test(file)) return "locators";
  if (/(^|\/)pages?\//i.test(file) || /Page\.ts$/.test(file)) return "page";
  if (/\.(spec|test)\.ts$/.test(file) || /(^|\/)(tests?|e2e)\//.test(file)) return "spec";
  return "other";
}

// --- locator repository (JSON) ---------------------------------------------------

interface JsonLocator { strategy?: string; value?: string; role?: string; name?: string }
interface JsonElement { primary?: JsonLocator; fallbacks?: JsonLocator[] }

const jsonStrategy = (l: JsonLocator | undefined): Strategy => {
  const s = l?.strategy ?? "";
  if (s === "getByRole") return "role";
  if (s === "getByLabel") return "label";
  if (s === "getByTestId" || s === "testid" || s === "dataTestId") return "testid";
  if (s === "getByPlaceholder") return "placeholder";
  if (s === "getByText" || s === "text") return "text";
  if (s === "id") return "id";
  if (s === "xpath") return "xpath";
  if (s === "css") return l?.value ? (/\[data-(testid|test-id|test|qa|cy)\b/i.test(l.value) ? "testid" : "css") : "css";
  return "other";
};
const jsonText = (l: JsonLocator | undefined) => (l ? `${l.strategy ?? "?"}:${l.value ?? `${l.role ?? ""} ${l.name ?? ""}`.trim()}` : "");

const GENERIC_VALUE = /^(\*|[a-z][a-z0-9]*|\/\/\*|\/\/[a-z]+)$/i;
const isGenericJson = (l: JsonLocator | undefined) => !!l && (l.strategy === "css" || l.strategy === "xpath") && GENERIC_VALUE.test((l.value ?? "").trim());

function classifyLocatorJson(file: string, before: string, after: string): LearningEvent[] {
  type Doc = { elements?: Record<string, JsonElement | null> } | null;
  let b: Doc, a: Doc;
  try {
    b = JSON.parse(before.replace(/^\uFEFF/, ""));
    a = JSON.parse(after.replace(/^\uFEFF/, ""));
  } catch {
    return [];
  }
  if (!a || typeof a !== "object" || !b || typeof b !== "object") return [];
  const out: LearningEvent[] = [];
  for (const [name, ae] of Object.entries(a.elements ?? {})) {
    const be = b.elements?.[name];
    if (!be || !ae || typeof be !== "object" || typeof ae !== "object") continue;
    const bs = jsonStrategy(be.primary), as = jsonStrategy(ae.primary);
    let primaryDowngraded = false;
    if (jsonText(be.primary) !== jsonText(ae.primary) && be.primary && ae.primary) {
      const d = STRATEGY_RANK[as] - STRATEGY_RANK[bs];
      const kind: EventKind = bs !== as && d > 0 ? "locator-upgraded" : bs !== as && d < 0 ? "locator-downgraded" : "locator-replaced";
      primaryDowngraded = kind === "locator-downgraded" || (kind === "locator-upgraded" && isGenericJson(ae.primary));
      if (!(kind === "locator-upgraded" && isGenericJson(ae.primary))) out.push(mk(kind, file, "locators", 0, jsonText(be.primary), jsonText(ae.primary), { subkind: bs !== as ? `${bs}->${as}` : as, target: name }));
    }
    const bfl = Array.isArray(be.fallbacks) ? be.fallbacks : [], afl = Array.isArray(ae.fallbacks) ? ae.fallbacks : [];
    const bf = bfl.map(jsonText), af = afl.map(jsonText);
    // the old primary moved into the fallbacks is a swap, not a new fallback
    const swapped = new Set([jsonText(be.primary)]);
    const added = af.filter((x) => !bf.includes(x) && !swapped.has(x));
    const removed = bf.filter((x) => !af.includes(x));
    const addedLoc = afl.filter((l) => added.includes(jsonText(l)));
    if (added.length > 0 && af.length > bf.length && !primaryDowngraded && addedLoc.some((l) => !isGenericJson(l))) {
      const strat = addedLoc.find((l) => !isGenericJson(l));
      out.push(mk("locator-fallback-added", file, "locators", 0, bf.join(" | ") || "(none)", af.join(" | "), { subkind: `+${jsonStrategy(strat)}`, target: name }));
    } else if (removed.length > 0 && af.length < bf.length) {
      out.push(mk("locator-fallback-removed", file, "locators", 0, bf.join(" | "), af.join(" | ") || "(none)", { target: name }));
    }
  }
  return out;
}

// --- public API ------------------------------------------------------------------

export interface ClassifyResult {
  events: LearningEvent[];
  review: FileReview;
  /** Why a file was not analysed (too large to diff, does not parse): reported, never silent. */
  skipped?: string;
}

const testTitles = (units: Unit[]) => new Set(units.map((u) => u.test).filter((t): t is string => !!t));

export function classifyChange(file: string, before: string, after: string): ClassifyResult {
  const fk = fileKindOf(file);
  const review: FileReview = { file, fixed: [], introduced: [] };
  if (before === after) return { events: [], review };
  if (/\.json$/.test(file)) return { events: classifyLocatorJson(file, before, after), review };
  if (!/\.tsx?$/.test(file)) return { events: [], review };

  const bu = collectUnits(before, file), au = collectUnits(after, file);
  const diff = diffUnits(bu.units, au.units);
  if (!diff) return { events: [], review, skipped: "too many changed statements to compare; split the change or review it by hand" };
  const ops = cancelMoves(diff);
  const events: LearningEvent[] = [];
  const beforeTests = testTitles(bu.units), afterTests = testTitles(au.units);
  // a statement inside a test that exists on only one side belongs to a test that was added, deleted or renamed
  const inKnownTest = (u: Unit, other: Set<string>) => !u.test || other.has(u.test);

  let removed: Unit[] = [], added: Unit[] = [];
  let lastAfter: Unit | undefined;
  const flush = () => {
    if (!removed.length && !added.length) return;
    const rem = removed.filter((u) => inKnownTest(u, afterTests)), add = added.filter((u) => inKnownTest(u, beforeTests));
    const { pairs, loneRemoved, loneAdded } = pairUp(rem, add);
    for (const [r, a] of pairs) events.push(...classifyPair(r, a, factsOf(r.node, bu.sf), factsOf(a.node, au.sf), file, fk));
    const hunkAddsShortcut = add.some((u) => { const f = factsOf(u.node, au.sf); return f.bad > 0 || f.force || f.timeout > 0; });
    for (const r of loneRemoved) events.push(...classifyLoneRemoved(r, factsOf(r.node, bu.sf), file, fk, hunkAddsShortcut));
    for (const a of loneAdded) {
      const idx = au.units.indexOf(a);
      const prev = idx > 0 ? au.units[idx - 1] : lastAfter;
      events.push(...classifyLoneAdded(a, factsOf(a.node, au.sf), prev ? factsOf(prev.node, au.sf) : undefined, file, fk));
    }
    removed = [];
    added = [];
  };
  for (const op of ops) {
    if (op.type === "equal") { flush(); lastAfter = op.b; }
    else if (op.type === "remove") removed.push(op.a!);
    else added.push(op.b!);
  }
  flush();

  // reviewer delta: which rules stopped / started firing because of this change
  const count = (src: string) => {
    const m = new Map<string, number>();
    for (const f of reviewSource(file, src)) m.set(f.ruleId, (m.get(f.ruleId) ?? 0) + 1);
    return m;
  };
  const cb = count(before), ca = count(after);
  for (const id of new Set([...cb.keys(), ...ca.keys()])) {
    const d = (ca.get(id) ?? 0) - (cb.get(id) ?? 0);
    if (d < 0) review.fixed.push(id);
    if (d > 0) review.introduced.push(id);
  }
  review.fixed.sort();
  review.introduced.sort();

  const seen = new Set<string>();
  return { events: events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))), review };
}
