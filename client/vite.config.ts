import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//, /^\/socket\.io\//],
        runtimeCaching: [
          {
            urlPattern: /^\/uploads\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'torex-uploads-media-v1',
              expiration: {
                maxEntries: 250,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'torex-google-fonts-v1',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'TOREX JOURNAL',
        short_name: 'TOREX JOURNAL',
        description: 'Diário e Analytics para Traders Profissionais',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const norm = id.replace(/\\/g, '/');
          if (!norm.includes('/node_modules/')) return undefined;
          if (norm.includes('klinecharts') || norm.includes('@klinecharts')) {
            return 'vendor-kline';
          }
          if (norm.includes('lightweight-charts')) {
            return 'vendor-lw-charts';
          }
          if (norm.includes('chart.js') || norm.includes('react-chartjs-2')) {
            return 'vendor-chartjs';
          }
          if (norm.includes('@tinymce')) {
            return 'vendor-tinymce';
          }
          if (norm.includes('@paypal')) {
            return 'vendor-paypal';
          }
          if (norm.includes('socket.io-client') || norm.includes('engine.io-client') || norm.includes('protobufjs')) {
            return 'vendor-realtime';
          }
          if (norm.includes('emoji-picker-react') || norm.includes('html2canvas')) {
            return 'vendor-extras';
          }
          if (norm.includes('framer-motion')) {
            return 'vendor-motion';
          }
          if (norm.includes('/three/') || norm.includes('@react-three')) {
            return 'vendor-three';
          }
          if (norm.includes('/gsap/')) {
            return 'vendor-gsap';
          }
          if (
            norm.includes('/react/') ||
            norm.includes('/react-dom/') ||
            norm.includes('/react-router') ||
            norm.includes('/@remix-run/router/') ||
            norm.includes('/scheduler/')
          ) {
            return 'vendor-react';
          }
          return undefined;
        }
      }
    }
  },
  server: {
    allowedHosts: true,
    proxy: {
      '/api/quant': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true
      },
      '/api': {
        target: 'http://localhost:3010',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:3010',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:3010',
        ws: true
      }
    }
  }
})
