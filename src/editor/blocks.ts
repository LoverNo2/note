/**
 * 自研块编辑器 DOM 引擎（contenteditable 之上的一层受控操作）。
 *
 * 约定：
 * - 正文内容顶层只允许块元素：p / h1-h5 / ul / ol / pre(code) / hr
 * - 列表项 li 内直接容纳行内内容（不嵌 p）
 * - 引擎只做 DOM 变换并尽量保留光标所在的文本节点；撤销/重做由调用方维护快照
 */

export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5'
export type BlockKind =
  | 'paragraph'
  | HeadingLevel
  | 'codeblock'
  | 'bulletList'
  | 'orderedList'
export type InlineMark = 'bold' | 'italic' | 'underline' | 'strike' | 'inlineCode'

const MARK_TAGS: Record<InlineMark, string[]> = {
  bold: ['B', 'STRONG'],
  italic: ['I', 'EM'],
  underline: ['U'],
  strike: ['S', 'STRIKE', 'DEL'],
  inlineCode: ['CODE'],
}

const HEADING_TAGS = ['H1', 'H2', 'H3', 'H4', 'H5']

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
      if (tag === 'LI' || tag === 'PRE') return node as HTMLElement
      // 表格内的光标归属到整张表格（单元格本身不是可切换的块类型）
      if (tag === 'TABLE') return node as HTMLElement
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
  // 表格不是可切换的块类型：不点亮任何块按钮
  if (tag === 'TABLE') return null
  if (tag === 'LI') {
    return block.closest('OL') ? 'orderedList' : 'bulletList'
  }
  if (tag === 'PRE') return 'codeblock'
  if (HEADING_TAGS.includes(tag)) return tag.toLowerCase() as HeadingLevel
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
/** 光标锚点：顶层块序号 + 块内文本偏移（空块也能精确定位，避免落到文档末尾） */
export interface CaretAnchor {
  block: number
  offset: number
}

export function caretAnchor(editor: HTMLElement): CaretAnchor | null {
  const sel = getSelection()
  if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode)) return null
  let top: Node | null = sel.anchorNode
  while (top && top.parentNode !== editor) top = top.parentNode
  if (!top || top.nodeType !== Node.ELEMENT_NODE) return null
  const block = top as HTMLElement
  const blockIndex = Array.from(editor.children).indexOf(block)
  if (blockIndex < 0) return null
  // 用 Range 取「块首 → 光标」的文本长度：这样光标落在元素边界（如块末尾）
  // 时也能算出正确的偏移，不会退化成 0 而被当成块首。零宽锚点不计入。
  const range = document.createRange()
  try {
    range.setStart(block, 0)
    range.setEnd(sel.anchorNode, sel.anchorOffset)
  } catch {
    return { block: blockIndex, offset: 0 }
  }
  const offset = blockOffsetAt(block, sel.anchorNode, sel.anchorOffset)
  // 定位不到就返回 null：宁可不恢复光标，也不要把它错误地放到块首
  if (offset === null) return null
  return { block: blockIndex, offset }
}

/** 一个节点的偏移权重：文本字符数、<br> 与单元格边界各 1 */
function nodeWeight(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\u200b/g, '').length
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tag = (node as HTMLElement).tagName
    if (tag === 'BR' || tag === 'TD' || tag === 'TH') return 1
    let sum = 0
    for (const child of Array.from(node.childNodes)) sum += nodeWeight(child)
    return sum
  }
  return 0
}

/**
 * 块内偏移：文本字符数 + 每个 <br> 计 1 + 每个单元格边界计 1。
 * 必须把 <br> 和单元格边界算进去，否则“第 N 行/格开头”与“上一行/格末尾”
 * 会算出同一个偏移，DOM 重排（语法高亮、排版包裹）后光标就会跑到上一行/上一格。
 * 采用“从块首一路走到光标位置”的计数方式（而不是 cloneContents），
 * 这样光标正好落在某个元素边界（如空的 td）时也能正确计入。
 */
function blockOffsetAt(block: HTMLElement, container: Node, offset: number): number | null {
  let total = 0
  let found: number | null = null
  // 光标停在块元素自身的边界上（Chrome 在内容末尾常这样表达）：
  // 按“前 offset 个子节点的权重”折算，否则会找不到容器而被当成偏移 0（表现为光标跳回块首）
  if (container === block) {
    const n = Math.min(offset, block.childNodes.length)
    for (let i = 0; i < n; i++) total += nodeWeight(block.childNodes[i])
    return total
  }
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (found !== null) return
      if (child === container) {
        if (child.nodeType === Node.TEXT_NODE) {
          // 光标 offset 按原始字符计，锚点里的零宽空格不占偏移，先换算掉
          const raw = child.textContent ?? ''
          found = total + raw.slice(0, offset).replace(/\u200b/g, '').length
        } else {
          const tag = (child as HTMLElement).tagName
          // 光标停在元素边界上（如空单元格）：偏移 0 表示“跨入这个元素”
          const bump = (tag === 'TD' || tag === 'TH') && offset === 0 ? 1 : 0
          let acc = 0
          for (let i = 0; i < Math.min(offset, child.childNodes.length); i++) {
            acc += nodeWeight(child.childNodes[i])
          }
          found = total + bump + acc
        }
        return
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child as HTMLElement).tagName
        if (tag === 'BR') {
          total += 1
          continue
        }
        // 单元格边界占 1，并继续进入单元格内部计数
        if (tag === 'TD' || tag === 'TH') total += 1
        walk(child)
        continue
      }
      total += (child.textContent ?? '').replace(/\u200b/g, '').length
    }
  }
  walk(block)
  return found
}

/** 按“块内偏移（<br> 计 1）”放置光标：行首 / 上一行末尾由此区分 */
function placeCaretAtBlockOffset(block: HTMLElement, offset: number): void {
  let remain = Math.max(0, offset)
  let placed = false
  const put = (range: Range): void => {
    if (placed) return
    placed = true
    applyRange(range)
  }
  const walk = (node: Node): void => {
    if (placed) return
    for (const child of Array.from(node.childNodes)) {
      if (placed) return
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childTag = (child as HTMLElement).tagName
        if (childTag === 'TD' || childTag === 'TH') {
          // 偏移落在单元格边界上 → 进入这个单元格的开头
          if (remain <= 1) {
            const range = document.createRange()
            range.setStart(child, 0)
            range.collapse(true)
            put(range)
            return
          }
          remain -= 1
          walk(child)
          continue
        }
        if (childTag === 'BR') {
          if (remain === 0) {
            // 偏移正好落在换行符上 → 上一行末尾
            const range = document.createRange()
            range.setStartBefore(child)
            range.collapse(true)
            put(range)
            return
          }
          remain -= 1
          if (remain === 0) {
            // 换行符之后 → 下一行行首
            const range = document.createRange()
            range.setStartAfter(child)
            range.collapse(true)
            put(range)
            return
          }
          continue
        }
        walk(child)
        continue
      }
      const text = (child.textContent ?? '').replace(/\u200b/g, '')
      if (remain <= text.length) {
        const range = document.createRange()
        range.setStart(child, remain)
        range.collapse(true)
        put(range)
        return
      }
      remain -= text.length
    }
  }
  walk(block)
  if (!placed) placeCaretAtEndOf(block)
}

export function restoreCaretAnchor(editor: HTMLElement, anchor: CaretAnchor): void {
  const block = editor.children[anchor.block] as HTMLElement | undefined
  if (!block) return
  placeCaretAtBlockOffset(block, anchor.offset)
}

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

/** 在容器内按文本偏移放置光标；容器无文本（如空 <code>）时放在开头 */export function placeCaretInTextAt(container: Node, offset: number): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let remain = Math.max(0, offset)
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
  // 没有文本节点（空块）或超出总长：放块内末尾
  if (remain === 0 && offset === 0) {
    placeCaretAtStartOf(container)
    return
  }
  placeCaretAtEndOf(container)
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

/** 光标之后（块内）是否有可见文本。
 *  用 Range 取文本，光标落在元素容器（而非文本节点）上时判定同样准确 */
function textAfterCaretInBlock(block: HTMLElement, caret: Range): boolean {
  const r = document.createRange()
  try {
    r.setStart(caret.startContainer, caret.startOffset)
    r.setEnd(block, block.childNodes.length)
  } catch {
    return false
  }
  return r.toString().trim().length > 0
}

/** 光标之前（块内）是否有可见文本。
 *  用 Range 取文本，光标落在元素容器（而非文本节点）上时判定同样准确 */
function textBeforeCaretInBlock(block: HTMLElement, caret: Range): boolean {
  const r = document.createRange()
  try {
    r.setStart(block, 0)
    r.setEnd(caret.startContainer, caret.startOffset)
  } catch {
    return false
  }
  return r.toString().trim().length > 0
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

/** 将段落等包装为代码块 */
function wrapAsCode(block: HTMLElement): HTMLElement {
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  // 空块（如 <p><br></p>）转成空行文本，避免 br 造成的额外换行
  code.textContent = isEmptyBlock(block) ? '' : textContentWithBreaks(block)
  pre.appendChild(code)
  block.replaceWith(pre)
  return pre
}

/** 块内文本：<br> 视作换行，行内标记只取文本（代码块是纯文本容器） */
function textContentWithBreaks(el: HTMLElement): string {
  let out = ''
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.textContent ?? ''
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      const tag = (n as HTMLElement).tagName
      if (tag === 'BR') out += '\n'
      else out += textContentWithBreaks(n as HTMLElement)
    }
  }
  return out
}

/** 把多个连续的段落/标题块合并为一个代码块（每块一行，中间空段保留为空行） */
function mergeBlocksToCode(blocks: HTMLElement[]): HTMLElement {
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  const lines = blocks.map((b) =>
    isEmptyBlock(b) ? '' : textContentWithBreaks(b),
  )
  code.textContent = lines.join('\n')
  pre.appendChild(code)
  blocks[0]!.replaceWith(pre)
  for (let i = 1; i < blocks.length; i++) blocks[i]!.remove()
  return pre
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

/** 由任意节点向上找最近的“可编辑块”（li/p/标题/pre 等） */
function blockOfNode(node: Node, editor: HTMLElement): HTMLElement | null {
  let n: Node | null = node
  while (n && n !== editor) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const tag = (n as HTMLElement).tagName
      if (tag === 'LI' || tag === 'PRE') {
        return n as HTMLElement
      }
      if (tag === 'P' || HEADING_TAGS.includes(tag) || tag === 'DIV') {
        return n as HTMLElement
      }
    }
    n = n.parentNode
  }
  return null
}

/**
 * 选区覆盖到的顶层块序列。
 * - 塌缩（只有光标）→ 返回 null（沿用单块逻辑）
 * - 跨多个顶层段落/标题且中间没有列表/代码块等时返回这些块，
 *   否则返回 null，避免破坏复杂结构
 */
function selectedBlocks(editor: HTMLElement): HTMLElement[] | null {
  const range = getCaretRange(editor)
  if (!range) return null
  // 用 anchor/focus 两端取边界：anchor==focus（纯光标）时为 null，
  // 反向拖选也不会因 Range 被浏览器折叠而丢失另一端
  const sel = getSelection()
  if (!sel || !sel.anchorNode || !sel.focusNode) return null
  const a = blockOfNode(sel.anchorNode, editor)
  const b = blockOfNode(sel.focusNode, editor)
  if (!a || !b || a === b) return null
  if (a.parentNode !== editor || b.parentNode !== editor) return null

  const kids = Array.from(editor.children)
  const ia = kids.indexOf(a)
  const ib = kids.indexOf(b)
  if (ia < 0 || ib < 0) return null
  const lo = Math.min(ia, ib)
  const hi = Math.max(ia, ib)
  const out: HTMLElement[] = []
  for (let i = lo; i <= hi; i++) {
    const block = kids[i] as HTMLElement
    if (!isPlainBlock(block)) return null
    out.push(block)
  }
  // 去掉首尾的空块：拖选多行时常把上下相邻的空段落夹带进来，
  // 不应把它们转成“空列表项”多出空行（中间的仍保留）
  while (out.length > 0 && isEmptyBlock(out[0]!)) out.shift()
  while (out.length > 0 && isEmptyBlock(out[out.length - 1]!)) out.pop()
  return out.length > 0 ? out : null
}

/** 把整段连续的段落/标题块合成为一个列表（每块一项） */
function wrapBlocksAsList(blocks: HTMLElement[], tag: 'UL' | 'OL'): HTMLElement {
  const list = document.createElement(tag)
  for (const block of blocks) {
    const li = document.createElement('li')
    li.append(...Array.from(block.childNodes))
    ensureBrForEmpty(li)
    list.appendChild(li)
  }
  blocks[0]!.replaceWith(list)
  for (let i = 1; i < blocks.length; i++) blocks[i]!.remove()
  trimTrailingEmptyItems(list)
  return list
}

/** 去掉列表末尾多余的空项（保留至少一项，整表为空则保留一个空项） */
function trimTrailingEmptyItems(list: HTMLElement): void {
  const lis = Array.from(list.children).filter(
    (n) => n.tagName === 'LI',
  ) as HTMLElement[]
  for (let i = lis.length - 1; i > 0; i--) {
    if (isEmptyBlock(lis[i]!)) lis[i]!.remove()
    else break
  }
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
  /** 光标在表格内 */
  inTable: boolean
  /** 光标所在单元格的内容对齐（不在表格内时无意义） */
  tableAlign: CellAlign
  canUndo: boolean
  canRedo: boolean
}

export function emptyToolbarUi(): ToolbarUi {
  return {
    kind: null,
    marks: {
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      inlineCode: false,
    },
    collapsed: true,
    inCode: false,
    inList: false,
    inTable: false,
    tableAlign: 'left',
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
  // 表格不是可切换的块类型：光标在表格内时块按钮不生效
  if (block.tagName === 'TABLE') return

  // —— 列表类目标 ——
  if (kind === 'codeblock' && block.tagName !== 'PRE') {
    // 跨多行选区：把选中的所有段落/标题整段合并进同一个代码块
    const many = selectedBlocks(editor)
    if (many) {
      const pre = mergeBlocksToCode(many)
      // 与其它路径一致：换行 → <br>，末尾换行补光标锚点
      codeTextToBrDom(editor)
      const code = pre.firstElementChild as HTMLElement | null
      if (code) placeCaretAtStartOf(code)
      return
    }
  }

  if (kind === 'bulletList' || kind === 'orderedList') {
    const targetTag = kind === 'bulletList' ? 'UL' : 'OL'

    // 跨多行选区：把选中的所有段落/标题整段转成一个列表
    const many = selectedBlocks(editor)
    if (many) {
      const list = wrapBlocksAsList(many, targetTag)
      const lastLi = list.lastElementChild
      if (lastLi) placeCaretAtEndOf(lastLi)
      return
    }

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

  const isCode = block.tagName === 'PRE'

  switch (kind) {
    case 'paragraph': {
      if (isCode) unwrapCodeToParagraph(block)
      else if (HEADING_TAGS.includes(block.tagName)) replaceBlockWith(block, 'p')
      break
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5': {
      if (isCode) return // 需先切回正文
      if (block.tagName === kind.toUpperCase()) {
        replaceBlockWith(block, 'p') // toggle：已是该标题 → 还原正文
      } else if (isPlainBlock(block)) {
        replaceBlockWith(block, kind.toUpperCase())
      }
      break
    }
    case 'codeblock': {
      if (isCode) {
        unwrapCodeToParagraph(block)
      } else if (isPlainBlock(block)) {
        // 记录光标在块内的相对文本位置（转换会重建 DOM，原光标必失效）
        let local = 0
        const caret = getCaretRange(editor)
        if (caret && block.contains(caret.startContainer)) {
          const walker = document.createTreeWalker(
            block,
            NodeFilter.SHOW_TEXT,
          )
          let n: Node | null = walker.nextNode()
          while (n) {
            if (n === caret.startContainer) {
              local = local + caret.startOffset
              break
            }
            local += (n.textContent ?? '').length
            n = walker.nextNode()
          }
        }
        const pre = wrapAsCode(block)
        // 换行符 → <br>，末尾换行补光标锚点（与粘贴/加载路径保持一致）
        codeTextToBrDom(editor)
        const code =
          (pre.firstElementChild as HTMLElement | null) ??
          (() => {
            const c = document.createElement('code')
            pre.appendChild(c)
            return c
          })()
        placeCaretInTextAt(code, local)
      }
      break
    }
    default:
      break
  }
}

/* ---------------- 块内容整理（清理浏览器残留） ---------------- */

/** 解包元素（保留其子内容） */
function unwrapElement(el: Element): void {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  el.remove()
}

/** 清除外来内联样式（浏览器粘贴/跨块合并产生的 span[style]、font 等），
 *  保留编辑器自身的强调标记（b/i/u/s/code） */
export function stripForeignStylesIn(container: HTMLElement): boolean {
  let changed = false
  for (const el of Array.from(container.querySelectorAll('span,font'))) {
    if (el.tagName === 'FONT') {
      unwrapElement(el)
      changed = true
      continue
    }
    if (el.hasAttribute('style')) {
      el.removeAttribute('style')
      changed = true
    }
    if (el.attributes.length === 0) {
      unwrapElement(el)
      changed = true
    }
  }
  return changed
}

/** 移除“有内容的块”末尾多余的 <br>（空块的占位 br 保留）。
 *  行尾换行没有排版意义（换行请用 Enter 新建段落），一律清掉，
 *  这样不会再出现“行末尾多出一空行”的困惑。 */
export function trimTrailingBreaksIn(block: HTMLElement): boolean {
  let changed = false
  for (;;) {
    const last = block.lastChild
    if (
      !last ||
      last.nodeType !== Node.ELEMENT_NODE ||
      (last as HTMLElement).tagName !== 'BR'
    ) {
      break
    }
    const others = Array.from(block.childNodes).filter((n) => n !== last)
    const hasContent = others.some((n) =>
      n.nodeType === Node.TEXT_NODE
        ? (n.textContent ?? '').length > 0
        : (n as HTMLElement).tagName !== 'BR',
    )
    if (!hasContent) break // 空块：保留占位 br
    last.remove()
    changed = true
  }
  return changed
}

/** node 之后（到块尾之间）是否已无有意义内容 */
function isAtBlockEnd(block: HTMLElement, node: Node): boolean {
  let cur: Node | null = node
  while (cur && cur !== block) {
    let s: Node | null = cur.nextSibling
    while (
      s &&
      s.nodeType === Node.TEXT_NODE &&
      !(s.textContent ?? '').length
    ) {
      s = s.nextSibling
    }
    if (s) return false
    cur = cur.parentNode
  }
  return true
}

/** 去掉块尾文本末尾的空白字符（空格 / 制表符 / 不换行空格）。
 *  protectCaret=true 时，若光标停在被删区间内则跳过，避免影响正在输入的内容 */
export function trimTrailingSpacesIn(
  block: HTMLElement,
  protectCaret = false,
): boolean {
  const t = lastTextNodeOf(block)
  if (!t) return false
  if (!isAtBlockEnd(block, t)) return false
  const text = t.textContent ?? ''
  const trimmed = text.replace(/[ \t\u00a0]+$/, '')
  if (trimmed === text) return false
  if (protectCaret) {
    const sel = getSelection()
    if (sel && sel.anchorNode === t && sel.anchorOffset > trimmed.length) {
      return false
    }
  }
  if (trimmed === '') t.remove()
  else t.textContent = trimmed
  return true
}

/* ---------- 代码块结构规范化（浏览器会在 <pre> 里塞进 <p>/<span>/<br>） ---------- */

const PRE_BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'SECTION', 'ARTICLE', 'FIGURE',
])

function preTextContent(pre: HTMLElement): string {
  const parts: string[] = []
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        parts.push(child.textContent ?? '')
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const el = child as HTMLElement
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
        if (body.trim() === '' && !inner.includes('\n')) continue // 空块不产生空行
        parts.push(body, '\n')
        continue
      }
      walk(el) // span/b/i 等内联：直接取内容
    }
  }
  walk(pre)
  return parts.join('')
}

/** 编辑器 DOM 中代码块的行分隔用 <br> 表示（浏览器对“换行符结尾文本之后”的光标
 *  处理不可靠，会把后续输入插进上一行）；存储时再折算回 \n。
 *  <br> 之后放一个零宽空格作为光标锚点，用户输入才会落进新行。 */
const CODE_ANCHOR = '\u200b'

export function insertCodeNewline(editor: HTMLElement): boolean {
  const block = resolveBlock(editor)
  if (!block || block.tagName !== 'PRE') return false
  const caret = getCaretRange(editor)
  if (!caret) return false

  caret.deleteContents()
  const br = document.createElement('br')
  caret.insertNode(br)
  const anchor = document.createTextNode(CODE_ANCHOR)
  br.after(anchor)

  const after = document.createRange()
  after.setStart(anchor, (anchor.textContent ?? '').length)
  after.collapse(true)
  applyRange(after)
  return true
}

/** 把代码块内的换行符拆成 <br> 行（加载内容后调用，无光标参与，安全） */
export function codeTextToBrDom(editor: HTMLElement): void {
  for (const pre of Array.from(editor.querySelectorAll('pre'))) {
    const code = pre.firstElementChild
    if (!code || code.tagName !== 'CODE') continue
    const text = code.textContent ?? ''
    if (!text.includes('\n') && !text.includes(CODE_ANCHOR)) continue
    const lines = text.split('\n')
    const endsWithNewline = lines[lines.length - 1] === ''
    code.replaceChildren()
    lines.forEach((line, i) => {
      if (i > 0) code.appendChild(document.createElement('br'))
      if (line) code.appendChild(document.createTextNode(line))
    })
    // 以换行结尾：末尾的 <br> 需要一个可见的落脚点，
    // 否则该空行不显示、光标会落在代码块末尾之外（表现为“偏移”）
    if (endsWithNewline) {
      code.appendChild(document.createTextNode(CODE_ANCHOR))
    }
  }
}

/** 光标在块内的文本偏移（光标落在元素边界时按累计长度处理） */
function textOffsetAtCaret(block: HTMLElement, caret: Range): number {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let acc = 0
  let n: Node | null = walker.nextNode()
  while (n) {
    if (n === caret.startContainer) return acc + caret.startOffset
    acc += (n.textContent ?? '').length
    n = walker.nextNode()
  }
  return acc
}

/** 把 <pre> 规整为 <code> + 纯文本；返回是否改动 DOM */
export function flattenPreElement(pre: HTMLElement): boolean {
  const text = preTextContent(pre)
  const code = pre.firstElementChild
  if (code && code.tagName === 'CODE' && pre.children.length === 1) {
    if ((code.textContent ?? '') !== text) {
      // 需要重写文本节点：尽量把光标恢复到同一文本偏移
      const sel = getSelection()
      const local =
        sel && sel.anchorNode && pre.contains(sel.anchorNode)
          ? textOffsetAtCaret(pre, sel.getRangeAt(0))
          : null
      code.textContent = text
      if (local !== null) placeCaretInTextAt(code, local)
      return true
    }
    return false
  }
  const c = document.createElement('code')
  c.textContent = text
  pre.replaceChildren(c)
  return true
}

/**
 * 保证代码块结构为 <pre><code>…</code></pre>，并返回 <code> 容器（幂等）。
 *
 * 粘贴到 pre 空白处、在 <code> 之外输入等操作会产生“裸 pre”——内容直接挂在
 * pre 下而没有 <code>。此时按 `pre.firstElementChild` 取容器的旧逻辑会拿到
 * null / <br>，表现为该代码块既不格式化（读不到文本）也不上色（找不到容器）。
 * 这里把 pre 的所有子节点按原顺序并进一个 <code>，再把 <code> 设为唯一子节点。
 */
export function ensureCodeEl(pre: HTMLElement): HTMLElement | null {
  const first = pre.firstElementChild as HTMLElement | null
  const existing =
    first && first.tagName === 'CODE'
      ? first
      : (pre.querySelector(':scope > code') as HTMLElement | null)
  const code = existing ?? document.createElement('code')
  for (const node of Array.from(pre.childNodes)) {
    if (node !== code) code.appendChild(node)
  }
  if (pre.children.length !== 1 || pre.firstChild !== code) {
    pre.replaceChildren(code)
  }
  return code
}

/** 就地整理一个块：清外来样式 + 去尾部多余 br（+ 非光标块的行尾空白）；
 *  返回是否改动 DOM */
export function tidyBlock(
  block: HTMLElement,
  protectCaret = false,
): boolean {
  // 代码块 / 表格不参与正文式清理：块内的 <br> 就是换行（空单元格也靠它落脚），
  // 行尾空格也可能是刻意保留的，清理会破坏结构与光标位置
  if (block.tagName === 'PRE' || block.tagName === 'TABLE') return false
  let changed = stripForeignStylesIn(block)
  while (trimTrailingBreaksIn(block)) changed = true
  if (trimTrailingSpacesIn(block, protectCaret)) changed = true
  return changed
}

/* ---------------- 选中区域强制转正文 ---------------- */

/** 剥除某区域内全部行内样式痕迹：解包加粗/斜体/下划线/删除线/行内代码，
 *  以及任何外来 span/font 残留，使文本恢复“无样式”的当前正文外观 */
function stripInlineMarksIn(container: HTMLElement): void {
  const TAGS = [
    'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL',
    'CODE', 'SPAN', 'FONT', 'SUB', 'SUP', 'MARK',
  ]
  const hits = Array.from(
    container.querySelectorAll(TAGS.join(',')),
  ).reverse() // 先解包最深层的
  for (const el of hits) {
    const children = Array.from(el.childNodes)
    if (children.length === 0) {
      el.remove()
      continue
    }
    el.replaceWith(...children)
  }
}

/** 顶层直接子块中，node 所在的那个 */
function topChildOf(editor: HTMLElement, node: Node): HTMLElement | null {
  let n: Node | null = node
  while (n && n.parentNode && n.parentNode !== editor) n = n.parentNode
  if (!n || n === editor || n.nodeType !== Node.ELEMENT_NODE) return null
  return n as HTMLElement
}

/** 一个列表整体拆成若干正文段落（每项一段，含嵌套项） */
function flattenListToParagraphs(list: HTMLElement): void {
  stripInlineMarksIn(list)
  const out: HTMLElement[] = []
  const walkList = (l: HTMLElement) => {
    for (const child of Array.from(l.children)) {
      if (child.tagName === 'LI') walkLi(child as HTMLElement)
    }
  }
  const walkLi = (li: HTMLElement) => {
    const p = document.createElement('p')
    const nested: HTMLElement[] = []
    for (const child of Array.from(li.childNodes)) {
      if (
        child.nodeType === Node.ELEMENT_NODE &&
        isListTag(child as HTMLElement)
      ) {
        nested.push(child as HTMLElement)
      } else {
        p.appendChild(child)
      }
    }
    ensureBrForEmpty(p)
    out.push(p)
    for (const l of nested) walkList(l)
  }
  walkList(list)
  let prev: HTMLElement | null = null
  for (const p of out) {
    if (prev) prev.after(p)
    else list.replaceWith(p)
    prev = p
  }
  if (prev === null) list.replaceWith(newParagraph())
}

/**
 * “强制应用正文”：把选区（未塌缩）触碰到的内容全部恢复为当前正文配置 ——
 * 剥除加粗/斜体/下划线/删除线/行内代码及外来 span/font 等一切行内样式，
 * 标题/列表/代码块等块类型也一并转成正文段落。
 * 选区塌缩（只有光标）时返回 false，由调用方按单块转换处理。
 */
export function paragraphsOnSelection(editor: HTMLElement): boolean {
  const sel = getSelection()
  if (
    !sel ||
    !sel.anchorNode ||
    !sel.focusNode ||
    (sel.anchorNode === sel.focusNode &&
      sel.anchorOffset === sel.focusOffset)
  ) {
    return false
  }
  const a = topChildOf(editor, sel.anchorNode)
  const b = topChildOf(editor, sel.focusNode)
  if (!a || !b) return false
  const kids = Array.from(editor.children) as HTMLElement[]
  const ia = kids.indexOf(a)
  const ib = kids.indexOf(b)
  if (ia < 0 || ib < 0) return false
  const lo = Math.min(ia, ib)
  const hi = Math.max(ia, ib)

  // 两端落在同一个顶层块
  if (lo === hi) {
    const top = a
    if (top.tagName === 'UL' || top.tagName === 'OL') {
      const liA = blockOfNode(sel.anchorNode, editor)
      const liB = blockOfNode(sel.focusNode, editor)
      if (liA && liB && liA !== liB) {
        flattenListToParagraphs(top) // 跨多个列表项：整表拆成段落
        return true
      }
      // 同在一个列表项里：剥样式后把该项提升为独立段落
      if (liA) {
        stripInlineMarksIn(liA)
        liftListItemToParagraph(liA)
        return true
      }
      return false
    }
    if (top.tagName === 'PRE') {
      unwrapCodeToParagraph(top) // 代码行本身无行内样式，直接拆段
      return true
    }
    stripInlineMarksIn(top)
    if (HEADING_TAGS.includes(top.tagName) || top.tagName === 'DIV') {
      replaceBlockWith(top, 'p')
    }
    return true
  }

  // 跨多个顶层块：逐块转正文并剥样式
  for (const top of kids.slice(lo, hi + 1)) {
    if (top.tagName === 'UL' || top.tagName === 'OL') {
      flattenListToParagraphs(top)
    } else if (top.tagName === 'PRE') {
      unwrapCodeToParagraph(top)
    } else {
      stripInlineMarksIn(top)
      if (HEADING_TAGS.includes(top.tagName) || top.tagName === 'DIV') {
        replaceBlockWith(top, 'p')
      }
    }
  }
  return true
}

/** 顶部笔记标题回车：每次都在正文最顶部插入一个新的空段落并聚焦 */
export function ensureStartParagraph(editor: HTMLElement): HTMLElement {
  const p = newParagraph()
  editor.insertBefore(p, editor.firstChild)
  placeCaretAtStartOf(p)
  return p
}

/** 删除正文最顶部的空行（光标须在该空行内）；删空最后一个块时不做处理 */
export function deleteFirstEmptyParagraph(editor: HTMLElement): boolean {
  const first = editor.firstElementChild as HTMLElement | null
  if (!first || first.tagName !== 'P') return false
  if (!isEmptyBlock(first)) return false
  if (editor.children.length <= 1) return false // 唯一空行保留

  const caret = getCaretRange(editor)
  if (!caret || !editor.contains(caret.startContainer)) return false
  if (
    caret.startContainer !== first &&
    !first.contains(caret.startContainer)
  ) {
    return false
  }

  const next = first.nextElementSibling as HTMLElement | null
  first.remove()
  if (next) {
    placeCaretAtStartOf(next)
    return true
  }
  return false
}

/** 区域内最深的最后一个文本节点（用于判定“光标在末尾”） */
function lastTextNodeOf(container: Node): Text | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let last: Text | null = null
  let n: Node | null = walker.nextNode()
  while (n) {
    last = n as Text
    n = walker.nextNode()
  }
  return last
}

/**
 * 自愈：把编辑区顶层游离的文本节点收拢到相邻前一个块里
 * （例如往代码块粘贴时被浏览器顶到 <pre> 外的内容，会放回代码块中；
 * 正常编辑不会产生顶层游离文本）。
 */
export function healStrayTopLevelText(editor: HTMLElement): void {
  for (const node of Array.from(editor.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE) continue
    const text = node.textContent ?? ''
    const prev = node.previousSibling
    if (prev && prev.nodeType === Node.ELEMENT_NODE) {
      const el = prev as HTMLElement
      const target =
        el.tagName === 'PRE' && el.firstElementChild
          ? el.firstElementChild
          : el
      target.appendChild(document.createTextNode(text))
      node.remove()
    } else {
      node.remove()
    }
  }
}

/**
 * 光标在代码块最后一行（含末尾空行）的任意位置按 ↓ 方向键：
 * 在代码块正下方新建一个正文段落（原有内容整体下移），并把光标移过去——
 * 相当于“从代码块底部另起一个新空行”。返回是否已处理；不在最后一行时
 * 返回 false，交给浏览器默认在代码块内下移光标。
 */
export function codeExitOnArrowDown(editor: HTMLElement): boolean {
  const block = resolveBlock(editor)
  if (!block || block.tagName !== 'PRE') return false
  const caret = getCaretRange(editor)
  if (!caret) return false
  const code = ensureCodeEl(block)
  if (!code || !code.contains(caret.startContainer)) return false

  // 最后一行判定：光标所在行号 == 末行行号（末尾空行也算一行）
  const lines = codeLineTexts(code)
  const { line } = codeLineCol(code, caret.startContainer, caret.startOffset)
  if (line < lines.length - 1) return false

  const p = newParagraph()
  block.after(p)
  placeCaretAtStartOf(p)
  return true
}

/* ---------------- 代码块单行注释 ---------------- */

/** 光标 / 选区所在的代码块（pre）；不在代码块内返回 null */
function codeBlockOf(editor: HTMLElement, node: Node): HTMLElement | null {
  let cur: Node | null = node
  while (cur && cur !== editor) {
    if (cur.nodeType === Node.ELEMENT_NODE && (cur as HTMLElement).tagName === 'PRE') {
      return cur as HTMLElement
    }
    cur = cur.parentNode
  }
  return null
}

/** 代码块 DOM → 行文本（<br> 为换行；零宽锚点不计入） */
function codeLineTexts(code: HTMLElement): string[] {
  const lines: string[] = ['']
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if ((child as HTMLElement).tagName === 'BR') lines.push('')
        else walk(child)
        continue
      }
      const text = (child.textContent ?? '').replace(/\u200b/g, '')
      if (text) lines[lines.length - 1] += text
    }
  }
  walk(code)
  return lines
}

/** 代码块内某位置（容器 + 偏移）对应的行号与列（皆 0 基） */
function codeLineCol(code: HTMLElement, container: Node, offset: number): { line: number; col: number } {
  const range = document.createRange()
  try {
    range.setStart(code, 0)
    range.setEnd(container, offset)
  } catch {
    return { line: 0, col: 0 }
  }
  let line = 0
  let col = 0
  const frag = range.cloneContents()
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if ((child as HTMLElement).tagName === 'BR') {
          line += 1
          col = 0
        } else {
          walk(child)
        }
        continue
      }
      col += (child.textContent ?? '').replace(/\u200b/g, '').length
    }
  }
  walk(frag)
  return { line, col }
}

/** 用行文本重建代码块内容（与 codeTextToBrDom 的 DOM 形态保持一致） */
function setCodeLines(code: HTMLElement, lines: string[]): void {
  code.replaceChildren()
  lines.forEach((line, i) => {
    if (i > 0) code.appendChild(document.createElement('br'))
    if (line) code.appendChild(document.createTextNode(line))
  })
  if (lines[lines.length - 1] === '') {
    code.appendChild(document.createTextNode(CODE_ANCHOR))
  }
}

/**
 * 把光标放进代码块的第 line 行。
 * 位置取“行内第一个字符之后”而不是行首：块内文本偏移不计算 <br>，
 * 行首会与上一行末尾算出同一个偏移，DOM 重排后光标会被还原到上一行。
 */
function placeCaretInCodeLine(code: HTMLElement, line: number): void {
  let cur = 0
  const found: Text[] = []
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (found.length) return
      if (child.nodeType === Node.ELEMENT_NODE) {
        if ((child as HTMLElement).tagName === 'BR') cur += 1
        else walk(child)
        continue
      }
      if (cur === line && (child.textContent ?? '').replace(/\u200b/g, '')) {
        found.push(child as Text)
        return
      }
    }
  }
  walk(code)

  const target = found[0] ?? null
  const range = document.createRange()
  if (target) {
    range.setStart(target, Math.min(1, (target.textContent ?? '').length))
  } else {
    range.setStart(code, 0)
  }
  range.collapse(true)
  applyRange(range)
}

/**
 * ⌘/ ·Ctrl+/ ：给代码块内选中的行（光标所在行为单行）切换行注释 `// `。
 * 缩进保留；已全部注释的行则取消注释；空行不参与。
 * 不在代码块内、或选区跨出代码块时返回 false。
 */
export function toggleCodeComment(editor: HTMLElement): boolean {
  const sel = getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  const pre = codeBlockOf(editor, range.startContainer)
  if (!pre) return false
  if (!pre.contains(range.endContainer)) return false
  const code = pre.firstElementChild as HTMLElement | null
  if (!code || code.tagName !== 'CODE') return false

  const lines = codeLineTexts(code)
  if (!lines.length) return false
  const a = codeLineCol(code, range.startContainer, range.startOffset)
  const b = codeLineCol(code, range.endContainer, range.endOffset)
  let startLine = Math.min(a.line, b.line)
  let endLine = Math.max(a.line, b.line)
  // 选区停在下一行行首时不算这一行（用户只选到上一行末尾）
  if (endLine > startLine && b.col === 0) endLine -= 1
  startLine = Math.max(0, Math.min(startLine, lines.length - 1))
  endLine = Math.max(startLine, Math.min(endLine, lines.length - 1))

  // 空行不参与；范围内全是空行时只处理光标所在行
  const targets: number[] = []
  for (let i = startLine; i <= endLine; i++) {
    if (lines[i].trim()) targets.push(i)
  }
  const use = targets.length ? targets : [startLine]

  const commented = use.every((i) => /^[ \t]*\/\//.test(lines[i]))
  for (const i of use) {
    if (commented) {
      lines[i] = lines[i].replace(/^([ \t]*)\/\/ ?/, '$1')
    } else {
      lines[i] = lines[i].replace(/^([ \t]*)/, '$1// ')
    }
  }

  setCodeLines(code, lines)
  placeCaretInCodeLine(code, startLine)
  return true
}

/* ---------------- 代码块：保存时的格式整理 ---------------- */

export interface CodeFormatOptions {
  /** 行首缩进里的 Tab 换成几个空格（0 = 不处理） */
  tabSize: number
  /** 连续 3 行以上的空行折成 1 行（1~2 行原样保留） */
  collapseBlankLines: boolean
  /** 去掉行尾分号（保留其后的空白） */
  stripTrailingSemicolon: boolean
  /**
   * 缩进等比例归一：该块行首最小缩进单位若小于 tabSize 且能整除 tabSize，
   * 就把各行的缩进按同一比例放大到 tabSize（2→4、4→8、6→12…），结构不变。
   */
  normalizeIndent: boolean
  /**
   * 单行控制结构（if / for / while）拆成两行，体为块 `{ … }` 的除外：
   *   if (cond) doSomething()
   * →
   *   if (cond)
   *       doSomething()
   * 若同行还带行尾注释，注释会先被提到该行上方（见 hoistTrailingComments）。
   */
  breakInlineControl: boolean
}

export const CODE_FORMAT: CodeFormatOptions = {
  tabSize: 4,
  collapseBlankLines: true,
  stripTrailingSemicolon: true,
  normalizeIndent: true,
  breakInlineControl: true,
}

/**
 * 代码文本整理（纯函数，便于测试）：
 *  - 行首缩进的 Tab → N 个空格（行内的 Tab 不动，避免破坏对齐）
 *  - 行尾分号去掉（分号后的尾随空白保留）
 *  - 连续 3 行以上空行折成 1 行
 */
/**
 * 缩进等比例归一（纯函数）。
 * 只在「最小缩进单位 < tabSize 且能整除 tabSize」时动手，且只映射
 * 「恰好是最小单位整数倍」的行——用于对齐的长缩进会原样保留，避免破坏排版。
 */
export function normalizeIndentScale(
  lines: string[],
  tabSize: number,
): string[] {
  const widths: number[] = []
  for (const line of lines) {
    const width = line.length - line.trimStart().length
    if (width > 0) widths.push(width)
  }
  if (!widths.length) return lines
  const minUnit = Math.min(...widths)
  if (minUnit < 2 || minUnit >= tabSize || tabSize % minUnit !== 0) return lines
  return lines.map((line) => {
    const width = line.length - line.trimStart().length
    if (width <= 0 || width % minUnit !== 0) return line
    return ' '.repeat((width / minUnit) * tabSize) + line.trimStart()
  })
}

/**
 * 行尾注释整理（纯函数）：
 * - 独占一行的注释（前面只有空白）原样保留；
 * - 行尾注释 `code // 注释` → 注释提为 code 上方独立一行，并在注释上方空一行；
 *   剥离后落在行尾的分号一并去掉（与去行尾分号规则一致）。
 * 空行不叠加：上方已是空行时不再重复插入。
 */
export function hoistTrailingComments(src: string, stripTrailingSemicolon = true): string {
  const out: string[] = []
  for (const line of src.split('\n')) {
    const at = line.indexOf('//')
    const code = at >= 0 ? line.slice(0, at) : line
    if (at < 0 || code.trim() === '') {
      out.push(line) // 无注释，或整行注释（独占一行）—— 都不动
      continue
    }
    const body = code.replace(/[ \t]+$/, '')
    const indent = (/^[ \t]*/.exec(body) ?? [''])[0]
    const comment = line.slice(at).trim()
    if (out.length && out[out.length - 1] !== '') out.push('') // 注释上方空一行
    out.push(`${indent}${comment}`)
    out.push(stripTrailingSemicolon ? body.replace(/;$/, '') : body)
  }
  return out.join('\n')
}

/** 行首即为 if / for / while 且后跟 `(` 的行 */
const INLINE_HEAD_RE = /^([ \t]*)(if|for|while)[ \t]*\(/

/**
 * 拆出单行控制结构 `if|for|while (…)<体>` 的四段（缩进 / 关键字 / 条件 / 体）。
 * 用括号配对定位收尾 `)`，避免“条件或体内含括号”时被正则误切；
 * 行首不是控制关键字、或括号不配对时返回 null。
 */
function splitInlineControl(
  line: string,
): { indent: string; keyword: string; cond: string; body: string } | null {
  const head = INLINE_HEAD_RE.exec(line)
  if (!head) return null
  const indent = head[1]
  const keyword = head[2]
  const open = head[0].length - 1
  let depth = 0
  let i = open
  for (; i < line.length; i++) {
    const ch = line[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) break
    }
  }
  if (depth !== 0) return null
  return {
    indent,
    keyword,
    cond: line.slice(open + 1, i).trim(),
    body: line.slice(i + 1).trim(),
  }
}

/**
 * 单行控制结构拆行（纯函数）：`if|for|while (cond) <单条语句>` →
 *   if (cond)
 *       <语句>
 * - 只处理“行首就是控制关键字”的整行；`else if …` 不受影响；
 * - 体为空（`if (cond)`）或为块（`{ … }`）时不拆；
 * - 行尾注释通常已由 hoistTrailingComments 提走，这里对残留注释做兜底（提到该行上方）。
 */
export function breakInlineControl(src: string, tabSize = 4): string {
  const pad = ' '.repeat(Math.max(1, tabSize))
  const out: string[] = []
  for (const line of src.split('\n')) {
    const split = splitInlineControl(line)
    if (!split) {
      out.push(line)
      continue
    }
    const { indent, keyword, cond, body: raw } = split
    if (!raw || raw.startsWith('{')) {
      out.push(line) // 体为空、或块级结构：整体不拆
      continue
    }
    let body = raw
    let comment = ''
    const at = body.indexOf('//')
    if (at >= 0) {
      comment = body.slice(at).trim()
      body = body.slice(0, at).trim()
    }
    if (comment) out.push(`${indent}${comment}`)
    out.push(`${indent}${keyword} (${cond})`)
    if (body) out.push(`${indent}${pad}${body}`)
  }
  return out.join('\n')
}

export function formatCodeText(src: string, opts: CodeFormatOptions = CODE_FORMAT): string {
  let lines = src.replace(/\r\n?/g, '\n').split('\n')

  if (opts.tabSize > 0) {
    const pad = ' '.repeat(opts.tabSize)
    lines = lines.map((line) =>
      line.replace(/^[ \t]+/, (indent) => indent.replace(/\t/g, pad)),
    )
  }

  if (opts.stripTrailingSemicolon) {
    lines = lines.map((line) => line.replace(/;(\s*)$/, '$1'))
  }

  if (opts.collapseBlankLines) {
    const out: string[] = []
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== '') {
        out.push(lines[i])
        continue
      }
      let j = i
      while (j < lines.length && lines[j].trim() === '') j++
      const count = j - i
      const keep = count >= 3 ? 1 : count
      for (let k = 0; k < keep; k++) out.push('')
      i = j - 1
    }
    lines = out
  }

  if (opts.normalizeIndent) {
    lines = normalizeIndentScale(lines, opts.tabSize)
  }

  if (opts.breakInlineControl) {
    // 先把行尾注释提到独立一行（注释上方空一行），再拆单行控制结构
    lines = hoistTrailingComments(
      lines.join('\n'),
      opts.stripTrailingSemicolon,
    ).split('\n')
    lines = breakInlineControl(lines.join('\n'), opts.tabSize).split('\n')
  }

  return lines.join('\n')
}

/** 取代码块文本（<br> 视作换行，零宽锚点不计入）；结构性异常的裸 pre 会先被规整 */
export function codeBlockText(pre: HTMLElement): string {
  const code = ensureCodeEl(pre)
  if (!code) return ''
  return textContentWithBreaks(code).replace(/\u200b/g, '')
}

/** 按文本重建代码块内容（渲染标记随之清掉，调用方需重新高亮） */
export function setCodeBlockText(pre: HTMLElement, text: string): void {
  const code = ensureCodeEl(pre)
  if (!code) return
  setCodeLines(code, text.split('\n'))
}

/**
 * 对编辑器里所有代码块做格式整理（保存前调用）。
 * 会重建代码块内容（渲染标记随之清掉，调用方需重新高亮）。
 * 返回是否发生了改动。
 */
export function formatCodeBlocks(
  editor: HTMLElement,
  opts: CodeFormatOptions = CODE_FORMAT,
): boolean {
  let changed = false
  for (const pre of Array.from(editor.querySelectorAll('pre')) as HTMLElement[]) {
    const code = ensureCodeEl(pre)
    if (!code) continue
    const text = codeBlockText(pre)
    if (!text.trim()) continue
    const next = formatCodeText(text, opts)
    if (next === text) continue
    setCodeLines(code, next.split('\n'))
    changed = true
  }
  return changed
}

/* ---------------- 表格 ---------------- */

/** 单元格内容对齐 */
export type CellAlign = 'left' | 'center' | 'right'

export interface TableContext {
  table: HTMLTableElement
  row: HTMLTableRowElement
  cell: HTMLTableCellElement
  rowIndex: number
  colIndex: number
  /** 当前单元格的对齐方式（未显式设置时为 left） */
  align: CellAlign
}

function closestTag(editor: HTMLElement, node: Node, tags: string[]): HTMLElement | null {
  let cur: Node | null = node
  while (cur && cur !== editor) {
    if (cur.nodeType === Node.ELEMENT_NODE && tags.includes((cur as HTMLElement).tagName)) {
      return cur as HTMLElement
    }
    cur = cur.parentNode
  }
  return null
}

/** 一行里的单元格（忽略杂散节点） */
function rowCells(row: Element): HTMLTableCellElement[] {
  return Array.from(row.children).filter(
    (c) => c.tagName === 'TD' || c.tagName === 'TH',
  ) as HTMLTableCellElement[]
}

/** 空单元格：放一个 <br> 作为可点击/可输入的落脚点 */
function emptyCell(tag: 'td' | 'th'): HTMLTableCellElement {
  const cell = document.createElement(tag) as HTMLTableCellElement
  cell.appendChild(document.createElement('br'))
  return cell
}

function focusCell(cell: HTMLElement | null | undefined): void {
  if (cell) placeCaretAtStartOf(cell)
}

/** 单元格内容对齐：读内联样式，未设置为 left */
export function cellAlign(cell: HTMLElement): CellAlign {
  const v = (cell.style.textAlign || '').toLowerCase()
  return v === 'center' || v === 'right' ? v : 'left'
}

/** 写对齐：左对齐不写字面样式，保持存储干净 */
function applyCellAlign(cell: HTMLElement, align: CellAlign): void {
  if (align === 'left') cell.style.removeProperty('text-align')
  else cell.style.textAlign = align
  if (!cell.getAttribute('style')) cell.removeAttribute('style')
}

/**
 * 按“表格 + 行列索引”还原上下文：行列操作据此执行，
 * 这样即使点击按钮时编辑器已失焦、光标丢失，操作依然生效。
 */
export function tableIndex(
  table: HTMLTableElement,
  rowIndex: number,
  colIndex: number,
): TableContext | null {
  const rows = Array.from(table.querySelectorAll('tr')) as HTMLTableRowElement[]
  if (!rows.length) return null
  const row = rows[Math.max(0, Math.min(rowIndex, rows.length - 1))]
  if (!row) return null
  const cells = rowCells(row)
  if (!cells.length) return null
  const cell = cells[Math.max(0, Math.min(colIndex, cells.length - 1))]
  if (!cell) return null
  return {
    table,
    row,
    cell,
    rowIndex: rows.indexOf(row),
    colIndex: cells.indexOf(cell),
    align: cellAlign(cell),
  }
}

/** 光标所在的表格 / 行 / 单元格；不在表格内返回 null */
export function tableContext(editor: HTMLElement): TableContext | null {
  const sel = getSelection()
  if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode)) return null
  const cell = closestTag(editor, sel.anchorNode, ['TD', 'TH']) as HTMLTableCellElement | null
  if (!cell) return null
  const row = cell.parentElement as HTMLTableRowElement | null
  const table = closestTag(editor, cell, ['TABLE']) as HTMLTableElement | null
  if (!row || !table) return null
  const rows = Array.from(table.querySelectorAll('tr'))
  return {
    table,
    row,
    cell,
    rowIndex: rows.indexOf(row),
    colIndex: rowCells(row).indexOf(cell),
    align: cellAlign(cell),
  }
}

/** 生成 rows × cols 的表格（首行为表头 th） */
export function buildTable(rows: number, cols: number): HTMLTableElement {
  const table = document.createElement('table')
  const tbody = document.createElement('tbody')
  for (let r = 0; r < rows; r++) {
    const tr = document.createElement('tr')
    for (let c = 0; c < cols; c++) tr.appendChild(emptyCell(r === 0 ? 'th' : 'td'))
    tbody.appendChild(tr)
  }
  table.appendChild(tbody)
  return table
}

/** 在光标块之后插入表格，光标进入第一个单元格 */
export function insertTable(editor: HTMLElement, rows: number, cols: number): boolean {
  const rowCount = Math.max(1, Math.min(30, Math.floor(rows) || 1))
  const colCount = Math.max(1, Math.min(15, Math.floor(cols) || 1))
  const table = buildTable(rowCount, colCount)
  const block = resolveBlock(editor)
  if (block) block.after(table)
  else editor.appendChild(table)
  // 表格后保证有一个空段落：既是继续写正文的落点，也让表格末尾不再“顶到文档底”
  const next = table.nextElementSibling as HTMLElement | null
  if (!next) table.after(newParagraph())
  focusCell(table.querySelector('th, td') as HTMLElement | null)
  return true
}

/** 在给定行的上 / 下方插入一行（不依赖光标） */
export function insertTableRowAt(ctx: TableContext, where: 'above' | 'below'): boolean {
  const tr = document.createElement('tr')
  const isHeader = rowCells(ctx.row)[0]?.tagName === 'TH'
  const cols = Math.max(1, rowCells(ctx.row).length)
  for (let i = 0; i < cols; i++) tr.appendChild(emptyCell(isHeader ? 'th' : 'td'))
  if (where === 'above') ctx.row.before(tr)
  else ctx.row.after(tr)
  const cells = rowCells(tr)
  focusCell(cells[Math.min(ctx.colIndex, cells.length - 1)])
  return true
}

/** 删除给定行（只剩一行时删除整张表格，不依赖光标） */
export function deleteTableRowAt(ctx: TableContext): boolean {
  const rows = Array.from(ctx.table.querySelectorAll('tr'))
  if (rows.length <= 1) return deleteTableAt(ctx)
  ctx.row.remove()
  const rest = Array.from(ctx.table.querySelectorAll('tr'))
  const target = rest[Math.min(ctx.rowIndex, rest.length - 1)] as HTMLTableRowElement
  const cells = rowCells(target)
  focusCell(cells[Math.min(ctx.colIndex, cells.length - 1)])
  return true
}

/** 在给定列的左 / 右侧插入一列（不依赖光标） */
export function insertTableColumnAt(ctx: TableContext, where: 'left' | 'right'): boolean {
  for (const row of Array.from(ctx.table.querySelectorAll('tr'))) {
    const cells = rowCells(row)
    const ref = cells[Math.min(ctx.colIndex, cells.length - 1)]
    if (!ref) continue
    const cell = emptyCell(ref.tagName === 'TH' ? 'th' : 'td')
    if (where === 'left') ref.before(cell)
    else ref.after(cell)
  }
  const cells = rowCells(ctx.row)
  focusCell(cells[where === 'left' ? ctx.colIndex : ctx.colIndex + 1] ?? cells[0])
  return true
}

/** 删除给定列（只剩一列时删除整张表格，不依赖光标） */
export function deleteTableColumnAt(ctx: TableContext): boolean {
  if (rowCells(ctx.row).length <= 1) return deleteTableAt(ctx)
  for (const row of Array.from(ctx.table.querySelectorAll('tr'))) {
    const cells = rowCells(row)
    cells[Math.min(ctx.colIndex, cells.length - 1)]?.remove()
  }
  const cells = rowCells(ctx.row)
  focusCell(cells[Math.min(ctx.colIndex, cells.length - 1)] ?? cells[0])
  return true
}

/** 删除整张表格，光标落到表格后的块（没有则新建一段，不依赖光标） */
export function deleteTableAt(ctx: TableContext): boolean {
  const table = ctx.table
  const parent = table.parentElement
  const next = table.nextElementSibling as HTMLElement | null
  table.remove()
  if (next && next.isConnected) {
    placeCaretAtStartOf(next)
  } else {
    const p = newParagraph()
    if (parent) parent.appendChild(p)
    placeCaretAtStartOf(p)
  }
  return true
}

/**
 * Tab / Shift+Tab：移动到下一个（上一个）单元格；
 * 在最后一个单元格按 Tab 时新增一行（Word / Excel 手感）。
 */
export function tableMoveCell(editor: HTMLElement, backwards = false): boolean {
  const ctx = tableContext(editor)
  if (!ctx) return false
  const cells = Array.from(ctx.table.querySelectorAll('td, th')) as HTMLElement[]
  const idx = cells.indexOf(ctx.cell)
  if (idx < 0) return false
  const next = idx + (backwards ? -1 : 1)
  if (next >= 0 && next < cells.length) {
    focusCell(cells[next])
    return true
  }
  if (backwards) {
    focusCell(cells[cells.length - 1])
    return true
  }
  const rows = Array.from(ctx.table.querySelectorAll('tr'))
  const lastRow = rows[rows.length - 1] as HTMLTableRowElement
  const cols = Math.max(1, rowCells(lastRow).length)
  const tr = document.createElement('tr')
  for (let i = 0; i < cols; i++) tr.appendChild(emptyCell('td'))
  lastRow.after(tr)
  focusCell(rowCells(tr)[0])
  return true
}

/** Enter：跳到下一行同一列；已在最后一行则新增一行 */
export function tableEnterNext(editor: HTMLElement): boolean {
  const ctx = tableContext(editor)
  if (!ctx) return false
  const rows = Array.from(ctx.table.querySelectorAll('tr'))
  if (ctx.rowIndex >= rows.length - 1) {
    const cols = Math.max(1, rowCells(ctx.row).length)
    const tr = document.createElement('tr')
    for (let i = 0; i < cols; i++) tr.appendChild(emptyCell('td'))
    ctx.row.after(tr)
    focusCell(rowCells(tr)[Math.min(ctx.colIndex, cols - 1)])
    return true
  }
  const nextRow = rows[ctx.rowIndex + 1] as HTMLTableRowElement
  const cells = rowCells(nextRow)
  focusCell(cells[Math.min(ctx.colIndex, cells.length - 1)])
  return true
}

/** 光标所在行的上 / 下方插入一行 */
export function insertTableRow(editor: HTMLElement, where: 'above' | 'below'): boolean {
  const ctx = tableContext(editor)
  return ctx ? insertTableRowAt(ctx, where) : false
}

/** 删除光标所在行（只剩一行时删除整张表格） */
export function deleteTableRow(editor: HTMLElement): boolean {
  const ctx = tableContext(editor)
  return ctx ? deleteTableRowAt(ctx) : false
}

/** 在光标所在列的左 / 右侧插入一列 */
export function insertTableColumn(editor: HTMLElement, where: 'left' | 'right'): boolean {
  const ctx = tableContext(editor)
  return ctx ? insertTableColumnAt(ctx, where) : false
}

/** 删除光标所在列（只剩一列时删除整张表格） */
export function deleteTableColumn(editor: HTMLElement): boolean {
  const ctx = tableContext(editor)
  return ctx ? deleteTableColumnAt(ctx) : false
}

/** 删除整张表格（光标版） */
export function deleteTable(editor: HTMLElement): boolean {
  const ctx = tableContext(editor)
  return ctx ? deleteTableAt(ctx) : false
}

/** 选区覆盖到的单元格（无跨格选区时返回空数组） */
function cellsInSelection(table: HTMLTableElement): HTMLElement[] {
  const sel = getSelection()
  if (!sel || sel.rangeCount === 0) return []
  const range = sel.getRangeAt(0)
  if (range.collapsed) return []
  const all = Array.from(table.querySelectorAll('td, th')) as HTMLElement[]
  try {
    return all.filter((cell) => range.intersectsNode(cell))
  } catch {
    // 个别环境不支持 intersectsNode：退化为“两端之间的单元格”
    const startCell = closestTag(table, range.startContainer, ['TD', 'TH'])
    const endCell = closestTag(table, range.endContainer, ['TD', 'TH'])
    if (!startCell || !endCell) return []
    const i = all.indexOf(startCell)
    const j = all.indexOf(endCell)
    if (i < 0 || j < 0) return []
    return all.slice(Math.min(i, j), Math.max(i, j) + 1)
  }
}

/** 单元格在表格里的位置（行列索引，DOM 重排后依然可用） */
export interface TableCellIndex {
  row: number
  col: number
}

/**
 * 当前表格里“要作用”的单元格索引：
 * 有跨格选区时是选中的每一格，否则就是光标所在的一格。
 * 返回索引（而非元素）是为了在编辑器失焦、DOM 被重排后仍能准确定位。
 */
export function tableSelectedCells(
  editor: HTMLElement,
): { table: HTMLTableElement; cells: TableCellIndex[] } | null {
  const ctx = tableContext(editor)
  if (!ctx) return null
  const selected = cellsInSelection(ctx.table)
  const list: HTMLTableCellElement[] = selected.length
    ? (selected as HTMLTableCellElement[])
    : [ctx.cell]
  const rows = Array.from(ctx.table.querySelectorAll('tr'))
  const cells = list
    .map((cell) => {
      const row = cell.parentElement as HTMLTableRowElement
      return { row: rows.indexOf(row), col: rowCells(row).indexOf(cell) }
    })
    .filter((c) => c.row >= 0 && c.col >= 0)
  return cells.length ? { table: ctx.table, cells } : null
}

/** 按索引设置对齐（不依赖选区，点击按钮导致选区丢失时用它） */
export function setTableCellsAlign(
  table: HTMLTableElement,
  cells: TableCellIndex[],
  align: CellAlign,
): boolean {
  let done = 0
  for (const { row, col } of cells) {
    const ctx = tableIndex(table, row, col)
    if (!ctx) continue
    applyCellAlign(ctx.cell, align)
    done++
  }
  return done > 0
}

/**
 * 设置单元格内容对齐：有跨格选区时作用于选中的每个单元格，
 * 否则只作用于光标所在单元格。左对齐 = 清除样式（存储保持干净）。
 */
export function setTableCellAlignAt(ctx: TableContext, align: CellAlign): boolean {
  const targets = cellsInSelection(ctx.table)
  const list = targets.length ? targets : [ctx.cell as HTMLElement]
  for (const cell of list) applyCellAlign(cell, align)
  placeCaretAtStartOf(ctx.cell)
  return true
}

/** 设置光标所在（或选中范围内）单元格的对齐 */
export function setTableCellAlign(editor: HTMLElement, align: CellAlign): boolean {
  const ctx = tableContext(editor)
  return ctx ? setTableCellAlignAt(ctx, align) : false
}

/** 整张表格的所有单元格对齐（如需要整表统一时使用） */
export function setTableAlignAt(ctx: TableContext, align: CellAlign): boolean {
  for (const cell of Array.from(ctx.table.querySelectorAll('td, th'))) {
    applyCellAlign(cell as HTMLElement, align)
  }
  placeCaretAtStartOf(ctx.cell)
  return true
}

/** Shift+Enter：单元格内换行 */
export function insertCellLineBreak(editor: HTMLElement): boolean {
  const ctx = tableContext(editor)
  if (!ctx) return false
  const caret = getCaretRange(editor)
  if (!caret) return false
  caret.deleteContents()
  const br = document.createElement('br')
  caret.insertNode(br)
  const after = document.createRange()
  after.setStartAfter(br)
  after.collapse(true)
  applyRange(after)
  return true
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
      const lastKid = kids[kids.length - 1] ?? null
      whole.remove()
      // 解包后把光标放到展开内容的末尾，确保选区仍落在编辑器内的节点上
      if (lastKid) placeCaretAtEndOf(lastKid)
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
    if (last) {
      // 光标放进最后一个包裹元素“内部”末尾（anchor 落回该元素内，
      // 使 isMarkActive 立即判定为激活），而不是放到元素之后
      placeCaretAtEndOf(last)
    }
  }
  return true
}

/* ---------------- 中文专用字距 / 英文间距（渲染层包裹） ---------------- */

const CJK_CLASS = 'cjk'
const LATIN_CLASS = 'latin'

/** 文本分片：中文片段，或英文单词（词内允许 . ' - _ ，并吞掉紧跟其后的标点） */
/**
 * 文本分片：中文片段 / 英文单词（词内允许 . ' - _）/ ASCII 标点符号（含各类括号）。
 * 标点单独成片，好处是它与中文相邻的一侧也能算出间隔
 * （例如 add_child(主场景) 里 （ 的右侧、) 的左侧都要留空）。
 */
const TOKEN_RE =
  /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+|[A-Za-z0-9]+(?:[.'’\-_][A-Za-z0-9]+)*|[!-/:-@\[-`{-~]+/g

type TokenKind = 'cjk' | 'latin'

interface TypographyToken {
  start: number
  end: number
  kind: TokenKind
}

/** 把一个文本串切成中文片段 / 英文单词 / ASCII 标点（按出现顺序） */
function typographyTokens(data: string): TypographyToken[] {
  const out: TypographyToken[] = []
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(data))) {
    const kind: TokenKind = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(
      m[0].charAt(0),
    )
      ? 'cjk'
      : 'latin' // 数字 / 字母 / ASCII 标点都属于西文体系
    out.push({ start: m.index, end: m.index + m[0].length, kind })
  }
  return out
}

/** 所属块级宿主：判断相邻字符时不跨块 */
function blockHostOf(node: Node): HTMLElement | null {
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement
  return el?.closest('p,h1,h2,h3,h4,h5,li,pre') ?? null
}

/** 前一个可见字符（可跨行内标记；行首返回 null） */
function charBefore(node: Node): string | null {
  const host = blockHostOf(node)
  let cur: Node | null = node
  while (cur) {
    let prev = cur.previousSibling
    while (prev) {
      const text = prev.textContent ?? ''
      if (text) return text.slice(-1)
      prev = prev.previousSibling
    }
    if (!host || cur === host || !cur.parentElement) return null
    cur = cur.parentElement
  }
  return null
}

/** 后一个可见字符（可跨行内标记；行尾返回 null） */
function charAfter(node: Node): string | null {
  const host = blockHostOf(node)
  let cur: Node | null = node
  while (cur) {
    let next = cur.nextSibling
    while (next) {
      const text = next.textContent ?? ''
      if (text) return text.slice(0, 1)
      next = next.nextSibling
    }
    if (!host || cur === host || !cur.parentElement) return null
    cur = cur.parentElement
  }
  return null
}

/**
 * 与西文“视为一体”的相邻字符：拉丁字母、数字、ASCII 标点/符号（不含空格）。
 * 与这些相邻时不再额外加间隔；与空格、中文、中文/全角标点相邻都会留出间隔
 * （所以 add_child(主场景实例)。 里括号两侧都有空隙）。
 */
const SOLID_NEIGHBOR = /[A-Za-z0-9!-/:-@\[-`{-~]/

/**
 * 该侧是否需要留出英文间隔：单词两侧都留，
 * 只有与英文字母/数字/ASCII 标点符号、或中文标点相连时才视为一体、不另加间隔。
 */
function needsEnGap(ch: string | null): boolean {
  return ch !== null && !SOLID_NEIGHBOR.test(ch)
}

/** 清掉零长度的文本节点（包裹时 splitText 的副产物）。
 *  它们不可见，却会让光标“落”在空节点上，导致行首 / 行中判定出错 */
function removeEmptyTextNodes(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const empties: Text[] = []
  let n: Node | null = walker.nextNode()
  while (n) {
    const t = n as Text
    if (t.data.length === 0) empties.push(t)
    n = walker.nextNode()
  }
  for (const t of empties) t.remove()
}

/** 去掉编辑器内的排版包裹标记（保持文本不变，仅还原结构） */
export function unwrapTypographySpans(root: HTMLElement): void {
  const sel = `span.${CJK_CLASS}, span.${LATIN_CLASS}`
  for (const el of Array.from(root.querySelectorAll(sel))) {
    const parent = el.parentNode
    if (!parent) continue
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    el.remove()
  }
}

/** 给一个文本节点里的中文片段 / 英文单词包上标记（不改变文本内容与长度） */
function wrapTokensInTextNode(text: Text): void {
  let current: Text | null = text
  while (current) {
    const token = typographyTokens(current.data)[0]
    if (!token) break
    const data = current.data
    const rawBefore =
      token.start > 0 ? data.charAt(token.start - 1) : charBefore(current)
    const after =
      token.end < data.length ? data.charAt(token.end) : charAfter(current)
    // 行首（含软换行后的行首）：charBefore 会看到“上一行的末尾字符”，
    // 若据此加间隔，就会让这些行整行缩进一小段。列表项内部统一留出间隔，
    // 这样首行与后续行的内容都与列表标记保持同样距离；其它块的行首不留。
    const atLineStart = rawBefore === null
    const inListItem = !!current.parentElement?.closest('li')
    const needLeft = atLineStart ? inListItem : needsEnGap(rawBefore)
    const tail = current.splitText(token.end)
    const node = current.splitText(token.start)
    const span = document.createElement('span')
    span.className = token.kind === 'cjk' ? CJK_CLASS : LATIN_CLASS
    if (token.kind === 'latin') {
      if (needLeft) span.classList.add('latin--gap-l')
      if (needsEnGap(after)) span.classList.add('latin--gap-r')
    }
    span.appendChild(node)
    tail.parentNode?.insertBefore(span, tail)
    current = tail
  }
}

/**
 * 重排排版包裹：先解包再按需包裹。
 * 只处理普通文本节点，跳过代码块与行内代码；包裹不改变文本内容与长度，
 * 因此调用方可用文本索引精确恢复光标。
 */
export function wrapTypographySpans(
  editor: HTMLElement,
  bgByTag?: Record<string, string>,
): void {
  unwrapTypographySpans(editor)
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  let n: Node | null = walker.nextNode()
  while (n) {
    texts.push(n as Text)
    n = walker.nextNode()
  }
  for (const t of texts) {
    if (!t.data) continue
    const host = t.parentElement
    // 跳过代码块与行内代码：格式不同，不参与正文的排版包裹
    if (!host || host.closest('pre, code')) continue
    wrapTokensInTextNode(t)
  }
  removeEmptyTextNodes(editor)
  if (bgByTag) syncHighlightSpans(editor, bgByTag) // 底色：只包住文字范围
}

/* ---------------- 底色（行内高亮，只覆盖文字范围） ---------------- */

const HL_CLASS = 'hl'

/** 解包行内底色标记（文本不变，仅还原结构） */
export function unwrapHighlightSpans(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll(`span.${HL_CLASS}`))) {
    unwrapElement(el)
  }
}

/** 该块是否已被行内底色包裹 */
function isHighlightWrapped(block: HTMLElement): boolean {
  const first = block.firstElementChild as HTMLElement | null
  return (
    !!first &&
    first.tagName === 'SPAN' &&
    first.classList.contains(HL_CLASS) &&
    block.childNodes.length === 1
  )
}

/**
 * 按各块底色配置维护行内底色标记（幂等，可反复调用）：
 * - 有底色且未包裹 → 用 <span class="hl"> 包住块内容，底色只覆盖文字范围
 * - 无底色 / 空块 → 解包
 */
export function syncHighlightSpans(
  editor: HTMLElement,
  bgByTag: Record<string, string>,
): void {
  const blocks: HTMLElement[] = []
  for (const child of Array.from(editor.children) as HTMLElement[]) {
    if (child.tagName === 'UL' || child.tagName === 'OL') {
      blocks.push(...(Array.from(child.children) as HTMLElement[])) // li
    } else {
      blocks.push(child)
    }
  }
  for (const block of blocks) {
    const bg = bgByTag[block.tagName] ?? 'transparent'
    const wrapped = isHighlightWrapped(block)
    if (!bg || bg === 'transparent') {
      if (wrapped) unwrapElement(block.firstElementChild as Element)
      continue
    }
    if (wrapped) continue
    if (block.tagName === 'PRE' || block.tagName === 'HR') continue
    if (!(block.textContent ?? '')) continue // 空块不铺底色
    const span = document.createElement('span')
    span.className = HL_CLASS
    span.append(...Array.from(block.childNodes))
    block.appendChild(span)
  }
}

/* ---------------- 回车拆块 ---------------- */

/**
 * 处理 Enter：普通回车在下方新建一行并把光标移过去（代码块除外——
 * 代码块内回车只换行；返回 false 表示交给浏览器默认行为）
 */
export function handleEnterKey(editor: HTMLElement): boolean {
  const block = resolveBlock(editor)
  const caret = getCaretRange(editor)
  if (!block || !caret) return false

  // —— 代码块 ——
  if (block.tagName === 'PRE') {
    // 代码块内回车只在代码块内换行（交给浏览器默认插入换行）。
    // 想退出到代码块下方新行：在末尾按 ↓（见 codeExitOnArrowDown）
    return false
  }

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
    if (HEADING_TAGS.includes(block.tagName)) {
      const p = replaceBlockWith(block, 'p') // 空标题：清除样式
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

  // —— 行首回车：在光标处让出一个空行（当前块整体下移一行），
  //    光标跟着这行文字一起下移，仍停在这一行文字的开头 ——
  if (!hasBefore) {
    if (block.tagName === 'LI') {
      const list = block.parentElement as HTMLElement | null
      const li = document.createElement('li')
      ensureBrForEmpty(li)
      if (list) list.insertBefore(li, block)
      else block.before(li)
      placeCaretAtStartOf(block) // 光标跟随原列表项
      return true
    }
    const lead = newParagraph()
    block.before(lead)
    placeCaretAtStartOf(block) // 光标跟随原段落
    return true
  }

  // —— 行尾回车：在下方追加新行（段落/标题；列表续项） ——
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

  // 标题 / 段落：标题拆出的后续默认转为正文
  const next = newParagraph(rest)
  block.after(next)
  placeCaretAtStartOf(next)
  return true
}

/* ---------------- 粘贴为纯文本 ---------------- */

/** 光标折叠到 node 之后；node 为文本节点时收进文本内部末尾，
 *  避免落到 code/pre 元素边界导致“末尾”判定失效 */
function selectCollapsedAfter(node: Node): void {
  const range = document.createRange()
  if (node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, (node.textContent ?? '').length)
  } else {
    range.setStartAfter(node)
  }
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
    // 兜底：刚创建的代码块可能让浏览器把光标丢到块外/上一段，
    // 此时先把光标放回 <code> 开头再粘贴，避免内容落到代码块外
    let range: Range | null = caret
    if (!range || !block.contains(range.startContainer)) {
      // 兜底：刚创建的代码块可能让浏览器把光标丢到块外/上一段，
      // 此时先把光标放回 <code> 开头再粘贴，避免内容落到代码块外
      const code =
        (block.firstElementChild as HTMLElement | null) ?? block
      placeCaretAtStartOf(code)
      range = getCaretRange(editor)
      if (range === null) return
    }
    range.deleteContents()
    const preLines = clean.split('\n')
    const frag = document.createDocumentFragment()
    preLines.forEach((line, i) => {
      if (i > 0) frag.appendChild(document.createElement('br'))
      if (line) frag.appendChild(document.createTextNode(line))
    })
    if (preLines[preLines.length - 1] === '') {
      frag.appendChild(document.createTextNode(CODE_ANCHOR)) // 光标停在新行时用锚点承接输入
    }
    const lastNode = frag.lastChild
    range.insertNode(frag)
    if (lastNode) selectCollapsedAfter(lastNode)
    return
  }

  // 表格单元格内：整段文本按 <br> 换行塞进当前单元格
  if (tableContext(editor)) {
    const cellLines = clean
      .split('\n')
      .map((line) => line.replace(/[ \t\u00a0]+$/, ''))
    const cellFrag = document.createDocumentFragment()
    cellLines.forEach((line, i) => {
      if (i > 0) cellFrag.appendChild(document.createElement('br'))
      if (line) cellFrag.appendChild(document.createTextNode(line))
    })
    if (!cellFrag.childNodes.length) return
    caret.deleteContents()
    const lastCellNode = cellFrag.lastChild
    caret.insertNode(cellFrag)
    if (lastCellNode) selectCollapsedAfter(lastCellNode)
    return
  }

  const lines = clean
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+$/, '')) // 外部粘贴：去掉行尾多余空白
  // 单行：直接插入当前位置
  if (lines.length <= 1) {
    const only = lines[0] ?? ''
    caret.deleteContents()
    const node = document.createTextNode(only)
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
  // 光标放到粘贴内容末尾（最后一行最后一个字符之后）
  if (lastLine) placeCaretAtEndOf(lastLine)
}
