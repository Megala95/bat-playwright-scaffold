import { test } from '@playwright/test';
import { ExamplePage } from '../pages/ExamplePage';

/**
 * Spec template (plain mode). One test() per manual case.
 * Title format: `TC-<id>: <original manual title>` so reports trace back.
 * Setup (login, seeded data) goes in beforeEach / fixtures / storageState,
 * not in the test body, unless the manual case is about that setup.
 */
test.describe('Search @regression', () => {
  // Manual test data kept visible and typed, next to the spec.
  const data = {
    term: 'Router X200',
  };

  test.beforeEach(async ({ page }) => {
    await new ExamplePage(page).goto();
  });

  test('TC-0001: Search returns the matching product', async ({ page }) => {
    const example = new ExamplePage(page);

    // Step 1 - Enter a product name and search
    await example.search(data.term);

    // Step 1 expected - Result list shows the product
    await example.expectResultContains(data.term);
  });
});
