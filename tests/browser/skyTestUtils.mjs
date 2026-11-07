// Existing world tests exercise their original, unobscured canvas coordinates.
// The dedicated HUD tests exercise the same controls with the panel open.
export async function closeSkyForWorldTests(page) {
  await page.evaluate(() => {
    const button = document.querySelector('[data-action="sky"]');
    if (button?.getAttribute('aria-expanded') === 'true') button.click();
  });
}
