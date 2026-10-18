import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

// Original folded N. All variants and raster icons share this geometry.
const ribbon = '<path d="M10 54V10h10v44Z" fill="url(#ribbon)"/><path d="M44 54V10h10v44Z" fill="url(#ribbon)"/><path d="M10 10h12l32 44H42Z" fill="url(#ribbon)"/><path d="m10 10 10 14v12L10 22Z" fill="#0F172A" opacity=".16"/><path d="m44 28 10 14v12L44 40Z" fill="#0F172A" opacity=".16"/>'
const gradient = '<defs><linearGradient id="ribbon" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#7C6CFF"/><stop offset="1" stop-color="#60A5FA"/></linearGradient></defs>'
const mono = '<path d="M10 54V10h12l22 30V10h10v44H42L20 24v30Z" fill="currentColor"/>'
// Custom geometric lowercase lettering, outlined so no font download is needed.
const letters = '<path d="M4 31V11m0 8c0-12 19-12 19 0v12M36 21h19c0-15-20-15-20 0 0 12 14 14 20 6M69 21c0-15 21-15 21 0s-21 15-21 0ZM103 31V11m0 9c0-7 5-10 12-9M126 11l9 20m10-20-13 31M158 31V11m0 8c0-12 19-12 19 0v12" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>'
const svg = (body, viewBox = '0 0 64 64', color = '#202638') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" color="${color}">${body}</svg>\n`
const symbol = svg(gradient + ribbon)
await mkdir('public/brand', { recursive: true })
await mkdir('public/icons', { recursive: true })
await writeFile('public/brand/symbol.svg', symbol)
await writeFile('public/brand/symbol-mono.svg', svg(mono))
for (const [variant, color] of [['light', '#202638'], ['dark', '#E5E7EB'], ['mono', '#202638']]) {
  await writeFile(`public/brand/logo-${variant}.svg`, svg((variant === 'mono' ? mono : gradient + ribbon) + `<g transform="translate(77 8)">${letters}</g>`, '0 0 260 64', color))
}
await writeFile('public/favicon.svg', svg('<rect width="64" height="64" rx="15" fill="#0F172A"/>' + gradient + ribbon))

// Browser rasterization keeps the SVG as the source of truth; no extra dependency.
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'msedge', headless: true })
try {
  const page = await browser.newPage()
  for (const [name, size, inset, background] of [
    ['icon-192', 192, 0, null], ['icon-512', 512, 0, null],
    ['maskable-512', 512, 10, '#0F172A'], ['apple-touch-icon', 180, 6, '#0F172A'],
  ]) {
    const source = svg((background ? `<rect width="64" height="64" fill="${background}"/>` : '') + gradient + `<g transform="translate(${inset} ${inset}) scale(${(64 - inset * 2) / 64})">${ribbon}</g>`)
    const data = await page.evaluate(async ({ source, size }) => {
      const image = new Image()
      image.src = 'data:image/svg+xml;base64,' + btoa(source)
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      canvas.getContext('2d').drawImage(image, 0, 0, size, size)
      return canvas.toDataURL('image/png').split(',')[1]
    }, { source, size })
    await writeFile(`public/icons/${name}.png`, Buffer.from(data, 'base64'))
  }
} finally { await browser.close() }
console.log('Neoryn: SVG identity and PNG application icons generated.')
