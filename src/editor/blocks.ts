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
  const frag = range.cloneContents()
  let offset = 0
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT)
  let n: Node | null = walker.nextNode()
  while (n) {
    offset += (n.textContent ?? '').replace(/\u200b/g, '').length
    n = walker.nextNode()
  }
  return { block: blockIndex, offset }
}

export function restoreCaretAnchor(editor: HTMLElement, anchor: CaretAnchor): void {
  const block = editor.children[anchor.block] as HTMLElement | undefined
  if (!block) return
  placeCaretInTextAt(block, anchor.offset)
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

/** 就地整理一个块：清外来样式 + 去尾部多余 br（+ 非光标块的行尾空白）；
 *  返回是否改动 DOM */
export function tidyBlock(
  block: HTMLElement,
  protectCaret = false,
): boolean {
  // 代码块不参与正文式清理：块内的 <br> 就是换行（末尾的 <br> 是一个空行），
  // 行尾空格也可能是刻意保留的，清理会破坏换行结构与光标位置
  if (block.tagName === 'PRE') return false
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
 * 光标在代码块最后一行行尾并按 ↓ 方向键：若代码块是正文最后一个内容块，
 * 在其下方新建一个正文段落并把光标移过去（相当于“跳出代码块另起新行”）。
 * 返回是否已处理；代码块后还有其它内容时返回 false 交给浏览器默认移动光标。
 */
export function codeExitOnArrowDown(editor: HTMLElement): boolean {
  const block = resolveBlock(editor)
  if (!block || block.tagName !== 'PRE') return false
  const caret = getCaretRange(editor)
  if (!caret) return false

  // 末尾判定：光标之前的文本量已达块内文本总量。
  // （浏览器会在块尾留下空文本节点，单纯比较“最后一个文本节点”会误判）
  const total = (block.textContent ?? '').length
  const atEnd = textOffsetAtCaret(block, caret) >= total
  if (!atEnd) return false

  let next = block.nextElementSibling as HTMLElement | null
  while (next && next.tagName === 'HR') {
    next = next.nextElementSibling as HTMLElement | null
  }
  if (next) return false

  const p = newParagraph()
  block.after(p)
  placeCaretAtStartOf(p)
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
