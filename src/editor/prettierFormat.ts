/**
 * 用 Prettier（浏览器版 standalone）格式化 JavaScript 代码块。
 *
 * - 只在「手动保存」时调用，且**只处理 JavaScript**：
 *   解析失败（C++ / GDScript / Python 等）返回 null，由调用方退回简单规则。
 * - 体积较大，所以懒加载：首次保存时才动态 import，不进入首屏包。
 * - 选项按当前笔记的既有风格：4 空格缩进、不写行尾分号。
 * - 容错：整段因「缺分号」类语法错误解析不了时，按解析器给出的 (行:列)
 *   精准补一个分号再重试（只补分号、只在最终能解析通过时才采用 Prettier 结果）。
 */

export const PRETTIER_OPTIONS = {
  parser: "babel",
  tabWidth: 4,
  useTabs: false,
  semi: false,
  singleQuote: false,
  trailingComma: "none",
  printWidth: 120,
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "lf",
} as const

/** 最多补多少次分号（防御死循环） */
const MAX_REPAIRS = 40

type FormatFn = (source: string, options: Record<string, unknown>) => Promise<string>
type Attempt = { ok: true; out: string } | { ok: false; message: string }

let loader: Promise<FormatFn> | null = null

/** 懒加载 Prettier 运行时（standalone + babel/estree 解析器） */
function loadPrettier(): Promise<FormatFn> {
  if (!loader) {
    loader = (async () => {
      const [standalone, babel, estree] = await Promise.all([
        import("prettier/standalone"),
        import("prettier/plugins/babel"),
        import("prettier/plugins/estree"),
      ])
      const pick = (mod: unknown): unknown => (mod as { default?: unknown }).default ?? mod
      const plugins = [pick(babel), pick(estree)]
      const mod = standalone as unknown as { format?: FormatFn; default?: { format: FormatFn } }
      const format = mod.format ?? (mod.default as { format: FormatFn }).format
      return ((source: string, options: Record<string, unknown>) =>
        format(source, { ...options, plugins })) as FormatFn
    })()
  }
  return loader
}

/** 试一次格式化，失败时把解析器原始错误消息带出来（供补分号定位用） */
async function tryFormat(code: string): Promise<Attempt> {
  try {
    const format = await loadPrettier()
    const out = await format(code, { ...PRETTIER_OPTIONS })
    return { ok: true, out: out.replace(/\n+$/, "") }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message }
  }
}

/** 从解析器错误消息里取出 (行, 列)——1 基行号、0 基列号 */
export function errorPosition(message: string): { line: number; col: number } | null {
  const hit = message.match(/\((\d+):(\d+)\)/)
  if (!hit) return null
  return { line: Number(hit[1]), col: Number(hit[2]) }
}

/** 在指定行、指定列**之前**插入一个分号（纯字符串操作，便于单测） */
export function insertSemicolonAt(code: string, line: number, col: number): string {
  const lines = code.split("\n")
  const index = line - 1
  if (index < 0 || index >= lines.length) return code
  const text = lines[index]
  const at = Math.max(0, Math.min(col, text.length))
  const before = text.slice(0, at)
  if (/;[ \t]*$/.test(before)) return code // 已有分号，不重复插
  lines[index] = `${before};${text.slice(at)}`
  return lines.join("\n")
}

/** 格式化 JavaScript；解析不了（非 JS 或改不动）时返回 null */
export async function formatJavaScript(code: string): Promise<string | null> {
  if (!code.trim()) return null
  const attempt = await tryFormat(code)
  return attempt.ok ? attempt.out : null
}

/**
 * 带「补分号」容错的格式化：整段能解析时直接返回；
 * 否则按报错位置补分号重试，**最终仍解析不了就返回 null**（保持原样）。
 * 返回的是 Prettier 的产物，因此补进去的临时分号不会进入笔记
 * （Prettier 会按 semi: false 重新输出）。
 */
export async function formatJavaScriptWithRepair(code: string): Promise<string | null> {
  if (!code.trim()) return null
  let current = code
  for (let i = 0; i < MAX_REPAIRS; i++) {
    const attempt = await tryFormat(current)
    if (attempt.ok) return attempt.out
    const position = errorPosition(attempt.message)
    if (!position) return null
    const next = insertSemicolonAt(current, position.line, position.col)
    if (next === current) return null
    current = next
  }
  return null
}
