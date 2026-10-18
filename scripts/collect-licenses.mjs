import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
const sections = ['Neoryn — third-party software notices\n\nThe following notices belong to installed runtime dependencies. Each package retains its own license and copyright.\n']
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev) continue
  const files = await readdir(path).catch(() => [])
  const names = files.filter(name => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(name))
  if (!names.length) continue
  sections.push(`\n${'='.repeat(70)}\n${path.replace(/^node_modules\//, '')} ${entry.version}\nLicense: ${entry.license || 'See the following notice'}\n`)
  for (const name of names) {
    const body = await readFile(join(path, name), 'utf8').catch(() => null)
    if (body) sections.push(`\n--- ${name} ---\n${body}\n`)
  }
}
await writeFile('public/third-party-licenses.txt', sections.join('\n'))
console.log('Runtime license notices collected.')
