import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { notesPlugin } from './server/notesMiddleware'
import { settingsPlugin } from './server/settingsMiddleware'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), notesPlugin(), settingsPlugin()],
  server: {
    port: 5173,
    open: true,
  },
})
