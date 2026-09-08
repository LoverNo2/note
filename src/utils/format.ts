/** 日期时间与文本格式化工具 */

const MS_MINUTE = 60_000
const MS_HOUR = 60 * MS_MINUTE
const MS_DAY = 24 * MS_HOUR

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / yyyy/M/d */
export function formatRelativeTime(iso: string): string {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return ''

  const diff = Date.now() - time
  if (diff < MS_MINUTE) return '刚刚'
  if (diff < MS_HOUR) return `${Math.floor(diff / MS_MINUTE)} 分钟前`

  const dayStartOf = (t: number): number => {
    const d = new Date(t)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const dayDiff = Math.round((dayStartOf(Date.now()) - dayStartOf(time)) / MS_DAY)

  if (dayDiff <= 0) return `${Math.floor(diff / MS_HOUR)} 小时前`
  if (dayDiff === 1) return '昨天'
  if (dayDiff < 7) return `${dayDiff} 天前`

  const d = new Date(time)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** 时钟显示，如 09:41:05 */
export function formatClock(date: number | Date): string {
  const d = date instanceof Date ? date : new Date(date)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/** 用于备份文件名的日期，如 2025-09-08 */
export function dateStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 从正文中提取摘要：第一个非空行，超长截断 */
export function noteSummary(content: string, max = 80): string {
  const firstLine =
    content
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ''
  return firstLine.length > max ? `${firstLine.slice(0, max)}…` : firstLine
}

/** 空标题显示为「无标题」 */
export function displayTitle(title: string): string {
  const t = title.trim()
  return t.length > 0 ? t : '无标题'
}
