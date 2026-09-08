import { computed, reactive } from 'vue'
import type { BackupFile, Note } from '../types'
import { BACKUP_MAGIC } from '../types'
import { buildBackup, defaultBackupName } from '../utils/backup'

const STORAGE_KEY = 'notebook.notes.v1'

/** 自动保存防抖间隔（毫秒） */
const AUTOSAVE_DELAY = 500

/** 生成一个简单且几乎不会冲突的唯一 id */
function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 宽松校验：这条数据是否像一条笔记 */
function isNote(v: unknown): v is Note {
  if (typeof v !== 'object' || v === null) return false
  const n = v as Record<string, unknown>
  return (
    typeof n.id === 'string' &&
    typeof n.title === 'string' &&
    typeof n.content === 'string' &&
    typeof n.createdAt === 'string' &&
    typeof n.updatedAt === 'string'
  )
}

/** 从 localStorage 恢复笔记（损坏或不存在时返回空数组） */
function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isNote)
  } catch {
    return []
  }
}

interface StoreState {
  notes: Note[]
  currentId: string | null
  /** 最近一次成功落盘的时间（毫秒），用于「已自动保存」提示 */
  lastSavedAt: number | null
}

/* ---------------- 单例状态 ---------------- */

const state = reactive<StoreState>({
  notes: loadNotes(),
  currentId: null,
  lastSavedAt: null,
})

const sortedNotes = computed<Note[]>(() =>
  [...state.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
)

const currentNote = computed<Note | null>(() => {
  if (!state.currentId) return null
  return state.notes.find((n) => n.id === state.currentId) ?? null
})

// 应用启动时，若已有笔记则自动选中最近编辑的一条
if (state.notes.length > 0) {
  state.currentId = state.notes.reduce((latest, n) =>
    n.updatedAt > latest.updatedAt ? n : latest,
  ).id
}

/* ---------------- 持久化 ---------------- */

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notes))
  } catch {
    // localStorage 不可用（如隐私模式）时静默降级：数据仍保存在内存中
  }
}

let autosaveTimer: number | undefined

function flushAutosave(): void {
  if (autosaveTimer !== undefined) {
    window.clearTimeout(autosaveTimer)
    autosaveTimer = undefined
  }
  persist()
  state.lastSavedAt = Date.now()
}

/** 编辑器输入后调用：刷新 updatedAt，并防抖 500ms 落盘 */
function requestAutosave(): void {
  const note = currentNote.value
  if (!note) return
  note.updatedAt = new Date().toISOString()
  if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer)
  autosaveTimer = window.setTimeout(flushAutosave, AUTOSAVE_DELAY)
}

/* ---------------- 笔记操作 ---------------- */

function createNote(): string {
  const now = new Date().toISOString()
  const note: Note = { id: genId(), title: '', content: '', createdAt: now, updatedAt: now }
  state.notes.push(note)
  state.currentId = note.id
  flushAutosave()
  return note.id
}

function selectNote(id: string | null): void {
  state.currentId = id
}

function deleteNote(id: string): void {
  const index = state.notes.findIndex((n) => n.id === id)
  if (index === -1) return
  state.notes.splice(index, 1)
  // 若删除的是当前笔记，则自动选中下一条
  if (state.currentId === id) {
    state.currentId = sortedNotes.value[0]?.id ?? null
  }
  flushAutosave()
}

/* ---------------- 导入 / 导出 ---------------- */

function parseBackup(text: string): Note[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('无法解析该文件，请确认是「笔记本」导出的 JSON 备份')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('备份文件内容不是有效的 JSON 对象')
  }
  const obj = parsed as Partial<BackupFile>
  if (obj.app !== BACKUP_MAGIC) {
    throw new Error('这不是「笔记本」导出的备份文件（缺少标识）')
  }
  if (!Array.isArray(obj.notes)) {
    throw new Error('备份文件中没有找到笔记数据')
  }
  return obj.notes.filter(isNote)
}

async function importFromFile(
  file: File,
): Promise<{ total: number; added: number; updated: number }> {
  const text = await file.text()
  const incoming = parseBackup(text)

  let added = 0
  let updated = 0
  for (const note of incoming) {
    const existing = state.notes.find((n) => n.id === note.id)
    if (existing) {
      // 同 id：采用备份中较新的内容合并覆盖
      existing.title = note.title
      existing.content = note.content
      existing.updatedAt = note.updatedAt
      updated += 1
    } else {
      state.notes.push({ ...note })
      added += 1
    }
  }
  flushAutosave()
  if (state.currentId === null && state.notes.length > 0) {
    state.currentId = sortedNotes.value[0]?.id ?? null
  }
  return { total: incoming.length, added, updated }
}

function exportToFile(): void {
  const content = JSON.stringify(buildBackup(state.notes), null, 2)
  const blob = new Blob([content], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = defaultBackupName()
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** 供 App 在页面卸载 / 隐藏前兜底保存 */
function ensurePersisted(): void {
  flushAutosave()
}

/* ---------------- 对外暴露 ---------------- */

export function useNotes() {
  return {
    notes: state.notes,
    sortedNotes,
    currentNote,
    currentId: computed(() => state.currentId),
    lastSavedAt: computed(() => state.lastSavedAt),
    createNote,
    selectNote,
    deleteNote,
    requestAutosave,
    importFromFile,
    exportToFile,
    ensurePersisted,
  }
}
