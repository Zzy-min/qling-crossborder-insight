import type { Page } from '@playwright/test'

export async function openAdvanced(page: Page, name: string) {
  const summary = page.locator('summary').filter({ hasText: name }).first()
  if (await summary.count() && await summary.locator('..').getAttribute('open') === null) await summary.click()
}

export async function analyzeAndOpenReport(page: Page) {
  await page.getByRole('button', { name: /数据准备/ }).click()
  await page.getByRole('button', { name: /开始分析/ }).click()
  await page.getByRole('heading', { name: '市场机会，不止一个分数。' }).waitFor()
  await page.getByRole('button', { name: /决策报告/ }).click()
  await openAdvanced(page, '比较两个历史版本')
}
