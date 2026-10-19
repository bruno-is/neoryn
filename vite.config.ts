import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['favicon.svg', 'brand/*.svg', 'icons/*.png'],
    manifest: {
      name: 'Neoryn — Um espaço para suas ideias.', short_name: 'Neoryn',
      description: 'Escreva, organize e desenvolva suas ideias em um ambiente pessoal, sem distrações.',
      theme_color: '#181A1F', background_color: '#F7F8FA', display: 'standalone',
      id: './', start_url: './', scope: './', lang: 'pt-BR',
      icons: [
        { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: { clientsClaim: true, globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,ttf}'], maximumFileSizeToCacheInBytes: 8 * 1024 * 1024, navigateFallback: 'index.html' },
  })],
  build: { chunkSizeWarningLimit: 1200 },
})
