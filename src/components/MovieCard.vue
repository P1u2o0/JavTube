<!--
  文件名：MovieCard.vue
  所属模块：公共组件 / 影片卡片
  功能描述：单个影片的卡片展示组件，显示封面图片、番号和标题。
           悬停浮现播放按钮；右上角喜欢按钮（已喜欢为朱柿红实心心）；
           多选模式下显示勾选框。
           通过 emit 向父组件传递点击、播放、选中切换事件
           （编辑/删除操作统一在影片详情页进行）。
  视觉规范：图标统一使用 AppIcon；番号使用拉丁展示字 + 等宽数字；
           卡片带错峰入场动画（--i 由 MovieGrid 注入）；右上角喜欢按钮可切换喜欢。
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
      <!-- 右上角喜欢按钮：可点击切换喜欢（白底圆 + 心形，已喜欢为朱柿红实心）。
           事件链：MovieCard emit fav → MovieGrid 转发 → 视图 onFav → store.toggleFav（乐观更新） -->
      <button class="fav-btn" :class="{ active: isFav }"
              :title="isFav ? '取消喜欢' : '喜欢'"
              @click.stop="onFavClick">
        <AppIcon :name="isFav ? 'heart-filled' : 'heart'" :size="14" />
      </button>
      <!-- 播放次数角标（观看记录页显示）：右下角胶囊，播放次数来自 recordPlay 累加 -->
      <span v-if="showPlayCount && m.play_count" class="play-count">
        <AppIcon name="play" :size="10" />{{ m.play_count }}
      </span>
      <!-- 多选模式下的勾选框（自绘圆形：未选白圆描边，选中朱柿红实心圆 + 白色对勾，内联 SVG 零依赖） -->
      <div v-if="selectMode" class="check" :class="{ checked: isSel }" @click.stop="$emit('toggle')">
        <svg v-if="isSel" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <path d="M5 12.5 10 17.5 19 7" fill="none" stroke="#fff" stroke-width="3"
                stroke-linecap="round" stroke-linejoin="round" />
        </svg>
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
import { computed, ref, watch } from 'vue'
// 引入封面解析工具和数据目录引用
import { resolveCover, dataDirRef } from '@/utils/global'
// 引入统一图标组件
import AppIcon from '@/components/AppIcon.vue'

// 组件 props 定义
const props = defineProps({
  m: { type: Object, required: true },        // 影片数据对象
  selectMode: { type: Boolean, default: false }, // 是否处于多选模式
  isSel: { type: Boolean, default: false },      // 当前卡片是否被选中
  showPlayCount: { type: Boolean, default: false } // 是否显示播放次数角标（观看记录页启用）
})

// 定义 emit 事件：
// - click: 卡片点击事件
// - play: 播放影片
// - fav: 切换喜欢状态（右上角喜欢按钮）
// - toggle: 多选模式下切换选中状态
const emit = defineEmits(['click', 'play', 'fav', 'toggle'])

// 封面图片是否加载出错
const errd = ref(false)

// 图片加载出错时的处理函数
function onErr() { errd.value = true }

// 是否已收藏（cl 字段为 'y' 表示已收藏）
const isFav = computed(() => props.m.cl === 'y')

/**
 * 喜欢按钮点击：用 Web Animations API 播放轻微弹跳（与状态解耦、确定性播放），
 * 再触发 fav 事件由父级写库（父级乐观更新，界面即时响应）
 * @param {MouseEvent} e - 点击事件
 */
function onFavClick(e) {
  e.currentTarget?.animate?.(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(0.85)', offset: 0.3 },
      { transform: 'scale(1.12)', offset: 0.65 },
      { transform: 'scale(1)' }
    ],
    { duration: 260, easing: 'ease-out' }
  )
  emit('fav')
}

// 封面 URL 计算属性：出错时返回空，否则解析封面路径
const coverUrl = computed(() => {
  if (errd.value) return ''
  return resolveCover(props.m.cover) || ''
})

// 侦听封面变化，重置错误状态（切换影片时重新尝试加载封面）
watch(() => props.m.cover, () => { errd.value = false })
// 侦听数据目录变化，重置错误状态（数据目录变更后重新尝试加载封面）
watch(dataDirRef, () => { errd.value = false })
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
/* 右上角喜欢按钮：磨砂玻璃圆形 + 心形（半透明白 + 背景模糊 + 边缘高光）。
   未喜欢：暖灰描边心；已喜欢：朱柿红实心心；hover 底色提亮、心形变朱柿红并微放大 */
.fav-btn {
  position: absolute; top: 8px; right: 8px;
  width: 27px; height: 27px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);          /* 半透明白（更透，明显透出海报底色） */
  backdrop-filter: blur(12px) saturate(1.5);      /* 磨砂玻璃：模糊背景 + 略提饱和 */
  -webkit-backdrop-filter: blur(12px) saturate(1.5);
  color: var(--text-2);                           /* 未喜欢：暖灰（比 muted 略深，避免玻璃底上发虚） */
  display: flex; align-items: center; justify-content: center;
  /* 玻璃质感：顶部细内高光模拟受光，外加一级轻投影保持层次（替代原实线描边） */
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35),
              inset 0 0 0 0.5px rgba(255, 255, 255, 0.12),
              var(--sh-1);
  cursor: pointer;
  transition: color var(--dur-fast) ease, background var(--dur-fast) ease,
              transform var(--dur-fast) var(--ease-out);
}
.fav-btn:hover { background: rgba(255, 255, 255, 0.34); color: var(--accent); transform: scale(1.12); }
.fav-btn.active { color: var(--accent); background: rgba(255, 255, 255, 0.26); }

/* 播放次数角标：右下角墨黑半透明胶囊 + 白字（与悬停遮罩同色系，不遮挡点击） */
.play-count {
  position: absolute; right: 8px; bottom: 8px;
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 7px;
  border-radius: var(--r-pill);
  background: rgba(29, 28, 26, 0.62);
  color: #fff;
  font-size: 11px; font-weight: 600;
  font-variant-numeric: tabular-nums;
  backdrop-filter: blur(4px);
  pointer-events: none;
}

/* 多选模式勾选框：磨砂玻璃圆形（与右上角喜欢按钮同一质感），选中态为朱柿红实心 */
.check {
  position: absolute; top: 8px; left: 8px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(12px) saturate(1.5);
  -webkit-backdrop-filter: blur(12px) saturate(1.5);
  border: none;
  border-radius: 50%;
  width: 25px; height: 25px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35),
              inset 0 0 0 0.5px rgba(255, 255, 255, 0.12),
              var(--sh-1);
  cursor: pointer;
  transition: background var(--dur-fast) ease, border-color var(--dur-fast) ease;
}
.check.checked {
  background: #d2401e;
  border-color: #d2401e;
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
