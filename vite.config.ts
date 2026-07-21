import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const base = mode === 'github-pages' ? '/nutritionApp/' : '/'

  return {
    base,
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.endsWith('/data/mext/app/user_food_groups.json')) return 'mextUserFoodGroups'
            if (id.endsWith('/data/mext/app/user_food_group_mappings.json')) return 'mextUserFoodMappings'
            if (id.endsWith('/data/mext/app/user_food_search_index.json')) return 'mextUserFoodSearch'
          },
        },
      },
    },
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
          start_url: base,
          display: 'standalone',
          theme_color: '#f4f7f2',
          background_color: '#f4f7f2',
          icons: [
            { src: `${base}icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          ],
        },
        workbox: {
          navigateFallback: `${base}index.html`,
          globPatterns: ['**/*.{js,css,html,svg,ico,png,json}'],
          // 確定済みMEXTグループとvariant解決表をオフラインでも利用する。
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        },
      }),
    ],
  }
})
