# 笔记本 · Notebook

一个**冷调极简**（Notion / Linear 风格）的本地笔记本。Vue 3 + TypeScript + Vite 构建，
不依赖任何大型 UI 库；笔记以每篇一个 JSON 文件存放在项目 `notes/` 目录，通过本地
Vite 中间件读写（`npm run dev` / `npm run preview` 自带）。

## ✨ 功能

- 📝 **笔记增删改**：顶部笔记下拉切换，编辑区全宽显示，操作即生效
- 🎛 **预设样式工具条**：顶部一键切换 正文 / 一级/二级/三级标题、引用、代码块、分割线，
  无序 / 有序列表（`Tab` 缩进、`Shift+Tab` 退级），行内强调：粗体 / 斜体 / 删除线 / 行内代码
- ↩️ **所见即所得块式编辑**：自研 contenteditable 引擎，回车自动续列表、标题回车转正文、空项回车退出列表/引用
- 🗄 **笔记存放在项目里**：`notes/` 目录每篇一个 JSON 文件，启动时自动载入；
  按 `⌘S` / `Ctrl+S` 把当前全部笔记写回该目录（新增/更新写文件，已删除的笔记同步移除文件）
- 🎨 **冷调极简视觉**：白底编辑、克制蓝强调色、细边框、轻盈滚动条
- ⌨️ **快捷键**：`⌘N` / `Ctrl+N` 新建；`⌘S` / `Ctrl+S` 保存到项目；`⌘Z` / `Ctrl+Z` 撤销；`⇧⌘Z` / `Ctrl+Y` 重做
- 🧱 技术栈：`Vue 3`（Composition API）· `TypeScript` · `Vite`，自研轻量组件，无多余依赖

## 🚀 快速开始

> 需要 Node.js **18+**（含 npm）。

```bash
npm install      # 安装依赖
npm run dev      # 启动开发服务器（默认 http://localhost:5173，自动打开浏览器）
```

生产构建与预览：

```bash
npm run build    # 类型检查 + 打包到 dist/
npm run preview  # 预览构建产物
npm test         # 编辑器引擎与 HTML 兼容层的冒烟测试（jsdom）
```

## 🗂 数据与持久化说明

- 笔记以**每篇一个 JSON 文件**存放在项目 `notes/` 目录（文件名即笔记 id，内容为单条
  笔记的规范化 JSON）。启动时应用会自动读取该目录全部笔记；编辑内容在保存前仅存在内存。
- 按 `⌘S` / `Ctrl+S` 把当前**全部**笔记同步回 `notes/`：新增/更新的笔记写为文件，
  已从列表删除的笔记其对应文件也会被移除。建议编辑重要内容后及时保存。
- 该读写由内置的 Vite 中间件提供（`GET /api/notes`、`PUT /api/notes`），
  `npm run dev` 与 `npm run preview` 均已挂载；若改用其它方式部署，需要提供相同接口。
- 正文以**规范化 HTML** 存储（标题/引用/代码块等块结构与行内强调），旧版本的纯文本笔记
  在首次打开时会自动迁移为段落，无需手动处理。

## 🧩 目录结构

```
├── index.html                  # 入口 HTML
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── main.ts                 # 应用入口
    ├── App.vue                 # 布局 + 欢迎空态 + 快捷键 + Toast
    ├── style.css               # 设计令牌（CSS 变量）与共享控件
    ├── types.ts                # Note 类型
    ├── editor/
    │   ├── html.ts             # HTML 规范化 / 迁移 / 文本提取
    │   └── blocks.ts           # 自研块编辑器引擎（DOM 受控操作）
    ├── utils/
    │   ├── format.ts            # 时间与摘要格式化
    │   └── backup.ts            # 备份载荷构造与建议文件名
    ├── composables/
    │   ├── useNotes.ts          # 单例状态层：CRUD（内存）、写回项目
    │   ├── useFileSave.ts       # 保存到本地文件：句柄 + IndexedDB + 原地覆盖 + 降级
    │   └── useToast.ts          # 全局轻提示
    └── components/
        ├── AppBar.vue          # 顶部栏：笔记切换 / 新建 / 删除
        ├── NoteToolbar.vue     # 顶部格式工具条（预设样式按钮）
        ├── NoteEditor.vue      # 编辑区：标题 + 块编辑器
        └── Icon.vue            # 轻量内联 SVG 图标
```

## 🧩 自研编辑器边界（首版）

自研块编辑器在不引入任何依赖的前提下，对以下场景做了简化处理：

- 撤销按输入停顿（约 500ms）合并一步，结构操作（切样式/列表等）各记一步
- 光标在块首的 `Backspace` 跨块合并依赖浏览器默认行为
- 粘贴统一转纯文本并按行拆段，富文本格式不会保留
- 标题内回车 → 后续内容转为正文段落；引用内回车 → 后续内容退出引用
- 行内强调（粗/斜/删/行内代码）需先选中文字再点击按钮

## 🔭 后续可扩展方向

- Markdown 写作与实时预览
- 标签 / 文件夹分类与全文搜索
- 深色模式切换
- 多端同步（接入后端 API 或 WebDAV 等）
