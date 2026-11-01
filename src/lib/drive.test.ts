import { createSeedLibrary } from './seed'
import { validateLibrary } from './library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DriveClient, DriveError, fingerprint, isMarkdown, markdownName, syncDecision } from './drive'

afterEach(() => vi.unstubAllGlobals())
describe('Drive synchronization decisions', () => {
  it('distinguishes local, remote and concurrent edits, including a converged conflict', () => {
    expect(syncDecision('a', 'a', 'old')).toBe('equal')
    expect(syncDecision('new', 'old', 'old')).toBe('push')
    expect(syncDecision('old', 'new', 'old')).toBe('pull')
    expect(syncDecision('local', 'remote', 'old')).toBe('conflict')
    expect(syncDecision('edited', 'uploaded', '')).toBe('conflict')
  })
  it('uses content and normalized names, not timestamps, to detect changes', async () => {
    expect(await fingerprint({ name: 'Texto.md', content: 'abc' })).toBe(await fingerprint({ name: 'Texto', content: 'abc' }))
    expect(await fingerprint({ name: 'Texto', content: 'def' })).not.toBe(await fingerprint({ name: 'Texto', content: 'abc' }))
    expect(await fingerprint({ name: 'Outro', content: 'abc' })).not.toBe(await fingerprint({ name: 'Texto', content: 'abc' }))
    expect(markdownName('\u0000Documento.markdown')).toBe('Documento')
    expect(isMarkdown({ title: 'Texto.md', mimeType: 'application/vnd.google-apps.document' } as never)).toBe(false)
  })
})
describe('Drive HTTP boundary', () => {
  const file = { id: 'file-1', title: 'Texto.md', mimeType: 'text/markdown', etag: '"v1"', version: '1', fileSize: '3' }
  const client = () => new DriveClient('test-token', Date.now() + 60000)
  it('never sends an expired credential', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await expect(new DriveClient('expired', 0).metadata('id')).rejects.toMatchObject({ status: 401 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects a changing remote snapshot before importing its content', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(file)).mockResolvedValueOnce(new Response('abc')).mockResolvedValueOnce(Response.json({ ...file, etag: '"v2"' }))
    vi.stubGlobal('fetch', fetch)
    await expect(client().read('file-1')).rejects.toMatchObject({ status: 412 })
  })
  it('rejects unsupported and oversized files before downloading', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...file, fileSize: '10000001' })); vi.stubGlobal('fetch', fetch)
    await expect(client().read('file-1')).rejects.toThrow('10 MB')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('writes with a conditional version and propagates concurrent write failures', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 412 })); vi.stubGlobal('fetch', fetch)
    await expect(client().write('file-1', { name: 'Texto', content: 'mine' }, '"v1"')).rejects.toBeInstanceOf(DriveError)
    expect(fetch.mock.calls[0][1].headers['If-Match']).toBe('"v1"')
    expect(fetch.mock.calls[0][1].body).toContain('mine')
    expect(fetch.mock.calls[0][1].method).toBe('PUT')
  })
  it('uses a preallocated ID when creating, allowing safe retries', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(file)); vi.stubGlobal('fetch', fetch)
    await client().write('reserved-id', { name: 'Texto.md', content: 'abc' }, undefined, 'folder-1')
    const body = fetch.mock.calls[0][1].body
    expect(body).toContain('"id":"reserved-id"')
    expect(body).toContain('"parents":[{"id":"folder-1"}]')
    expect(body).toContain('"title":"Texto.md"')
    expect(body).not.toContain('Texto.md.md')
  })
  it('paginates folder discovery and filters Google-native documents', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ items: [file], nextPageToken: 'next' })).mockResolvedValueOnce(Response.json({ items: [{ ...file, id: 'native', mimeType: 'application/vnd.google-apps.document' }] }))
    vi.stubGlobal('fetch', fetch)
    expect(await client().list('folder-1')).toHaveLength(1)
    expect(fetch.mock.calls[1][0]).toContain('pageToken=next')
  })
  it('requires a version when moving a file to trash', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({})); vi.stubGlobal('fetch', fetch)
    await client().trash(file)
    expect(fetch.mock.calls[0][1].headers['If-Match']).toBe('"v1"')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ labels: { trashed: true } })
    await expect(client().trash({ ...file, etag: '' })).rejects.toThrow('versão')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})


describe('persisted Drive links', () => {
  it('preserves links through validation without including tokens and accepts legacy documents', () => {
    const library = createSeedLibrary(100)
    expect(validateLibrary(library).documents[0].drive).toBeUndefined()
    library.documents[0].localOnly = true
    expect(validateLibrary(library).documents[0].localOnly).toBe(true)
    library.documents[0].drive = { account: 'account-a', fileId: 'file-a', base: 'a'.repeat(64) }
    expect(validateLibrary(library).documents[0].drive).toEqual(library.documents[0].drive)
    library.documents.push({ ...library.documents[0], id: 'duplicate-link' })
    expect(() => validateLibrary(library)).toThrow('mesmo arquivo do Drive')
    library.documents.pop()
    library.documents[0].drive.base = 'invalid'
    expect(() => validateLibrary(library)).toThrow('versão do Drive')
  })
})
