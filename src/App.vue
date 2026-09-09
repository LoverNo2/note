<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import AppBar from './components/AppBar.vue'
import NoteEditor from './components/NoteEditor.vue'
import { useNotes } from './composables/useNotes'
import { useToast } from './composables/useToast'

const { currentNote, createNote, loadFromProject, saveToProject } = useNotes()
const { toasts, toast } = useToast()
/** 只展示最新一条提示（右下角浮层卡片） */
const latestToast = computed(() => {
  const list = toasts.value
  return list.length > 0 ? list[list.length - 1] : null
})

function onCreateFirst(): void {
  createNote()
  toast('已新建笔记', 'success')
}

async function doSaveToProject(): Promise<void> {
  const result = await saveToProject()
  if (result === 'ok') {
    toast('已保存到项目 notes/ 目录', 'success')
  } else {
    toast('保存失败：无法写入项目 notes/ 目录', 'error')
  }
}

/* ---------------- 保存节流 ----------------
 * ⌘S / Ctrl+S 可能被连按/按住不放。节流规则（窗口 1000ms）：
 *  - 窗口内第一次触发：立即保存；
 *  - 冷却期内再次触发：不重复写盘，只排一次「尾随保存」（冷却结束后执行，
 *    保证最后一次修改也不会丢）；
 *  - 尾随保存执行前若又到冷却窗口，按「立即保存」处理并取消尾随。
 */
const SAVE_THROTTLE_MS = 1000
let lastSaveAt = 0
let saveTrailTimer: number | undefined

function requestSave(): void {
  if (!currentNote.value) return
  const now = Date.now()
  const idle = now - lastSaveAt
  if (idle >= SAVE_THROTTLE_MS) {
    if (saveTrailTimer !== undefined) {
      window.clearTimeout(saveTrailTimer)
      saveTrailTimer = undefined
    }
    lastSaveAt = now
    void doSaveToProject()
  } else if (saveTrailTimer === undefined) {
    saveTrailTimer = window.setTimeout(() => {
      saveTrailTimer = undefined
      lastSaveAt = Date.now()
      void doSaveToProject()
    }, SAVE_THROTTLE_MS - idle)
  }
}

/** 全局快捷键：⌘N / Ctrl+N 新建；⌘S / Ctrl+S 保存到项目 notes/ 目录 */
function onKeydown(e: KeyboardEvent): void {
  const mod = e.metaKey || e.ctrlKey
  if (!mod) return
  const key = e.key.toLowerCase()
  if (key === 'n') {
    e.preventDefault()
    onCreateFirst()
  } else if (key === 's' && currentNote.value) {
    e.preventDefault()
    requestSave()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // 启动时从项目 notes/ 目录载入笔记
  void (async () => {
    const result = await loadFromProject()
    if (result === 'error') {
      toast('无法读取项目 notes/：请确认通过 npm run dev 或 npm run preview 启动服务', 'error')
    }
  })()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (saveTrailTimer !== undefined) {
    window.clearTimeout(saveTrailTimer)
    saveTrailTimer = undefined
  }
})
</script>

<template>
  <div class="app">
    <AppBar />

    <main class="app__main">
      <!-- 切换笔记时通过 key 重建编辑区，保证输入焦点与高度状态干净 -->
      <NoteEditor v-if="currentNote" :key="currentNote.id" />

      <section v-else class="welcome">
        <span class="welcome__logo">笔记本</span>
        <h1 class="welcome__title">欢迎使用</h1>
        <p class="welcome__desc">
          笔记存放在项目 <span class="kbd">notes/</span> 目录（每篇一个 JSON 文件）。
          输入后按 <span class="kbd">⌘S</span> / <span class="kbd">Ctrl+S</span> 即写回项目；编辑内容在保存前仅存在内存中。
        </p>
        <button class="btn-primary" @click="onCreateFirst">新建第一条笔记</button>
        <p class="welcome__hint">快捷键 <span class="kbd">⌘</span> / <span class="kbd">Ctrl</span> + <span class="kbd">N</span></p>
      </section>
    </main>

    <transition name="toastpop">
      <div
        v-if="latestToast"
        :key="latestToast.id"
        class="toast-card"
        :class="`toast-card--${latestToast.type}`"
      >
        <span class="toast-card__dot"></span>
        <span class="toast-card__text">{{ latestToast.text }}</span>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
}

.app__main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-canvas);
}

/* ---------- 欢迎空态 ---------- */
.welcome {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 40px;
  text-align: center;
}
.welcome__logo {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.2em;
  color: var(--accent);
  margin-bottom: 14px;
}
.welcome__title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.welcome__desc {
  margin: 6px 0 18px;
  max-width: 400px;
  font-size: 14px;
  line-height: 1.75;
  color: var(--text-mid);
}
.welcome__hint {
  margin: 14px 0 0;
  font-size: 12.5px;
  color: var(--text-faint);
}
.kbd {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  border-radius: 5px;
  background: var(--bg-canvas);
  font-size: 11.5px;
  color: var(--text-mid);
}

/* ---------- 右下角提示浮层（新拟态卡片） ---------- */
.toast-card {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 80;
  max-width: min(340px, calc(100vw - 44px));
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px 12px 13px;
  background: var(--bg-canvas); /* 与页面基底同色，阴影塑造体积 */
  border: none;
  border-radius: 14px;
  box-shadow: var(--shadow-pop); /* 与样式设置等浮层一致的凸起双影 */
  font-size: 13px;
  line-height: 1.4;
  font-weight: 500;
  color: var(--text-strong);
}
.toast-card__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent, #5b7cfa);
}
.toast-card__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toast-card--success .toast-card__dot {
  background: #1aa06d;
}
.toast-card--error .toast-card__dot {
  background: #d4483f;
}
.toastpop-enter-active,
.toastpop-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.24s cubic-bezier(0.2, 0.8, 0.3, 1);
}
.toastpop-enter-from,
.toastpop-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
