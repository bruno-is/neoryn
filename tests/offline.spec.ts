import { expect, test } from '@playwright/test'

test('production build works under a repository path and after going offline', async ({ page, context }) => {
  test.skip(!process.env.NEORYN_PRODUCTION_TEST, 'Run against the built site: NEORYN_PRODUCTION_TEST=1')
  await page.goto(process.env.NEORYN_PRODUCTION_URL || 'http://127.0.0.1:4175/neoryn/')
  await expect(page.getByRole('textbox', { name: 'Conteúdo do documento' })).toBeVisible()
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await page.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill('# Trabalho offline\n\nMeu texto continua aqui.')
  await expect(page.locator('.save-indicator')).toHaveText('Tudo salvo')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
  })
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href
    return (await fetch(href)).json()
  })
  expect(manifest.short_name).toBe('Neoryn')
  expect(manifest.scope).toBe('./')
  expect(manifest.start_url).toBe('./')
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(['any', '192x192', '512x512', '512x512'])
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  expect(scope).toBe(page.url())
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue('# Trabalho offline\n\nMeu texto continua aqui.')
  await page.getByRole('button', { name: 'Escrever', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Conteúdo do documento' })).toBeVisible()
  await page.getByRole('button', { name: 'Modo leitura', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Trabalho offline', exact: true })).toBeVisible()
  const assets = await page.evaluate(async () => {
    const paths = ['favicon.svg', 'brand/logo-light.svg', 'brand/logo-dark.svg', 'brand/symbol.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png']
    return Promise.all(paths.map(async path => {
      const response = await fetch(path)
      if (path.endsWith('.png')) {
        const bitmap = await createImageBitmap(await response.blob())
        return { path, ok: response.ok, size: bitmap.width }
      }
      return { path, ok: response.ok }
    }))
  })
  for (const asset of assets) expect(asset.ok, asset.path).toBe(true)
  expect(assets.filter(asset => asset.size).map(asset => asset.size)).toEqual([192, 512, 512, 180])
})
