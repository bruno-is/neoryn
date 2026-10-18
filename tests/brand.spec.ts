import { expect, test } from '@playwright/test'
import { createSeedLibrary } from '../src/lib/seed'
import { legacyWelcome } from '../src/lib/legacyWelcome'

test('identity is legible in both themes, follows preferences and fits mobile', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Conteúdo do documento' })).toBeVisible()
  await expect(page).toHaveTitle(/— Neoryn$/)
  await expect(page.locator('body')).not.toContainText(/lume/i)
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Usar tema escuro' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const logo = page.locator('.brand-logo:visible')
    await expect(logo).toHaveCount(1)
    await expect(logo).toHaveAttribute('src', new RegExp(`logo-${theme}.svg$`))
    await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    const contrast = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      const luminance = (name: string) => {
        const hex = style.getPropertyValue(name).trim().slice(1)
        const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
          .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
      }
      return [['--text', '--paper'], ['--muted', '--sidebar'], ['--accent', '--paper'], ['--on-accent', '--accent']].map(([a, b]) => {
        const x = luminance(a), y = luminance(b)
        return { pair: `${a}/${b}`, ratio: (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
      })
    })
    for (const value of contrast) expect(value.ratio, value.pair).toBeGreaterThanOrEqual(4.5)
    if (process.env.NEORYN_CAPTURE) await page.screenshot({ path: theme === 'light' ? 'docs/preview.png' : 'docs/preview-dark.png' })
  }
  await page.getByRole('button', { name: 'Preferências', exact: true }).click()
  await page.getByLabel('Aparência', { exact: true }).selectOption('system')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Neoryn — voltar ao início', exact: true }).click()
  await expect(page.locator('.empty-workspace h1')).toHaveText('Um espaço para suas ideias.')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Recolher biblioteca', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (process.env.NEORYN_CAPTURE) await page.screenshot({ path: 'docs/preview-mobile.png' })
  expect(errors).toEqual([])
})

test('old path data, pending drafts and writer lock survive the rebrand on the same origin', async ({ page, context }) => {
  const old = createSeedLibrary(100)
  old.documents[0].content = legacyWelcome
  old.folders = [{ id: 'personal', name: 'Pasta pessoal', parentId: null, createdAt: 100 }]
  old.documents.push({ ...old.documents[0], id: 'mine', name: 'Notas pessoais.md', content: '# Meu documento', folderId: 'personal' })
  old.activeId = 'mine'
  old.openTabIds = ['welcome', 'mine']
  old.settings.editorMode = 'source'
  old.settings.theme = 'dark'
  // Simulate the old page without mounting the new application or its writer lock.
  await page.route('**/lume/', route => route.fulfill({ contentType: 'text/html', body: '<title>Legacy storage fixture</title>' }))
  await page.goto('/lume/')
  await page.evaluate(async library => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('lume-library', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('library')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('library', 'readwrite')
        tx.objectStore('library').put({ format: 'lume-backup', version: 1, exportedAt: new Date(100).toISOString(), library }, 'current')
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); reject(tx.error) }
      }
    })
    localStorage.setItem('lume-pending-drafts-v1', JSON.stringify({ version: 1, drafts: [{ id: 'mine', content: '# Rascunho recuperado', updatedAt: 200 }] }))
    await new Promise<void>(resolve => {
      void navigator.locks.request('lume-library-writer', () => { resolve(); return new Promise(() => {}) })
    })
  }, old)
  const next = await context.newPage()
  await next.goto('/neoryn/')
  await expect(next.getByRole('heading', { name: 'Rascunho recuperado', exact: true })).toBeVisible()
  await expect(next.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(next.locator('.warning-banner')).toContainText('aberta em outra aba')
  await expect(next.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveCount(0)
  await expect(next.getByRole('button', { name: 'Negrito', exact: true })).toBeDisabled()
  await expect(next.locator('.folder-row')).toContainText('Pasta pessoal')
  await expect(next.locator('.document-tab')).toHaveCount(2)
  await page.close()
  await next.reload()
  await expect(next.getByRole('textbox', { name: 'Conteúdo Markdown' })).toBeEditable()
  await next.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill('# Edição no Neoryn')
  await expect(next.locator('.save-indicator')).toHaveText('Tudo salvo')
  await next.reload()
  await expect(next.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue('# Edição no Neoryn')
})
