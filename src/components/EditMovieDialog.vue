<!--
  文件名：EditMovieDialog.vue
  所属模块：公共组件 / 编辑影片对话框
  功能描述：编辑已有影片元数据的对话框组件，复用 ManualForm 表单组件进行数据编辑。
           通过 props 接收待编辑的影片数据，通过 watch 监听影片变化并初始化表单。
           保存时调用后端 API 更新影片记录，通过 emit 通知父组件保存完成。
           支持 v-model 双向绑定控制对话框的显示/隐藏。
-->
<template>
  <!-- 编辑影片对话框主体 -->
  <el-dialog v-model="show" title="编辑影片" width="820px" @close="onClose" destroy-on-close>
    <!-- 复用手动添加表单组件进行编辑 -->
    <ManualForm :initial="movieData" @submit="onSave" />
  </el-dialog>
</template>

<script setup>
// 引入 Vue 的响应式 API、计算属性和侦听器
import { ref, computed, watch } from 'vue'
// 引入 Element Plus 的消息提示组件
import { ElMessage } from 'element-plus'
// 引入手动添加表单组件（编辑复用此表单）
import ManualForm from './AddMovieDialog/ManualForm.vue'

// 组件 props 定义
// - modelValue: 控制对话框显示/隐藏（支持 v-model）
// - movie: 待编辑的影片数据对象
const props = defineProps({
  modelValue: Boolean,
  movie: Object
})

// 定义 emit 事件：
// - update:modelValue: 更新对话框显示状态（支持 v-model）
// - saved: 影片保存成功后触发，通知父组件刷新列表
const emit = defineEmits(['update:modelValue', 'saved'])

// 对话框显示状态的计算属性：通过 get/set 实现 v-model 双向绑定
const show = computed({
  get() { return props.modelValue },
  set(v) { emit('update:modelValue', v) }
})

// 传递给 ManualForm 的影片数据（浅拷贝，避免直接修改原始数据）
const movieData = ref({})

// 侦听 props.movie 变化：影片数据更新时同步到表单的初始数据
// immediate: true 表示组件初始化时也立即执行一次
watch(() => props.movie, (m) => {
  if (m) movieData.value = { ...m }
}, { immediate: true })

// 对话框关闭回调：通知父组件关闭对话框
// 触发时机：用户关闭对话框时
function onClose() { emit('update:modelValue', false) }

// 保存影片修改的回调：调用后端 API 更新影片记录
// 参数 data: 编辑后的影片元数据对象
// 触发时机：ManualForm 的 submit 事件
async function onSave(data) {
  if (!window.api || !props.movie?.id) return
  // 调用后端 API 更新指定 ID 的影片
  const r = await window.api.updateMovie(props.movie.id, data)
  if (r.ok) {
    ElMessage.success('修改已保存')
    // 通知父组件影片已保存，可刷新列表
    emit('saved')
    show.value = false
  } else {
    ElMessage.error('保存失败：' + r.error)
  }
}
</script>
