/**
 * Item 2.1: shared shape and classification logic for locator candidates,
 * regardless of which of the three sourcing options produced them -
 * Crawling (crawlOnce.ts), HTML/repo access (htmlRepoLocatorExtractor.ts),
 * or MCP (produced live by the locator-strategist agent via the Playwright
 * MCP server's browser_snapshot/browser_generate_locator tools).
 *
 * Keeping classification in one place means all three options feed the
 * same element-class vocabulary that ElementTypes.ts and BasePage.ts
 * consume - a candidate from a static HTML export and a candidate from a
 * live crawl are interchangeable once they reach this shape.
 */

export interface RawElementAttrs {
  tag: string;
  type: string | null;
  id: string | null;
  name: string | null;
  ariaLabel: string | null;
  role: string | null;
  text: string | null;
}

export interface CandidateLocator extends RawElementAttrs {
  suggestedElementClass: string;
  source: "crawl" | "html-repo" | "mcp";
}

/**
 * Pure function, no DOM/browser dependency, so it runs identically inside
 * a Playwright page.$$eval callback (after that callback hands back plain
 * attribute objects) and inside a plain Node script parsing static HTML
 * with cheerio.
 */
export function classifyElement(attrs: RawElementAttrs): string {
  const { tag, type, role } = attrs;

  if (tag === "input" && type && ["text", "email", "password", "search"].includes(type)) {
    return "EditBox";
  }
  if (tag === "input" && type === "date") {
    return "DatePicker";
  }
  if (tag === "input" && type === "checkbox") {
    return "Checkbox";
  }
  if (tag === "select") {
    return "Dropdown";
  }
  if (tag === "button" || role === "button") {
    return "Button";
  }
  if (tag === "a") {
    return "Link";
  }
  return "ReadOnlyField";
}

export function toCandidate(attrs: RawElementAttrs, source: CandidateLocator["source"]): CandidateLocator {
  return { ...attrs, suggestedElementClass: classifyElement(attrs), source };
}
