/**
 * 正文内容的 HTML 化工具：旧纯文本迁移、结构规范化、文本提取。
 *
 * 存储约定：note.content 为「规范化 HTML」。块结构只允许出现在内容顶层，
 * 由编辑器代码保证生成；此文件提供展示/迁移侧的兜底清洗。
 */

/** 转义 HTML 特殊字符（用于纯文本 → HTML 迁移） */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 顶层块级元素（编辑器内容容器的合法子块） */
const BLOCK_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'PRE',
  'HR',
  'DIV',
  'SECTION',
  'ARTICLE',
  'FIGURE',
])

function parseBody(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body
}

/** 判断字符串更像 HTML（含标签）还是纯文本 */
export function looksLikeHtml(text: string): boolean {
  return /<\s*[a-zA-Z!]/.test(text)
}

/** 旧版纯文本正文 → 段落 HTML（空行分段，单换行转 <br>） */
export function legacyTextToHtml(text: string): string {
  const trimmed = text.replace(/\s+$/, '')
  if (!trimmed) return ''
  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((para) =>
      para
        .trim()
        .split('\n')
        .map((line) => escapeHtml(line))
        .join('<br>'),
    )
    .filter(Boolean)
    .map((para) => `<p>${para}</p>`)
  return paragraphs.join('')
}

/**
 * 结构规范化（幂等）：
 * - 顶层 div/section/article/figure → p（浏览器输入差异的兜底）
 * - 顶层裸露的文本/行内节点 → 收拢进段落
 * - 移除空文本；内容全空时返回空字符串
 */
export function normalizeHtml(html: string): string {
  const body = parseBody(html)
  if (!body) return ''

  // 1) 顶层 div 类容器替换为 p（历史引用 blockquote 一并转段落）
  const topNodes = Array.from(body.childNodes) as Node[]
  for (const node of topNodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as HTMLElement).tagName
      if (
        tag === 'DIV' ||
        tag === 'SECTION' ||
        tag === 'ARTICLE' ||
        tag === 'FIGURE' ||
        tag === 'BLOCKQUOTE'
      ) {
        const p = document.createElement('p')
        p.append(...Array.from(node.childNodes))
        node.parentNode?.replaceChild(p, node)
      }
    }
  }

  // 2) 重新读取顶层，把裸文本 / 行内元素收拢为段落，保持原顺序
  const ordered: Node[] = []
  let buffer: Node[] = []
  const flush = () => {
    if (buffer.length === 0) return
    const p = document.createElement('p')
    // 行内元素原样保留；文本按换行折叠
    for (const n of buffer) {
      if (n.nodeType === Node.TEXT_NODE) {
        const piece = (n.textContent ?? '').replace(/\n+/g, ' ')
        if (piece) p.appendChild(document.createTextNode(piece))
      } else {
        p.appendChild(n)
      }
    }
    if (p.hasChildNodes()) ordered.push(p)
    buffer = []
  }
  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as HTMLElement).tagName)) {
      flush()
      ordered.push(node)
    } else {
      buffer.push(node)
    }
  }
  flush()

  // 3) 清空 body 后按序放回，并清理空块（文本为空且无 hr/img/pre 内容）
  body.replaceChildren()
  let hasVisible = false
  for (const node of ordered) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const el = node as HTMLElement
    const tag = el.tagName
    if (tag === 'HR') {
      hasVisible = true
      body.appendChild(el)
      continue
    }
    if (tag === 'IMG') {
      hasVisible = true
      body.appendChild(el)
      continue
    }
    const text = el.textContent ?? ''
    // 空段落 <p> 是合法的结构空行，保留；标题/列表等空块则清除
    const visible = tag === 'P' || tag === 'PRE'
      ? true
      : text.trim().length > 0 || el.querySelector('img') !== null
    if (visible) {
      hasVisible = true
      body.appendChild(el)
    }
  }
  if (!hasVisible) return ''

  // 4) 去掉末尾连续空段（保留至多一个，供光标停靠）
  const children = Array.from(body.children)
  for (let i = children.length - 1; i >= 0; i--) {
    const el = children[i] as HTMLElement
    const tag = el.tagName
    if (tag === 'P' && !(el.textContent ?? '').trim() && !el.querySelector('img')) {
      if (i === children.length - 1 && i > 0) {
        el.remove()
      } else {
        break
      }
    } else {
      break
    }
  }

  // 5) 整体没有实质内容（文本 / 图片 / 分割线 / 代码块）时返回空串
  const hasMeaning = Array.from(body.childNodes).some((n) => {
    if (n.nodeType === Node.TEXT_NODE) return !!(n.textContent ?? '').trim()
    const el = n as HTMLElement
    if (el.tagName === 'IMG' || el.tagName === 'HR') return true
    if (el.tagName === 'PRE') return true
    return !!(el.textContent ?? '').trim()
  })
  if (!hasMeaning) return ''

  return body.innerHTML
}

/**
 * 提取可见文本（块之间以换行分隔，br 也算一次换行）。
 * 用于侧栏摘要与字数统计。
 */
export function textFromHtml(html: string): string {
  const body = parseBody(html)
  const parts: string[] = []
  const INLINE_TAGS = new Set([
    'B',
    'STRONG',
    'I',
    'EM',
    'U',
    'S',
    'STRIKE',
    'DEL',
    'CODE',
    'SPAN',
    'A',
    'MARK',
  ])
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        parts.push(child.textContent ?? '')
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement
        const tag = el.tagName
        if (tag === 'BR') {
          parts.push('\n')
        } else if (INLINE_TAGS.has(tag)) {
          walk(el)
        } else {
          parts.push('\n')
          walk(el)
          parts.push('\n')
        }
      }
    }
  }
  walk(body)
  return parts
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 复制/粘贴时允许保留的标签（块 + 行内样式语义） */
const PASTE_SAFE_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "PRE",
  "HR",
  "DIV",
  "BR",
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "STRIKE",
  "DEL",
  "MARK",
  "CODE",
  "SPAN",
  "SUB",
  "SUP",
  "A",
])

/** 必须整体丢弃的标签（可能携带脚本 / 表单 / 富媒体） */
const PASTE_DROP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "FRAME",
  "OBJECT",
  "EMBED",
  "APPLET",
  "LINK",
  "META",
  "BASE",
  "TITLE",
  "TEMPLATE",
  "NOSCRIPT",
  "FORM",
  "INPUT",
  "BUTTON",
  "SELECT",
  "TEXTAREA",
  "OPTION",
  "VIDEO",
  "AUDIO",
  "CANVAS",
  "MAP",
  "AREA",
  "SVG",
  "MATH",
])

/**
 * 剪贴板富文本清洗：只保留有语义的格式标签并去掉全部属性，
 * 其余标签保留文本内容解包；危险标签整段移除。
 * 复制时用（写入剪贴板），粘贴时先用（再交给 normalizeHtml）。
 */
export function sanitizeHtml(html: string): string {
  const body = parseBody(html ?? "")
  const clean = (el: Element): void => {
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const cEl = child as HTMLElement
      const tag = cEl.tagName
      if (PASTE_DROP_TAGS.has(tag)) {
        cEl.remove()
        continue
      }
      if (!PASTE_SAFE_TAGS.has(tag)) {
        // 未知标签：保留其文本内容并解包
        const parent = cEl.parentNode
        if (parent) {
          while (cEl.firstChild) parent.insertBefore(cEl.firstChild, cEl)
          cEl.remove()
        }
        continue
      }
      // 白名单标签：去掉全部属性（含 class/style/href），只保留语义
      for (const attr of Array.from(cEl.attributes)) {
        cEl.removeAttribute(attr.name)
      }
      clean(cEl)
    }
  }
  clean(body)
  return body.innerHTML
}
