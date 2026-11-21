<!--
  文件名：ManualForm.vue
  所属模块：公共组件 / 添加影片对话框子表单
  功能描述：手动填写影片元数据的表单组件，同时被添加影片和编辑影片对话框复用。
           包含番号、标题、女优、发行日期、标签、视频路径、简介等字段。
           通过 props.initial 接收初始数据进行表单回填，通过 emit('submit') 提交表单数据。
-->
<template>
  <!-- 影片元数据表单（2026-11-21 审计：补 rules/ref/提交锁，番号与路径必填） -->
  <el-form ref="formRef" :model="d" :rules="rules" label-width="100px" size="default" @submit.prevent>
    <!-- 番号输入框 -->
    <el-form-item label="番号" prop="ph"><el-input v-model="d.ph" placeholder="例: IPX-001" /></el-form-item>
    <!-- 标题（自适应高度多行文本，过长自动换行） -->
    <el-form-item label="标题">
      <el-input v-model="d.pm" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" placeholder="影片标题" />
    </el-form-item>
    <!-- 女优（可多个，自适应高度多行文本，过长自动换行） -->
    <el-form-item label="女优">
      <el-input v-model="d.yid" type="textarea" :autosize="{ minRows: 1, maxRows: 3 }" placeholder="多个用中文逗号分隔：，" />
    </el-form-item>
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
    <!-- 视频路径：完整胶囊输入框 + 独立胶囊按钮并排（与设置页播放器路径一致） -->
    <el-form-item label="视频路径" prop="py">
      <div class="path-row">
        <el-input v-model="d.py" placeholder="本地视频文件绝对路径" class="path-input" />
        <el-button :loading="picking" :disabled="picking" @click="chooseVideo">浏览</el-button>
      </div>
    </el-form-item>
    <!-- 简介输入框（多行文本） -->
    <el-form-item label="简介">
      <el-input v-model="d.jt" type="textarea" :rows="3" />
    </el-form-item>
    <!-- 底部操作区（2026-11-21 审计）：与其它弹窗统一「取消 + 主操作」右对齐 -->
    <div class="form-actions">
      <el-button :disabled="submitting" @click="onCancel">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="submitting" @click="onSubmit">保存</el-button>
    </div>
  </el-form>
</template>

<script setup>
// 引入 Vue 的响应式 API 和侦听器
import { reactive, ref, watch } from 'vue'
// 引入消息提示：文件选择失败时的可见反馈
import { ElMessage } from 'element-plus'

// 组件 props 定义
// - initial: 表单初始数据对象（用于编辑时回填），默认为空对象
const props = defineProps({ initial: { type: Object, default: () => ({}) } })

// 定义 emit 事件：
// - submit: 表单提交时触发，参数为表单数据对象（纯值，去除内部字段）
// - cancel: 取消时触发，由父级关闭弹窗
const emit = defineEmits(['submit', 'cancel'])

// 表单引用与提交锁（2026-11-21 审计）：此前无 rules、无 ref，番号可留空/改重；
// 保存按钮也没有 loading，连点会重复提交。
const formRef = ref(null)
const submitting = ref(false)
const picking = ref(false)
const rules = {
  ph: [
    { required: true, message: '请填写番号', trigger: 'blur' },
    { pattern: /^[A-Za-z0-9][A-Za-z0-9_.-]{1,31}$/, message: '番号只能包含字母、数字、连字符，2~32 位', trigger: 'blur' }
  ],
  py: [{ required: true, message: '请选择或填写视频路径', trigger: 'blur' }]
}

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

// 侦听日期选择器值变化：同步到实际提交使用的 fxrq 字段。
// 注意必须把「清空」也同步过去（v 为空时写空串）—— 原实现 `if (v) d.fxrq = v` 会保留旧值，
// 用户删掉日期后提交仍写入原日期，界面却提示「保存成功」（2026-09-28 审计）
watch(() => d._fxrq, (v) => { d.fxrq = v || '' })

// 选择视频文件的处理函数
// 调用后端 API 打开文件选择对话框，将选择的路径填入视频路径字段
async function chooseVideo() {
  if (!window.api || picking.value) return
  picking.value = true
  try {
    const p = await window.api.openVideoDialog()
    if (typeof p === 'string' && p) d.py = p
  } catch (e) {
    ElMessage.error('打开文件选择器失败：' + ((e && e.message) || e))
  } finally {
    picking.value = false
  }
}

// 表单提交处理函数
// 先跑校验；通过后深拷贝表单数据、移除内部辅助字段 _fxrq，再 emit 提交
// 触发时机：用户点击"保存"按钮
async function onSubmit() {
  if (submitting.value) return
  // 校验失败会 reject：错误提示由 el-form 在字段下方展示，这里直接返回
  try { await formRef.value?.validate() } catch { return }
  submitting.value = true
  const plain = JSON.parse(JSON.stringify(d))
  delete plain._fxrq
  emit('submit', plain)
  // 父级成功后销毁弹窗；失败时不关窗，给 800ms 短锁防连点重发
  setTimeout(() => { submitting.value = false }, 800)
}

function onCancel() { emit('cancel') }
</script>

<style scoped>
/* 视频路径行：完整胶囊输入框 + 独立胶囊按钮并排（与设置页播放器路径一致） */
.path-row { display: flex; gap: 10px; width: 100%; }
.path-input { flex: 1; }
/* 底部操作区：右对齐「取消 + 保存」 */
.form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
</style>
