import { expect, test, type Page } from '@playwright/test'

async function mockDrive(page: Page) {
  const files = new Map<string, { id: string; title: string; content: string; etag: string; mimeType: string; labels?: { trashed: boolean }; userPermission: { role: string } }>([
    ['folder', { id: 'folder', title: 'Neoryn', content: '', etag: '1', mimeType: 'application/vnd.google-apps.folder', userPermission: { role: 'owner' } }],
    ['remote', { id: 'remote', title: 'Importado.md', content: '# Original\n\nTexto do Drive.', etag: '1', mimeType: 'text/markdown', userPermission: { role: 'owner' } }],
  ])
  const state = { writes: 0, unauthorized: false, account: 'account-a', counter: 0 }
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'application/javascript', body: `window.google={accounts:{oauth2:{initTokenClient:opts=>({requestAccessToken:()=>opts.callback({access_token:'test-access-token',expires_in:3600,scope:'https://www.googleapis.com/auth/drive.file'})})}}};` }))
  await page.route('https://apis.google.com/js/api.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.gapi={load:(name,opts)=>{ window.google.picker={ViewId:{FOLDERS:'folders',DOCS:'docs'},Action:{PICKED:'picked',CANCEL:'cancel'},Feature:{MULTISELECT_ENABLED:'multi'},
      DocsView:class{constructor(kind){this.kind=kind}setIncludeFolders(){return this}setSelectFolderEnabled(){return this}setMimeTypes(){return this}setQuery(){return this}},
      PickerBuilder:class{addView(view){this.view=view;return this}setOAuthToken(){return this}setDeveloperKey(){return this}setAppId(){return this}setOrigin(){return this}setLocale(){return this}setTitle(){return this}setCallback(cb){this.cb=cb;return this}enableFeature(){return this}build(){return this}setVisible(){this.cb({action:'picked',docs:[{id:this.view.kind==='folders'?'folder':'remote',name:'Arquivo'}]})}}
    };opts.callback()}};` }))
  await page.route('https://www.googleapis.com/**', async route => {
    const url = new URL(route.request().url()), method = route.request().method()
    if (state.unauthorized) return route.fulfill({ status: 401, json: {} })
    if (url.pathname.endsWith('/about')) return route.fulfill({ json: { user: { permissionId: state.account, emailAddress: `${state.account}@example.com` } } })
    if (url.pathname.endsWith('/generateIds')) return route.fulfill({ json: { ids: [`new-${++state.counter}`] } })
    const id = url.pathname.split('/files/')[1]
    if (url.pathname.includes('/upload/') && ['POST', 'PUT'].includes(method)) {
      const body = route.request().postData()!
      const meta = JSON.parse(body.split('\r\n\r\n')[1].split('\r\n--')[0])
      const content = body.split('Content-Type: text/markdown; charset=UTF-8\r\n\r\n')[1].split('\r\n--neoryn_')[0]
      const old = files.get(id || meta.id)
      if (method === 'PUT' && route.request().headers()['if-match'] !== old?.etag) return route.fulfill({ status: 412, json: {} })
      const file = { ...meta, id: id || meta.id, content, etag: String(Number(old?.etag || 0) + 1), userPermission: { role: 'owner' } }
      files.set(file.id, file); state.writes++; return route.fulfill({ json: file })
    }
    if (!id) return route.fulfill({ json: { items: [...files.values()].filter(file => !file.labels?.trashed) } })
    const file = files.get(id)
    if (!file) return route.fulfill({ status: 404, json: {} })
    if (method === 'PATCH') { file.labels = { trashed: true }; return route.fulfill({ json: file }) }
    if (url.searchParams.get('alt') === 'media') return route.fulfill({ body: file.content, contentType: 'text/markdown' })
    return route.fulfill({ json: { ...file, version: file.etag, fileSize: String(file.content.length) } })
  })
  return { files, state }
}
async function open(page: Page) { await page.getByRole('button', { name: 'Google Drive', exact: true }).click() }
async function connect(page: Page) {
  await open(page)
  await expect(page.getByRole('button', { name: 'Conectar ao Google Drive', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Conectar ao Google Drive', exact: true }).click()
  await expect(page.getByText('account-a@example.com', { exact: true })).toBeVisible()
}
async function close(page: Page) { await expect(page.getByRole('button', { name: 'Fechar Google Drive' })).toBeEnabled(); await page.getByRole('button', { name: 'Fechar Google Drive' }).click() }

test('Drive imports once, saves manually, preserves conflicts, and reconnects without storing tokens', async ({ page }) => {
  const { files, state } = await mockDrive(page)
  await page.goto('./'); await connect(page)
  await page.getByRole('button', { name: 'Importar do Drive', exact: true }).click()
  await expect(page.locator('.drive-document').filter({ hasText: 'Importado' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Importar do Drive', exact: true }).click()
  await expect(page.locator('.drive-document').filter({ hasText: 'Importado' })).toHaveCount(1)
  await close(page)
  await page.locator('.document-item').filter({ hasText: 'Importado' }).click()
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await page.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill('# Alteração local')
  await expect(page.locator('.save-indicator')).toHaveText('Tudo salvo')
  expect(state.writes).toBe(0)
  await open(page); await page.getByRole('button', { name: 'Sincronizar agora', exact: true }).click()
  await expect.poll(() => files.get('remote')?.content).toBe('# Alteração local')
  await close(page)
  await page.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill('# Minha segunda versão')
  files.get('remote')!.content = '# Alteração externa'; files.get('remote')!.etag = '3'
  await open(page); await page.getByRole('button', { name: 'Sincronizar agora', exact: true }).click()
  await expect(page.getByText('Versões que precisam da sua escolha')).toBeVisible()
  expect(files.get('remote')!.content).toBe('# Alteração externa')
  await page.getByRole('button', { name: 'Manter ambas', exact: true }).click()
  await expect(page.locator('.drive-document').filter({ hasText: 'Importado (cópia local)' })).toBeVisible()
  await page.getByRole('switch', { name: 'Salvar automaticamente no Drive', exact: false }).check()
  const stored = await page.evaluate(() => JSON.stringify(localStorage))
  expect(stored).not.toContain('test-access-token')
  await close(page); await page.reload(); await connect(page)
  await expect(page.getByRole('switch', { name: 'Salvar automaticamente no Drive', exact: false })).toBeChecked()
  state.unauthorized = true
  await page.getByRole('button', { name: 'Sincronizar agora', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Reconecte')
  await expect(page.getByRole('button', { name: 'Conectar ao Google Drive', exact: true })).toBeEnabled()
})

test('Drive uploads, autosaves, discovers authorized files and explicitly trashes remote files', async ({ page }) => {
  const { files, state } = await mockDrive(page)
  await page.goto('./'); await connect(page)
  await page.getByRole('button', { name: 'Escolher pasta de destino' }).click()
  await expect(page.getByRole('button', { name: 'Neoryn', exact: true })).toBeVisible()
  const row = page.locator('.drive-document').first()
  await row.getByRole('checkbox').first().check()
  await page.getByRole('button', { name: 'Enviar selecionados (1)' }).click()
  await expect.poll(() => state.writes).toBe(1)
  await page.getByRole('switch', { name: 'Salvar automaticamente no Drive', exact: false }).check()
  await page.getByRole('switch', { name: 'Importar novos arquivos automaticamente', exact: false }).check()
  await close(page)
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await page.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill('# Autosave')
  await expect.poll(() => files.get('new-1')?.content, { timeout: 15000 }).toBe('# Autosave')
  await open(page)
  await expect(page.locator('.drive-document').filter({ hasText: 'Importado' })).toBeVisible()
  const remote = page.locator('.drive-document').filter({ hasText: 'Importado' })
  await remote.getByRole('button', { name: 'Lixeira do Drive' }).click()
  expect(files.get('remote')!.labels?.trashed).toBeFalsy()
  await page.getByRole('button', { name: 'Confirmar envio à lixeira' }).click()
  await expect.poll(() => files.get('remote')!.labels?.trashed).toBe(true)
  await expect(remote).toContainText('Somente neste navegador')
  await close(page)
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Recolher biblioteca' }).click(); await open(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'investigation/drive-mobile.png', fullPage: true, animations: 'disabled' })
})

test('Drive queues new documents offline and keeps account boundaries and local-only choices', async ({ page, context }) => {
  const { files, state } = await mockDrive(page)
  await page.goto('./'); await connect(page)
  await page.getByRole('button', { name: 'Escolher pasta de destino' }).click()
  await page.getByRole('switch', { name: 'Enviar novos documentos automaticamente', exact: false }).check()
  await close(page)
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Criar documento', exact: true }).click()
  await page.getByLabel('Nome do documento').fill('Novo offline')
  await page.getByRole('button', { name: 'Criar', exact: true }).click()
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await page.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill('# Conteúdo offline')
  await expect(page.locator('.save-indicator')).toHaveText('Tudo salvo')
  expect(state.writes).toBe(0)
  await context.setOffline(false)
  await expect.poll(() => [...files.values()].find(file => file.title === 'Novo offline.md')?.content).toBe('# Conteúdo offline')
  expect(state.writes).toBe(1) // The pre-existing welcome document was not uploaded.
  await open(page)
  await expect(page.locator('.drive-document').filter({ hasText: 'Novo offline' })).toContainText('Sincronizado')
  await page.getByRole('button', { name: 'Desconectar', exact: true }).click()
  state.account = 'account-b'
  await page.getByRole('button', { name: 'Conectar ao Google Drive', exact: true }).click()
  await expect(page.getByText('account-b@example.com', { exact: true })).toBeVisible()
  await expect(page.locator('.drive-document').filter({ hasText: 'Novo offline' })).toContainText('Vinculado a outra conta')
  await page.getByRole('button', { name: 'Sincronizar agora', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Fechar Google Drive' })).toBeEnabled()
  expect(state.writes).toBe(1)
  await page.screenshot({ path: 'investigation/drive-desktop.png', fullPage: true, animations: 'disabled' })
})
