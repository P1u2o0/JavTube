<!--
  文件名：NfoForm.vue
  所属模块：公共组件 / 添加影片对话框子表单
  功能描述：从 NFO/XML 文件导入影片元数据的表单组件，兼容 Kodi/Jellyfin/Emby 格式。
           使用简易 XML 解析器（不依赖外部库）从文件中提取番号、标题、演员、标签、
           封面等信息。支持多文件批量解析，选择第一个结果继续编辑或直接导入。
-->
<template>
  <div>
    <!-- 说明文字 -->
    <p style="color: var(--muted); margin-top:0">选择 NFO/XML 文件（兼容 Kodi/Jellyfin/Emby 格式）。</p>
    <!-- 选择 NFO 文件按钮 -->
    <el-button type="primary" @click="choose">选择 NFO 文件</el-button>
    <!-- 解析结果列表 -->
    <ul v-if="results.length" class="parse-list">
      <li v-for="(r,i) in results" :key="i">
        <AppIcon name="check" :size="14" />
        <span>解析成功：{{ r.ph || r.pm }}</span>
      </li>
    </ul>
    <!-- 使用第一个结果按钮：有解析结果时显示 -->
    <div v-if="results.length" style="margin-top: 12px">
      <el-button type="primary" @click="go">使用第一个结果</el-button>
    </div>
  </div>
</template>

<script setup>
// 引入 Vue 的响应式 API
import { ref } from 'vue'
// 引入 Element Plus 的消息提示组件
import { ElMessage } from 'element-plus'
// 引入统一图标组件
import AppIcon from '@/components/AppIcon.vue'

// 定义 emit 事件：
// - selected: 选择解析结果时触发，参数为影片元数据对象，父组件将其填入手动表单
const emit = defineEmits(['selected'])

// NFO 解析结果列表
const results = ref([])

// 选择并解析 NFO 文件的处理函数
// 调用后端 API 打开文件选择对话框，逐个读取并解析文件内容
// 触发时机：用户点击"选择 NFO 文件"按钮
async function choose() {
  if (!window.api) return
  // 打开文件选择对话框，返回文件路径数组
  const paths = await window.api.openNfoDialog()
  if (!paths) return
  // 遍历所有选择的文件进行解析
  for (const p of paths) {
    try {
      // 读取文件文本内容
      const txt = await readText(p)
      // 解析 NFO/XML 内容
      const parsed = parseNfo(txt)
      if (parsed) results.value.push(parsed)
    } catch (e) {}
  }
  // 无成功解析结果时提示用户
  if (!results.value.length) ElMessage.warning('未能解析任何 NFO 文件')
}

// 读取文件文本内容的辅助函数
// 参数 p: 文件路径
// 返回值: Promise<string>，文件文本内容
// 抛出异常: API 不可用或读取失败时抛出
async function readText(p) {
  if (!window.api) throw new Error('API not available')
  const r = await window.api.readFileText(p)
  if (!r.ok) throw new Error(r.error)
  return r.data
}

// 简易 NFO/XML 解析函数（不依赖外部库）
// 参数 txt: NFO/XML 文件文本内容
// 返回值: 影片元数据对象，解析失败返回 null
function parseNfo(txt) {
  // 简易 XML 解析（不依赖外部库）
  // 辅助函数：提取指定标签的文本内容
  const tag = (name) => {
    const m = txt.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
    return m ? stripHtml(m[1]).trim() : ''
  }
  // 解析所有 genre 标签（标签/类型）
  const genres = []
  const genRe = /<genre[^>]*>([\s\S]*?)<\/genre>/gi
  let mm
  while ((mm = genRe.exec(txt)) !== null) genres.push(stripHtml(mm[1]).trim())
  // 解析所有 actor 标签中的 name 子标签（演员名）
  const actors = []
  const actRe = /<actor[^>]*>([\s\S]*?)<\/actor>/gi
  while ((mm = actRe.exec(txt)) !== null) {
    const nm = mm[1].match(/<name[^>]*>([\s\S]*?)<\/name>/i)
    if (nm) actors.push(stripHtml(nm[1]).trim())
  }
  // 解析所有 thumb 标签（封面缩略图 URL）
  const thumbs = []
  const thRe = /<thumb[^>]*>([\s\S]*?)<\/thumb>/gi
  while ((mm = thRe.exec(txt)) !== null) thumbs.push(stripHtml(mm[1]).trim())

  // 返回标准化的影片元数据对象
  return {
    ph: tag('uniqueid') || tag('num') || '',    // 番号
    pm: tag('title') || tag('originaltitle') || '', // 标题
    fxrq: tag('premiered') || tag('year') || '', // 发行日期
    yy: tag('studio') || tag('maker') || '',     // 厂商
    bq: genres.join('，'),                        // 标签
    yid: actors.join('，'),                       // 演员
    jt: tag('plot') || tag('outline') || '',      // 简介
    cover: thumbs[0] || '',                       // 封面（取第一张缩略图）
    sc: tag('set') || '',                         // 系列
    ps: tag('tag') || '',                         // 片商
    dy: tag('director') || '',                   // 导演
    xl: tag('resolution') || ''                  // 分辨率
  }
}

// 去除 HTML 标签的辅助函数
// 参数 s: 可能包含 HTML 标签的字符串
// 返回值: 去除所有 HTML 标签后的纯文本
function stripHtml(s) { return String(s).replace(/<[^>]+>/g, '') }

// 使用第一个解析结果的回调
// 将第一个解析结果通过 emit 传给父组件，进入手动编辑流程
// 触发时机：用户点击"使用第一个结果"按钮
function go() { emit('selected', results.value[0]) }
</script>

<style scoped>
/* 解析结果列表：成功色 + 图标对齐 */
.parse-list {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  color: var(--success);
  font-size: 13px;
}
.parse-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}
</style>
