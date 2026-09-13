<!--
  文件名：AppIcon.vue
  所属模块：公共组件 / 统一图标
  功能描述：全应用统一的 SVG 图标组件。所有图标使用 24×24 viewBox、
           stroke=2、圆角线帽线尾的线性风格；实心变体以 -filled 结尾。
           通过 name 指定图标，size 控制尺寸，颜色继承 currentColor。
           用于替换此前混用的内联 SVG / Element 图标 / emoji 三套体系。
-->
<template>
  <svg
    :width="size" :height="size" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" :stroke-width="sw"
    stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" class="app-icon"
  >
    <template v-for="(el, i) in els" :key="i">
      <circle v-if="el.c" :cx="el.c[0]" :cy="el.c[1]" :r="el.c[2]"
              :fill="el.fill ? 'currentColor' : 'none'"
              :stroke="el.fill ? 'none' : 'currentColor'" />
      <path v-else :d="el.d"
            :fill="el.fill ? 'currentColor' : 'none'"
            :stroke="el.fill ? 'none' : 'currentColor'" />
    </template>
  </svg>
</template>

<script setup>
import { computed } from 'vue'

// 图标字典：每个图标为元素数组
// { d: '路径' } 线性元素；{ d, fill: true } 实心元素；{ c: [cx, cy, r] } 圆形元素
const ICONS = {
  // 导航
  home: [
    { d: 'M3 10.5 12 3l9 7.5' },
    { d: 'M5.5 9.5V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9.5' }
  ],
  library: [
    { d: 'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z' },
    { d: 'M4 9h16M9 3v18' }
  ],
  heart: [
    { d: 'M19.8 5.1a5 5 0 0 0-7.1 0L12 5.8l-.7-.7a5 5 0 1 0-7.1 7.1l.7.7L12 20l7.1-7.1.7-.7a5 5 0 0 0 0-7.1z' }
  ],
  'heart-filled': [
    { d: 'M19.8 5.1a5 5 0 0 0-7.1 0L12 5.8l-.7-.7a5 5 0 1 0-7.1 7.1l.7.7L12 20l7.1-7.1.7-.7a5 5 0 0 0 0-7.1z', fill: true }
  ],
  history: [
    { c: [12, 12, 8.5] },
    { d: 'M12 7.5V12l3 1.8' }
  ],
  settings: [
    { d: 'M4 7h8M16 7h4M4 12h2M10 12h10M4 17h12M20 17h0' },
    { c: [14, 7, 2] },
    { c: [8, 12, 2] },
    { c: [18, 17, 2] }
  ],
  // 操作
  search: [
    { c: [11, 11, 7] },
    { d: 'M20 20l-3.5-3.5' }
  ],
  import: [
    { d: 'M12 3v10m0 0 4-4m-4 4-4-4' },
    { d: 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2' }
  ],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  play: [{ d: 'M9.5 5.5v13l11-6.5z', fill: true }],
  edit: [
    { d: 'M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z' },
    { d: 'M13.5 6.5l3 3' }
  ],
  trash: [
    { d: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 12.2a1 1 0 0 0 1 .8h7a1 1 0 0 0 1-.8L17.5 7' },
    { d: 'M10 11.5v5M14 11.5v5' }
  ],
  globe: [
    { c: [12, 12, 8.5] },
    { d: 'M3.5 12h17' },
    { d: 'M12 3.5c2.7 2.3 4.1 5.1 4.1 8.5s-1.4 6.2-4.1 8.5c-2.7-2.3-4.1-5.1-4.1-8.5S9.3 5.8 12 3.5z' }
  ],
  back: [{ d: 'M15 5.5 8.5 12l6.5 6.5' }],
  shuffle: [
    { d: 'M16 4h4v4M20 4 4 20M16 20h4v-4M4 4l5.5 5.5M20 20l-5.5-5.5' }
  ],
  reset: [
    { d: 'M3 12a9 9 0 1 0 2.6-6.4L3 8' },
    { d: 'M3 3v5h5' }
  ],
  more: [
    { c: [12, 5.5, 1.6], fill: true },
    { c: [12, 12, 1.6], fill: true },
    { c: [12, 18.5, 1.6], fill: true }
  ],
  bell: [
    { d: 'M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9z' },
    { d: 'M10.3 20a2 2 0 0 0 3.4 0' }
  ],
  check: [{ d: 'M5 12.5 10 17.5 19 7' }],
  close: [{ d: 'M6 6l12 12M18 6 6 18' }],
  copy: [
    { d: 'M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z' },
    { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }
  ],
  // 文件与媒体
  folder: [
    { d: 'M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.6.8L12.6 8H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }
  ],
  film: [
    { d: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z' },
    { d: 'M3 9.5h18M3 14.5h18M8.5 5v14M15.5 5v14' }
  ],
  file: [
    { d: 'M6 3h7.5L18 7.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z' },
    { d: 'M13.5 3v4.5H18' }
  ],
  image: [
    { d: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z' },
    { d: 'm4 16 4.5-4.5a1.5 1.5 0 0 1 2 0L15 16m-2-2 1.5-1.5a1.5 1.5 0 0 1 2 0L21 17' },
    { c: [9, 9, 1.2] }
  ],
  // 其他
  link: [
    { d: 'M10 14a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2' },
    { d: 'M14 10a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.2-1.2' }
  ],
  external: [
    { d: 'M14 4h6v6M20 4l-9 9' },
    { d: 'M10 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4' }
  ],
  user: [
    { c: [12, 8, 4] },
    { d: 'M4.5 20c1.6-3.6 4.2-5 7.5-5s5.9 1.4 7.5 5' }
  ],
  database: [
    { d: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z' },
    { d: 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6' },
    { d: 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3' }
  ],
  info: [
    { c: [12, 12, 9] },
    { d: 'M12 11v5' },
    { c: [12, 7.8, 0.4], fill: true }
  ],
  tag: [
    { d: 'M4 4h6.3a2 2 0 0 1 1.4.6l8 8a2 2 0 0 1 0 2.8l-4.3 4.3a2 2 0 0 1-2.8 0l-8-8A2 2 0 0 1 4 10.3z' },
    { c: [8.5, 8.5, 1.2] }
  ],
  calendar: [
    { d: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z' },
    { d: 'M8 3v4M16 3v4M4 10h16' }
  ],
  video: [
    { d: 'M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z' },
    { d: 'm16 10 5-2.5v9L16 14' }
  ]
}

const props = defineProps({
  name: { type: String, required: true }, // 图标名（见 ICONS 字典）
  size: { type: [Number, String], default: 18 }, // 尺寸（px）
  sw: { type: [Number, String], default: 2 }     // 线宽
})

// 当前图标的元素列表，未知名称时退化为空（不渲染内容）
const els = computed(() => ICONS[props.name] || [])
</script>

<style scoped>
.app-icon { display: inline-block; vertical-align: middle; flex-shrink: 0; }
</style>
