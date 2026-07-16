import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Nutrition PWA',
        short_name: 'Nutrition',
        description: '端末内で使える個人用栄養管理アプリ',
        lang: 'ja',
        start_url: '/',
        display: 'standalone',
        theme_color: '#f4f7f2',
        background_color: '#f4f7f2',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,ico,png,json}'],
      },
    }),
  ],
})
