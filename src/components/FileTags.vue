<template>
  <span v-if="list.length" class="file-tags">
    <span v-for="b in list" :key="b.kind" class="file-tag"
          :class="['ft-' + b.kind, { 'file-tag-sm': size === 'sm' }]">{{ b.label }}</span>
  </span>
</template>

<script setup>
/**
 * FileTags / 全站公共组件 / 影片「文件名属性标签」（无码破解 / 中文字幕 / 4K）
 *
 * 接入位置（2026-10-05 用户要求）：首页「近期上新」卡、片库/喜欢/观看记录卡（MovieCard）、
 * 影片详情页标题行；播放页与推荐卡原本就有（markup 不变）。
 *
 * 样式约定：.file-tag / .ft-* / .file-tag-sm 三组类**定义为本组件的非 scoped 全局样式**，
 * 是这两个标签体系的**单一事实来源** —— 播放页等不经本组件的旧标记也依赖它们
 * （原先 Player.vue 里的 scoped 副本已移除）。改样式只改这里。
 *
 * 解析口径：默认只用**文件名**判断（不做真实分辨率探测 —— 列表页几百部影片逐部读 NAS
 * 不可接受）；播放页把「文件名 + 真实分辨率」的合并结果通过 badges 传入，复用同一套样式。
 */
import { computed } from 'vue'
import { fileBadgesOf } from '@/utils/global'

const props = defineProps({
  py: { type: String, default: '' },       // movies.py：取文件名部分解析（为空则不渲染）
  badges: { type: Array, default: null },  // 传入则直接使用（播放页：文件名+真实分辨率 合并结果）
  size: { type: String, default: 'md' }    // md=播放页主行同款 / sm=卡片缩略款
})
const list = computed(() => props.badges || fileBadgesOf(props.py))
</script>

<style>
/* 全站共用的属性标签样式（配色令牌见 global.css --filetag-*） */
.file-tags {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-left: 6px;   /* 标签与番号之间留一点缝（列表/详情直接内联在番号后） */
  vertical-align: middle;
}
.file-tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: var(--r-tag);
  font-size: var(--fs-base);
  line-height: 1.6;
  white-space: nowrap;
  user-select: none;
}
.ft-uncen { background: var(--filetag-blue-soft); color: var(--filetag-blue); }
.ft-cnsub { background: var(--filetag-purple-soft); color: var(--filetag-purple); }
.ft-uhd { background: var(--filetag-gold-soft); color: var(--filetag-gold); }
/* 卡片里的缩小版（窄卡片，跟随 11px 小字层级） */
.file-tag-sm { padding: 1px 8px; font-size: var(--fs-xs); border-radius: var(--r-sm); }
</style>