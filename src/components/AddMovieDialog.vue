<!--
  文件名：AddMovieDialog.vue
  所属模块：公共组件 / 添加影片对话框
  功能描述：添加影片的对话框容器组件，使用 el-tabs 提供五种添加方式：
           在线刮削、手动添加、扫描目录、选择单个视频、导入 NFO。
           各子表单通过 emit 将数据传回本组件，由本组件统一调用后端 API 创建影片记录。
           支持 v-model 双向绑定控制对话框的显示/隐藏。
-->
<template>
  <!-- 添加影片对话框主体 -->
  <el-dialog v-model="show" title="添加影片" width="820px" @close="onClose" destroy-on-close>
    <!-- 选项卡区域：五种添加方式 -->
    <el-tabs v-model="tab">
      <!-- 在线刮削选项卡：输入番号自动从网站获取元数据 -->
      <el-tab-pane label="在线刮削" name="scrape">
        <ScrapeForm @selected="onSelected" @create="onScrapeCreate" />
      </el-tab-pane>
      <!-- 手动添加选项卡：手动填写影片元数据表单 -->
      <el-tab-pane label="手动添加" name="manual">
        <ManualForm :initial="current" @submit="onCreate" />
      </el-tab-pane>
      <!-- 扫描目录选项卡：扫描本地文件夹批量导入 -->
      <el-tab-pane label="扫描目录" name="dir">
        <ScanDirForm @selected="onSelected" />
      </el-tab-pane>
      <!-- 选择单个视频选项卡：选择单个视频文件导入 -->
      <el-tab-pane label="选择单个视频" name="single">
        <SingleForm @selected="onSelected" />
      </el-tab-pane>
      <!-- 导入 NFO 选项卡：从 NFO/XML 文件解析元数据 -->
      <el-tab-pane label="导入 NFO" name="nfo">
        <NfoForm @selected="onSelected" />
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<script setup>
// 引入 Vue 的响应式 API 和计算属性
import { ref, computed } from 'vue'
// 引入 Element Plus 的消息提示组件
import { ElMessage } from 'element-plus'
// 引入各添加方式的子表单组件
import ManualForm from './AddMovieDialog/ManualForm.vue'
import ScanDirForm from './AddMovieDialog/ScanDirForm.vue'
import SingleForm from './AddMovieDialog/SingleForm.vue'
import NfoForm from './AddMovieDialog/NfoForm.vue'
import ScrapeForm from './AddMovieDialog/ScrapeForm.vue'

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

// 当前激活的选项卡名称，默认为"在线刮削"
const tab = ref('scrape')
// 当前传递给手动表单的初始数据（来自其他表单的选择结果）
const current = ref({})

// 子表单选择数据后的回调：将数据填入手动表单并切换到手动添加选项卡
// 参数 data: 子表单返回的影片元数据对象
// 触发时机：ScrapeForm/ScanDirForm/SingleForm/NfoForm 的 selected 事件
function onSelected(data) {
  current.value = data
  tab.value = 'manual'
}

// 对话框关闭回调：重置状态并通知父组件关闭
// 触发时机：用户关闭对话框时
function onClose() {
  current.value = {}
  tab.value = 'scrape'
  emit('update:modelValue', false)
}

// 创建影片的回调：调用后端 API 创建影片记录
// 参数 data: 影片元数据对象
// 触发时机：ManualForm 的 submit 事件
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

// 在线刮削直接保存成功的回调
// 参数 id: 新创建的影片 ID
// 触发时机：ScrapeForm 的 create 事件（用户点击"直接保存"）
function onScrapeCreate(id) {
  emit('created', id)
  show.value = false
}
</script>
