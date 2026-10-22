import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object template (plain mode). Copy, rename, and fill in from REAL
 * locator sources only - see references/locator-priority.md.
 * Methods are named for user intent; page-state checks are `expect*` methods.
 */
export class ExamplePage {
  constructor(private readonly page: Page) {}

  // Locators: role/label first, CSS/XPath last. Mark anything unsourced.
  private get searchBox(): Locator {
    return this.page.getByRole('searchbox', { name: 'Search' });
  }

  private get resultRows(): Locator {
    return this.page.getByRole('row');
  }

  async goto(): Promise<void> {
    await this.page.goto('/example'); // relative to baseURL in playwright.config.ts
  }

  async search(term: string): Promise<void> {
    await this.searchBox.fill(term);
    await this.searchBox.press('Enter');
  }

  async expectResultContains(text: string): Promise<void> {
    await expect(this.resultRows.filter({ hasText: text })).toBeVisible();
  }
}
