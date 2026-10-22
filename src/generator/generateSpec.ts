import { DslActionStep, DslTestCase } from "./dslTypes";

/**
 * A deterministic, non-LLM reference implementation of the shape
 * script-generator.agent.md is instructed to produce: a spec built purely
 * from `BasePage.act()`/`verify()` calls on a Page Object instance, never a
 * raw `page.locator(...)` call. It exists for one reason - to give that
 * agent's contract something a CI job can actually check
 * (tests/meta/generator-regression.spec.ts), instead of "trust the prompt".
 *
 * This is NOT a stand-in for running the real Copilot agent - it can't
 * exercise judgment about locator strategy, DSL parsing, or anything an
 * LLM step genuinely has to decide. What it DOES pin down: given the same
 * DSL input, the *generated code shape* stays stable and matches this
 * project's conventions (Page Object + act/verify, no raw locators). If a
 * prompt change makes script-generator emit something structurally
 * different from what this function emits for the same DSL, that's worth
 * noticing in review, not discovering after it reaches a PR.
 */
export function generateSpecSource(dsl: DslTestCase): string {
  const lines: string[] = [];
  lines.push(`import { test } from "@playwright/test";`);
  lines.push(`import { ${dsl.pageObject} } from "../../src/pages/${dsl.pageObject}";`);
  lines.push("");
  lines.push(`test.describe("${dsl.name} ${dsl.tag}", () => {`);
  lines.push(`  test("${dsl.name}", async ({ page }) => {`);
  lines.push(`    const pageObject = new ${dsl.pageObject}(page);`);

  for (const step of dsl.steps) {
    lines.push(`    ${renderStep(step)}`);
  }

  lines.push(`  });`);
  lines.push(`});`);
  lines.push("");
  return lines.join("\n");
}

function renderStep(step: DslActionStep): string {
  switch (step.kind) {
    case "goto":
      return `await pageObject.goto(process.env.BAT_APP_BASE_URL ?? "https://REPLACE_WITH_APP_BASE_URL");`;
    case "act": {
      const args = [JSON.stringify(step.locatorKey), JSON.stringify(step.action)];
      if (step.value !== undefined) args.push(JSON.stringify(step.value));
      return `await pageObject.act(${args.join(", ")});`;
    }
    case "verify": {
      const args = [JSON.stringify(step.locatorKey), JSON.stringify(step.action)];
      if (step.expected !== undefined) args.push(JSON.stringify(step.expected));
      if (step.exact) args.push(`{ exact: true }`);
      return `await pageObject.verify(${args.join(", ")});`;
    }
    default: {
      const _exhaustive: never = step;
      throw new Error(`Unsupported DSL step: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
