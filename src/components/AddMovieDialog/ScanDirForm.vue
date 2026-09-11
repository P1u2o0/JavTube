<!--
  文件名：ScanDirForm.vue
  所属模块：公共组件 / 添加影片对话框子表单
  功能描述：扫描本地视频文件夹批量导入影片的表单组件。递归扫描选中目录下所有视频文件，
           自动从文件名提取番号（可手动修正），通过表格展示文件列表供用户选择导入。
           支持全选/取消全选，导入时调用后端 API 逐条创建影片记录。
-->
<template>
  <div>
    <!-- 说明文字 -->
    <p style="color: var(--muted); margin-top:0">
      选择本地视频文件夹，递归扫描所有视频文件，自动从文件名尝试提取番号，然后导入。
    </p>
    <!-- 选择目录按钮 + 已选目录路径显示 -->
    <el-button type="primary" @click="chooseDir">选择目录</el-button>
    <span v-if="dir" style="margin-left:10px; color: var(--text-2)">{{ dir }}</span>
    <!-- 文件列表表格：有扫描结果时显示 -->
    <div v-if="list.length" style="margin-top:14px; max-height: 280px; overflow:auto; border:1px solid var(--border); border-radius: var(--r-sm);">
      <el-table :data="list" size="small" @selection-change="sel = $event" ref="tb">
        <!-- 选择列 -->
        <el-table-column type="selection" width="50" />
        <!-- 文件名列 -->
        <el-table-column label="文件名" min-width="220" prop="name" />
        <!-- 提取番号列（可编辑输入框） -->
        <el-table-column label="提取番号" width="140">
          <template #default="{ row, $index }">
            <el-input v-model="codes[$index]" size="small" />
          </template>
        </el-table-column>
        <!-- 文件路径列（超长省略提示） -->
        <el-table-column label="路径" prop="path" min-width="260" show-overflow-tooltip />
        <!-- 文件大小列 -->
        <el-table-column label="大小" width="110">
          <template #default="{ row }">{{ fmtSize(row.size) }}</template>
        </el-table-column>
      </el-table>
    </div>
    <!-- 操作按钮区域：有扫描结果时显示 -->
    <div v-if="list.length" style="margin-top: 12px; display:flex; gap:8px; justify-content:flex-end;">
      <!-- 全选按钮 -->
      <el-button @click="selectAll(true)">全选</el-button>
      <!-- 取消全选按钮 -->
      <el-button @click="selectAll(false)">取消全选</el-button>
      <!-- 导入已选按钮：无选中项时禁用 -->
      <el-button type="primary" :disabled="!sel.length" @click="onImport">导入已选（{{ sel.length }}）</el-button>
    </div>
  </div>
</template>

<script setup>
// 引入 Vue 的响应式 API 和 nextTick
import { ref, nextTick } from 'vue'
// 引入番号提取工具函数
import { extractCode } from '@/utils/global'
// 引入 Element Plus 的消息提示组件
import { ElMessage } from 'element-plus'

// 定义 emit 事件：
// - selected: 导入完成后触发，通知父组件（参数为空对象，仅作通知用）
const emit = defineEmits(['selected'])

// 当前选择的目录路径
const dir = ref('')
// 扫描到的文件列表
const list = ref([])
// 每个文件对应的提取番号数组（与 list 一一对应）
const codes = ref([])
// 当前选中的文件行列表
const sel = ref([])
// el-table 组件引用
const tb = ref(null)

// 选择目录并扫描视频文件的处理函数
// 调用后端 API 打开目录选择对话框，扫描目录下所有视频文件，
// 自动从文件名提取番号并默认全选
// 触发时机：用户点击"选择目录"按钮
async function chooseDir() {
  if (!window.api) return
  // 打开目录选择对话框
  const d = await window.api.openDirDialog()
  if (!d) return
  dir.value = d
  // 扫描目录下的视频文件
  const r = await window.api.scanDir(d)
  if (!r.ok) return ElMessage.error(r.error)
  list.value = r.data || []
  // 从每个文件名提取番号
  codes.value = list.value.map(x => extractCode(x.name))
  // 默认全选：等待 DOM 更新后调用表格的全选方法
  await nextTick()
  if (tb.value) tb.value.toggleAllSelection()
}

// 全选/取消全选处理函数
// 参数 v: true=全选，false=取消全选
function selectAll(v) {
  if (!tb.value) return
  if (v) tb.value.toggleAllSelection()
  else {
    tb.value.clearSelection()
  }
}

// 导入已选文件的处理函数
// 遍历选中文件，调用后端 API 逐条创建影片记录。
// 已存在同番号记录时：库中视频路径为空/失效则自动回填，路径有效则跳过。
// 触发时机：用户点击"导入已选"按钮
async function onImport() {
  let ok = 0, filled = 0, skipped = 0
  for (let i = 0; i < sel.value.length; i++) {
    const row = sel.value[i]
    // 获取当前行对应的提取番号
    const code = codes.value[list.value.indexOf(row)] || ''
    // 调用后端 API 创建影片记录
    const r = await window.api.createMovie({
      ph: code,                           // 番号
      pm: row.name.replace(/\.[^.]+$/, ''), // 标题（去除文件扩展名）
      py: row.path                         // 视频路径
    })
    if (r.ok) {
      if (r.updated) filled++        // 已有记录但路径失效 → 已回填
      else if (r.skipped) skipped++  // 已有记录且路径有效 → 跳过
      else ok++                      // 新建成功
    }
  }
  const parts = [`已导入 ${ok} 条`]
  if (filled) parts.push(`回填视频路径 ${filled} 条`)
  if (skipped) parts.push(`跳过已存在 ${skipped} 条`)
  ElMessage.success(parts.join('，') + '；请到详情页补充元数据')
  emit('selected', {})
}

// 格式化文件大小的辅助函数
// 参数 n: 文件字节数
// 返回值: 带单位的可读字符串（如 "1.5 MB"）
function fmtSize(n) {
  if (!n) return '0 B'
  const u = ['B','KB','MB','GB','TB']; let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`
}
</script>
