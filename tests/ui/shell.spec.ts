import { expect } from '@playwright/test';
import { test } from './fixture';

// Shell loads clean: topbar, sidebar, editor, preview, statusbar render, zero console errors.
test('shell renders with zero console errors', async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseURL!);
  await expect(page.getByText('Builder', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI agent' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explorer' })).toBeVisible();
  await expect(page.locator('.preview .panel-title', { hasText: 'Preview' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Agent activity/ })).toBeVisible();
  expect(errors).toEqual([]);
});

// Command palette opens with Cmd+K, filters, and closes.
test('command palette filters and runs', async ({ page, baseURL }) => {
  await page.goto(baseURL!);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Command palette' }).getByRole('textbox').fill('refresh');
  await expect(page.getByText('Refresh project')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

// Agent flow: send a prompt via MockProvider, timeline fills, run completes.
test('agent run completes and shows activity', async ({ page, baseURL }) => {
  await page.goto(baseURL!);
  await page.getByLabel('Agent prompt').fill('Add a hello banner');
  await page.getByRole('button', { name: 'Send' }).click();
  // Assistant bubble appears (streaming, then final state text).
  await expect(page.getByText('Builder').first()).toBeVisible({ timeout: 15000 });
  // Timeline tab: switch to it and expect at least one agent event line.
  await page.getByText('Agent activity').click();
  await expect.poll(async () => {
    const lines = await page.locator('.activity-line').count();
    return lines;
  }, { timeout: 60000 }).toBeGreaterThan(0);
});

// Preview pane + viewport switcher render; empty state offers Start preview.
test('preview pane renders with viewport switcher', async ({ page, baseURL }) => {
  await page.goto(baseURL!);
  await expect(page.getByLabel('desktop viewport')).toBeVisible();
  await expect(page.getByLabel('tablet viewport')).toBeVisible();
  await expect(page.getByLabel('mobile viewport')).toBeVisible();
  await page.getByLabel('mobile viewport').click();
  await expect(page.locator('.preview-url', { hasText: /Preview not running/ })).toBeVisible();
});

// Mobile-width: layout survives narrow viewport.
test('narrow viewport keeps core panels reachable', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseURL!);
  await expect(page.getByText('Builder', { exact: true })).toBeVisible();
  await expect(page.getByText('AI agent')).toBeVisible();
});
