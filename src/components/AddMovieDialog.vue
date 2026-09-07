<!--
  文件名：AddMovieDialog.vue
  所属模块：公共组件 / 添加影片对话框
  功能描述：添加影片的对话框容器组件，使用 el-tabs 提供两种添加方式：
           扫描目录（批量导入本地视频）、导入 NFO（Kodi/Jellyfin/Emby 格式解析）。
           各子表单通过 emit 将数据传回本组件，由本组件统一调用后端 API 创建影片记录。
           支持 v-model 双向绑定控制对话框的显示/隐藏。
-->
<template>
  <!-- 添加影片对话框主体 -->
  <el-dialog v-model="show" title="添加影片" width="820px" @close="onClose" destroy-on-close>
    <!-- 选项卡区域：两种添加方式 -->
    <el-tabs v-model="tab">
      <!-- 扫描目录选项卡：扫描本地文件夹批量导入 -->
      <el-tab-pane label="扫描目录" name="dir">
        <ScanDirForm @selected="onScanned" />
      </el-tab-pane>
      <!-- 导入 NFO 选项卡：从 NFO/XML 文件解析元数据 -->
      <el-tab-pane label="导入 NFO" name="nfo">
        <NfoForm @selected="onNfoSelected" />
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<script setup>
// 引入 Vue 的响应式 API 和计算属性
import { ref, computed } from 'vue'
// 引入 Element Plus 的消息提示组件
import { ElMessage } from 'element-plus'
// 引入保留的添加方式子表单组件
import ScanDirForm from './AddMovieDialog/ScanDirForm.vue'
import NfoForm from './AddMovieDialog/NfoForm.vue'

// 组件 props 定义
// - modelValue: 控制对话框显示/隐藏（支持 v-model）
const props = defineProps({ modelValue: Boolean })

// 定义 emit 事件：
// - update:modelValue: 更新对话框显示状态（支持 v-model）
// - created: 影片创建成功时触发，参数为新影片 ID
const emit = defineEmits(['update:modelValue', 'created'])

// 对话框显示状态的计算属性：通过 get/set 实现 v-model 双向绑定
const show = computed({
  get() { return props.modelValue },
  set(v) { emit('update:modelValue', v) }
})

// 当前激活的选项卡名称，默认为"扫描目录"
const tab = ref('dir')

// 扫描目录导入完成后的回调
// ScanDirForm 在导入完成后 emit 空对象仅作通知，此处直接关闭对话框并通知父组件刷新
function onScanned() {
  emit('created')
  show.value = false
}

// NFO 解析结果选中后的回调
// NfoForm 在用户点击"使用第一个结果"时 emit 元数据对象，此处直接调用后端创建影片
function onNfoSelected(data) {
  onCreate(data)
}

// 对话框关闭回调：重置状态并通知父组件关闭
// 触发时机：用户关闭对话框时
function onClose() {
  tab.value = 'dir'
  emit('update:modelValue', false)
}

// 创建影片的回调：调用后端 API 创建影片记录
// 参数 data: 影片元数据对象
async function onCreate(data) {
  if (!window.api) return
  // 调用后端 API 创建影片
  const r = await window.api.createMovie(data)
  if (r.ok) {
    ElMessage.success('添加成功！')
    // 通知父组件影片已创建，传递新影片 ID
    emit('created', r.id)
    show.value = false
  } else {
    ElMessage.error('添加失败：' + r.error)
  }
}
</script>
