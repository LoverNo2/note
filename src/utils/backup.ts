import type { BackupFile, Note } from '../types'
import { BACKUP_MAGIC, BACKUP_VERSION } from '../types'
import { dateStamp } from './format'

/** 构造标准备份载荷（导出下载与「保存到文件」共用，保证格式一致） */
export function buildBackup(notes: Note[]): BackupFile {
  return {
    app: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    notes: [...notes],
  }
}

/** 备份文件建议名，如 notebook-备份-2025-09-08.json */
export function defaultBackupName(): string {
  return `notebook-备份-${dateStamp()}.json`
}
