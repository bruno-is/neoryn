import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 960 } })

async function open(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Conteúdo do documento' })).toBeVisible()
}

async function folder(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nova pasta', exact: true }).click()
  await page.getByLabel('Nome da pasta', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Criar', exact: true }).click()
}

// Windows clipboard text uses CRLF even when the Markdown source uses LF.
const readClipboard = (page: Page) => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'))

test('one introduction, clickable folder rows and logo navigation preserve the library', async ({ page }) => {
  await open(page)
  await expect(page.locator('.folder-row')).toHaveCount(0)
  await expect(page.locator('.document-item')).toHaveCount(1)
  await folder(page, 'Raiz')
  await folder(page, 'Filha')
  await page.locator('input[accept=".md,.markdown,.txt"]').setInputFiles({ name: 'Notas.md', mimeType: 'text/markdown', buffer: Buffer.from('# Minhas notas\n\n**Guardar** este texto.') })
  const root = page.locator('.folder-label').filter({ hasText: 'Raiz' })
  await root.getByText('Raiz', { exact: true }).click()
  await expect(root).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.tree-document')).toHaveCount(0)
  await root.getByText('Raiz', { exact: true }).click()
  await expect(page.locator('.tree-document')).toHaveText('Notas')
  await root.locator('.folder-chevron').click()
  await expect(root).toHaveAttribute('aria-expanded', 'false')
  await root.focus()
  await page.keyboard.press('Enter')
  await expect(root).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'Opções da pasta Raiz', exact: true }).click()
  await expect(root).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  const markdown = '# Minhas notas\n\nÚltimas palavras antes de voltar ao início.'
  await page.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill(markdown)
  await page.getByRole('button', { name: 'Modo leitura', exact: true }).click()
  await page.getByRole('button', { name: 'Lume — voltar ao início', exact: true }).click()
  await expect(page.locator('.empty-workspace')).toBeVisible()
  await expect(page.locator('.document-item')).toHaveCount(2)
  await expect(page.locator('.app-shell')).not.toHaveClass(/reading-mode/)
  await page.locator('.document-select').filter({ hasText: 'Notas' }).click()
  await expect(page.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue(markdown)
  await expect(page.locator('.save-indicator')).toHaveText('Tudo salvo')
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue(markdown)
})

test('copies complete Markdown from every editor mode, reading and another document', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await open(page)
  const markdown = '---\ntitle: Notas de teste\n---\n# Copiar tudo\n\nAcentos: ação. **Negrito** e `código`.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst valor = 42\n```\n'
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await page.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill(markdown)
  for (const mode of ['Markdown', 'Dividido', 'Escrever', 'Modo leitura']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    if (mode === 'Escrever') await expect(page.getByRole('textbox', { name: 'Conteúdo do documento' })).toBeVisible()
    await page.getByRole('button', { name: 'Mais opções do documento', exact: true }).click()
    await page.getByRole('button', { name: 'Copiar Markdown', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Markdown completo copiado.')
    await expect.poll(() => readClipboard(page)).toBe(markdown)
  }
  await page.getByRole('button', { name: 'Lume — voltar ao início', exact: true }).click()
  await page.locator('input[accept=".md,.markdown,.txt"]').setInputFiles({ name: 'Outro.md', mimeType: 'text/markdown', buffer: Buffer.from('# Outro') })
  await page.getByRole('button', { name: 'Opções de Um espaço para suas ideias', exact: true }).click()
  await page.getByRole('button', { name: 'Copiar Markdown', exact: true }).click()
  await expect.poll(() => readClipboard(page)).toBe(markdown)
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await page.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill('')
  await page.getByRole('button', { name: 'Mais opções do documento', exact: true }).click()
  await page.getByRole('button', { name: 'Copiar Markdown', exact: true }).click()
  await expect.poll(() => readClipboard(page)).toBe('')
})

test('a blocked clipboard shows a useful error without changing the document', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { value: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) })
  })
  await page.getByRole('button', { name: 'Mais opções do documento', exact: true }).click()
  await page.getByRole('button', { name: 'Copiar Markdown', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Não foi possível copiar')
  await expect(page.getByRole('textbox', { name: 'Conteúdo do documento' }).locator('h1')).toHaveText('Um espaço para suas ideias')
})

test('open tabs, their order, selection and closed tabs survive reload', async ({ page }) => {
  await open(page)
  for (const name of ['Um', 'Dois', 'Três']) {
    await page.locator('input[accept=".md,.markdown,.txt"]').setInputFiles({ name: `${name}.md`, mimeType: 'text/markdown', buffer: Buffer.from(`# ${name}`) })
    await expect(page.locator('.document-tab.active')).toContainText(`${name}.md`)
  }
  const tabLabels = page.locator('.document-tab > button:first-child > span')
  const originalOrder = ['Um espaço para suas ideias.md', 'Um.md', 'Dois.md', 'Três.md']
  await page.locator('.document-tab').nth(1).locator('button').first().click()
  await expect(page.locator('.save-indicator')).toHaveText('Tudo salvo')
  await page.reload()
  await expect(tabLabels).toHaveText(originalOrder)
  await expect(page.locator('.document-tab.active')).toContainText('Um.md')
  await page.getByRole('button', { name: 'Fechar aba Dois', exact: true }).click()
  await expect(page.locator('.save-indicator')).toHaveText('Tudo salvo')
  await page.reload()
  const remaining = ['Um espaço para suas ideias.md', 'Um.md', 'Três.md']
  await expect(tabLabels).toHaveText(remaining)
  await expect(page.locator('.document-tab.active')).toContainText('Um.md')
  await page.getByRole('button', { name: 'Lume — voltar ao início', exact: true }).click()
  await expect(page.locator('.save-indicator')).toHaveText('Tudo salvo')
  await page.reload()
  await expect(page.locator('.empty-workspace')).toBeVisible()
  await expect(tabLabels).toHaveText(remaining)
  await page.locator('.document-tab').nth(1).locator('button').first().click()
  await page.getByRole('button', { name: 'Fechar aba Um', exact: true }).click()
  await expect(page.locator('.document-tab.active')).toContainText('Três.md')
  await expect(page.locator('.save-indicator')).toHaveText('Tudo salvo')
  await page.reload()
  await expect(tabLabels).toHaveText(['Um espaço para suas ideias.md', 'Três.md'])
  await expect(page.locator('.document-tab.active')).toContainText('Três.md')
  await page.getByRole('button', { name: 'Fechar aba Três', exact: true }).click()
  await page.getByRole('button', { name: 'Fechar aba Um espaço para suas ideias', exact: true }).click()
  await expect(page.locator('.save-indicator')).toHaveText('Tudo salvo')
  await page.reload()
  await expect(page.locator('.empty-workspace')).toBeVisible()
  await expect(tabLabels).toHaveCount(0)
  await expect(page.locator('.document-item')).toHaveCount(4)
})

test('tabs fit at fractional zoom and still scroll horizontally when needed', async ({ page }) => {
  await open(page)
  const tabs = page.locator('.tabs-scroll')
  for (const zoom of [0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5]) {
    await page.evaluate(value => { document.documentElement.style.zoom = String(value) }, zoom)
    const metrics = await tabs.evaluate(element => ({ height: element.clientHeight, contentHeight: element.scrollHeight, width: element.clientWidth, contentWidth: element.scrollWidth }))
    expect(metrics.contentHeight, `vertical overflow at ${zoom}`).toBeLessThanOrEqual(metrics.height)
    expect(metrics.contentWidth, `single-tab horizontal overflow at ${zoom}`).toBeLessThanOrEqual(metrics.width)
  }
  await page.evaluate(() => { document.documentElement.style.zoom = '1' })
  await page.setViewportSize({ width: 1000, height: 960 })
  for (let index = 1; index <= 5; index++) {
    await page.locator('input[accept=".md,.markdown,.txt"]').setInputFiles({ name: `Documento com um título longo número ${index}.md`, mimeType: 'text/markdown', buffer: Buffer.from(`# Documento ${index}`) })
    await expect(page.locator('.document-tab')).toHaveCount(index + 1)
  }
  expect(await tabs.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  const tabLabels = page.locator('.document-tab > button:first-child > span')
  const originalOrder = await tabLabels.allTextContents()
  const first = page.locator('.document-tab').first().locator('button').first()
  await first.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Conteúdo do documento' }).locator('h1')).toHaveText('Um espaço para suas ideias')
  await expect(tabLabels).toHaveText(originalOrder)
  for (const index of [2, 0, 4, 2, 2]) {
    await page.locator('.document-tab').nth(index).locator('button').first().click()
    await expect(page.locator('.document-tab.active > button:first-child > span')).toHaveText(originalOrder[index])
    await expect(tabLabels).toHaveText(originalOrder)
  }
  await page.locator('.document-select').filter({ hasText: 'Documento com um título longo número 1' }).click()
  await expect(page.locator('.document-tab.active > button:first-child > span')).toHaveText(originalOrder[1])
  await expect(tabLabels).toHaveText(originalOrder)
  await page.getByRole('button', { name: 'Buscar documentos Ctrl K' }).click()
  await page.getByRole('textbox', { name: 'Buscar na biblioteca' }).fill('Documento com um título longo número 3')
  await page.locator('.search-results > button').click()
  await expect(page.locator('.document-tab.active > button:first-child > span')).toHaveText(originalOrder[3])
  await expect(tabLabels).toHaveText(originalOrder)
  await expect(page.getByRole('button', { name: 'Criar documento', exact: true })).toBeVisible()
})
