import { computed, reactive } from 'vue'
import type { BackupFile, Note } from '../types'
import { BACKUP_MAGIC } from '../types'

/**
 * 笔记状态层（内存单例）。
 *
 * 持久化模型：不做任何自动存储——内容只存在于内存；
 * 启动时从项目 notes/ 目录载入（loadFromProject），
 * 点「保存」时把全部笔记写回该目录（saveToProject）。
 */

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

interface StoreState {
  notes: Note[]
  currentId: string | null
}

/* ---------------- 单例状态 ---------------- */

const state = reactive<StoreState>({
  notes: [],
  currentId: null,
})

const sortedNotes = computed<Note[]>(() =>
  [...state.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
)

const currentNote = computed<Note | null>(() => {
  if (!state.currentId) return null
  return state.notes.find((n) => n.id === state.currentId) ?? null
})

/* ---------------- 笔记操作 ---------------- */

function createNote(): string {
  const now = new Date().toISOString()
  const note: Note = { id: genId(), title: '', content: '', createdAt: now, updatedAt: now }
  state.notes.push(note)
  state.currentId = note.id
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
}

/** 编辑产生变化时刷新当前笔记的「最近编辑」时间（仅内存，不落盘） */
function markEdited(): void {
  const note = currentNote.value
  if (note) note.updatedAt = new Date().toISOString()
}

/* ---------------- 项目 notes/ 目录读写 ---------------- */

async function loadFromProject(): Promise<'ok' | 'empty' | 'error'> {
  try {
    const resp = await fetch('/api/notes')
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data: unknown = await resp.json()
    const incoming = Array.isArray(data) ? data.filter(isNote) : []
    // 启动时用项目目录中的笔记替换当前内存
    state.notes.splice(0, state.notes.length, ...incoming)
    if (incoming.length > 0) {
      state.currentId = incoming.reduce((latest, n) =>
        n.updatedAt > latest.updatedAt ? n : latest,
      ).id
    } else {
      state.currentId = null
    }
    return incoming.length > 0 ? 'ok' : 'empty'
  } catch {
    return 'error'
  }
}

/** 把当前全部笔记手动写回项目 notes/ 目录（每篇一个文件） */
async function saveToProject(): Promise<'ok' | 'error'> {
  try {
    const resp = await fetch('/api/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.notes),
    })
    if (!resp.ok) {
      const detail = (await resp.json().catch(() => null)) as { error?: string } | null
      throw new Error(detail?.error ?? `HTTP ${resp.status}`)
    }
    return 'ok'
  } catch {
    return 'error'
  }
}

/* ---------------- 导入 ---------------- */

function parseBackup(text: string): Note[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('无法解析该文件，请确认是「笔记本」保存的 JSON 文件')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('文件内容不是有效的 JSON 对象')
  }
  const obj = parsed as Partial<BackupFile>
  if (obj.app !== BACKUP_MAGIC) {
    throw new Error('这不是「笔记本」保存的备份文件（缺少标识）')
  }
  if (!Array.isArray(obj.notes)) {
    throw new Error('文件中没有找到笔记数据')
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
      // 同 id：采用文件中较新的内容合并覆盖
      existing.title = note.title
      existing.content = note.content
      existing.updatedAt = note.updatedAt
      updated += 1
    } else {
      state.notes.push({ ...note })
      added += 1
    }
  }
  if (state.currentId === null && state.notes.length > 0) {
    state.currentId = sortedNotes.value[0]?.id ?? null
  }
  return { total: incoming.length, added, updated }
}

/* ---------------- 对外暴露 ---------------- */

export function useNotes() {
  return {
    notes: state.notes,
    sortedNotes,
    currentNote,
    currentId: computed(() => state.currentId),
    createNote,
    selectNote,
    deleteNote,
    markEdited,
    loadFromProject,
    saveToProject,
    importFromFile,
  }
}
