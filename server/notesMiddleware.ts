/**
 * 本地笔记数据服务（Vite 中间件）。
 *
 * 把全部笔记以「每篇一个 JSON 文件」的形式存放在项目 notes/ 目录：
 *   GET /api/notes  → 读取目录内所有笔记并返回
 *   PUT /api/notes  → 以请求体（笔记数组）全量同步目录：
 *                     - 新增/更新的笔记写为 notes/<id>.json（原子写入）
 *                     - 请求中已删除的笔记，其对应文件一并移除
 *
 * dev（npm run dev）与 preview（npm run preview）都会挂载本中间件。
 * 静态部署时需由其它后端提供相同接口。
 */
import type { Connect, Plugin } from 'vite'
import type { ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

export const NOTES_DIR = path.resolve(process.cwd(), 'notes')

/** 仅允许安全的文件名：字母数字下划线连字符 + .json */
const FILE_RE = /^[A-Za-z0-9_-]+\.json$/

function isNoteLike(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const n = v as Record<string, unknown>
  return (
    typeof n.id === 'string' &&
    typeof n.title === 'string' &&
    typeof n.content === 'string' &&
    typeof n.createdAt === 'string' &&
    typeof n.updatedAt === 'string'
  )
}

function ensureDir(): void {
  fs.mkdirSync(NOTES_DIR, { recursive: true })
}

function readNotes(): unknown[] {
  ensureDir()
  const notes: unknown[] = []
  for (const file of fs.readdirSync(NOTES_DIR)) {
    if (!FILE_RE.test(file)) continue
    try {
      const raw = fs.readFileSync(path.join(NOTES_DIR, file), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (isNoteLike(parsed)) notes.push(parsed)
    } catch {
      // 单个文件损坏/解析失败时跳过，不阻断其它笔记
    }
  }
  return notes
}

function writeFileAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, file)
}

function syncNotes(body: unknown): { count: number } {
  if (!Array.isArray(body)) throw new Error('请求体必须是一个笔记数组')
  ensureDir()

  const keptIds = new Set<string>()
  for (const note of body) {
    if (!isNoteLike(note)) {
      throw new Error('存在无效的笔记数据（缺少 id/title/content 等字段）')
    }
    if (!FILE_RE.test(`${note.id}.json`)) {
      throw new Error(`笔记 id 含非法字符：${note.id}`)
    }
    keptIds.add(note.id)
    writeFileAtomic(path.join(NOTES_DIR, `${note.id}.json`), JSON.stringify(note, null, 2))
  }

  // 删除本次同步中已不存在的笔记文件
  for (const file of fs.readdirSync(NOTES_DIR)) {
    if (!FILE_RE.test(file)) continue
    const id = file.replace(/\.json$/, '')
    if (!keptIds.has(id)) {
      try {
        fs.unlinkSync(path.join(NOTES_DIR, file))
      } catch {
        /* 忽略删除失败 */
      }
    }
  }
  return { count: body.length }
}

function send(res: ServerResponse, code: number, data: unknown): void {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handle(
  req: Connect.IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== '/api/notes') return false

  try {
    if (req.method === 'GET') {
      send(res, 200, readNotes())
      return true
    }
    if (req.method === 'PUT') {
      const bodyText = await readBody(req)
      const body: unknown = JSON.parse(bodyText)
      send(res, 200, syncNotes(body))
      return true
    }
    send(res, 405, { error: '不支持的请求方法' })
    return true
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : '服务内部错误' })
    return true
  }
}

function middleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    handle(req as Connect.IncomingMessage, res as ServerResponse)
      .then((handled) => {
        if (!handled) next()
      })
      .catch(() => {
        if (!res.headersSent) {
          send(res as ServerResponse, 500, { error: '服务内部错误' })
        }
      })
  }
}

export function notesPlugin(): Plugin {
  return {
    name: 'notebook-notes',
    configureServer(server) {
      server.middlewares.use(middleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware())
    },
  }
}
