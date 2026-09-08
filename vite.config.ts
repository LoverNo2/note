import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { notesPlugin } from './server/notesMiddleware'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), notesPlugin()],
  server: {
    port: 5173,
    open: true,
  },
})
