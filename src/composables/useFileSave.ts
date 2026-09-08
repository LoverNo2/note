import { ref } from 'vue'
import { useNotes } from './useNotes'
import { useToast } from './useToast'
import { buildBackup, defaultBackupName } from '../utils/backup'

/**
 * 「保存到本地文件」：首次通过系统另存为选择位置并授权，
 * 之后按 ⌘S / Ctrl+S 直接原地覆盖同一文件，不再弹出另存为。
 *
 * 依赖 File System Access API（Chrome / Edge）。
 * Safari / Firefox 不支持时自动降级为普通下载（每次都会下载一份文件）。
 */

/* ---- File System Access API 的本地最小类型（TS DOM lib 尚未收录完整） ---- */
interface PickerOptions {
  suggestedName?: string
  types?: Array<{ description?: string; accept: Record<string, string[]> }>
}
interface WritableLike {
  write(data: string): Promise<void>
  close(): Promise<void>
}
export interface PickerFileHandle {
  name: string
  queryPermission?(opts?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(opts?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  createWritable?(): Promise<WritableLike>
}
type SavePickerFn = (opts?: PickerOptions) => Promise<PickerFileHandle>

/* ---- IndexedDB：跨会话记住已授权的文件句柄 ---- */
const DB_NAME = 'notebook-file-target'
const DB_VERSION = 1
const STORE = 'targets'
const TARGET_KEY = 'main'

interface StoredTarget {
  name: string
  handle: PickerFileHandle
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('无法打开本地索引库'))
    })
  }
  return dbPromise
}

async function idbPut(target: StoredTarget): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(target, TARGET_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

async function idbGet(): Promise<StoredTarget | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(TARGET_KEY)
    req.onsuccess = () => resolve(req.result as StoredTarget | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function idbClear(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(TARGET_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/* ---- 单例状态 ---- */
const { notes } = useNotes()
const { toast } = useToast()

const savedFileName = ref<string | null>(null)
const busy = ref(false)

const savedHandle = ref<PickerFileHandle | null>(null)

function getPickerFn(): SavePickerFn | null {
  const w = window as unknown as { showSaveFilePicker?: SavePickerFn }
  return typeof w.showSaveFilePicker === 'function' ? w.showSaveFilePicker : null
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function downloadFallback(content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = defaultBackupName()
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function hasWritePermission(handle: PickerFileHandle): Promise<boolean> {
  try {
    const opts = { mode: 'readwrite' } as const
    if (typeof handle.queryPermission === 'function') {
      const state = await handle.queryPermission(opts)
      if (state === 'granted') return true
      if (state === 'denied') return false
    }
    if (typeof handle.requestPermission === 'function') {
      const state = await handle.requestPermission(opts)
      if (state === 'granted') return true
    }
    return false
  } catch {
    // 权限接口异常时不提前拦截，交由写入步骤决定成败
    return true
  }
}

async function writeToHandle(handle: PickerFileHandle, content: string): Promise<void> {
  if (typeof handle.createWritable !== 'function') {
    throw new Error('该文件句柄不支持写入')
  }
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

async function resetTarget(): Promise<void> {
  savedHandle.value = null
  savedFileName.value = null
  try {
    await idbClear()
  } catch {
    /* 忽略清理失败 */
  }
}

/** 应用启动时恢复上次授权的保存目标（幂等，需在安全上下文中调用） */
async function init(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    const stored = await idbGet()
    if (stored) {
      savedHandle.value = stored.handle
      savedFileName.value = stored.name
    }
  } catch {
    /* 忽略：首次使用或索引库不可用 */
  }
}

/* ---------------- 保存流程（保存 与 另存为 共用） ---------------- */

type PickResult =
  | { kind: 'picked'; handle: PickerFileHandle }
  | { kind: 'cancelled' }
  | { kind: 'unsupported' }

/** 弹系统对话框选择目标；不支持该 API 时返回 unsupported */
async function pickHandle(): Promise<PickResult> {
  const picker = getPickerFn()
  if (!picker) return { kind: 'unsupported' }
  try {
    const handle = await picker({
      suggestedName: defaultBackupName(),
      types: [{ description: 'JSON 备份文件', accept: { 'application/json': ['.json'] } }],
    })
    return { kind: 'picked', handle }
  } catch (err) {
    if (isAbortError(err)) return { kind: 'cancelled' } // 用户取消
    return { kind: 'unsupported' }
  }
}

async function rememberTarget(handle: PickerFileHandle): Promise<void> {
  savedHandle.value = handle
  savedFileName.value = handle.name
  try {
    await idbPut({ name: handle.name, handle })
  } catch {
    /* 记忆失败不影响本次写入 */
  }
}

/** 原地写入文件；失败（文件被删/移动/占用）时清除记忆并返回 false */
async function commitWrite(handle: PickerFileHandle, content: string): Promise<boolean> {
  try {
    await writeToHandle(handle, content)
    return true
  } catch {
    await resetTarget()
    return false
  }
}

function serializeContent(): string | null {
  try {
    return JSON.stringify(buildBackup(notes), null, 2)
  } catch {
    return null
  }
}

function fallbackDownload(content: string): void {
  downloadFallback(content)
  savedFileName.value = defaultBackupName()
  toast(`已下载备份文件 ${savedFileName.value}`, 'success')
}

/**
 * 保存全部笔记：
 * - 已有目标句柄 → 原地覆盖写（不再弹窗）
 * - 尚无句柄且浏览器支持 → 弹系统对话框选位置并授权
 * - 浏览器不支持 → 降级为直接下载一份 JSON
 */
async function saveAll(): Promise<void> {
  if (busy.value) return
  const content = serializeContent()
  if (content === null) {
    toast('保存失败：无法序列化笔记数据', 'error')
    return
  }

  busy.value = true
  try {
    let handle = savedHandle.value

    if (!handle) {
      const picked = await pickHandle()
      if (picked.kind === 'cancelled') return
      if (picked.kind === 'unsupported') {
        fallbackDownload(content)
        return
      }
      handle = picked.handle
      await rememberTarget(handle)
    }

    if (!(await hasWritePermission(handle))) {
      toast('未获得该文件的写入权限，无法保存', 'error')
      return
    }
    if (!(await commitWrite(handle, content))) {
      toast('保存失败：文件可能已被移动或删除，请重新保存', 'error')
      return
    }
    toast(`已保存到 ${savedFileName.value}`, 'success')
  } finally {
    busy.value = false
  }
}

/**
 * 另存为：强制选择一个新位置写入，并把该文件设为之后的保存目标；
 * 浏览器不支持时降级为直接下载一份 JSON。
 */
async function saveAsCopy(): Promise<void> {
  if (busy.value) return
  const content = serializeContent()
  if (content === null) {
    toast('保存失败：无法序列化笔记数据', 'error')
    return
  }

  busy.value = true
  try {
    const picked = await pickHandle()
    if (picked.kind === 'cancelled') return
    if (picked.kind === 'unsupported') {
      fallbackDownload(content)
      return
    }
    const handle = picked.handle
    await rememberTarget(handle)

    if (!(await commitWrite(handle, content))) {
      toast('保存失败：文件可能已被移动或删除，请重试', 'error')
      return
    }
    toast(`已另存为 ${savedFileName.value}`, 'success')
  } finally {
    busy.value = false
  }
}

export function useFileSave() {
  return {
    /** 当前保存目标的文件名（无目标时为 null） */
    savedFileName,
    busy,
    init,
    saveAll,
    saveAsCopy,
  }
}
