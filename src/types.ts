/** 一条笔记的数据结构 */
export interface Note {
  /** 唯一标识，时间戳 + 随机串生成 */
  id: string
  /** 笔记标题 */
  title: string
  /** 正文内容（规范化 HTML；旧版本纯文本会在装载时自动迁移为段落） */
  content: string
  /** 创建时间（ISO 字符串） */
  createdAt: string
  /** 最近修改时间（ISO 字符串） */
  updatedAt: string
}
