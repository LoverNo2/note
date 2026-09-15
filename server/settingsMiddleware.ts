/**
 * 本地「界面配置」服务（Vite 中间件）。
 *
 * 把样式配置（正文/标题样式、已保存的样式方案、代码块外观、字体选择等）
 * 以 JSON 文件形式存放在**项目内**，从而跟随 git 一起同步：
 *   GET /api/settings  → 读取配置文件（不存在时返回 {}）
 *   PUT /api/settings  → 覆盖写入配置文件（原子写入）
 *
 * 前端在启动时先读取它，再用它初始化浏览器 localStorage；
 * 之后任何配置改动都会防抖回写，因此换仓库/换机器拉代码即可带上配置。
 *
 * 文件路径可用环境变量 NOTEBOOK_SETTINGS_FILE 覆盖，默认 <项目根>/ui-settings.json。
 */
import type { Connect, Plugin } from 'vite'
import type { ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

export const SETTINGS_FILE = process.env.NOTEBOOK_SETTINGS_FILE
  ? path.resolve(process.env.NOTEBOOK_SETTINGS_FILE)
  : path.resolve(process.cwd(), 'ui-settings.json')

/** 只接受 notebook: 前缀的字符串配置项，避免被写入无关内容 */
const KEY_PREFIX = 'notebook:'
const MAX_BODY = 2 * 1024 * 1024 // 2MB

function send(res: ServerResponse, code: number, data: unknown): void {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('配置数据过大'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function writeFileAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, file)
}

function readSettings(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {} // 文件不存在或损坏：视作没有配置
  }
}

function writeSettings(body: unknown): { count: number } {
  if (typeof body !== 'object' || body === null) {
    throw new Error('请求体必须是对象')
  }
  const values = (body as Record<string, unknown>).values
  if (typeof values !== 'object' || values === null) {
    throw new Error('缺少 values 字段')
  }
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    if (!key.startsWith(KEY_PREFIX)) continue
    if (typeof value !== 'string') continue
    clean[key] = value
  }
  const payload = {
    version: (body as Record<string, unknown>).version ?? 1,
    updatedAt: new Date().toISOString(),
    values: clean,
  }
  writeFileAtomic(SETTINGS_FILE, `${JSON.stringify(payload, null, 2)}\n`)
  return { count: Object.keys(clean).length }
}

async function handle(
  req: Connect.IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== '/api/settings') return false

  try {
    if (req.method === 'GET') {
      send(res, 200, readSettings())
      return true
    }
    if (req.method === 'PUT') {
      const body: unknown = JSON.parse(await readBody(req))
      send(res, 200, writeSettings(body))
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

export function settingsPlugin(): Plugin {
  return {
    name: 'notebook-settings',
    configureServer(server) {
      server.middlewares.use(middleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware())
    },
  }
}
