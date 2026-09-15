/**
 * 界面配置与项目文件的同步。
 *
 * 背景：样式配置原本只存在浏览器 localStorage 里，换仓库 / 换机器 / 换浏览器
 * 就会丢失。这里把它与项目内文件（`ui-settings.json`，由本地服务读写）同步：
 *
 *   1. 应用启动时先调用 `loadSettingsIntoStorage()`：
 *      - 文件里有配置 → 写入 localStorage（以文件为准），随后各 composable
 *        在初始化时自然读到它们；
 *      - 文件不存在（首次）→ 把当前 localStorage 里的配置写进文件。
 *   2. 之后任何配置改动调用 `markSettingsDirty()`，防抖后整体回写文件。
 *
 * 静态部署（没有该接口）时会自动降级为纯 localStorage，不影响使用。
 */

/** 参与同步的 localStorage 配置项 */
const SYNCED_KEYS = [
  'notebook:textStyles:v1',
  'notebook:textStyles:snapshots:v1',
  'notebook:codeBlockStyle:v1',
  'notebook:tableStyle:v1',
  'notebook:fonts:v1',
  // 迁移标记也一并同步，避免换机器后重复触发一次性迁移
  'notebook:textStyles:segGapMigrated',
  'notebook:textStyles:snapshots:segGapMigrated',
] as const

const API = '/api/settings'
const WRITE_DELAY = 800

/** 快照：把当前 localStorage 里的同步项打包成请求体 */
function collectValues(): Record<string, string> {
  const values: Record<string, string> = {}
  for (const key of SYNCED_KEYS) {
    try {
      const value = localStorage.getItem(key)
      if (value !== null) values[key] = value
    } catch {
      /* 忽略读取失败 */
    }
  }
  return values
}

async function pushSettings(): Promise<void> {
  try {
    await fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, values: collectValues() }),
    })
  } catch {
    /* 接口不可用（静态部署）时忽略，配置仍留在 localStorage */
  }
}

let writeTimer = 0

/** 配置有改动：防抖回写项目文件 */
export function markSettingsDirty(): void {
  if (typeof window === 'undefined') return
  window.clearTimeout(writeTimer)
  writeTimer = window.setTimeout(() => {
    void pushSettings()
  }, WRITE_DELAY)
}

/**
 * 启动时把项目文件里的配置灌入 localStorage。
 * 必须在应用（及其 composable）初始化之前 await 完成。
 */
export async function loadSettingsIntoStorage(): Promise<void> {
  let incoming: Record<string, unknown> | null = null
  try {
    const res = await fetch(API)
    if (res.ok) {
      const data: unknown = await res.json()
      if (data && typeof data === 'object') {
        const values = (data as Record<string, unknown>).values
        if (values && typeof values === 'object') {
          incoming = values as Record<string, unknown>
        }
      }
    }
  } catch {
    /* 没有接口：纯本地模式 */
  }

  if (!incoming || Object.keys(incoming).length === 0) {
    // 文件还不存在：把当前浏览器的配置写进去（首次使用时建立文件）
    const values = collectValues()
    if (Object.keys(values).length > 0) await pushSettings()
    return
  }

  for (const key of SYNCED_KEYS) {
    const value = incoming[key]
    if (typeof value !== 'string') continue
    try {
      localStorage.setItem(key, value)
    } catch {
      /* 忽略写入失败 */
    }
  }
}
