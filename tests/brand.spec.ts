import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createSeedLibrary } from '../src/lib/seed'
import { legacyWelcome } from '../src/lib/legacyWelcome'

async function tokenColor(page: Page, token: string) {
  return page.evaluate(name => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, token)
}

test('Markdown, code, diagrams and exported HTML share Graphite Blue in both themes', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('./')
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  const markdown = '# Graphite Blue\n\nClareza para **escrever** e *pensar*. [Uma referência](https://example.com) e `código inline`.\n\n> Espaço para o que importa.\n\n- [x] Uma ideia organizada\n- [ ] Próximo passo\n\n| Ideia | Estado |\n| --- | --- |\n| Ensaio | Em andamento |\n\n```javascript\n// Uma ideia por vez\nconst mensagem = "Olá";\nfunction criar() { return 42; }\n```\n\n$$\nE = mc^2\n$$\n\n```mermaid\nflowchart LR\nA[Ideia] --> B[Rascunho] --> C[Texto]\n```'
  await page.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill(markdown)
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Usar tema escuro', exact: true }).click()
    await page.getByRole('button', { name: 'Escrever', exact: true }).click()
    await expect(page.locator('.cm-editor').first()).toBeVisible()
    await expect(page.locator('.document-scroll')).toHaveCSS('background-color', await tokenColor(page, '--paper'))
    await expect(page.locator('.milkdown')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.cm-content').first()).toHaveCSS('color', await tokenColor(page, '--text'))
    await page.getByRole('button', { name: 'Dividido', exact: true }).click()
    await expect(page.locator('.split-preview .mermaid-diagram .node rect').first()).toHaveCSS('fill', await tokenColor(page, '--diagram-node'))
    await page.getByRole('button', { name: 'Modo leitura', exact: true }).click()
    const reader = page.locator('.reader')
    await expect(reader.locator('a').first()).toHaveCSS('color', await tokenColor(page, '--accent'))
    await expect(reader.locator('blockquote')).toHaveCSS('background-color', await tokenColor(page, '--subtle'))
    await expect(reader.locator('table th').first()).toHaveCSS('background-color', await tokenColor(page, '--surface'))
    await expect(reader.locator('input[type=checkbox]:checked')).toHaveCSS('background-color', await tokenColor(page, '--accent'))
    for (const category of ['keyword', 'string', 'number', 'comment']) {
      await expect(reader.locator(`.hljs-${category}`).first()).toHaveCSS('color', await tokenColor(page, `--syntax-${category}`))
    }
    await expect(reader.locator('.mermaid-diagram .node rect').first()).toHaveCSS('fill', await tokenColor(page, '--diagram-node'))
    await expect(reader.locator('.mermaid-diagram .node rect').first()).toHaveCSS('stroke', await tokenColor(page, '--control-border'))
    await expect(reader.locator('.katex').first()).toBeVisible()
    await reader.locator('.reading-code-block').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`markdown-${theme}.png`) })
    await page.getByRole('button', { name: 'Exportar', exact: true }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Página HTML', exact: true }).click()
    const html = await readFile((await (await downloadPromise).path())!, 'utf8')
    expect(html).toMatch(theme === 'light' ? /--paper:#(?:FFFFFF|FFF)(?:;|})/i : /--paper:#181A1F(?:;|})/i)
    expect(html).toContain('color:var(--accent)')
    await page.getByRole('button', { name: 'Voltar à edição', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Preferências', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', await tokenColor(page, '--paper'))
  const appearance = page.getByLabel('Aparência', { exact: true })
  await appearance.focus()
  await expect(appearance).toHaveCSS('outline-color', await tokenColor(page, '--focus'))
  await expect(appearance).toHaveCSS('border-top-color', await tokenColor(page, '--control-border'))
  await page.keyboard.press('Escape')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.new-document')).toHaveCSS('transition-duration', '0s')
  expect(errors).toEqual([])
})

test('identity is legible in both themes, follows preferences and fits mobile', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('./')
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
    const palette = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return Object.fromEntries(['bg', 'paper', 'sidebar', 'surface', 'subtle', 'hover', 'selection', 'border', 'text', 'muted', 'accent', 'accent-strong', 'brand-primary', 'brand-secondary'].map(token => {
        const hex = style.getPropertyValue(`--${token}`).trim().toUpperCase()
        return [token, hex.replace(/^#([A-F\d])([A-F\d])([A-F\d])$/, '#$1$1$2$2$3$3')]
      }))
    })
    expect(palette).toEqual(theme === 'light' ? {
      bg: '#F7F8FA', paper: '#FFFFFF', sidebar: '#F0F2F5', surface: '#FFFFFF', subtle: '#F1F3F6', hover: '#E6ECF3', selection: '#E7F0FF', border: '#D9E0E9', text: '#1E2430', muted: '#586475', accent: '#1D5EC9', 'accent-strong': '#1D4ED8', 'brand-primary': '#3B82F6', 'brand-secondary': '#93C5FD',
    } : {
      bg: '#181A1F', paper: '#181A1F', sidebar: '#121418', surface: '#252A31', subtle: '#202329', hover: '#2A2E36', selection: '#203651', border: '#333840', text: '#ECEFF4', muted: '#A1AAB8', accent: '#77B6FF', 'accent-strong': '#91C5FF', 'brand-primary': '#3B82F6', 'brand-secondary': '#93C5FD',
    })
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', new RegExp(`^${palette.bg}$`, 'i'))
    const contrast = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      const luminance = (name: string) => {
        const value = style.getPropertyValue(name).trim().slice(1)
        const hex = value.length === 3 ? [...value].map(digit => digit + digit).join('') : value
        const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
          .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
      }
      const pairs: [string, string, number][] = [
        ['--text', '--paper', 4.5], ['--muted', '--sidebar', 4.5], ['--accent', '--paper', 4.5], ['--on-accent', '--accent', 4.5],
        ['--on-accent', '--accent-strong', 4.5], ['--text', '--selection', 4.5], ['--accent', '--selection', 4.5], ['--muted', '--hover', 4.5],
        ['--text', '--surface-raised', 4.5], ['--muted', '--surface-raised', 4.5], ['--text-secondary', '--subtle', 4.5], ['--code-inline-text', '--code-inline-bg', 4.5],
        ...['--syntax-comment', '--syntax-keyword', '--syntax-string', '--syntax-number', '--syntax-title'].map(token => [token, '--code-bg', 4.5] as [string, string, number]),
        ...['--paper', '--sidebar', '--surface', '--selection'].flatMap(bg => [['--focus', bg, 3], ['--control-border', bg, 3]] as [string, string, number][]),
        ...['--diagram-node', '--diagram-secondary', '--diagram-tertiary'].flatMap(bg => [['--text', bg, 4.5], ['--control-border', bg, 3]] as [string, string, number][]),
        ['--success', '--paper', 4.5], ['--warning', '--warning-bg', 4.5], ['--danger', '--danger-bg', 4.5], ['--on-danger', '--danger-fill', 4.5],
      ]
      return pairs.map(([a, b, minimum]) => {
        const x = luminance(a), y = luminance(b)
        return { pair: `${a}/${b}`, minimum, ratio: (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
      })
    })
    for (const value of contrast) expect(value.ratio, `${theme}: ${value.pair}`).toBeGreaterThanOrEqual(value.minimum)
    for (const selector of ['.new-document', '.reading-button']) {
      const button = page.locator(selector)
      const colors = await button.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }))
      expect(colors).toEqual(theme === 'light' ? { color: 'rgb(255, 255, 255)', background: 'rgb(29, 78, 216)' } : { color: 'rgb(24, 26, 31)', background: 'rgb(145, 197, 255)' })
    }
    if (process.env.NEORYN_CAPTURE) await page.screenshot({ path: theme === 'light' ? 'docs/preview.png' : 'docs/preview-dark.png' })
  }
  await page.getByRole('button', { name: 'Preferências', exact: true }).click()
  await page.getByLabel('Aparência', { exact: true }).selectOption('system')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('button', { name: 'Usar tema escuro', exact: true })).toHaveCount(1)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: 'Usar tema claro', exact: true })).toHaveCount(1)
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
