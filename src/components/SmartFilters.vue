<!--
  文件名：SmartFilters.vue
  所属模块：公共组件 / 片库筛选
  功能描述：智能收藏夹（2026-11-08）——把当前「标签组合 + 搜索词 + 排序」存成命名条目，
           以后一键切回。数据存 settings.smart_filters，逻辑见 composables/useSmartFilters.js。
  交互：点按钮展开列表（点条目 = 应用并关闭）→ 底部「保存当前筛选…」→ 输入名字。
        条目右侧 ✕ 删除（点它不触发应用）。
-->
<template>
  <el-dropdown trigger="click" @command="onCommand" @visible-change="onOpen">
    <el-button class="smart-btn" :class="{ compact }" title="筛选夹：保存/切回常用筛选">
      <AppIcon name="tag" :size="compact ? 12 : 14" :style="compact ? '' : 'margin-right:5px'" />
      <span>筛选夹</span>
      <span v-if="list.length" class="sf-count">{{ list.length }}</span>
    </el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item v-if="!list.length" disabled>还没有收藏夹</el-dropdown-item>
        <el-dropdown-item v-for="f in list" :key="f.id" :command="'apply:' + f.id">
          <span class="sf-name">{{ f.name }}</span>
          <span class="sf-sub">{{ summarize(f) }}</span>
          <span class="sf-del" title="删除这个收藏夹" @click.stop="onRemove(f)">✕</span>
        </el-dropdown-item>
        <el-dropdown-item divided command="save" :disabled="!canSave">保存当前筛选…</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup>
import { computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import { useMoviesStore } from '@/store/movies'
import { smartFilters, loadSmartFilters, saveSmartFilter, removeSmartFilter, applySmartFilter, hasFilter, summarize } from '@/composables/useSmartFilters'

const emit = defineEmits(['apply'])
// compact：塞进标签筛选头部时用的小号样式（与标签丸同高，不撑高头部）
const props = defineProps({ compact: { type: Boolean, default: false } })
const store = useMoviesStore()
const list = computed(() => smartFilters.value)
/** 当前筛选是空的（没有标签也没有搜索词）→ 存下来没有意义 */
const canSave = computed(() => hasFilter(store))

async function onOpen(open) { if (open) await loadSmartFilters() }

async function onCommand(cmd) {
  if (cmd === 'save') return onSave()
  const id = String(cmd).replace(/^apply:/, '')
  const f = list.value.find(x => x.id === id)
  if (!f) return
  applySmartFilter(store, f)
  emit('apply', f)
  ElMessage.success(`已应用「${f.name}」`)
}

async function onSave() {
  let name = ''
  try {
    const r = await ElMessageBox.prompt('给当前筛选起个名字（同名会覆盖）：', '保存筛选', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputPlaceholder: '例如：巨乳 + 中文字幕',
      inputValidator: v => (String(v || '').trim() ? true : '名字不能为空')
    })
    name = r.value
  } catch { return }   // 取消
  const r = await saveSmartFilter(store, name)
  if (r.ok) ElMessage.success('已保存')
  else ElMessage.error(r.error || '保存失败')
}

async function onRemove(f) {
  try {
    await ElMessageBox.confirm(`删除收藏夹「${f.name}」？`, '删除收藏夹', { type: 'warning' })
  } catch { return }
  await removeSmartFilter(f.id)
  ElMessage.success('已删除')
}
</script>

<style scoped>
.smart-btn {
  flex-shrink: 0;
  border-radius: var(--r-tag) !important;
}
/*
 * 小号（标签筛选头部）：故意做成与 TagChip 同一档尺寸/圆角/底色，
 * 这样"标签筛选 · 筛选夹 · 全部"三个东西在同一行里视觉重量一致，
 * 且不会把头部撑高（原来 el-button 默认 32px 高，比标签丸高出一截，头部会明显变厚）。
 */
.smart-btn.compact {
  height: auto;
  padding: 4px 11px;
  font-size: var(--fs-sm);
  line-height: 1.6;
  margin-left: 2px;
  background: var(--surface-2);
  border-color: var(--border) !important;
  color: var(--text-2);
}
.smart-btn.compact:hover {
  background: var(--surface-3);
  color: var(--text);
}
.smart-btn.compact :deep(span) { margin-left: 3px; }
/* 条数角标：与按钮文字同排的小胶囊 */
.sf-count {
  margin-left: 8px;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: var(--r-pill);
  background: var(--surface-3);
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 18px; text-align: center;
  font-variant-numeric: tabular-nums;
}
/* 下拉条目：名字 + 条件摘要 + 删除按钮一行放下 */
.sf-name { font-weight: 600; }
.sf-sub { margin-left: 8px; color: var(--muted); font-size: var(--fs-xs); }
.sf-del {
  margin-left: 10px;
  padding: 0 2px;
  color: var(--muted);
  cursor: pointer;
  font-size: var(--fs-xs);
}
.sf-del:hover { color: var(--danger); }
</style>
