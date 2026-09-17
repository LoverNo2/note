import './style.css'
import { loadSettingsIntoStorage } from './composables/settingsFile'
import { initTheme } from './composables/useTheme'

/**
 * 先把项目文件里的界面配置灌入 localStorage，再定外观主题，最后引入并挂载应用，
 * 这样各 composable 初始化时读到的就是文件里的配置（换仓库也能带过来）。
 */
loadSettingsIntoStorage().then(async () => {
  // ui-settings.json 里的主题选择优先于浏览器里的旧值
  initTheme()
  const { createApp } = await import('vue')
  const App = (await import('./App.vue')).default
  createApp(App).mount('#app')
})
