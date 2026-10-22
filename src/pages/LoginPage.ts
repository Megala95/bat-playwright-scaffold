import { Page } from "@playwright/test";
import { BasePage } from "../core/BasePage";
import { LocatorRepository } from "../core/LocatorRepository";
import loginLocators from "../locators/login.locators.json";

/**
 * Item 2.3: "reusable Page Object library the agent draws from". This is the
 * worked example the team can point Copilot at (via the Skill in the
 * project's GitHub Copilot playbook) as the pattern to replicate for every
 * other page/feature.
 */
export class LoginPage extends BasePage {
  constructor(page: Page) {
    // No `as any` here on purpose - LocatorRepository.load() takes `unknown`
    // and validates the file's actual shape at runtime (see
    // src/core/LocatorRepository.ts's parseLocatorFile()), which is what
    // actually catches a malformed locators.json - a type-level cast here
    // previously defeated that even when the underlying check existed.
    super(page, LocatorRepository.load(loginLocators));
  }

  async goto(baseUrl: string): Promise<void> {
    await this.page.goto(`${baseUrl.replace(/\/$/, "")}/login`);
  }

  /** A full login flow expressed purely in terms of locate -> classify -> act -> verify. */
  async login(username: string, password: string): Promise<void> {
    await this.act("usernameField", "fill", username);
    await this.act("passwordField", "fill", password);
    await this.act("signInButton", "click");
  }

  /** Exact wording matters for an error message (assertion-strategy: use toHaveText, not toContainText, here). */
  async expectLoginError(message: string): Promise<void> {
    await this.verify("loginErrorMessage", "assertText", message, { exact: true });
  }

  async expectAuthenticated(): Promise<void> {
    await this.verify("postLoginLandmark", "assertVisible");
  }
}
