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
// 只加载 JavaScript 规则（含其依赖 clike）；统一按 JS 着色，不再按语言猜测，
// 因此其它语言包无需引入，可减小打包体积。
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-javascript'
// 结构兜底：把“裸 pre”（内容直接挂在 pre 下、没有 <code>）规整回 <pre><code>
import { ensureCodeEl } from './blocks'

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

/**
 * 统一使用的着色语言：所有代码块都按 JavaScript 规则着色。
 * （若日后想恢复“按语言自动识别”，把这里换成 guessLanguage() 的返回值即可。）
 */
const HIGHLIGHT_LANGUAGE = 'javascript'

/**
 * Prism 的 JS 规则只给关键字 / 函数名 / 内置类名上色，
 * 大写开头的类名、全大写常量（静态类、全局对象、通知常量等）会被当成普通标识符而不着色。
 * 这里补两条规则（顺序：先全大写常量，再首字母大写的类名）：
 *   - NOTIFICATION_ENTER_TREE / MAX / ClassDB 这样全大写的 → 常量色
 *   - SceneTree / Main / OS / Math 这样首字母大写的 → 类名色
 *   - console / window / document 这类全局对象 → 内置对象色
 *   - 点后面的成员名 → 属性色
 *   - 其余还没着色的标识符（局部变量、自定义名字）→ 变量色（兜底）
 */
let grammarPatched = false
function patchedJavaScript(): Prism.Grammar | undefined {
  if (grammarPatched) return Prism.languages[HIGHLIGHT_LANGUAGE]
  if (!Prism.languages[HIGHLIGHT_LANGUAGE]) return undefined
  Prism.languages.insertBefore(HIGHLIGHT_LANGUAGE, 'operator', {
    // 首字母大写（含 OS / ClassDB 这类全大写类名）= 类名，统一一个颜色
    'class-name-static': {
      pattern: /\b[A-Z][A-Za-z0-9_]*\b/,
      alias: 'class-name',
    },
    // 全局对象：console、window、document、globalThis……
    'global-object': {
      pattern:
        /\b(?:console|window|document|globalThis|global|process|module|exports|require|Reflect|Proxy|Symbol|BigInt|WeakMap|WeakSet|Intl|Atomics|performance|location|navigator|localStorage|sessionStorage)\b/,
      alias: 'builtin',
    },
    // 点后面的成员名：x.delta、node.children
    'member-access': {
      pattern: /(?<=\.)[A-Za-z_$][A-Za-z0-9_$]*/,
      alias: 'property',
    },
    // 兜底：剩下的标识符（局部变量、自定义名字）也上一档柔和的颜色
    'identifier': {
      pattern: /[A-Za-z_$][A-Za-z0-9_$]*/,
      alias: 'variable',
    },
  })
  // Prism 默认把「全大写标识符」一律当常量：OS、MAX、ClassDB 都会被染成常量色。
  // 收窄为「含下划线的全大写」才算常量（NOTIFICATION_ENTER_TREE、MODE_DISABLED），
  // 其余全大写名字交给上面的类名规则，这样同一类事物颜色才一致。
  const grammar = Prism.languages[HIGHLIGHT_LANGUAGE]
  const mutable = grammar as unknown as Record<string, unknown> | undefined
  if (mutable && mutable.constant) {
    mutable.constant = {
      pattern: /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/,
      alias: 'constant',
    }
  }
  grammarPatched = true
  return Prism.languages[HIGHLIGHT_LANGUAGE]
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
  const code = ensureCodeEl(pre)
  if (!code) return false
  const text = codeBlockText(code)
  if (!text.trim()) return false
  const grammar = patchedJavaScript() ?? Prism.languages.clike
  if (!grammar) return false
  const html = Prism.highlight(text, grammar, HIGHLIGHT_LANGUAGE)
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
  const code = ensureCodeEl(pre)
  return !!code && isHighlighted(code)
}
