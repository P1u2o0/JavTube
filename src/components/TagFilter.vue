<!--
  文件名：TagFilter.vue
  所属模块：公共组件 / 标签筛选器
  功能描述：按标签分类筛选影片的组件，将所有标签按分类（类别）分组展示。
           支持多分类、多标签同时选中，包含"全部"按钮清除所有筛选。
           未归入任何分类的标签显示在"未分类"区域。通过 store 管理选中状态，
           通过 emit('change') 通知父组件筛选条件已变更。
-->
<template>
  <!-- 标签筛选器主体：有标签数据时才显示 -->
  <div class="tag-filter" v-if="allTags.length">
    <!-- 筛选器头部：标题 + "全部"按钮 -->
    <div class="filter-header">
      <span class="header-label">标签筛选</span>
      <!-- "全部"按钮：无任何选中标签时高亮，点击清除所有筛选 -->
      <TagChip label="全部" :selected="selectedTags.length === 0" @click="onClearAll" />
    </div>
    <!-- 筛选器主体：分类标签区域 -->
    <div class="filter-body">
      <!-- 遍历有标签的分类，渲染每个分类行 -->
      <div v-for="cat in displayCategories" :key="cat.idx" class="cat-row">
        <!-- 分类名称 -->
        <span class="cat-name">{{ cat.cat }}</span>
        <!-- 分类下的标签列表 -->
        <div class="cat-tags">
          <TagChip v-for="t in cat.tags" :key="t"
                   :label="t"
                   :selected="isTagSelected(cat.idx, t)"
                   @click="onToggle(cat.idx, t)" />
        </div>
      </div>
      <!-- 未分类标签区域：有未分类标签时显示 -->
      <div v-if="uncategorizedTags.length" class="cat-row">
        <span class="cat-name">未分类</span>
        <div class="cat-tags">
          <TagChip v-for="t in uncategorizedTags" :key="t"
                   :label="t"
                   :selected="isTagSelected(-1, t)"
                   @click="onToggleUncategorized(t)" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// 引入 Vue 的计算属性 API
import { computed } from 'vue'
// 引入标签芯片子组件
import TagChip from './TagChip.vue'
// 引入影片数据仓库（Pinia store）
import { useMoviesStore } from '@/store/movies'

// 定义 emit 事件：
// - change: 标签选中状态变更时触发，通知父组件重新加载列表
const emit = defineEmits(['change'])
// 获取 store 实例
const store = useMoviesStore()

// 所有数据库标签（计算属性，从 store 获取；allDbTags 本身按使用频率降序）
const allTags = computed(() => store.allDbTags || [])

/**
 * 按「含该标签的影片数量」降序排序（数量相同则按名称稳定排序）
 * 数据源为 store.tagCounts（主进程统计），不依赖 allDbTags 的数组顺序——
 * 这样即使标签列表尚未刷新，新标签也能按真实数量归位，不会落在最末。
 * 该排序同时作用于「分类内部」与「未分类标签」两处。
 * @param {string[]} tags - 原始标签数组
 * @returns {string[]} 排序后的新数组（不改动 store 内数据）
 */
function byUsage(tags) {
  const counts = store.tagCounts || {}
  return [...tags].sort((a, b) => {
    const ca = counts[a] || 0
    const cb = counts[b] || 0
    if (cb !== ca) return cb - ca          // 影片数量多者在前
    return String(a).localeCompare(String(b), 'zh-Hans-CN')  // 同数量按名称稳定排序
  })
}

// 当前所有已选中的标签（计算属性，将多分类的二维数组展平为一维）
const selectedTags = computed(() => store.tagSelected.flat())

// 可显示的分类列表（计算属性）：过滤掉无标签的分类，并按使用次数排序各类内标签
const displayCategories = computed(() => {
  return store.visibleCategories
    .filter(c => c.tags.length > 0)
    .map(c => ({ ...c, tags: byUsage(c.tags) }))
})

// 已分类标签集合（计算属性）：收集所有分类下的标签，用于区分未分类标签
const categorizedTags = computed(() => {
  const set = new Set()
  for (const c of store.categories) {
    for (const t of (c.tags || [])) set.add(t)
  }
  return set
})

// 未分类标签列表（计算属性）：不在任何分类中的标签，同样按使用次数排序
const uncategorizedTags = computed(() => {
  return byUsage(allTags.value.filter(t => !categorizedTags.value.has(t)))
})

// 判断指定分类下的标签是否被选中
// 参数 catIdx: 分类索引（-1 表示未分类，需遍历所有分类检查）
// 参数 tag: 标签名称
// 返回值: Boolean，是否已选中
function isTagSelected(catIdx, tag) {
  // 未分类标签：遍历所有 9 个分类检查是否被选中
  if (catIdx < 0) {
    for (let i = 0; i < 9; i++) {
      if ((store.tagSelected[i] || []).includes(tag)) return true
    }
    return false
  }
  // 已分类标签：检查指定分类的选中数组
  return (store.tagSelected[catIdx] || []).includes(tag)
}

// 切换已分类标签的选中状态
// 参数 catIdx: 分类索引
// 参数 tag: 标签名称
// 触发时机：用户点击已分类区域的标签芯片
function onToggle(catIdx, tag) {
  store.toggleTag(catIdx, tag)
  emit('change')
}

// 切换未分类标签的选中状态
// 参数 tag: 标签名称
// 如果标签已在某分类中被选中则取消选中，否则添加到第一个分类
// 触发时机：用户点击未分类区域的标签芯片
function onToggleUncategorized(tag) {
  // 遍历所有 9 个分类，查找并移除已选中的标签
  for (let i = 0; i < 9; i++) {
    const arr = store.tagSelected[i] || []
    if (arr.includes(tag)) {
      arr.splice(arr.indexOf(tag), 1)
      emit('change')
      return
    }
  }
  // 标签未被选中，添加到第一个分类
  if (!store.tagSelected[0]) store.tagSelected[0] = []
  store.tagSelected[0].push(tag)
  emit('change')
}

// 清除所有标签筛选
// 将 9 个分类的选中数组全部重置为空数组
// 触发时机：用户点击"全部"按钮
function onClearAll() {
  store.tagSelected = [[], [], [], [], [], [], [], [], []]
  emit('change')
}
</script>

<style scoped>
/* 标签筛选器主体：统一面板样式 */
.tag-filter {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  margin-bottom: 10px;
}
/* 筛选器头部样式 */
.filter-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
}
/* 头部标签文字样式 */
.header-label {
  font-weight: 600;
  color: var(--text);
  font-size: 13.5px;
  flex-shrink: 0;
  min-width: 60px;
  margin-right: 6px;
}
/* 筛选器主体区域 */
.filter-body {
  padding: 6px 14px;
}
/* 单个分类行样式 */
.cat-row {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 2px 5px;
  padding: 4px 0;
}
/* 分类名称样式 */
.cat-name {
  font-weight: 500;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.9;
  margin-right: 6px;
  flex-shrink: 0;
  min-width: 60px;
}
/* 分类下标签列表容器 */
.cat-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 5px;
  flex: 1;
}
</style>
