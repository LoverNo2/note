import './style.css'
import { loadSettingsIntoStorage } from './composables/settingsFile'

/**
 * 先把项目文件里的界面配置灌入 localStorage，再引入并挂载应用，
 * 这样各 composable 初始化时读到的就是文件里的配置（换仓库也能带过来）。
 */
loadSettingsIntoStorage().then(async () => {
  const { createApp } = await import('vue')
  const App = (await import('./App.vue')).default
  createApp(App).mount('#app')
})
