/**
 * 代码块语法高亮（Prism.js）。
 *
 * 设计要点：
 * - 代码块在编辑器里是 **contenteditable** 的，内容会随输入变化。
 *   直接调用 Prism.highlightElement 会把 <br>、光标锚点等结构冲掉，
 *   所以这里走「取纯文本 → Prism 生成高亮 HTML → 重新写回 DOM（换行还原成 <br>）」的路径。
 * - 高亮标记（span.token）只存在于渲染层：写存储前会解包，复制出去也不带。
 * - 语言靠关键词命中数自动猜测；认不出来时退回通用规则（clike）。
 */
import Prism from 'prismjs'
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-csharp'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-gdscript'
import 'prismjs/components/prism-markup'

/** 与 blocks.ts 中一致的光标锚点（零宽空格） */
const CODE_ANCHOR = '\u200b'

/** 段落标签 */
const PRE = 'PRE'
const BR = 'BR'

/** 递归收集纯文本：<br> 视作换行，去掉光标锚点（高亮后文本位于 span.token 内） */
function collectText(node: Node, out: string[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.push((child.textContent ?? '').replace(/\u200b/g, ''))
    } else if ((child as HTMLElement).tagName === BR) {
      out.push('\n')
    } else {
      collectText(child, out)
    }
  }
}

/** 取代码块的纯文本：<br> 视作换行，去掉光标锚点 */
export function codeBlockText(code: HTMLElement): string {
  const out: string[] = []
  collectText(code, out)
  return out.join('')
}

/** 语言猜测规则：命中越多越可能是该语言（按优先级排列） */
const LANGUAGE_HINTS: ReadonlyArray<{ lang: string; re: RegExp }> = [
  { lang: 'gdscript', re: /\b(func|extends|signal|var|const|match|@export|_ready|_process|class_name|preload|yield)\b/g },
  { lang: 'typescript', re: /\b(interface|type|enum|implements|declare|namespace|readonly|as|satisfies)\b/g },
  { lang: 'javascript', re: /\b(function|const|let|var|=>|console\.log|require|module\.exports|export default|async|await|import|export|new)\b/g },
  { lang: 'python', re: /\b(def|class|import|from|None|True|False|elif|lambda|self|print)\b|^\s*#/gm },
  { lang: 'cpp', re: /\b(#include|std::|template|namespace|constexpr|nullptr|virtual|public:|private:)\b/g },
  { lang: 'c', re: /\b(#include|printf|malloc|sizeof|struct|typedef|int main)\b/g },
  { lang: 'csharp', re: /\b(using|namespace|public class|void|string\[\]|Console\.WriteLine|var|get;|set;)\b/g },
  { lang: 'json', re: /^\s*[{[]|"[^"]+"\s*:/gm },
  { lang: 'bash', re: /^(#!|\s*(sudo|cd|ls|grep|awk|sed|echo|export|source|chmod|git)\b)/gm },
  { lang: 'markup', re: /<\/?[a-z][\w-]*(\s[^>]*)?>/gi },
]

/** 猜测语言；识别不出时返回空串（用通用规则高亮） */
export function guessLanguage(text: string): string {
  let best = ''
  let bestScore = 0
  for (const { lang, re } of LANGUAGE_HINTS) {
    const score = (text.match(new RegExp(re.source, re.flags)) ?? []).length
    if (score > bestScore) {
      bestScore = score
      best = lang
    }
  }
  // 命中 1 次就采用（短代码也能识别）；一次都没命中则用通用规则
  return bestScore >= 1 ? best : ''
}

/** 把节点里的换行文本还原成 <br>（保留 span 结构），末尾换行补光标锚点 */
function newlinesToBr(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  let n: Node | null = walker.nextNode()
  while (n) {
    texts.push(n as Text)
    n = walker.nextNode()
  }
  for (const t of texts) {
    if (!t.data.includes('\n')) continue
    const parts = t.data.split('\n')
    const frag = document.createDocumentFragment()
    parts.forEach((part, i) => {
      if (i > 0) frag.appendChild(document.createElement('br'))
      if (part) frag.appendChild(document.createTextNode(part))
    })
    t.replaceWith(frag)
  }
  const last = root.lastChild
  if (last && last.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === BR) {
    root.appendChild(document.createTextNode(CODE_ANCHOR))
  }
}

/** 行内代码是否已经高亮过（避免重复重排） */
function isHighlighted(code: HTMLElement): boolean {
  return !!code.querySelector('span.token')
}

/**
 * 高亮单个代码块。内容不变（只包 span.token 与 <br>），因此调用方
 * 可以用文本偏移精确恢复光标。
 */
export function highlightCodeBlock(pre: HTMLElement): boolean {
  const code = pre.firstElementChild as HTMLElement | null
  if (!code || code.tagName !== 'CODE') return false
  const text = codeBlockText(code)
  if (!text.trim()) return false
  const lang = guessLanguage(text)
  const grammar = (lang && Prism.languages[lang]) || Prism.languages.clike
  if (!grammar) return false
  const html = Prism.highlight(text, grammar, lang || 'clike')
  code.innerHTML = html
  newlinesToBr(code)
  return true
}

/**
 * 高亮代码块。传入 only 时只处理该块（编辑时用，减少重排与干扰），
 * 否则处理编辑器内全部代码块（加载 / 撤销 / 导出时用）。
 */
export function highlightCodeBlocks(
  editor: HTMLElement,
  only?: HTMLElement | null,
): void {
  const blocks = only
    ? [only]
    : (Array.from(editor.querySelectorAll('pre')) as HTMLElement[])
  for (const pre of blocks) {
    if (pre.tagName !== PRE) continue
    highlightCodeBlock(pre)
  }
}

/** 该代码块是否已经高亮（供调用方判断是否需要重排） */
export function isBlockHighlighted(pre: HTMLElement): boolean {
  const code = pre.firstElementChild as HTMLElement | null
  return !!code && isHighlighted(code)
}
