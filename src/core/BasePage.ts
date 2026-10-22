import { Page, expect } from "@playwright/test";
import { LocatorRepository } from "./LocatorRepository";
import { ElementAction, assertActionAllowed } from "./ElementTypes";

/**
 * Item 2.2's standardized pattern, as one reusable base class:
 *   locate the object -> identify its element class -> the class determines
 *   valid actions -> perform the action -> verify the result.
 *
 * Item 2.3: every concrete page (see src/pages/LoginPage.ts) extends this,
 * so the pattern lives once here instead of being re-implemented per page,
 * and is what the "Copilot Skills, Scripts and Agents" item (2.6) should
 * generate against rather than writing raw Playwright calls from scratch.
 */
export abstract class BasePage {
  protected readonly page: Page;
  protected readonly locators: LocatorRepository;

  constructor(page: Page, locators: LocatorRepository) {
    this.page = page;
    this.locators = locators;
  }

  /** Step 1-2: locate the object, identify its element class. */
  protected async locate(key: string) {
    const locator = await this.locators.resolveWithFallback(this.page, key);
    const elementClass = this.locators.getElementClass(key);
    return { locator, elementClass };
  }

  /** Step 3-4: the class determines valid actions -> perform the action. */
  async act(key: string, action: ElementAction, value?: string): Promise<void> {
    const { locator, elementClass } = await this.locate(key);
    assertActionAllowed(elementClass, action);

    switch (action) {
      case "fill":
        await locator.fill(value ?? "");
        return;
      case "clear":
        await locator.fill("");
        return;
      case "pickDate":
        await locator.fill(value ?? "");
        return;
      case "selectOption":
        await locator.selectOption(value ?? "");
        return;
      case "check":
        await locator.check();
        return;
      case "uncheck":
        await locator.uncheck();
        return;
      case "click":
        await locator.click();
        return;
      default:
        throw new Error(`act() does not perform assertions - use verify() for "${action}"`);
    }
  }

  /**
   * Step 5: verify the result.
   *
   * Text-content default follows the **assertion-strategy** skill:
   * `toContainText` unless the DSL's expected result specifies exact
   * wording. When it does, pass `{ exact: true }` (or a `RegExp` as
   * `expected`) so the generated verify() opts into `toHaveText` instead of
   * silently accepting a substring match - the caller decides per step,
   * this method doesn't guess.
   */
  async verify(
    key: string,
    action: "assertText" | "assertVisible",
    expected?: string | RegExp,
    options?: { exact?: boolean }
  ): Promise<void> {
    const { locator, elementClass } = await this.locate(key);
    assertActionAllowed(elementClass, action);

    if (action === "assertVisible") {
      await expect(locator).toBeVisible();
    } else if (expected instanceof RegExp) {
      await expect(locator).toHaveText(expected);
    } else if (options?.exact) {
      await expect(locator).toHaveText(expected ?? "");
    } else {
      await expect(locator).toContainText(expected ?? "");
    }
  }
}
