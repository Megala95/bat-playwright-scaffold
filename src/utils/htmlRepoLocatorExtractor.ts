import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { RawElementAttrs, toCandidate } from "./locatorCandidate";

/**
 * Item 2.1, Option 3 ("Access to HTML Page Source / DevGit Repository") -
 * the team's PRIMARY recommended path once Cisco grants DevGit/repo access
 * or agrees to periodic HTML exports (see the 'Locator Options Comparison'
 * tab: "the option the team believes gets closest to the 70%
 * out-of-the-box target"). Unlike Option 1 (crawlOnce.ts), this needs no
 * running browser or live app - it reads static, versioned HTML, which is
 * why the sheet calls it "the most stable, deterministic source."
 *
 * Point this at either:
 *   - a directory of exported .html pages (BAT_HTML_EXPORT_DIR), or
 *   - a checked-out copy of the app's DevGit repo, if access is granted
 *     directly to page templates/HTML fixtures (BAT_HTML_EXPORT_DIR can
 *     point at that checkout too - this script doesn't care which).
 *
 * Produces the exact same CandidateLocator shape as crawlOnce.ts (via the
 * shared classifyElement()/toCandidate() in locatorCandidate.ts), so
 * whichever option is actually available in a given environment, the rest
 * of the pipeline (validation, src/locators/*.json) doesn't need to know or
 * care which one ran.
 *
 * KNOWN GAP - Shadow DOM and iframes: cheerio parses the raw HTML text
 * only. Anything attached at runtime inside a shadow root, or living inside
 * an `<iframe>`'s own document, simply isn't present in that source - this
 * extractor will silently produce zero candidates for those elements rather
 * than erroring, which is easy to miss. This is a different failure mode
 * than crawlOnce.ts's Shadow-DOM gap (that one runs a real browser but
 * still can't pierce closed shadow roots or cross-origin iframes); here,
 * there's no browser at all. Expect to fill anything inside a shadow root
 * or iframe in by hand, or via Option 2 (MCP, against the live, rendered
 * DOM) instead.
 *
 * Usage: BAT_HTML_EXPORT_DIR=./autopilot-ui/html-exports npm run extract-html -- login.html candidates.json
 */
function extractFromHtml(html: string): RawElementAttrs[] {
  const $ = cheerio.load(html);
  const results: RawElementAttrs[] = [];

  $("input, select, button, a, [role='button'], [role='textbox']").each((_, el) => {
    const $el = $(el);
    const tag = (el as any).tagName?.toLowerCase() ?? "";
    results.push({
      tag,
      type: $el.attr("type") ?? null,
      id: $el.attr("id") ?? null,
      name: $el.attr("name") ?? null,
      ariaLabel: $el.attr("aria-label") ?? null,
      role: $el.attr("role") ?? null,
      text: $el.text().trim().slice(0, 60) || null,
    });
  });

  return results;
}

async function main() {
  const [, , inputFile, outFile = "candidates.json"] = process.argv;
  if (!inputFile) {
    console.error("Usage: npm run extract-html -- <file-under-BAT_HTML_EXPORT_DIR> [outFile]");
    process.exit(1);
  }

  const exportDir = process.env.BAT_HTML_EXPORT_DIR ?? "./autopilot-ui/html-exports";
  const inputPath = path.join(exportDir, inputFile);

  console.log(`[htmlRepoLocatorExtractor] Reading ${inputPath} ...`);
  const html = fs.readFileSync(inputPath, "utf-8");
  const rawAttrs = extractFromHtml(html);
  const candidates = rawAttrs.map((attrs) => toCandidate(attrs, "html-repo"));

  const outPath = path.join(__dirname, "..", "locators", outFile);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        _comment:
          "Option 3 (HTML/repo access) output - still validate against the rendered page before trusting " +
          "(static HTML can omit anything injected by client-side JS at runtime).",
        source: inputPath,
        candidates,
      },
      null,
      2
    )
  );

  console.log(`[htmlRepoLocatorExtractor] Wrote ${candidates.length} candidate locators to ${outPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
