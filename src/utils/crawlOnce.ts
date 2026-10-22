import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";
import { RawElementAttrs, toCandidate } from "./locatorCandidate";

/**
 * Item 2.1, Option 1 ("Crawling") - one of three locator-sourcing options,
 * not the default. Per the team's recommendation on the 'Locator Options
 * Comparison' tab: use this as the working fallback while Option 3
 * (DevGit/HTML repo access - see htmlRepoLocatorExtractor.ts) is pending
 * Cisco IT/Security approval. "Once the app's pattern is learned (crawl
 * once per project), it can be reused instead of re-crawling every time" -
 * so this is a one-off generation step, not something that runs on every
 * test.
 *
 * IMPORTANT - this only produces *candidates*. Per item 2.2, "XPath
 * validated before saving" - a human (or the locator-strategist agent)
 * must check each generated entry against the real page before it's copied
 * into src/locators/*.json. Shadow-DOM elements and pop-up/dynamic content
 * are known misses for this option (see the 'Locator Options Comparison'
 * tab) - expect to fill some entries in by hand.
 *
 * Usage: BAT_APP_BASE_URL=https://app.example.com npm run crawl -- /login candidates.json
 */
async function crawlPage(url: string): Promise<RawElementAttrs[]> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle" });

  // Only extract raw, serializable attributes here - classification happens
  // back in Node via the shared classifyElement()/toCandidate() so both
  // this crawler and htmlRepoLocatorExtractor.ts agree on element classes.
  const rawAttrs: RawElementAttrs[] = await page.$$eval(
    "input, select, button, a, [role='button'], [role='textbox']",
    (elements) =>
      elements.map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: (el as HTMLInputElement).type ?? null,
        id: el.id || null,
        name: el.getAttribute("name"),
        ariaLabel: el.getAttribute("aria-label"),
        role: el.getAttribute("role"),
        text: el.textContent?.trim().slice(0, 60) || null,
      }))
  );

  await browser.close();
  return rawAttrs;
}

async function main() {
  const [, , routePath = "/", outFile = "candidates.json"] = process.argv;
  const baseUrl = process.env.BAT_APP_BASE_URL ?? "https://REPLACE_WITH_APP_BASE_URL";
  const url = `${baseUrl.replace(/\/$/, "")}${routePath}`;

  console.log(`[crawlOnce] Crawling ${url} ...`);
  const rawAttrs = await crawlPage(url);
  const candidates = rawAttrs.map((attrs) => toCandidate(attrs, "crawl"));

  const outPath = path.join(__dirname, "..", "locators", outFile);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ _comment: "UNVALIDATED crawl output (Option 1) - review before use (item 2.2)", url, candidates }, null, 2)
  );

  console.log(`[crawlOnce] Wrote ${candidates.length} candidate locators to ${outPath}`);
  console.log(`[crawlOnce] Next: validate each entry against the live page, then move it into a proper *.locators.json file.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
