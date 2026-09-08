<!--
  文件名：AddMovieDialog.vue
  所属模块：公共组件 / 添加影片对话框
  功能描述：添加影片的对话框容器组件，承载"扫描目录"（批量导入本地视频）表单。
           （原"导入 NFO"方式已于 2026-09-08 按用户要求移除，相关文件
            NfoForm.vue 与专属 IPC 通道一并删除。）
           子表单通过 emit 将完成事件传回本组件，通知父组件刷新列表。
           支持 v-model 双向绑定控制对话框的显示/隐藏。
-->
<template>
  <!-- 添加影片对话框主体 -->
  <el-dialog v-model="show" title="添加影片" width="820px" @close="onClose" destroy-on-close>
    <!-- 扫描目录表单：扫描本地文件夹批量导入 -->
    <ScanDirForm @selected="onScanned" />
  </el-dialog>
</template>

<script setup>
// 引入 Vue 的计算属性
import { computed } from 'vue'
// 引入扫描目录子表单组件
import ScanDirForm from './AddMovieDialog/ScanDirForm.vue'

// 组件 props 定义
// - modelValue: 控制对话框显示/隐藏（支持 v-model）
const props = defineProps({ modelValue: Boolean })

// 定义 emit 事件：
// - update:modelValue: 更新对话框显示状态（支持 v-model）
// - created: 影片导入完成时触发，通知父组件刷新列表
const emit = defineEmits(['update:modelValue', 'created'])

// 对话框显示状态的计算属性：通过 get/set 实现 v-model 双向绑定
const show = computed({
  get() { return props.modelValue },
  set(v) { emit('update:modelValue', v) }
})

// 扫描目录导入完成后的回调
// ScanDirForm 在导入完成后 emit 空对象仅作通知，此处直接关闭对话框并通知父组件刷新
function onScanned() {
  emit('created')
  show.value = false
}

// 对话框关闭回调：通知父组件关闭
// 触发时机：用户关闭对话框时
function onClose() {
  emit('update:modelValue', false)
}
</script>
