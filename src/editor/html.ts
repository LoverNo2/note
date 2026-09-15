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
  'TABLE',
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

/** 解包元素（保留子内容） */
function unwrapEl(el: Element): void {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  el.remove()
}

/** 在 pre 内算作“独立一行”的块级标签 */
const PRE_BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'LI',
  'UL',
  'OL',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'SECTION',
  'ARTICLE',
  'FIGURE',
])

/** 把 pre 的子树拍平成文本：<br> → 换行，块级元素独占一行，内联元素直接取文本 */
function preTextContent(pre: Element): string {
  const parts: string[] = []
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        parts.push(child.textContent ?? '')
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const el = child as Element
      if (el.tagName === 'BR') {
        parts.push('\n')
        continue
      }
      if (PRE_BLOCK_TAGS.has(el.tagName)) {
        const mark = parts.length
        walk(el)
        const inner = parts.slice(mark).join('')
        parts.length = mark
        const body = inner.replace(/\n+$/, '')
        // 空块（浏览器在代码块里塞进的空 <p><span> 之类）不产生空行
        if (body.trim() === '' && !inner.includes('\n')) continue
        parts.push(body, '\n')
        continue
      }
      walk(el)
    }
  }
  walk(pre)
  return parts.join('').replace(/\u200b/g, '')
}

/** 代码块结构规范化：只保留 <code> + 纯文本，块级嵌套拍平成行 */
function flattenPre(pre: Element): void {
  const text = preTextContent(pre)
  const code = pre.querySelector(':scope > code')
  if (code && pre.children.length === 1) {
    if ((code.textContent ?? '') !== text) code.textContent = text
    return
  }
  const c = document.createElement('code')
  c.textContent = text
  pre.replaceChildren(c)
}

/** 去掉浏览器产生的内联样式残留（span[style] / font），保留语义标签 */
function stripForeignStyles(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll('span,font'))) {
    if (el.tagName === 'FONT') {
      unwrapEl(el)
      continue
    }
    el.removeAttribute('style')
    if (el.attributes.length === 0) unwrapEl(el)
  }
}

/**
 * 表格单元格只允许保留 text-align（本编辑器的“内容对齐”设置），
 * 其它外来样式（颜色、字体、宽度……）一律清除，避免外部富文本残留。
 */
function keepCellAlignOnly(root: HTMLElement): void {
  for (const cell of Array.from(root.querySelectorAll('td, th'))) {
    if (!cell.hasAttribute('style')) continue
    const align = (cell as HTMLElement).style.textAlign
    if (align === 'center' || align === 'right') {
      cell.setAttribute('style', `text-align: ${align}`)
    } else {
      cell.removeAttribute('style')
    }
  }
}

/** 移除“有内容的块”末尾多余的 <br>（空块的占位 br 保留） */
function trimTrailingBreaks(el: Element): void {
  for (;;) {
    const last = el.lastChild
    if (
      !last ||
      last.nodeType !== Node.ELEMENT_NODE ||
      (last as Element).tagName !== 'BR'
    ) {
      break
    }
    const others = Array.from(el.childNodes).filter((n) => n !== last)
    const hasContent = others.some((n) =>
      n.nodeType === Node.TEXT_NODE
        ? (n.textContent ?? '').length > 0
        : (n as Element).tagName !== 'BR',
    )
    if (!hasContent) break
    last.remove()
  }
}

/** 循环移除块尾多余 br，直到稳定（幂等） */
function tidyChildren(el: Element): void {
  while (el.lastChild !== null) {
    const before = el.lastChild
    trimTrailingBreaks(el)
    if (el.lastChild === before) break
  }
}

/** 判断字符串更像 HTML（含标签）还是纯文本 */
export function looksLikeHtml(text: string): boolean {
  return /<\s*[a-zA-Z!]/.test(text)
}

/**
 * 清理“行尾多余空格”：软换行 <br> 之前、以及块末尾的文本都去掉尾部空白。
 * 只用于加载既有内容 / 粘贴这类“非实时输入”场景，绝不在输入过程中调用，
 * 以免删除光标前的字符导致光标错位。
 */
export function trimLineEndSpaces(html: string): string {
  const body = parseBody(html)
  const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,div'
  const nextMeaningful = (block: Element, node: Node): Node | null => {
    let cur: Node | null = node
    while (cur && cur !== block) {
      let s: Node | null = cur.nextSibling
      while (s && s.nodeType === Node.TEXT_NODE && !(s.textContent ?? '').length) {
        s = s.nextSibling
      }
      if (s) return s
      cur = cur.parentNode
    }
    return null
  }
  for (const block of Array.from(body.querySelectorAll(BLOCKS))) {
    const texts: Text[] = []
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    let n: Node | null = walker.nextNode()
    while (n) {
      texts.push(n as Text)
      n = walker.nextNode()
    }
    for (const t of texts) {
      const text = t.textContent ?? ''
      const next = nextMeaningful(block, t)
      const atLineEnd =
        next === null ||
        (next.nodeType === Node.ELEMENT_NODE &&
          (next as Element).tagName === 'BR')
      if (!atLineEnd) continue
      const trimmed = text.replace(/[ \t\u00a0]+$/, '')
      if (trimmed === text) continue
      if (trimmed === '') t.remove()
      else t.textContent = trimmed
    }
  }
  return body.innerHTML
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
/** 单元格内被视作“块级”（需要压平成带 <br> 的行内文本）的标签 */
const CELL_BLOCK_TAGS = [
  'p', 'div', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'section', 'article', 'figure', 'blockquote',
]

/**
 * 单元格内容压平：浏览器在 contenteditable 的 td 里会生成 p/div，
 * 而本编辑器的单元格只允许“行内文本 + 行内格式”，块级一律折成 <br> 换行。
 */
function flattenCellContent(cell: HTMLElement): boolean {
  const blocks = Array.from(cell.querySelectorAll(CELL_BLOCK_TAGS.join(',')))
  if (!blocks.length) return false
  for (const el of blocks.reverse()) {
    const parent = el.parentNode
    if (!parent) continue
    parent.insertBefore(document.createElement('br'), el)
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    parent.insertBefore(document.createElement('br'), el)
    el.remove()
  }
  // 去掉首尾多余的换行（至少保留单元格里的一个落脚点）
  while (cell.firstChild && (cell.firstChild as HTMLElement).nodeName === 'BR') {
    cell.firstChild.remove()
  }
  while (
    cell.lastChild &&
    (cell.lastChild as HTMLElement).nodeName === 'BR' &&
    cell.lastChild.previousSibling
  ) {
    cell.lastChild.remove()
  }
  if (!cell.firstChild) cell.appendChild(document.createElement('br'))
  return true
}

/**
 * 表格结构保底：删掉空行/空表，规整单元格内容，
 * 保证「每个单元格至少有一个 <br> 落脚点」——否则空单元格点不进去。
 */
function tidyTableStructure(table: HTMLElement): boolean {
  let changed = false
  for (const cell of Array.from(
    table.querySelectorAll<HTMLElement>('td, th'),
  )) {
    if (flattenCellContent(cell)) changed = true
    if (cell.querySelector('br') === null && !(cell.textContent ?? '').trim()) {
      cell.replaceChildren(document.createElement('br'))
      changed = true
    }
  }
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    if (row.querySelector('td, th') === null) {
      row.remove()
      changed = true
    }
  }
  if (table.querySelector('tr td, tr th') === null) {
    table.remove()
    changed = true
  }
  return changed
}

/** 导出给编辑器用：“单元格内不允许块级内容”的同一套规则 */
export function normalizeTableStructure(root: HTMLElement): void {
  for (const table of Array.from(root.querySelectorAll('table'))) {
    tidyTableStructure(table)
  }
}

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
    if (tag === 'TABLE') {
      tidyTableStructure(el)
      if (el.querySelector('tr td, tr th') === null) continue // 空表已删除
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

  // 3.5) 清理浏览器输入/合并留下的残留：代码块结构拍平、span[style]/font、块尾多余 br
  //      （幂等：清理后再次 normalize 结果不变）
  for (const pre of Array.from(body.querySelectorAll('pre'))) {
    flattenPre(pre)
  }
  // 编辑器在代码块里用作光标锚点的零宽空格不写入存储
  {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    const texts: Text[] = []
    let n: Node | null = walker.nextNode()
    while (n) {
      texts.push(n as Text)
      n = walker.nextNode()
    }
    for (const t of texts) {
      const v = t.textContent ?? ''
      if (v.includes('\u200b')) t.textContent = v.replace(/\u200b/g, '')
    }
  }
  stripForeignStyles(body)
  keepCellAlignOnly(body)
  // 排版包裹标记（中文字距 / 英文间隔）只用于渲染层，不写入存储
  for (const el of Array.from(
    body.querySelectorAll('span.cjk, span.latin, span.hl, span.token'),
  )) {
    unwrapEl(el)
  }
  for (const el of Array.from(
    body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,div'),
  )) {
    tidyChildren(el)
  }

  // 4) 末尾空段规范化：末尾连续的空白 <p> 只保留一个（供光标停靠），
  //    其余移除；规则幂等，多次 normalize 结果一致。
  {
    const kids = Array.from(body.children)
    let i = kids.length - 1
    while (i >= 0) {
      const el = kids[i] as HTMLElement
      if (el.tagName === 'P' && !(el.textContent ?? '').trim() && !el.querySelector('img')) {
        i--
      } else {
        break
      }
    }
    // i 指向最后一个非空块；其后的空段只保留一个（下标 i+1），删除多余
    const keepTail = i >= 0 && i < kids.length - 1
    if (keepTail) {
      while (body.children.length - 1 > i + 1) {
        const tail = body.children[body.children.length - 1]
        if (tail.tagName === 'P') tail.remove()
        else break
      }
    }
  }

  // 5) 整体没有实质内容（文本 / 图片 / 分割线 / 代码块）时返回空串
  const hasMeaning = Array.from(body.childNodes).some((n) => {
    if (n.nodeType === Node.TEXT_NODE) return !!(n.textContent ?? '').trim()
    const el = n as HTMLElement
    if (el.tagName === 'IMG' || el.tagName === 'HR') return true
    if (el.tagName === 'PRE') return true
    if (el.tagName === 'TABLE') return true
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
  let rowStart = true
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        parts.push(child.textContent ?? '')
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement
        const tag = el.tagName
        if (tag === 'BR') {
          parts.push('\n')
        } else if (tag === 'TD' || tag === 'TH') {
          // 单元格之间用制表符分隔，摘要里能看出列结构（行首不加）
          if (!rowStart && parts.length) parts.push('\t')
          rowStart = false
          walk(el)
        } else if (tag === 'TR' || tag === 'THEAD' || tag === 'TBODY') {
          parts.push('\n')
          rowStart = true
          walk(el)
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
    .replace(/\u200b/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 复制/粘贴时允许保留的标签（块 + 行内样式语义） */
const PASTE_SAFE_TAGS = new Set([
  "P",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TD",
  "TH",
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
      // 白名单标签：去掉全部属性（含 class/style/href），只保留语义。
      // 例外：表格单元格的 text-align 是本编辑器的“内容对齐”设置，需要保留。
      const isCell = tag === 'TD' || tag === 'TH'
      const cellAlign = isCell ? cEl.style.textAlign : ''
      for (const attr of Array.from(cEl.attributes)) {
        cEl.removeAttribute(attr.name)
      }
      if (cellAlign) cEl.style.textAlign = cellAlign
      clean(cEl)
    }
  }
  clean(body)
  return body.innerHTML
}
