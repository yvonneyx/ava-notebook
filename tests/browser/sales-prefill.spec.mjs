import { test, expect } from '@playwright/test';

test('sales example fills the composer and survives a refresh', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '探索销售经营案例' }).click();
  await expect(page.getByText('sales-case.csv', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '分析问题' })).toHaveValue(/2025 年 2 月/);
  await expect(page.getByRole('button', { name: '开始分析' })).toBeEnabled();
  await expect(page).toHaveURL('/');
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('ava-notebook-direct');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result.transaction('drafts').objectStore('drafts').get('composer');
      request.onsuccess = () => resolve(request.result?.source?.name);
      request.onerror = () => reject(request.error);
    };
  }))).toBe('sales-case.csv');
  await page.reload();
  await expect(page.getByText('sales-case.csv', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '分析问题' })).toHaveValue(/2025 年 2 月/);
});
