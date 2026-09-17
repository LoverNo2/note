import { computed, ref, watch } from 'vue'
import { markSettingsDirty } from './settingsFile'

/**
 * 外观主题：浅色 / 黑夜模式。
 *
 * - 默认浅色，点顶栏「导出 PDF」左侧的按钮手动切换；
 * - 选择存 localStorage，并同步到项目 ui-settings.json（换机器 / 换仓库也跟着走）；
 * - 生效方式：<html data-theme="dark">，具体配色与深色下的各种适配全部写在
 *   src/style.css 的「黑夜模式」区块（@media screen 内，打印不受影响）。
 */

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'notebook:theme:v1'

function load(): ThemeMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

const theme = ref<ThemeMode>(load())
const isDark = computed(() => theme.value === 'dark')

function apply(value: ThemeMode): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (value === 'dark') root.setAttribute('data-theme', 'dark')
  else root.removeAttribute('data-theme')
}

let watching = false

/**
 * 应用主题并开始持久化。幂等：
 * - 每次都重新读一次 localStorage（启动时 ui-settings.json 会先灌进去，
 *   所以要等它灌完再调用，才能对文件里的选择生效）；
 * - watch 只挂一次，避免重复写入。
 */
export function initTheme(): void {
  theme.value = load()
  apply(theme.value)
  if (watching) return
  watching = true
  watch(theme, (value) => {
    apply(value)
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch {
      /* 存储不可用时忽略 */
    }
    markSettingsDirty()
  })
}

function setTheme(value: ThemeMode): void {
  theme.value = value
}

function toggleTheme(): void {
  theme.value = isDark.value ? 'light' : 'dark'
}

export function useTheme() {
  initTheme()
  return { theme, isDark, setTheme, toggleTheme }
}
