import { computed, reactive, ref } from 'vue'
import type { Note } from '../types'

/**
 * 笔记状态层（内存单例）。
 *
 * 持久化模型：不做任何自动存储——内容只存在于内存；
 * 启动时从项目 notes/ 目录载入（loadFromProject），
 * 按 ⌘S / Ctrl+S 时把全部笔记写回该目录（saveToProject）。
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

/** 是否有未保存的修改（编辑后为 true，点「保存」写回后为 false） */
const dirty = ref(false)
/** 最近一次成功保存到项目的时间（HH:MM:SS） */
const savedLabel = ref<string | null>(null)

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
  dirty.value = true // 新笔记尚未写回项目
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

/** 标记内容已有修改（尚未保存到项目） */
function markDirty(): void {
  dirty.value = true
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
    dirty.value = false
    savedLabel.value = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    return 'ok'
  } catch {
    return 'error'
  }
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
    markDirty,
    dirty,
    savedLabel,
    loadFromProject,
    saveToProject,
  }
}
