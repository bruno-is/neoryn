import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 1000 } })

async function saved(page: Page) {
  await expect(page.locator('.save-indicator')).toHaveText('Tudo salvo')
  await expect(page.getByRole('alert')).toHaveCount(0)
}

async function createFolder(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nova pasta', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nome da pasta').fill(name)
  await dialog.getByRole('button', { name: 'Criar', exact: true }).click()
}

async function createDocument(page: Page, name: string) {
  await page.getByRole('button', { name: 'Criar documento', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nome do documento').fill(name)
  await dialog.getByRole('button', { name: 'Criar', exact: true }).click()
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await page.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill(`# ${name}\n\nConteúdo preservado.`)
  await saved(page)
}

async function removeDialog(page: Page, folder: string) {
  await page.getByRole('button', { name: `Opções da pasta ${folder}`, exact: true }).click()
  await page.getByRole('button', { name: 'Remover pasta', exact: true }).click()
  return page.getByRole('dialog', { name: 'Remover pasta', exact: true })
}

const documentItem = (page: Page, name: string) => page.locator('.document-list .document-item').filter({ hasText: name })

test('folder deletion keeps nested documents by default and cancellation changes neither data nor preference', async ({ page }) => {
  await page.goto('./')
  await saved(page)
  await createFolder(page, 'Projeto')
  await createDocument(page, 'Documento principal')
  await createFolder(page, 'Subpasta')
  await createDocument(page, 'Documento filho')

  let dialog = await removeDialog(page, 'Projeto')
  await expect(dialog.getByLabel('O que fazer com os documentos?')).toHaveValue('keep')
  await dialog.getByLabel('O que fazer com os documentos?').selectOption('trash')
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Opções da pasta Subpasta', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue('# Documento filho\n\nConteúdo preservado.')
  dialog = await removeDialog(page, 'Projeto')
  await expect(dialog.getByLabel('O que fazer com os documentos?')).toHaveValue('keep')
  await dialog.getByRole('button', { name: 'Confirmar remoção', exact: true }).click()
  await saved(page)
  await expect(page.locator('.folder-row')).toHaveCount(0)
  await expect(documentItem(page, 'Documento principal')).toHaveCount(1)
  await expect(documentItem(page, 'Documento filho')).toHaveCount(1)
  await page.reload()
  await saved(page)
  await expect(page.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue('# Documento filho\n\nConteúdo preservado.')
  await expect(page.locator('.breadcrumbs')).toContainText('Documentos')
  await page.getByRole('button', { name: 'Lixeira', exact: true }).click()
  await expect(page.locator('.document-list .document-item')).toHaveCount(0)
})

test('folder deletion trashes the entire tree, remembers the choice after reopening and allows changing it', async ({ page, context }) => {
  await page.goto('./')
  await saved(page)
  await createFolder(page, 'Remover')
  await createDocument(page, 'Nota da pasta')
  await createFolder(page, 'Filha')
  await createDocument(page, 'Nota da subpasta')
  let dialog = await removeDialog(page, 'Remover')
  await dialog.getByLabel('O que fazer com os documentos?').selectOption('trash')
  await expect(dialog).toContainText('Você poderá restaurá-los depois.')
  await dialog.getByRole('button', { name: 'Confirmar remoção', exact: true }).click()
  await saved(page)
  await expect(page.locator('.folder-row')).toHaveCount(0)
  await expect(documentItem(page, 'Nota da pasta')).toHaveCount(0)
  await expect(documentItem(page, 'Nota da subpasta')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Restaurar documento', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Lixeira', exact: true }).click()
  await expect(documentItem(page, 'Nota da pasta')).toHaveCount(1)
  await expect(documentItem(page, 'Nota da subpasta')).toHaveCount(1)
  await page.close()

  const reopened = await context.newPage()
  await reopened.goto('./')
  await saved(reopened)
  await reopened.getByRole('button', { name: 'Restaurar documento', exact: true }).click()
  await expect(reopened.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue('# Nota da subpasta\n\nConteúdo preservado.')
  await createFolder(reopened, 'Vazia')
  dialog = await removeDialog(reopened, 'Vazia')
  await expect(dialog.getByLabel('O que fazer com os documentos?')).toHaveValue('trash')
  await dialog.getByLabel('O que fazer com os documentos?').selectOption('keep')
  await dialog.getByRole('button', { name: 'Confirmar remoção', exact: true }).click()
  await saved(reopened)
  await reopened.reload()
  await saved(reopened)
  await createFolder(reopened, 'Próxima')
  dialog = await removeDialog(reopened, 'Próxima')
  await expect(dialog.getByLabel('O que fazer com os documentos?')).toHaveValue('keep')
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await reopened.getByRole('navigation', { name: 'Biblioteca' }).getByRole('button', { name: /^Todos os documentos/ }).click()
  await expect(documentItem(reopened, 'Nota da subpasta')).toHaveCount(1)
  await expect(documentItem(reopened, 'Um espaço para suas ideias')).toHaveCount(1)
  await reopened.getByRole('button', { name: 'Lixeira', exact: true }).click()
  await expect(documentItem(reopened, 'Nota da pasta')).toHaveCount(1)
})
