import { computed, reactive } from 'vue'

interface ToastItem {
  id: number
  text: string
  type: 'info' | 'success' | 'error'
}

const state = reactive<{ toasts: ToastItem[] }>({ toasts: [] })
let seq = 0
const DURATION = 2600

export function useToast() {
  function toast(text: string, type: ToastItem['type'] = 'info'): void {
    const id = ++seq
    state.toasts.push({ id, text, type })
    window.setTimeout(() => {
      const index = state.toasts.findIndex((t) => t.id === id)
      if (index !== -1) state.toasts.splice(index, 1)
    }, DURATION)
  }

  return {
    toasts: computed(() => state.toasts),
    toast,
  }
}
