<!--
  文件名：SingleForm.vue
  所属模块：公共组件 / 添加影片对话框子表单
  功能描述：选择单个本地视频文件导入的表单组件。调用后端 API 打开文件选择对话框，
           从文件名自动提取番号，生成标题（去除扩展名）和视频路径，
           通过 emit 将数据传给父组件进入手动编辑流程。
-->
<template>
  <div>
    <!-- 说明文字 -->
    <p style="color: var(--muted); margin-top:0">选择一个本地视频文件，自动提取番号。</p>
    <!-- 选择视频文件按钮 + 文件名显示 -->
    <el-button type="primary" @click="choose">选择视频文件</el-button>
    <span v-if="data.name" style="margin-left:12px; color: var(--text-2)">{{ data.name }}</span>
    <!-- 继续按钮区域 -->
    <div style="margin-top:18px">
      <!-- 继续填写元数据按钮：未选择文件时禁用 -->
      <el-button type="primary" :disabled="!data.name" @click="go">继续填写元数据</el-button>
    </div>
  </div>
</template>

<script setup>
// 引入 Vue 的响应式 API
import { ref } from 'vue'
// 引入番号提取工具函数
import { extractCode } from '@/utils/global'

// 定义 emit 事件：
// - selected: 选择视频文件后点击继续时触发，参数为影片元数据对象（番号、标题、路径）
const emit = defineEmits(['selected'])

// 当前选择的视频文件数据
const data = ref({})

// 选择视频文件的处理函数
// 调用后端 API 打开文件选择对话框，从文件名提取番号和标题
// 触发时机：用户点击"选择视频文件"按钮
async function choose() {
  if (!window.api) return
  // 打开文件选择对话框，返回文件完整路径
  const p = await window.api.openVideoDialog()
  if (!p) return
  // 从路径中提取文件名（兼容 Windows 和 Unix 路径分隔符）
  const name = p.split(/[\\/]/).pop() || ''
  // 构建影片数据对象
  data.value = {
    ph: extractCode(name),                 // 从文件名提取番号
    pm: name.replace(/\.[^.]+$/, ''),      // 标题（去除文件扩展名）
    py: p                                  // 视频文件完整路径
  }
}

// 继续填写元数据的处理函数
// 将视频文件数据传给父组件，切换到手动编辑表单
// 触发时机：用户点击"继续填写元数据"按钮
function go() { emit('selected', data.value) }
</script>
