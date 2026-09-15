<script setup lang="ts">
/** 工具栏图标名（与 ToolbarAction 语义一一对应） */
export type IconName =
  | "outline"
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "codeblock"
  | "bulletList"
  | "orderedList"
  | "table"
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "inlineCode"
  | "undo"
  | "redo";

defineProps<{ name: IconName }>();
</script>

<template>
  <svg
    class="ic"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- 目录树：层级缩进的三条线 -->
    <template v-if="name === 'outline'">
      <line x1="4.5" y1="7" x2="19.5" y2="7" />
      <line x1="8" y1="12" x2="19.5" y2="12" />
      <line x1="11.5" y1="17" x2="19.5" y2="17" />
    </template>

    <!-- 正文段落：三行文本 -->
    <template v-else-if="name === 'paragraph'">
      <line x1="5.5" y1="8.6" x2="18.5" y2="8.6" />
      <line x1="5.5" y1="12.3" x2="18.5" y2="12.3" />
      <line x1="5.5" y1="16" x2="13.5" y2="16" />
    </template>

    <!-- 标题：字母徽标（vertical: dominant-baseline=central + y=12 居中） -->
    <text
      v-else-if="
        name === 'h1' ||
        name === 'h2' ||
        name === 'h3' ||
        name === 'h4' ||
        name === 'h5'
      "
      x="12"
      y="12"
      text-anchor="middle"
      dominant-baseline="central"
      font-weight="500"
      stroke="none"
      fill="currentColor"
    >
      {{ name.toUpperCase() }}
    </text>

    <!-- 代码块：</> 徽标（三字符，用小一号字号避免溢出） -->
    <text
      v-else-if="name === 'codeblock'"
      class="code"
      x="12"
      y="12"
      text-anchor="middle"
      dominant-baseline="central"
      font-weight="600"
      stroke="none"
      fill="currentColor"
    >
      &#60;/&#62;
    </text>

    <!-- 表格：外框 + 一条横线一条竖线 -->
    <template v-else-if="name === 'table'">
      <rect x="4" y="5.5" width="16" height="13" rx="2" />
      <line x1="4" y1="10.5" x2="20" y2="10.5" />
      <line x1="10.8" y1="5.5" x2="10.8" y2="18.5" />
    </template>

    <!-- 无序列表：竖排圆点 -->
    <template v-else-if="name === 'bulletList'">
      <circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none" />
    </template>

    <!-- 有序列表：竖排序号（两行小字号，按行各自居中） -->
    <template v-else-if="name === 'orderedList'">
      <text
        class="num"
        x="12"
        y="8.6"
        text-anchor="middle"
        dominant-baseline="central"
        font-weight="600"
        stroke="none"
        fill="currentColor"
      >
        1
      </text>
      <text
        class="num"
        x="12"
        y="15.4"
        text-anchor="middle"
        dominant-baseline="central"
        font-weight="600"
        stroke="none"
        fill="currentColor"
      >
        2
      </text>
    </template>

    <!-- 粗体 / 斜体 / 删除线：字母徽标 -->
    <text
      v-else-if="name === 'bold'"
      x="12"
      y="12"
      text-anchor="middle"
      dominant-baseline="central"
      font-weight="700"
      stroke="none"
      fill="currentColor"
    >
      B
    </text>
    <text
      v-else-if="name === 'italic'"
      x="12"
      y="12"
      text-anchor="middle"
      dominant-baseline="central"
      font-weight="600"
      font-style="italic"
      stroke="none"
      fill="currentColor"
    >
      I
    </text>

    <!-- 下划线：字母 U + 底部横线（横线与字母留出空隙） -->
    <template v-else-if="name === 'underline'">
      <text
        x="12"
        y="11.5"
        text-anchor="middle"
        dominant-baseline="central"
        font-weight="600"
        stroke="none"
        fill="currentColor"
      >
        U
      </text>
      <line x1="8.6" y1="20.3" x2="16.4" y2="20.3" stroke-width="1.4" />
    </template>

    <template v-else-if="name === 'strike'">
      <text
        x="12"
        y="12"
        text-anchor="middle"
        dominant-baseline="central"
        font-weight="600"
        stroke="none"
        fill="currentColor"
      >
        S
      </text>
      <!-- 横线压在 S 字形中部 -->
      <line x1="5.4" y1="12.4" x2="18.6" y2="12.4" stroke-width="1.4" />
    </template>

    <!-- 行内代码：花括号徽标 -->
    <text
      v-else-if="name === 'inlineCode'"
      x="12"
      y="12"
      text-anchor="middle"
      dominant-baseline="central"
      font-weight="500"
      stroke="none"
      fill="currentColor"
    >
      {}
    </text>

    <!-- 撤销 / 重做：弯箭头 -->
    <path
      v-else-if="name === 'undo'"
      d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"
      fill="currentColor"
      stroke="none"
    />
    <g v-else-if="name === 'redo'" transform="translate(24 0) scale(-1 1)">
      <path
        d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"
        fill="currentColor"
        stroke="none"
      />
    </g>
  </svg>
</template>

<style scoped>
.ic {
  width: 19px;
  height: 19px;
  display: block;
  flex: none;
}
/* 文字徽标统一字号与字体；字号在 SVG 用户单位下随 viewBox 缩放 */
.ic text {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  font-size: 16px;
}
/* 特殊徽标用小一号字号：代码块（三字符）、有序列表数字（两行） */
.ic text.code {
  font-size: 11px;
}
.ic text.num {
  font-size: 9px;
}
</style>
