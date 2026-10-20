import pkg from './package.json'

export default defineNuxtConfig({
  compatibilityDate: '2026-08-29',
  devtools: { enabled: true },
  modules: ['@nuxt/ui'],
  future: {
    compatibilityVersion: 4,
  },
  css: ['~/assets/css/main.css'],
  // Unica fonte della versione: package.json, letto al build
  runtimeConfig: {
    public: {
      appVersion: pkg.version,
    },
  },
  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },
  colorMode: {
    preference: 'dark',
  },
  devServer: {
    host: '0.0.0.0',
    port: 3333,
  },
  vite: {
    server: {
      allowedHosts: true,
    },
  },
})
