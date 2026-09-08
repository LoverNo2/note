/**
 * 自研块编辑器 DOM 引擎（contenteditable 之上的一层受控操作）。
 *
 * 约定：
 * - 正文内容顶层只允许块元素：p / h1-h3 / blockquote / ul / ol / pre(code) / hr
 * - 列表项 li 与引用 blockquote 内直接容纳行内内容（不嵌 p）
 * - 引擎只做 DOM 变换并尽量保留光标所在的文本节点；撤销/重做由调用方维护快照
 */

export type HeadingLevel = 'h1' | 'h2' | 'h3'
export type BlockKind =
  | 'paragraph'
  | HeadingLevel
  | 'blockquote'
  | 'codeblock'
  | 'bulletList'
  | 'orderedList'
export type InlineMark = 'bold' | 'italic' | 'strike' | 'inlineCode'

const MARK_TAGS: Record<InlineMark, string[]> = {
  bold: ['B', 'STRONG'],
  italic: ['I', 'EM'],
  strike: ['S', 'STRIKE', 'DEL'],
  inlineCode: ['CODE'],
}

const HEADING_TAGS = ['H1', 'H2', 'H3']

/* ---------------- 选区与定位 ---------------- */

function getSelection(): Selection | null {
  return window.getSelection()
}

function applyRange(range: Range): void {
  const sel = getSelection()
  if (!sel) return
  sel.removeAllRanges()
  sel.addRange(range)
}

/** 光标（或选区）的 Range；不在 editor 内时返回 null */
export function getCaretRange(editor: HTMLElement): Range | null {
  const sel = getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  if (editor.contains(node)) return range
  return null
}

export function isInsideEditor(editor: HTMLElement): boolean {
  const sel = getSelection()
  return !!sel && sel.anchorNode !== null && editor.contains(sel.anchorNode)
}

/** 当前光标所在的“块元素” */
export function resolveBlock(editor: HTMLElement): HTMLElement | null {
  const sel = getSelection()
  if (!sel || !sel.anchorNode) return null
  let node: Node | null = sel.anchorNode
  let blockCandidate: HTMLElement | null = null
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as HTMLElement).tagName
      if (tag === 'LI' || tag === 'PRE' || tag === 'BLOCKQUOTE') return node as HTMLElement
      if (tag === 'P' || HEADING_TAGS.includes(tag) || tag === 'DIV') {
        blockCandidate = node as HTMLElement
      }
    }
    node = node.parentNode
  }
  return blockCandidate
}

/** 光标块的种类（供工具条高亮） */
export function currentBlockKind(editor: HTMLElement): BlockKind | null {
  const block = resolveBlock(editor)
  if (!block) return null
  const tag = block.tagName
  if (tag === 'LI') {
    return block.closest('OL') ? 'orderedList' : 'bulletList'
  }
  if (tag === 'PRE') return 'codeblock'
  if (tag === 'BLOCKQUOTE') return 'blockquote'
  if (tag === 'H1' || tag === 'H2' || tag === 'H3') return tag.toLowerCase() as HeadingLevel
  return 'paragraph'
}

/** 行内强调是否在光标处激活 */
export function isMarkActive(editor: HTMLElement, mark: InlineMark): boolean {
  const sel = getSelection()
  if (!sel || !sel.anchorNode) return false
  const tags = MARK_TAGS[mark]
  const node = sel.anchorNode.nodeType === Node.ELEMENT_NODE
    ? (sel.anchorNode as HTMLElement)
    : (sel.anchorNode.parentNode as HTMLElement | null)
  if (!node) return false
  let el: HTMLElement | null = node
  while (el && el !== editor) {
    if (tags.includes(el.tagName)) {
      // 行内 code 需排除代码块内的 pre>code
      return !(mark === 'inlineCode' && el.closest('pre'))
    }
    el = el.parentNode as HTMLElement | null
  }
  return false
}

/** 光标按文本字符计数定位（供撤销恢复近似光标） */
export function caretTextIndex(editor: HTMLElement): number {
  const sel = getSelection()
  if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode)) return -1
  let index = 0
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let n: Node | null = walker.nextNode()
  while (n) {
    if (n === sel.anchorNode) {
      return index + sel.anchorOffset
    }
    index += (n.textContent ?? '').length
    n = walker.nextNode()
  }
  return index
}

export function restoreCaretByTextIndex(editor: HTMLElement, index: number): void {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let remain = Math.max(0, index)
  let n: Node | null = walker.nextNode()
  while (n) {
    const len = (n.textContent ?? '').length
    if (remain <= len) {
      const range = document.createRange()
      range.setStart(n, remain)
      range.collapse(true)
      applyRange(range)
      return
    }
    remain -= len
    n = walker.nextNode()
  }
  placeCaretAtEnd(editor)
}

export function placeCaretAtStartOf(container: Node): void {
  const range = document.createRange()
  range.selectNodeContents(container)
  range.collapse(true)
  applyRange(range)
}

export function placeCaretAtEndOf(container: Node): void {
  const range = document.createRange()
  range.selectNodeContents(container)
  range.collapse(false)
  applyRange(range)
}

/** 光标放到编辑器最末尾可输入处 */
export function placeCaretAtEnd(editor: HTMLElement): void {
  const blocks = Array.from(editor.children) as HTMLElement[]
  const last = blocks[blocks.length - 1]
  if (last) {
    placeCaretAtEndOf(last)
    return
  }
  editor.focus()
}

/** 编辑器聚焦并将光标放到开头 */
export function focusEditorStart(editor: HTMLElement): void {
  editor.focus()
  const first = editor.firstElementChild as HTMLElement | null
  if (first) placeCaretAtStartOf(first)
  else placeCaretAtEnd(editor)
}

/* ---------------- 空内容判定 ---------------- */

export function isEmptyBlock(block: HTMLElement): boolean {
  if (block.tagName === 'HR') return false
  return !(block.textContent ?? '').trim() && !block.querySelector('img')
}

export function editorHasContent(editor: HTMLElement): boolean {
  return editor.querySelectorAll('img,hr').length > 0 || !!(editor.textContent ?? '').trim()
}

/* ---------------- 内部 DOM 小工具 ---------------- */

function isListTag(el: HTMLElement | null): boolean {
  return !!el && (el.tagName === 'UL' || el.tagName === 'OL')
}

function ensureBrForEmpty(el: HTMLElement): void {
  if (!el.hasChildNodes()) {
    el.appendChild(document.createElement('br'))
  }
}

/** 从 block 中切出光标之后的内容（返回 DocumentFragment，可能为空） */
function extractAfterCaret(block: HTMLElement, caret: Range): DocumentFragment {
  const range = document.createRange()
  range.selectNodeContents(block)
  range.setStart(caret.startContainer, caret.startOffset)
  return range.extractContents()
}

function textAfterCaretInBlock(block: HTMLElement, caret: Range): boolean {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let n: Node | null = walker.nextNode()
  while (n) {
    if (n === caret.startContainer) {
      const offset = caret.startOffset
      const after = (n.textContent ?? '').slice(offset)
      if (after.trim()) return true
      n = walker.nextNode()
      while (n) {
        if ((n.textContent ?? '').trim()) return true
        n = walker.nextNode()
      }
      return false
    }
    n = walker.nextNode()
  }
  return false
}

function textBeforeCaretInBlock(block: HTMLElement, caret: Range): boolean {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let n: Node | null = walker.nextNode()
  let anyBefore = false
  while (n) {
    const text = n.textContent ?? ''
    if (n === caret.startContainer) {
      const before = text.slice(0, caret.startOffset)
      if (before.trim()) return true
      return anyBefore
    }
    if (text.trim()) anyBefore = true
    n = walker.nextNode()
  }
  return anyBefore
}

function setCaretAfterNode(node: Node): void {
  const range = document.createRange()
  if (node.parentNode) {
    range.setStartAfter(node)
  } else {
    range.selectNodeContents(node)
  }
  range.collapse(true)
  applyRange(range)
}

function newParagraph(content?: DocumentFragment): HTMLElement {
  const p = document.createElement('p')
  if (content && content.hasChildNodes()) p.appendChild(content)
  ensureBrForEmpty(p)
  return p
}

/* ---------------- 块类型设置（含 toggle 语义） ---------------- */

function replaceBlockWith(block: HTMLElement, tag: string): HTMLElement {
  const el = document.createElement(tag)
  el.append(...Array.from(block.childNodes))
  block.replaceWith(el)
  return el
}

/** 将段落/标题等包装为带样式的容器 */
function wrapAsQuote(block: HTMLElement): HTMLElement {
  const quote = document.createElement('blockquote')
  quote.append(...Array.from(block.childNodes))
  block.replaceWith(quote)
  return quote
}

function wrapAsCode(block: HTMLElement): HTMLElement {
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = block.textContent ?? ''
  pre.appendChild(code)
  block.replaceWith(pre)
  return pre
}

function unwrapQuoteToParagraph(quote: HTMLElement): HTMLElement {
  const p = document.createElement('p')
  p.append(...Array.from(quote.childNodes))
  ensureBrForEmpty(p)
  quote.replaceWith(p)
  return p
}

function unwrapCodeToParagraph(pre: HTMLElement): HTMLElement {
  const p = document.createElement('p')
  const text = pre.textContent ?? ''
  const lines = text.split('\n')
  p.textContent = lines[0] ?? ''
  for (let i = 1; i < lines.length; i++) {
    p.appendChild(document.createElement('br'))
    p.appendChild(document.createTextNode(lines[i]))
  }
  ensureBrForEmpty(p)
  pre.replaceWith(p)
  return p
}

function wrapAsList(block: HTMLElement, tag: 'UL' | 'OL'): HTMLElement {
  const list = document.createElement(tag)
  const li = document.createElement('li')
  li.append(...Array.from(block.childNodes))
  ensureBrForEmpty(li)
  list.appendChild(li)
  block.replaceWith(list)
  return list
}

function switchListType(list: HTMLElement, tag: 'UL' | 'OL'): void {
  if (list.tagName === tag) return
  const el = document.createElement(tag)
  el.append(...Array.from(list.childNodes))
  list.replaceWith(el)
}

/** 把列表项从列表中取出，转成独立段落 */
function liftListItemToParagraph(li: HTMLElement): HTMLElement {
  const list = li.parentElement as HTMLElement | null
  const nested = Array.from(li.children).filter((el) =>
    isListTag(el as HTMLElement),
  ) as HTMLElement[]
  const p = document.createElement('p')
  p.append(
    ...Array.from(li.childNodes).filter(
      (n) => !(n.nodeType === Node.ELEMENT_NODE && isListTag(n as HTMLElement)),
    ),
  )
  ensureBrForEmpty(p)
  li.remove()

  if (list) {
    const remains = list.querySelectorAll('li').length
    if (remains === 0) {
      // 列表中只剩这一项：整个列表被段落取代
      list.replaceWith(p)
    } else {
      // 仍有其它项：段落整体放到列表之后
      list.after(p)
    }
  }
  // 嵌套子列表跟在段落后面（顺序保持）
  let prev: HTMLElement = p
  for (const n of nested) {
    prev.after(n)
    prev = n
  }
  return p
}

/** 编辑器光标上下文（工具条 UI 状态，由 NoteEditor 刷新、NoteToolbar 展示） */
export interface ToolbarUi {
  kind: BlockKind | null
  marks: Record<InlineMark, boolean>
  /** 光标是否处于塌缩状态（无选中文字） */
  collapsed: boolean
  /** 光标在代码块内（行内强调不可用） */
  inCode: boolean
  /** 光标在列表项内 */
  inList: boolean
  canUndo: boolean
  canRedo: boolean
}

export function emptyToolbarUi(): ToolbarUi {
  return {
    kind: null,
    marks: { bold: false, italic: false, strike: false, inlineCode: false },
    collapsed: true,
    inCode: false,
    inList: false,
    canUndo: false,
    canRedo: false,
  }
}

function isPlainBlock(block: HTMLElement | null): boolean {  return !!block && (block.tagName === 'P' || HEADING_TAGS.includes(block.tagName) || block.tagName === 'DIV')
}

/** 切换光标块到指定类型 */
export function setBlockType(editor: HTMLElement, kind: BlockKind): void {
  const block = resolveBlock(editor)
  if (!block) return

  // —— 列表类目标 ——
  if (kind === 'bulletList' || kind === 'orderedList') {
    const targetTag = kind === 'bulletList' ? 'UL' : 'OL'
    if (block.tagName === 'LI') {
      const list = block.parentElement as HTMLElement | null
      if (list && list.tagName !== targetTag && isListTag(list)) {
        switchListType(list, targetTag) // 已是有序/无序：改为另一类
        return
      }
      liftListItemToParagraph(block) // 同类按钮点击 = 取消列表
      return
    }
    if (isPlainBlock(block)) {
      wrapAsList(block, targetTag)
    }
    return
  }

  // —— 非列表块：先把列表项还原成段落再处理 ——
  if (block.tagName === 'LI') {
    if (kind === 'paragraph') liftListItemToParagraph(block)
    return
  }

  const isQuote = block.tagName === 'BLOCKQUOTE'
  const isCode = block.tagName === 'PRE'

  switch (kind) {
    case 'paragraph': {
      if (isQuote) unwrapQuoteToParagraph(block)
      else if (isCode) unwrapCodeToParagraph(block)
      else if (HEADING_TAGS.includes(block.tagName)) replaceBlockWith(block, 'p')
      break
    }
    case 'h1':
    case 'h2':
    case 'h3': {
      if (isQuote || isCode) return // 需先切回正文
      if (block.tagName === kind.toUpperCase()) {
        replaceBlockWith(block, 'p') // toggle：已是该标题 → 还原正文
      } else if (isPlainBlock(block)) {
        replaceBlockWith(block, kind.toUpperCase())
      }
      break
    }
    case 'blockquote': {
      if (isQuote) {
        unwrapQuoteToParagraph(block) // toggle：已是引用 → 还原正文
      } else if (isPlainBlock(block) && !isCode) {
        wrapAsQuote(block)
      }
      break
    }
    case 'codeblock': {
      if (isCode) {
        unwrapCodeToParagraph(block)
      } else if (isPlainBlock(block)) {
        wrapAsCode(block)
      }
      break
    }
    default:
      break
  }
}

/* ---------------- 列表缩进 ---------------- */

function indentListItem(li: HTMLElement): void {
  const list = li.parentElement as HTMLElement | null
  if (!list || !isListTag(list)) return
  const prev = li.previousElementSibling as HTMLElement | null
  if (!prev || prev.tagName !== 'LI') return
  let childList = Array.from(prev.children).find((el) => el.tagName === list.tagName) as HTMLElement | null
  if (!childList) {
    childList = document.createElement(list.tagName)
    prev.appendChild(childList)
  }
  childList.appendChild(li)
}

function outdentListItem(li: HTMLElement): void {
  const list = li.parentElement as HTMLElement | null
  if (!list || !isListTag(list)) return
  const outer = list.parentElement as HTMLElement | null

  if (outer && outer.tagName === 'LI') {
    // 从嵌套列表退到外层
    const outerList = outer.parentElement as HTMLElement | null
    if (outerList && isListTag(outerList)) {
      outerList.insertBefore(li, outer.nextSibling)
    } else {
      list.after(li)
    }
    if (!list.querySelector('li')) list.remove()
  } else {
    // 顶层列表：outdent = 还原为段落
    liftListItemToParagraph(li)
  }
}

/** Tab / Shift+Tab 处理；返回 true 表示已消费该按键 */
export function handleTabKey(editor: HTMLElement, shift: boolean): boolean {
  const block = resolveBlock(editor)
  if (!block || block.tagName !== 'LI') return false
  if (shift) outdentListItem(block)
  else indentListItem(block)
  return true
}

/* ---------------- 行内强调（粗/斜/删/行内代码） ---------------- */

function unwrapMarkElements(container: Node, tags: string[]): void {
  const nodes = Array.from(container.childNodes)
  for (const n of nodes) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement
      if (tags.includes(el.tagName)) {
        const kids = Array.from(el.childNodes)
        for (const k of kids) el.before(k)
        el.remove()
      } else {
        unwrapMarkElements(el, tags)
      }
    }
  }
}

function wrapTextNodes(container: Node, tag: string): void {
  const nodes = Array.from(container.childNodes)
  for (const n of nodes) {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = n.textContent ?? ''
      if (!text) continue
      const mark = document.createElement(tag)
      mark.textContent = text
      container.replaceChild(mark, n)
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      wrapTextNodes(n, tag)
    }
  }
}

/** 判断提取出的片段是否“整体已是该强调样式”（决定 toggle 方向） */
function fragmentIsWholeMark(frag: DocumentFragment, tags: string[]): boolean {
  const kids = Array.from(frag.childNodes).filter(
    (n) => n.nodeType !== Node.TEXT_NODE || !!(n.textContent ?? '').trim(),
  )
  if (kids.length === 0) return false
  return kids.every(
    (n) => n.nodeType === Node.ELEMENT_NODE && tags.includes((n as HTMLElement).tagName),
  )
}

/** 若选区起点与终点落在同一个“该强调样式”元素内，返回该元素（此时应解除而非再包一层） */
function findWholeMarkElement(range: Range, tags: string[]): HTMLElement | null {
  const find = (node: Node | null): HTMLElement | null => {
    let el = node?.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : (node?.parentNode as HTMLElement | null)
    while (el) {
      if (tags.includes(el.tagName)) return el
      el = el.parentNode as HTMLElement | null
    }
    return null
  }
  const start = find(range.startContainer)
  const end = find(range.endContainer)
  return start && start === end ? start : null
}

/** 切换行内强调。需要存在非空选区；否则返回 false */
export function toggleInlineMark(editor: HTMLElement, mark: InlineMark): boolean {
  const range = getCaretRange(editor)
  if (!range || range.collapsed) return false
  const tags = MARK_TAGS[mark]
  const wrapTag = tags[0]

  // 选中内容整体位于同一个强调元素内：解除该元素（避免嵌套包裹）
  const whole = findWholeMarkElement(range, tags)
  if (whole) {
    const parent = whole.parentNode
    if (parent) {
      const kids = Array.from(whole.childNodes)
      for (const k of kids) parent.insertBefore(k, whole)
      whole.remove()
    }
    return true
  }

  const frag = range.extractContents()
  if (fragmentIsWholeMark(frag, tags)) {
    unwrapMarkElements(frag, tags)
  } else {
    unwrapMarkElements(frag, tags)
    wrapTextNodes(frag, wrapTag)
  }
  if (frag.hasChildNodes()) {
    range.insertNode(frag)
    const last = frag.lastChild ?? null
    if (last) setCaretAfterNode(last)
  }
  return true
}

/* ---------------- 分割线 ---------------- */

export function insertDivider(editor: HTMLElement): void {
  const block = resolveBlock(editor)
  if (!block) return
  const caret = getCaretRange(editor)

  // 列表内：放到整个最外层列表之后
  let anchor: HTMLElement = block
  if (block.tagName === 'LI') {
    let cur: HTMLElement | null = block
    let top: HTMLElement = block
    while (cur && isListTag(cur.parentElement as HTMLElement | null)) {
      top = cur.parentElement as HTMLElement
      cur = top
    }
    anchor = top
  }

  // 块内有后文时先拆分（避免把后半内容吞掉）
  let splitP: HTMLElement | null = null
  if (caret && textAfterCaretInBlock(anchor, caret)) {
    const rest = extractAfterCaret(anchor, caret)
    splitP = newParagraph(rest)
    anchor.after(splitP)
  }

  const hr = document.createElement('hr')
  const target = splitP ?? anchor
  const p = newParagraph()
  if (splitP) {
    target.before(hr)
  } else {
    target.after(hr, p)
  }
  if (splitP) {
    splitP.after(p)
  }
  placeCaretAtStartOf(p)
}

/* ---------------- 回车拆块 ---------------- */

/** 处理 Enter：返回 false 表示交给浏览器默认（代码块内部） */
export function handleEnterKey(editor: HTMLElement): boolean {
  const block = resolveBlock(editor)
  const caret = getCaretRange(editor)
  if (!block || !caret) return false
  if (block.tagName === 'PRE') return false // 代码块内回车 = 插入换行

  // 有选区时先删除
  if (!caret.collapsed) caret.deleteContents()

  const blockEmpty = isEmptyBlock(block)

  // 1) 空块回车：不同块类型有不同语义
  if (blockEmpty) {
    if (block.tagName === 'LI') {
      const p = liftListItemToParagraph(block)
      placeCaretAtStartOf(p)
      return true
    }
    if (block.tagName === 'BLOCKQUOTE' || HEADING_TAGS.includes(block.tagName)) {
      const p = replaceBlockWith(block, 'p') // 空引用/空标题：清除样式
      placeCaretAtStartOf(p)
      return true
    }
    const p = newParagraph()
    block.after(p)
    placeCaretAtStartOf(p)
    return true
  }

  // 2) 非空块：先判断光标在行首 / 行尾 / 行中
  const hasBefore = textBeforeCaretInBlock(block, caret)
  const hasAfter = textAfterCaretInBlock(block, caret)

  // —— 行首回车：在上方插入一个空行（当前块整体下移），光标停在上方新行 ——
  if (!hasBefore) {
    if (block.tagName === 'LI') {
      const list = block.parentElement as HTMLElement | null
      const li = document.createElement('li')
      ensureBrForEmpty(li)
      if (list) list.insertBefore(li, block)
      else block.before(li)
      placeCaretAtStartOf(li)
      return true
    }
    const lead = newParagraph()
    block.before(lead)
    placeCaretAtStartOf(lead)
    return true
  }

  // —— 行尾回车：在下方追加新行（段落/标题；列表续项；引用末尾退出为正文） ——
  if (!hasAfter) {
    if (block.tagName === 'LI') {
      const list = block.parentElement as HTMLElement | null
      const li = document.createElement('li')
      ensureBrForEmpty(li)
      if (list) list.insertBefore(li, block.nextSibling)
      else block.after(li)
      placeCaretAtStartOf(li)
      return true
    }
    const next = newParagraph()
    block.after(next)
    placeCaretAtStartOf(next)
    return true
  }

  // —— 行中回车：从光标处拆成两段 ——
  const rest = extractAfterCaret(block, caret)

  if (block.tagName === 'LI') {
    // 列表内回车：继续同类型列表
    const list = block.parentElement as HTMLElement | null
    const li = document.createElement('li')
    if (rest.hasChildNodes()) li.appendChild(rest)
    ensureBrForEmpty(li)
    if (list) list.insertBefore(li, block.nextSibling)
    else block.after(li)
    placeCaretAtStartOf(li)
    return true
  }

  if (block.tagName === 'BLOCKQUOTE') {
    // 引用内回车：后续内容落到正文段落（退出引用）
    const p = newParagraph(rest)
    block.after(p)
    placeCaretAtStartOf(p)
    return true
  }

  // 标题 / 段落：标题拆出的后续默认转为正文
  const next = newParagraph(rest)
  block.after(next)
  placeCaretAtStartOf(next)
  return true
}

/* ---------------- 粘贴为纯文本 ---------------- */

function selectCollapsedAfter(node: Node): void {
  const range = document.createRange()
  range.setStartAfter(node)
  range.collapse(true)
  applyRange(range)
}

export function pasteTextInto(editor: HTMLElement, text: string): void {
  const caret = getCaretRange(editor)
  if (!caret) return
  const clean = text.replace(/\r\n?/g, '\n')

  const block = resolveBlock(editor)

  // 代码块内：整段文本（含换行）
  if (block && block.tagName === 'PRE') {
    caret.deleteContents()
    const node = document.createTextNode(clean)
    caret.insertNode(node)
    selectCollapsedAfter(node)
    return
  }

  const lines = clean.split('\n')
  // 单行：直接插入当前位置
  if (lines.length <= 1) {
    caret.deleteContents()
    const node = document.createTextNode(clean)
    caret.insertNode(node)
    selectCollapsedAfter(node)
    return
  }

  // 多行：首行就地插入，其余行依次生成段落
  caret.deleteContents()
  let anchor: HTMLElement = block ?? editor
  const first = lines[0]
  if (first) {
    const node = document.createTextNode(first)
    caret.insertNode(node)
    selectCollapsedAfter(node)
  }
  let lastLine: HTMLElement | null = null
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '' && i === lines.length - 1) continue // 结尾空行
    const p = newParagraph()
    p.textContent = lines[i]
    anchor.after(p)
    anchor = p
    lastLine = p
  }
  if (lastLine) placeCaretAtStartOf(lastLine)
}
