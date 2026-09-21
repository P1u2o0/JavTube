<!--
  文件名：MovieGrid.vue
  所属模块：公共组件 / 影片网格
  功能描述：影片网格列表组件，使用 CSS Grid 布局展示多个 MovieCard 卡片。
           支持空状态提示、加载中提示、分页器。通过 props 接收影片列表数据和分页信息，
           通过 emit 将卡片事件和分页事件透传给父组件。
-->
<template>
  <!-- 网格容器 -->
  <div class="grid-wrap">
    <!-- 空状态：无影片且未加载时显示 -->
    <el-empty v-if="!movies.length && !loading" description="共找到 0 个结果" />
    <!-- 影片网格：动态设置列数 -->
    <div class="grid" v-else :class="{ 'no-anim': !animateIn }" :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }">
      <!-- 遍历影片列表渲染卡片，注入索引驱动错峰入场动画 -->
      <MovieCard
        v-for="(m, i) in movies" :key="m.id"
        :m="m"
        :style="{ '--i': i }"
        :selectMode="selectMode"
        :isSel="selSet.has(m.id)"
        :showPlayCount="showPlayCount"
        @click="$emit('click', m)"
        @play="$emit('play', m)"



        @fav="$emit('fav', m)"
        @toggle="$emit('toggle', m)"
      />
    </div>
    <!-- 加载中提示 -->
    <div v-if="loading" class="loading-tip">加载中…</div>
    <!-- 分页器：总数超过每页数量时显示 -->
    <div v-if="total > pageSize" class="pager">
      <el-pagination
        background
        layout="prev, pager, next, total"
        :total="total"
        :page-size="pageSize"
        :current-page="page"
        @current-change="onPageChange"
      />
    </div>
  </div>
</template>

<script setup>
// 引入影片卡片子组件
import { computed, ref, onMounted, nextTick } from 'vue'
import MovieCard from './MovieCard.vue'

// 组件 props 定义
const props = defineProps({
  movies: Array,      // 影片列表数据
  total: Number,      // 影片总数
  page: Number,       // 当前页码
  pageSize: Number,   // 每页数量
  cols: { type: Number, default: 5 }, // 网格列数，默认 5 列
  loading: Boolean,   // 是否正在加载
  selectMode: Boolean, // 是否处于多选模式
  selectedIds: Array,  // 已选中的影片 ID 列表
  showPlayCount: Boolean // 是否显示播放次数角标（观看记录页）
})

// 选中集合：原先模板里写 selectedIds.includes(m.id)，
// 每张卡片都线性扫一遍选中数组（每页 200 张 = 4 万次比较，且每次勾选都全量重算）。
// 用 Set 后单次查找 O(1)，多选模式下的勾选/翻页明显变顺。
const selSet = computed(() => new Set(props.selectedIds || []))

// 入场动画只在「本次进入页面」的首屏播一次。
// 卡片是 v-for keyed 渲染，翻页会整批重建 —— 若每次都重播错峰动画（最迟 15×36ms≈540ms
// 才轮到最后一排淡入），每次翻页都有近 1 秒的"缓入"观感，用户感知就是「翻页卡顿」。
const animateIn = ref(true)
onMounted(async () => {
  await nextTick()
  setTimeout(() => { animateIn.value = false }, 800)
})

// 定义 emit 事件：
// - page: 分页切换事件，参数为目标页码
// - click/play/edit/delete/fav/toggle: 透传 MovieCard 的对应事件
// （detail 事件已移除：MovieCard 从不发出此事件，透传监听为死绑定）
const emit = defineEmits(['page', 'click', 'play', 'fav', 'toggle'])

// 分页器页码变化处理函数
// 参数 p: 用户选择的目标页码
// 触发时机：用户点击分页器的页码或上一页/下一页按钮
function onPageChange(p) {
  emit('page', p)
}
</script>

<style scoped>
/* 网格容器 */
.grid-wrap { padding: 0; }
/* 网格布局：使用 CSS Grid，列数由 props.cols 动态决定 */
.grid {
  display: grid;
  gap: 12px;
  align-items: start;
}
/* 翻页/换筛选后不再重播入场动画：卡片即时呈现 */
.grid.no-anim :deep(.movie-card) { animation: none; }
/* 加载中提示文字样式 */
.loading-tip { text-align: center; color: var(--muted); padding: 20px; }
/* 分页器容器：居中显示 */
.pager { display: flex; justify-content: center; padding: 20px 0; }
</style>
