import { expect, test } from '@playwright/test';
import { setup, id } from './fixtures';

for (const [width, height, label] of [[1280, 800, 'laptop'], [1077, 841, 'small laptop'], [850, 900, 'tablet'], [390, 800, 'phone']] as const) {
  test(`main navigation bar stays at the top while scrolling (${label})`, async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width, height });
    await page.goto(`/fields/${id}/analysis`);
    const header = page.locator('.preferences-bar');
    await expect(header).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What changed in the field?' })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
    const box = await header.boundingBox();
    expect(box?.y).toBe(0);
    // Short enough not to eat the screen: one row on a laptop, at most ~110px on a phone.
    expect(box!.height).toBeLessThan(width >= 901 ? 80 : 120);
    await expect(header.getByText('TerraScope')).toBeInViewport();
  });
}
