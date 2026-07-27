import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // jsdom defaults to the "about:blank" opaque origin when no URL is set,
    // which makes localStorage/sessionStorage throw SecurityError — give it
    // a real origin instead.
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    globals: true,
    setupFiles: ['./src/setupTests.js'],
  },
})
