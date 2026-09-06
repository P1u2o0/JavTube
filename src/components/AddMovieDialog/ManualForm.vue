<!--
  文件名：ManualForm.vue
  所属模块：公共组件 / 添加影片对话框子表单
  功能描述：手动填写影片元数据的表单组件，同时被添加影片和编辑影片对话框复用。
           包含番号、标题、女优、发行日期、标签、视频路径、简介等字段。
           通过 props.initial 接收初始数据进行表单回填，通过 emit('submit') 提交表单数据。
-->
<template>
  <!-- 影片元数据表单 -->
  <el-form :model="d" label-width="100px" size="default">
    <!-- 番号输入框 -->
    <el-form-item label="番号"><el-input v-model="d.ph" placeholder="例: IPX-001" /></el-form-item>
    <!-- 标题输入框 -->
    <el-form-item label="标题"><el-input v-model="d.pm" /></el-form-item>
    <!-- 女优输入框（多个用中文逗号分隔） -->
    <el-form-item label="女优"><el-input v-model="d.yid" placeholder="多个用中文逗号分隔：，" /></el-form-item>
    <!-- 发行日期选择器 -->
    <el-form-item label="发行日期">
      <el-date-picker v-model="d._fxrq" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
    </el-form-item>
    <!-- 标签输入框（多行文本，中文逗号分隔） -->
    <el-form-item label="标签">
      <el-input
        v-model="d.bq"
        type="textarea"
        :rows="2"
        placeholder="请用中文逗号分隔：标签1，标签2"
      />
    </el-form-item>
    <!-- 视频路径输入框（带浏览按钮） -->
    <el-form-item label="视频路径">
      <el-input v-model="d.py" placeholder="本地视频文件绝对路径">
        <template #append>
          <el-button @click="chooseVideo">浏览</el-button>
        </template>
      </el-input>
    </el-form-item>
    <!-- 简介输入框（多行文本） -->
    <el-form-item label="简介">
      <el-input v-model="d.jt" type="textarea" :rows="3" />
    </el-form-item>
    <!-- 保存按钮区域 -->
    <div style="text-align: right;">
      <el-button type="primary" @click="onSubmit">保存</el-button>
    </div>
  </el-form>
</template>

<script setup>
// 引入 Vue 的响应式 API 和侦听器
import { reactive, watch } from 'vue'

// 组件 props 定义
// - initial: 表单初始数据对象（用于编辑时回填），默认为空对象
const props = defineProps({ initial: { type: Object, default: () => ({}) } })

// 定义 emit 事件：
// - submit: 表单提交时触发，参数为表单数据对象（纯值，去除内部字段）
const emit = defineEmits(['submit'])

// 表单数据对象（reactive 响应式）
// 包含影片的所有元数据字段，合并初始数据
const d = reactive({
  ph: '', pm: '', yid: '', fxrq: '', fl: '全部',  // 基本信息
  pfs: 0, yz: 0, zb: 'A', tix: '正常',            // 评分和属性
  bq: '', py: '', cover: '', jt: '',               // 标签、路径、封面、简介
  // 布尔标记字段（默认值均为 'n'）
  zz: 'n', lc: 'n', pj: 'n', dt: 'n', dm: 'n', vr: 'n', sd: 'n', hj: 'n',
  // 合并外部传入的初始数据
  ...props.initial
})

// 如果初始数据有发行日期，同步到日期选择器的绑定字段 _fxrq
if (props.initial?.fxrq) d._fxrq = props.initial.fxrq

// 侦听日期选择器值变化：同步到实际提交使用的 fxrq 字段
watch(() => d._fxrq, (v) => { if (v) d.fxrq = v })

// 选择视频文件的处理函数
// 调用后端 API 打开文件选择对话框，将选择的路径填入视频路径字段
async function chooseVideo() {
  if (window.api) {
    const p = await window.api.openVideoDialog()
    if (p) d.py = p
  }
}

// 表单提交处理函数
// 深拷贝表单数据，移除内部辅助字段 _fxrq，通过 emit 提交纯数据
// 触发时机：用户点击"保存"按钮
function onSubmit() {
  // 深拷贝表单数据为普通对象
  const plain = JSON.parse(JSON.stringify(d))
  // 移除日期选择器的辅助字段，不提交给后端
  delete plain._fxrq
  emit('submit', plain)
}
</script>
