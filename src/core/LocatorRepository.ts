import { Page, Locator } from "@playwright/test";
import { ElementClass } from "./ElementTypes";

/**
 * A locator candidate's shape depends on its strategy: `getByRole` needs a
 * structured `role` (+ optional `name`), everything else is a single string
 * `value`. This used to be one shape - `{ strategy, value }` - with
 * `getByRole` packing `"role:name"` into `value` and splitting on `:`. That
 * broke on any accessible name containing a colon (e.g. a button literally
 * named "Sign In: SSO"), so the two are now a discriminated union.
 *
 * A TS type alone does NOT catch a malformed *.locators.json file, though -
 * `LoginPage.ts` used to hand the JSON import to `LocatorRepository.load()`
 * as `as any`, which silently defeats this union for the one real call site
 * (confirmed: reintroducing the old `{strategy:"getByRole", value:"button:Sign In"}`
 * shape compiled clean with `as any` in place). Locator files are also
 * written/edited by the locator-strategist agent and by hand, not only by
 * TypeScript authors, so a compile-time-only guarantee wouldn't cover the
 * realistic failure mode anyway. `parseLocatorFile()` below is the actual
 * enforcement: a runtime check every load goes through, regardless of how
 * the file was produced or whether a cast tried to paper over its shape.
 *
 * `role` is constrained to Playwright's own accepted ARIA role list
 * (ARIA_ROLES below, copied from `getByRole`'s parameter type in
 * @playwright/test), not left as a bare `string`. An independent re-review
 * found that an earlier version of this validator checked `role` was *a
 * string* but not that it was a *valid* one, so a typo'd role would pass
 * `parseLocatorFile()` and only fail later, inside Playwright, with `role
 * as any` silently papering over the mismatch at the one place it mattered.
 */
export const ARIA_ROLES = [
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button", "caption", "cell",
  "checkbox", "code", "columnheader", "combobox", "complementary", "contentinfo", "definition", "deletion",
  "dialog", "directory", "document", "emphasis", "feed", "figure", "form", "generic", "grid", "gridcell",
  "group", "heading", "img", "insertion", "link", "list", "listbox", "listitem", "log", "main", "marquee",
  "math", "meter", "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "navigation", "none",
  "note", "option", "paragraph", "presentation", "progressbar", "radio", "radiogroup", "region", "row",
  "rowgroup", "rowheader", "scrollbar", "search", "searchbox", "separator", "slider", "spinbutton", "status",
  "strong", "subscript", "superscript", "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox",
  "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
] as const;
export type AriaRole = (typeof ARIA_ROLES)[number];

export type LocatorRef =
  | { strategy: "id" | "css" | "xpath" | "getByLabel" | "getByTestId" | "getByText"; value: string }
  | { strategy: "getByRole"; role: AriaRole; name?: string };

interface LocatorEntry {
  label: string;
  elementClass: ElementClass;
  primary: LocatorRef;
  fallbacks: LocatorRef[];
}

interface LocatorFile {
  app: string;
  page: string;
  elements: Record<string, LocatorEntry>;
}

function describeCandidate(candidate: LocatorRef): string {
  return candidate.strategy === "getByRole"
    ? `getByRole=${candidate.role}${candidate.name ? `:name=${candidate.name}` : ""}`
    : `${candidate.strategy}=${candidate.value}`;
}

const STRING_VALUE_STRATEGIES = ["id", "css", "xpath", "getByLabel", "getByTestId", "getByText"];

function isLocatorRef(value: unknown): value is LocatorRef {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.strategy === "getByRole") {
    return (
      typeof v.role === "string" &&
      (ARIA_ROLES as readonly string[]).includes(v.role) &&
      (v.name === undefined || typeof v.name === "string") &&
      v.value === undefined // catches the old "role:name"-in-value shape directly
    );
  }
  return typeof v.strategy === "string" && STRING_VALUE_STRATEGIES.includes(v.strategy) && typeof v.value === "string";
}

const ELEMENT_CLASSES: readonly string[] = Object.values(ElementClass);

function isLocatorEntry(value: unknown): value is LocatorEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.label === "string" &&
    typeof v.elementClass === "string" &&
    ELEMENT_CLASSES.includes(v.elementClass) &&
    isLocatorRef(v.primary) &&
    Array.isArray(v.fallbacks) &&
    v.fallbacks.every(isLocatorRef)
  );
}

/**
 * The real enforcement point for the LocatorRef shape (see the block
 * comment above): every load - from a JSON import, `JSON.parse`, or a
 * hand-built object - goes through this, so a malformed entry throws a
 * clear, specific error immediately at load time instead of either a
 * confusing runtime failure inside Playwright or, worse, silently calling
 * `page.getByRole(undefined)`.
 */
export function parseLocatorFile(raw: unknown): LocatorFile {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Locator file is not a JSON object.");
  }
  const v = raw as Record<string, unknown>;
  if (typeof v.app !== "string" || typeof v.page !== "string" || typeof v.elements !== "object" || v.elements === null) {
    throw new Error('Locator file is missing required "app" / "page" / "elements" fields.');
  }

  const elements = v.elements as Record<string, unknown>;
  for (const [key, entry] of Object.entries(elements)) {
    if (!isLocatorEntry(entry)) {
      throw new Error(
        `Locator entry "${key}" in ${v.page}.locators.json doesn't match the expected shape. ` +
          `A getByRole candidate needs { strategy: "getByRole", role, name? } with "role" one of ` +
          `Playwright's recognized ARIA roles (see ARIA_ROLES in LocatorRepository.ts) - "value" is not valid there. ` +
          `Every other strategy needs { strategy, value }. "elementClass" must be one of: ${ELEMENT_CLASSES.join(", ")}. ` +
          `Fix the file before this repository loads it.`
      );
    }
  }

  return v as unknown as LocatorFile;
}

/**
 * Item 2.2: "a shared, validated locator repository (label -> id/href, XPath
 * validated before saving, CSS/class/get-by-value as fallbacks)".
 *
 * One JSON file per page/feature under src/locators/. Loading is separated
 * from resolution so the same repository file can be reused by the crawler
 * (src/utils/crawlOnce.ts) that generates candidate entries and by the
 * BasePage that resolves them into live Playwright Locators at test time.
 */
export class LocatorRepository {
  private readonly file: LocatorFile;

  constructor(file: LocatorFile) {
    this.file = file;
  }

  /**
   * Takes `unknown`, not `LocatorFile` - the caller should never need (or
   * be tempted to add) a cast to satisfy this signature. Every entry is
   * validated by parseLocatorFile() before it becomes a LocatorRepository;
   * an invalid file throws here, at load time, not at first use.
   */
  static load(raw: unknown): LocatorRepository {
    return new LocatorRepository(parseLocatorFile(raw));
  }

  getElementClass(key: string): ElementClass {
    return this.entry(key).elementClass;
  }

  /**
   * Builds a Locator from the PRIMARY strategy only - no fallback is tried,
   * no DOM check happens before returning. This is a narrow, deliberate
   * escape hatch, not the default way to resolve a locator: use it only
   * when you already trust the primary selector to exist and be unique
   * right now (for example, immediately after a fresh, human-validated
   * crawl/export, in a one-off script rather than a generated test).
   *
   * Every generated test and every BasePage.act()/verify() call goes
   * through resolveWithFallback() instead, which actually probes the DOM
   * and falls back - that's the resilient path item 3.3 depends on. Calling
   * this from test code bypasses that resilience silently, so its name says
   * so: "primary", not "resolve".
   */
  resolvePrimary(page: Page, key: string): Locator {
    const entry = this.entry(key);
    return this.toLocator(page, entry.primary);
  }

  /**
   * Probes each candidate - primary, then fallbacks, in order - and returns
   * the first one that matches at least one element on the live page. This
   * is what makes the repository resilient to a single stale selector
   * instead of failing the whole script - a cause of flakiness called out
   * in item 3.3. Prefer this everywhere; it's what BasePage uses.
   */
  async resolveWithFallback(page: Page, key: string): Promise<Locator> {
    const entry = this.entry(key);
    const candidates = [entry.primary, ...entry.fallbacks];
    for (const candidate of candidates) {
      const locator = this.toLocator(page, candidate);
      if ((await locator.count()) > 0) {
        return locator;
      }
    }
    throw new Error(
      `No selector matched for "${key}" (${entry.label}) on page "${this.file.page}". ` +
        `Tried: ${candidates.map(describeCandidate).join(" | ")}. ` +
        `Log this as a candidate for src/utils/crawlOnce.ts re-validation.`
    );
  }

  private entry(key: string): LocatorEntry {
    const entry = this.file.elements[key];
    if (!entry) {
      throw new Error(`Unknown locator key "${key}" in ${this.file.page}.locators.json`);
    }
    return entry;
  }

  private toLocator(page: Page, candidate: LocatorRef): Locator {
    switch (candidate.strategy) {
      case "id":
        return page.locator(`#${candidate.value}`);
      case "css":
        return page.locator(candidate.value);
      case "xpath":
        return page.locator(`xpath=${candidate.value}`);
      case "getByRole":
        // No `as any` here: candidate.role is AriaRole (validated by
        // parseLocatorFile()/isLocatorRef() above), which is the exact
        // union @playwright/test's own getByRole() parameter type expects.
        return candidate.name
          ? page.getByRole(candidate.role, { name: candidate.name })
          : page.getByRole(candidate.role);
      case "getByLabel":
        return page.getByLabel(candidate.value);
      case "getByTestId":
        return page.getByTestId(candidate.value);
      case "getByText":
        return page.getByText(candidate.value);
      default: {
        const _exhaustive: never = candidate;
        throw new Error(`Unsupported locator strategy: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}
