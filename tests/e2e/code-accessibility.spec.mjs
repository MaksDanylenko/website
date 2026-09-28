import { test, expect, expectClean, PAGES } from './fixtures.mjs';

test('code actions work with the keyboard and copy the complete source', async ({ page }) => {
  test.skip(!PAGES.code, 'no code fixture');
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedCode = value; } } }));
  await page.goto(PAGES.code);
  const block = page.locator('.enlighter-default').first();
  const plain = block.getByRole('button', { name: 'Plain text' });
  await plain.focus();
  await plain.press('Space');
  await expect(plain).toHaveAttribute('aria-pressed', 'true');
  await expect(block.locator('.enlighter-raw')).toBeVisible();
  await plain.press('Tab');
  await expect(block.getByRole('button', { name: 'Copy code' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(block.getByRole('status')).toHaveText('Code copied.');
  expect(await page.evaluate(() => window.copiedCode)).toBe(await block.locator('.enlighter-raw').textContent());
  await expect(block.getByRole('link', { name: 'Open code', exact: true })).toHaveAttribute('href', /^blob:/);
  await expect(block.getByRole('region')).toHaveAttribute('tabindex', '0');
  const legacy = page.locator('.prose pre:not(.EnlighterJSRAW):not(.mermaid)').first();
  await legacy.focus();
  await expect(legacy).toBeFocused();
  await expect(legacy).toHaveAttribute('role', 'region');
  expectClean(page);
});

for (const width of [390, 1280]) {
  test(`clipboard refusal leaves a keyboard-accessible manual copy path at ${width}px`, async ({ page }) => {
    test.skip(!PAGES.code, 'no code fixture');
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw Error('denied'); } } }));
    await page.goto(PAGES.code);
    const block = page.locator('.enlighter-default').first();
    if (width === 390) await block.locator('summary').click();
    await block.getByRole('button', { name: 'Copy code' }).press('Enter');
    await expect(block.getByRole('status')).toContainText('copy it manually');
    await expect(block.getByRole('region')).toBeFocused();
    await expect(block.locator('.enlighter-raw')).toBeVisible();
    expectClean(page);
  });
}

for (const width of [320, 390, 640]) {
  test(`mobile code options stay out of the reading path at ${width}px`, async ({ page }) => {
    test.skip(!PAGES.code, 'no code fixture');
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedCode = value; } } }));
    await page.goto(PAGES.code);
    const block = page.locator('.enlighter-default').first();
    const summary = block.locator('summary');
    const actions = block.locator('.code-actions');
    const code = block.getByRole('region');
    await expect(summary).toHaveText('Code options');
    await expect(actions).toBeHidden();
    await expect(code).toBeVisible();
    await summary.focus();
    await summary.press('Tab');
    await expect(code).toBeFocused();
    await code.press('Shift+Tab');
    await expect(summary).toBeFocused();
    await summary.press('Enter');
    await summary.press('Tab');
    const plain = block.getByRole('button', { name: 'Plain text' });
    await expect(plain).toBeFocused();
    await plain.press('Space');
    await expect(plain).toHaveAttribute('aria-pressed', 'true');
    await expect(block.locator('.enlighter-raw')).toBeVisible();
    await plain.press('Tab');
    await expect(block.getByRole('button', { name: 'Copy code' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(block.getByRole('status')).toHaveText('Code copied.');
    expect(await page.evaluate(() => window.copiedCode)).toBe(await block.locator('.enlighter-raw').textContent());
    await page.keyboard.press('Tab');
    await expect(block.getByRole('link', { name: 'Open code', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(block.getByRole('link', { name: 'EnlighterJS' })).toBeFocused();
    const targets = await block.locator('summary, .code-actions button, .code-actions a').evaluateAll(els => els.map(el => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    for (const target of targets) {
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(summary).toBeFocused();
    await expect(actions).toBeHidden();
    await expect(block.locator('.enlighter-raw')).toBeVisible();
    await summary.press('Space');
    await expect(actions).toBeVisible();
    await summary.click();
    await expect(actions).toBeHidden();
    expectClean(page);
  });
}

test('code options preserve focus across the mobile breakpoint', async ({ page }) => {
  test.skip(!PAGES.code, 'no code fixture');
  await page.setViewportSize({ width: 641, height: 900 });
  await page.goto(PAGES.code);
  const block = page.locator('.enlighter-default').first();
  const summary = block.locator('summary');
  const plain = block.getByRole('button', { name: 'Plain text' });
  await expect(summary).toBeHidden();
  await plain.focus();
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(plain).toBeFocused();
  await expect(plain).toBeVisible();
  await plain.press('Escape');
  await expect(summary).toBeFocused();
  await page.setViewportSize({ width: 641, height: 900 });
  await expect(summary).toBeHidden();
  await expect(plain).toBeFocused();
  await page.setViewportSize({ width: 640, height: 900 });
  await block.getByRole('region').focus();
  await page.setViewportSize({ width: 641, height: 900 });
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(block.getByRole('region')).toBeFocused();
  await expect(block.locator('.code-actions')).toBeHidden();
  expectClean(page);
});

test('AsciiDoc table reflows independently of the page at 320 CSS px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('today/asciidoc-support-on-foojay/');
  const table = page.locator('.prose-table-scroll:has(table.tableblock)').first();
  await expect(table).toHaveAttribute('role', 'region');
  await table.focus();
  await expect(table).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await table.press('ArrowRight');
  await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await expect(table.locator('table > caption')).toBeVisible();
  expectClean(page);
});
