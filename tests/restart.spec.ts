import { chromium, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

test('the library survives a full browser shutdown and restart', async ({ baseURL }) => {
  const profile = await mkdtemp(join(tmpdir(), 'lume-restart-test-'))
  const options = { channel: process.env.CI ? undefined : 'msedge', headless: true, viewport: { width: 1440, height: 960 } }
  let context = await chromium.launchPersistentContext(profile, options)
  try {
    let page = context.pages()[0]
    await page.goto(baseURL!)
    await expect(page.getByRole('textbox', { name: 'Conteúdo do documento' })).toBeVisible()
    for (const name of ['Primeiro', 'Segundo']) {
      await page.locator('input[accept=".md,.markdown,.txt"]').setInputFiles({ name: `${name}.md`, mimeType: 'text/markdown', buffer: Buffer.from(`# ${name}`) })
      await expect(page.locator('.document-tab.active')).toContainText(name)
    }
    await page.locator('.document-tab').first().locator('button').first().click()
    const expectedTabs = ['Um espaço para suas ideias.md', 'Primeiro.md', 'Segundo.md']
    await expect(page.locator('.document-tab > button:first-child > span')).toHaveText(expectedTabs)
    await page.getByRole('button', { name: 'Markdown', exact: true }).click()
    await page.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill('# Amanhã eu continuo\n\nEste texto sobrevive ao encerramento completo do navegador.')
    await expect(page.locator('.save-indicator')).toHaveText('Tudo salvo')
    await context.close()
    context = await chromium.launchPersistentContext(profile, options)
    page = context.pages()[0]
    await page.goto(baseURL!)
    await expect(page.locator('.document-tab > button:first-child > span')).toHaveText(expectedTabs)
    await expect(page.locator('.document-tab.active')).toContainText('Um espaço para suas ideias')
    await expect(page.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue('# Amanhã eu continuo\n\nEste texto sobrevive ao encerramento completo do navegador.')
  } finally {
    await context.close()
    const expectedRoot = resolve(tmpdir()) + sep
    if (resolve(profile).startsWith(expectedRoot) && profile.includes('lume-restart-test-')) await rm(profile, { recursive: true, force: true })
  }
})
