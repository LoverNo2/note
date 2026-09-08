<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import AppBar from './components/AppBar.vue'
import NoteEditor from './components/NoteEditor.vue'
import { useNotes } from './composables/useNotes'
import { useToast } from './composables/useToast'

const { currentNote, createNote, loadFromProject, saveToProject } = useNotes()
const { toast } = useToast()

function onCreateFirst(): void {
  createNote()
  toast('已新建笔记', 'success')
}

async function saveProjectShortcut(): Promise<void> {
  if (!currentNote.value) return
  const result = await saveToProject()
  if (result === 'ok') {
    toast('已保存到项目 notes/ 目录', 'success')
  } else {
    toast('保存失败：无法写入项目 notes/ 目录', 'error')
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
    void saveProjectShortcut()
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
          输入后点击右上角「保存」（⌘S）即写回项目；编辑内容在保存前仅存在内存中。
        </p>
        <button class="btn-primary" @click="onCreateFirst">新建第一条笔记</button>
        <p class="welcome__hint">快捷键 <span class="kbd">⌘</span> / <span class="kbd">Ctrl</span> + <span class="kbd">N</span></p>
      </section>
    </main>
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
</style>
