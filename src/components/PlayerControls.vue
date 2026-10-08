<!--
  文件名：PlayerControls.vue
  所属模块：公共组件 / 播放页
  功能描述：mpv「高兼容模式」下的自制播放控件条（2026-10-08）。
            mpv 是独立进程、不参与页面渲染，所以 ArtPlayer 那套控制条在 mpv 模式下用不上，
            这一条由页面自己画、经 @/player 契约驱动 mpv。
            它铺在视频区域之上（HTML 绘制在 mpv 之上，实测），鼠标不动 2.6 秒后淡出；
            暂停时保持常显。单击画面 = 播放/暂停，双击画面 = 全屏（与 ArtPlayer 的习惯一致）。
  为什么不做成内核自带控件：mpv 的 OSC 会被页面盖住（HTML 层级更高），且它的键位/交互与
            本应用的设计令牌不一致。
  @dependencies AppIcon.vue
-->
<template>
  <!-- 铺满整个视频区域：既负责接收「点画面暂停 / 双击全屏」，也负责鼠标活动检测（控件条自动隐藏） -->
  <div
    class="pc-root"
    :class="{ 'pc-show': visible }"
    @mousemove="poke"
    @mouseleave="onLeave"
    @click="onSurfaceClick"
    @dblclick="onSurfaceDblClick"
  >
    <div class="pc-bar" @click.stop @dblclick.stop>
      <!-- 播放 / 暂停 -->
      <button type="button" class="pc-btn" :title="state.paused ? '播放' : '暂停'" @click="$emit('toggle')">
        <AppIcon :name="state.paused ? 'play' : 'pause'" :size="18" />
      </button>

      <!-- 进度条：可点击定位、可拖拽。拖动期间只更新预览位置，松手才真正 seek（避免狂发 IPC） -->
      <div class="pc-track" ref="trackRef"
           @pointerdown="onTrackDown" @pointermove="onTrackMove"
           @pointerup="onTrackUp" @pointercancel="onTrackUp">
        <div class="pc-fill" :style="{ width: shownPct + '%' }"></div>
        <div class="pc-knob" :style="{ left: shownPct + '%' }"></div>
      </div>

      <span class="pc-time">{{ fmtTime(shownTime) }} / {{ fmtTime(state.dur) }}</span>

      <!-- 倍速 -->
      <div class="pc-rate-wrap">
        <button type="button" class="pc-btn pc-rate" title="播放倍速" @click="rateOpen = !rateOpen">
          {{ fmtRate(state.rate) }}
        </button>
        <div v-if="rateOpen" class="pc-rate-list">
          <button v-for="r in RATES" :key="r" type="button"
                  class="pc-rate-item" :class="{ on: Math.abs(r - state.rate) < 0.001 }"
                  @click="pickRate(r)">{{ fmtRate(r) }}</button>
        </div>
      </div>

      <!-- 音量 -->
      <button type="button" class="pc-btn" :title="state.muted ? '取消静音' : '静音'" @click="$emit('volume', state.muted ? state.vol : 0)">
        <AppIcon :name="state.muted || state.vol === 0 ? 'volume-mute' : 'volume'" :size="18" />
      </button>
      <input class="pc-vol" type="range" min="0" max="1" step="0.05"
             :value="state.muted ? 0 : state.vol" title="音量"
             @input="onVolInput" />

      <!-- 全屏 / 外部播放器 -->
      <button type="button" class="pc-btn" title="全屏" @click="$emit('fullscreen')">
        <AppIcon name="fullscreen" :size="18" />
      </button>
      <button type="button" class="pc-btn" title="使用外部播放器打开" @click="$emit('external')">
        <AppIcon name="external" :size="17" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps({
  /** 播放状态镜像（由播放页从契约事件维护）：{ t, dur, paused, vol, muted, rate } */
  state: { type: Object, required: true }
})
const emit = defineEmits(['toggle', 'seek', 'volume', 'rate', 'fullscreen', 'external'])

/** 可选倍速（与设置里的长按倍速互相独立） */
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

// ====== 自动隐藏：鼠标不动 2.6 秒淡出；暂停时常显 ======
const HIDE_MS = 2600
const visible = ref(true)
let hideTimer = null
function poke() {
  visible.value = true
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => { if (!props.state.paused) visible.value = false }, HIDE_MS)
}
function onLeave() {
  if (hideTimer) clearTimeout(hideTimer)
  if (!props.state.paused) visible.value = false
}
// 暂停时保持常显（用户在看进度/选倍速），播放中才自动淡出
watch(() => props.state.paused, (paused) => {
  if (hideTimer) clearTimeout(hideTimer)
  if (paused) visible.value = true
  else hideTimer = setTimeout(() => { visible.value = false }, HIDE_MS)
})
onBeforeUnmount(() => { if (hideTimer) clearTimeout(hideTimer) })

// ====== 进度条 ======
const trackRef = ref(null)
const dragging = ref(false)
const dragFrac = ref(0)

const dur = computed(() => Number(props.state.dur) || 0)
const pct = computed(() => (dur.value > 0 ? Math.min(100, Math.max(0, (props.state.t / dur.value) * 100)) : 0))
const shownPct = computed(() => (dragging.value ? dragFrac.value * 100 : pct.value))
const shownTime = computed(() => (dragging.value ? dragFrac.value * dur.value : props.state.t))

function fracFromEvent(e) {
  const el = trackRef.value
  if (!el) return 0
  const r = el.getBoundingClientRect()
  if (!(r.width > 0)) return 0
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
}
function onTrackDown(e) {
  if (!dur.value) return
  dragging.value = true
  dragFrac.value = fracFromEvent(e)
  try { e.target.setPointerCapture?.(e.pointerId) } catch { /* 忽略 */ }
  e.stopPropagation()
}
function onTrackMove(e) {
  if (!dragging.value) return
  dragFrac.value = fracFromEvent(e)
}
function onTrackUp(e) {
  if (!dragging.value) return
  dragging.value = false
  try { e.target.releasePointerCapture?.(e.pointerId) } catch { /* 忽略 */ }
  emit('seek', fracFromEvent(e))
}

// ====== 倍速 ======
const rateOpen = ref(false)
function pickRate(r) { rateOpen.value = false; emit('rate', r) }

// ====== 音量 ======
function onVolInput(e) { emit('volume', Number(e.target.value)) }

// ====== 点画面：单击 = 播放/暂停，双击 = 全屏 ======
// 单击必须等一个双击间隔再执行，否则双击会先触发一次暂停。与 ArtPlayer 的做法一致。
let clickTimer = null
function onSurfaceClick() {
  if (clickTimer) return
  clickTimer = setTimeout(() => { clickTimer = null; emit('toggle') }, 220)
}
function onSurfaceDblClick() {
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null }
  emit('fullscreen')
}

// ====== 格式化 ======
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const p = n => String(n).padStart(2, '0')
  return h ? `${h}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`
}
function fmtRate(r) {
  const n = Number(r) || 1
  return (Number.isInteger(n) ? n.toFixed(1) : String(n)) + 'x'
}
</script>

<style scoped>
/* 铺满视频区域：接收鼠标活动与点击（不画任何东西，否则会挡住 mpv 的画面） */
.pc-root {
  position: absolute;
  inset: 0;
  z-index: 40;
  cursor: default;
}

/* 控件条：默认淡出，鼠标活动时淡入。底部渐变让白字在任何画面上都可读 */
.pc-bar {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 46px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-fast) var(--ease-out);
  background: linear-gradient(to top, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0));
  border-radius: 0 0 var(--r-md) var(--r-md);
  color: #fff;
}
.pc-root.pc-show .pc-bar { opacity: 1; pointer-events: auto; }

.pc-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px; height: 28px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: #fff;
  cursor: pointer;
  opacity: 0.92;
}
.pc-btn:hover { background: rgba(255, 255, 255, 0.16); opacity: 1; }

.pc-time {
  flex: none;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  opacity: 0.9;
  white-space: nowrap;
}

/* 进度条：轨道细、悬停变粗，拖拽点用圆点表示 */
.pc-track {
  position: relative;
  flex: 1;
  height: 14px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}
.pc-track::before {
  content: '';
  position: absolute;
  left: 0; right: 0;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.28);
}
.pc-fill {
  position: absolute;
  left: 0;
  height: 4px;
  border-radius: 2px;
  background: var(--accent);
}
.pc-knob {
  position: absolute;
  width: 11px; height: 11px;
  margin-left: -5.5px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}

/* 倍速 */
.pc-rate-wrap { position: relative; flex: none; }
.pc-rate { width: auto; min-width: 40px; padding: 0 6px; font-size: 12px; font-variant-numeric: tabular-nums; }
.pc-rate-list {
  position: absolute;
  bottom: 34px;
  right: 0;
  display: flex;
  flex-direction: column;
  min-width: 62px;
  padding: 4px;
  border-radius: var(--r-sm);
  background: var(--overlay-strong);
  box-shadow: var(--sh-2);
}
.pc-rate-item {
  border: 0;
  background: transparent;
  color: #fff;
  font-size: 12px;
  text-align: center;
  padding: 4px 8px;
  border-radius: var(--r-sm);
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.pc-rate-item:hover { background: rgba(255, 255, 255, 0.16); }
.pc-rate-item.on { color: var(--accent); font-weight: 600; }

/* 音量滑块：细、低调，与控件条同高 */
.pc-vol {
  flex: none;
  width: 68px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}
</style>
