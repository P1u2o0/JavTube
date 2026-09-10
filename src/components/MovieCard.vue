<!--
  文件名：MovieCard.vue
  所属模块：公共组件 / 影片卡片
  功能描述：单个影片的卡片展示组件，显示封面图片、番号和标题。支持悬停播放按钮、
           更多操作菜单（编辑、喜欢/取消喜欢、删除）、多选模式下的勾选框。
           通过 emit 向父组件传递点击、播放、编辑、删除、收藏等事件。
  视觉规范：图标统一使用 AppIcon；番号使用拉丁展示字 + 等宽数字；
           卡片带错峰入场动画（--i 由 MovieGrid 注入）。
-->
<template>
  <!-- 影片卡片主体，点击时触发 click 事件 -->
  <div class="movie-card" @click="$emit('click')">
    <!-- 封面区域 -->
    <div class="cover">
      <!-- 有封面 URL 且未加载出错时显示图片 -->
      <img v-if="coverUrl && !errd" :src="coverUrl" @error="onErr" />
      <!-- 无封面时显示占位 -->
      <div v-else class="no-cover">
        <AppIcon name="image" :size="26" />
        <span>无封面</span>
      </div>
      <!-- 悬停遮罩层，包含播放按钮 -->
      <div class="hover-overlay">
        <!-- 仅当有视频路径时显示播放按钮 -->
        <button v-if="m.py" class="play-btn" @click.stop="$emit('play')" aria-label="播放">
          <AppIcon name="play" :size="18" />
        </button>
      </div>
      <!-- 已收藏角标：朱柿红小心形 -->
      <div v-if="isFav" class="fav-badge" title="已收藏">
        <AppIcon name="heart-filled" :size="13" />
      </div>
      <!-- 多选模式下的勾选框（自绘圆形：未选白圆描边，选中朱柿红实心圆 + 白色对勾，内联 SVG 零依赖） -->
      <div v-if="selectMode" class="check" :class="{ checked: isSel }" @click.stop="$emit('toggle')">
        <svg v-if="isSel" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <path d="M5 12.5 10 17.5 19 7" fill="none" stroke="#fff" stroke-width="3"
                stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <!-- 更多操作按钮（三点菜单） -->
      <button class="more-btn" @click.stop="toggleMenu" aria-label="更多操作">
        <AppIcon name="more" :size="16" />
      </button>
      <!-- 更多操作菜单（纯 CSS 入场动画，避免帧回调阻塞导致菜单无法消失） -->
      <div v-if="menuOpen" class="ctx-menu menu-anim" @click.stop>
          <button class="ctx-item" @click="onEdit">
            <AppIcon name="edit" :size="15" />
            <span>编辑</span>
          </button>
          <button class="ctx-item" :class="{ 'ctx-fav-on': isFav }" @click="onFav">
            <AppIcon :name="isFav ? 'heart-filled' : 'heart'" :size="15" />
            <span>{{ isFav ? '取消喜欢' : '喜欢' }}</span>
          </button>
          <button class="ctx-item ctx-del" @click="onDel">
            <AppIcon name="trash" :size="15" />
            <span>删除</span>
          </button>
      </div>
    </div>
    <!-- 影片信息区域：番号 + 标题 -->
    <div class="info">
      <div class="code">{{ m.ph || '—' }}</div>
      <div class="title" :title="m.pm">{{ m.pm || '无标题' }}</div>
    </div>
  </div>
</template>

<script setup>
// 引入 Vue 的响应式 API、计算属性、侦听器和生命周期钩子
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
// 引入封面解析工具和数据目录引用
import { resolveCover, dataDirRef } from '@/utils/global'
// 引入统一图标组件
import AppIcon from '@/components/AppIcon.vue'

// 组件 props 定义
const props = defineProps({
  m: { type: Object, required: true },        // 影片数据对象
  selectMode: { type: Boolean, default: false }, // 是否处于多选模式
  isSel: { type: Boolean, default: false }       // 当前卡片是否被选中
})

// 定义 emit 事件：
// - click: 卡片点击事件
// - play: 播放影片
// - edit: 编辑影片
// - delete: 删除影片
// - fav: 切换收藏状态
// - toggle: 多选模式下切换选中状态
// （detail 事件已移除：卡片从未发出过此事件，详情跳转由父组件 click 处理器决定）
const emit = defineEmits(['click', 'play', 'edit', 'delete', 'fav', 'toggle'])

// 封面图片是否加载出错
const errd = ref(false)
// 更多操作菜单是否展开
const menuOpen = ref(false)

// 图片加载出错时的处理函数
function onErr() { errd.value = true }

// 是否已收藏（cl 字段为 'y' 表示已收藏）
const isFav = computed(() => props.m.cl === 'y')

// 封面 URL 计算属性：出错时返回空，否则解析封面路径
const coverUrl = computed(() => {
  if (errd.value) return ''
  return resolveCover(props.m.cover) || ''
})

// 侦听封面变化，重置错误状态（切换影片时重新尝试加载封面）
watch(() => props.m.cover, () => { errd.value = false })
// 侦听数据目录变化，重置错误状态（数据目录变更后重新尝试加载封面）
watch(dataDirRef, () => { errd.value = false })

// 切换更多操作菜单的显示/隐藏
function toggleMenu() { menuOpen.value = !menuOpen.value }
// 点击编辑：关闭菜单并触发 edit 事件
function onEdit() { menuOpen.value = false; emit('edit') }
// 点击喜欢：关闭菜单并触发 fav 事件
function onFav() { menuOpen.value = false; emit('fav') }
// 点击删除：关闭菜单并触发 delete 事件
function onDel() { menuOpen.value = false; emit('delete') }

// 点击页面其他区域时关闭菜单
function closeMenu(e) {
  if (menuOpen.value) menuOpen.value = false
}
// 组件挂载时注册全局点击监听，用于关闭菜单
onMounted(() => document.addEventListener('click', closeMenu))
// 组件卸载前移除全局点击监听，防止内存泄漏
onBeforeUnmount(() => document.removeEventListener('click', closeMenu))
</script>

<style scoped>
/* 卡片主体：白底、统一卡片圆角、发丝边框、悬停上浮 */
.movie-card {
  background: var(--surface);
  border-radius: var(--r-md);
  overflow: hidden;
  border: 1px solid var(--border);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out),
              box-shadow var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) ease;
  position: relative;
  display: flex;
  flex-direction: column;
  /* 错峰入场动画：--i 由 MovieGrid 按索引注入 */
  animation: card-in var(--dur-base) var(--ease-out) both;
  animation-delay: calc(min(var(--i, 0), 15) * 36ms);
}
@keyframes card-in {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: none; }
}
/* 悬停：上浮 + 二级阴影 + 边框加深 */
.movie-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--sh-2);
  border-color: var(--border-strong);
}
/* 封面区域：3:2 宽高比，暖灰渐变占位 */
.cover {
  width: 100%;
  aspect-ratio: 3/2;
  background: linear-gradient(135deg, var(--surface-2), var(--surface-3));
  position: relative;
  overflow: hidden;
}
/* 封面图片填满容器 */
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* 无封面占位：图标 + 文字 */
.no-cover {
  width: 100%; height: 100%;
  display: flex; flex-direction: column; gap: 6px;
  align-items: center; justify-content: center;
  color: var(--muted); font-size: 12px;
}
/* 悬停遮罩层 */
.hover-overlay {
  position: absolute; inset: 0;
  background: rgba(29, 28, 26, 0.42);
  opacity: 0;
  transition: opacity var(--dur-fast) ease;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
}
.movie-card:hover .hover-overlay {
  opacity: 1;
  pointer-events: auto;
}
/* 播放按钮：圆形白底墨黑图标 */
.play-btn {
  width: 44px; height: 44px;
  border: none; border-radius: 50%;
  background: rgba(255, 255, 255, 0.94);
  color: var(--primary);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: var(--sh-2);
  transition: transform var(--dur-fast) var(--ease-out), background var(--dur-fast) ease;
}
.play-btn:hover { transform: scale(1.06); background: #fff; }
.more-btn { z-index: 10; }
.ctx-menu { z-index: 20; }
/* 已收藏角标：右上角朱柿红心形 */
.fav-badge {
  position: absolute; top: 8px; right: 8px;
  width: 24px; height: 24px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: var(--accent);
  display: flex; align-items: center; justify-content: center;
  box-shadow: var(--sh-1);
  pointer-events: none;
}
/* 多选模式勾选框：自绘圆形，选中前后形状一致（圆形）。
   选中底色写死朱柿红 #d2401e（与 --accent 同值），不依赖 CSS 变量解析 */
.check {
  position: absolute; top: 8px; left: 8px;
  background: rgba(255, 255, 255, 0.94);
  border: 1.5px solid #d8d4cb;
  border-radius: 50%;
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: var(--sh-1);
  cursor: pointer;
  transition: background var(--dur-fast) ease, border-color var(--dur-fast) ease;
}
.check.checked {
  background: #d2401e;
  border-color: #d2401e;
}
/* 更多操作按钮（三点菜单） */
.more-btn {
  position: absolute; bottom: 8px; right: 8px;
  width: 30px; height: 30px;
  border: none; border-radius: 50%;
  background: rgba(29, 28, 26, 0.55);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background var(--dur-fast) ease;
  backdrop-filter: blur(4px);
}
.more-btn:hover { background: rgba(29, 28, 26, 0.8); }
/* 更多操作菜单 */
.ctx-menu {
  position: absolute; bottom: 42px; right: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  box-shadow: var(--sh-2);
  padding: 4px;
  z-index: 100;
  min-width: 128px;
}
/* 菜单项 */
.ctx-item {
  display: flex; align-items: center; gap: 9px;
  width: 100%; padding: 8px 12px;
  border: none; background: transparent;
  border-radius: 6px;
  font-size: 13px; color: var(--text-2);
  cursor: pointer; text-align: left;
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
}
.ctx-item:hover { background: var(--surface-2); color: var(--text); }
.ctx-item .app-icon { opacity: 0.75; }
/* 已收藏状态下心形用强调色 */
.ctx-fav-on .app-icon { color: var(--accent); opacity: 1; }
/* 删除菜单项：危险色 */
.ctx-del { color: var(--danger); }
.ctx-del .app-icon { opacity: 1; }
.ctx-del:hover { background: var(--danger-soft); color: var(--danger); }
/* 菜单入场动画：纯 CSS animation，不依赖帧回调，避免在低帧率环境下菜单卡住无法消失 */
.menu-anim { animation: menu-in 0.14s var(--ease-out) both; }
@keyframes menu-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}
/* 信息区域 */
.info { padding: 10px 12px 12px; }
/* 番号：拉丁展示字 + 等宽数字，工具软件的"仪表盘感" */
.code {
  color: var(--primary);
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-weight: 600; font-size: 12.5px;
  letter-spacing: 0.02em;
  margin-bottom: 3px;
}
/* 标题：两行省略 */
.title {
  font-size: 13px; color: var(--text); line-height: 1.5;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  min-height: 3em;
}
</style>
