import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { generateSpecSource } from "../../src/generator/generateSpec";
import { DslTestCase } from "../../src/generator/dslTypes";

/**
 * Golden-file regression test for the deterministic reference generator
 * (src/generator/generateSpec.ts) - see that file's header for exactly
 * what this does and does not cover. Runs as its own "meta" Playwright
 * project (see playwright.config.ts) since it needs no browser and no
 * target app: it's the cheapest possible CI signal, and the direct answer
 * to "the agent chain is unauditable" from the Sept 2026 architecture
 * review - a prompt change that silently alters generated-code shape now
 * has something concrete to fail against.
 *
 * If this test fails after a DELIBERATE change to generateSpec.ts (or to
 * script-generator.agent.md's output conventions), update
 * tests/fixtures/login.spec.golden.txt to match and say why in the commit
 * message - don't regenerate it silently. That file IS the spec for "what
 * correct generated output looks like" for this fixture.
 */
test.describe("generator regression @meta", () => {
  const dslPath = path.join(__dirname, "..", "fixtures", "login.dsl.json");
  const goldenPath = path.join(__dirname, "..", "fixtures", "login.spec.golden.txt");

  test("the login DSL fixture produces exactly the golden generated spec", () => {
    const dsl: DslTestCase = JSON.parse(fs.readFileSync(dslPath, "utf-8"));
    const generated = generateSpecSource(dsl);
    const golden = fs.readFileSync(goldenPath, "utf-8");

    expect(generated).toBe(golden);
  });

  test("generated output never contains a raw locator escape hatch", () => {
    const dsl: DslTestCase = JSON.parse(fs.readFileSync(dslPath, "utf-8"));
    const generated = generateSpecSource(dsl);

    // The whole point of the act()/verify() pattern (item 2.2) is that a
    // generated spec never talks to the DOM directly - it always goes
    // through the Page Object, so the element-class guard and locator
    // fallback stay in effect. This is a cheap structural guard against
    // that invariant silently regressing.
    expect(generated).not.toMatch(/page\.locator\(/);
    expect(generated).not.toMatch(/page\.\$\(/);
    expect(generated).not.toMatch(/page\.\$\$\(/);
  });
});
