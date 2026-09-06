<!--
  文件名：ScrapeForm.vue
  所属模块：公共组件 / 添加影片对话框子表单
  功能描述：在线刮削影片元数据的表单组件。用户输入番号并选择数据源（自动选择/JAVDB/JAVBUS），
           调用后端 API 从网站抓取封面、标题、演员、标签等元数据。刮削结果可编辑后保存或直接保存。
           支持刮削结果预览（封面图片 + 详细信息表格）和错误提示。
-->
<template>
  <!-- 刮削表单主体 -->
  <div class="scrape-form">
    <!-- 说明文字 -->
    <p style="color: var(--muted); margin-top:0">
      输入番号自动从网站刮削元数据（封面、标题、演员、标签等）。
    </p>
    <!-- 输入区域：番号输入框 + 数据源选择 + 开始刮削按钮 -->
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:16px;">
      <!-- 番号输入框，回车触发刮削 -->
      <el-input v-model="ph" placeholder="例: IPX-001" style="width:220px" @keyup.enter="onScrape" />
      <!-- 数据源下拉选择 -->
      <el-select v-model="source" style="width:130px">
        <el-option label="自动选择" value="auto" />
        <el-option label="JAVDB" value="JAVDB" />
        <el-option label="JAVBUS" value="JAVBUS" />
      </el-select>
      <!-- 开始刮削按钮：加载中时显示 loading 状态 -->
      <el-button type="primary" :loading="loading" @click="onScrape">开始刮削</el-button>
    </div>

    <!-- 加载中提示 -->
    <div v-if="loading" class="loading-tip">
      <el-icon class="is-loading"><Loading /></el-icon>
      正在刮削，请稍候...
    </div>

    <!-- 刮削结果展示区域：有结果且未加载时显示 -->
    <div v-if="result && !loading" class="result">
      <!-- 成功提示（显示数据来源） -->
      <el-alert :title="`刮削成功（来源: ${result.source}）`" type="success" :closable="false" show-icon style="margin-bottom:14px" />
      <!-- 结果主体：封面预览 + 信息表格 -->
      <div class="result-body">
        <!-- 封面预览图 -->
        <div class="cover-preview" v-if="result.cover">
          <img :src="coverUrl" @error="$event.target.style.display='none'" />
        </div>
        <!-- 详细信息描述列表 -->
        <div class="result-info">
          <el-descriptions :column="2" size="small" border>
            <el-descriptions-item label="番号">{{ result.ph || '—' }}</el-descriptions-item>
            <el-descriptions-item label="分类">{{ result.fl || '—' }}</el-descriptions-item>
            <el-descriptions-item label="标题" :span="2">{{ result.pm || '—' }}</el-descriptions-item>
            <el-descriptions-item label="演员">{{ result.yy || '—' }}</el-descriptions-item>
            <el-descriptions-item label="发行日期">{{ result.fxrq || '—' }}</el-descriptions-item>
            <el-descriptions-item label="导演">{{ result.dy || '—' }}</el-descriptions-item>
            <el-descriptions-item label="片商">{{ result.ps || '—' }}</el-descriptions-item>
            <el-descriptions-item label="发行商">{{ result.fx || '—' }}</el-descriptions-item>
            <el-descriptions-item label="系列">{{ result.xl || '—' }}</el-descriptions-item>
            <el-descriptions-item label="标签" :span="2">{{ result.bq || '—' }}</el-descriptions-item>
          </el-descriptions>
        </div>
      </div>
      <!-- 结果操作按钮区域 -->
      <div style="margin-top:14px; display:flex; gap:8px; justify-content:flex-end;">
        <!-- 重新刮削：清空结果重新输入 -->
        <el-button @click="onReset">重新刮削</el-button>
        <!-- 编辑后保存：将结果传给手动表单进行编辑 -->
        <el-button type="primary" @click="onEdit">编辑后保存</el-button>
        <!-- 直接保存：不编辑直接创建影片记录 -->
        <el-button type="success" @click="onSave">直接保存</el-button>
      </div>
    </div>

    <!-- 错误提示区域：有错误且未加载时显示 -->
    <div v-if="error && !loading" class="error-tip">
      <el-alert :title="error" type="error" :closable="false" show-icon />
    </div>
  </div>
</template>

<script setup>
// 引入 Vue 的响应式 API 和计算属性
import { ref, computed } from 'vue'
// 引入 Element Plus 的消息提示组件
import { ElMessage } from 'element-plus'
// 引入 Element Plus 的加载图标组件
import { Loading } from '@element-plus/icons-vue'
// 引入封面解析工具函数
import { resolveCover } from '@/utils/global'

// 定义 emit 事件：
// - selected: 选择"编辑后保存"时触发，参数为刮削结果对象，父组件将其填入手动表单
// - create: 选择"直接保存"且创建成功时触发，参数为新影片 ID
const emit = defineEmits(['selected', 'create'])

// 番号输入值
const ph = ref('')
// 数据源选择值，默认自动选择
const source = ref('auto')
// 是否正在刮削加载中
const loading = ref(false)
// 刮削结果数据对象
const result = ref(null)
// 错误信息
const error = ref('')

// 封面 URL 计算属性：有结果时解析封面路径
const coverUrl = computed(() => result.value ? resolveCover(result.value.cover) : '')

// 开始刮削的处理函数
// 验证输入后调用后端 API 从网站获取元数据
// 触发时机：用户点击"开始刮削"按钮或输入框回车
async function onScrape() {
  // 验证番号不为空
  if (!ph.value.trim()) return ElMessage.warning('请输入番号')
  if (!window.api) return ElMessage.error('API 不可用')
  // 设置加载状态，清空之前的结果和错误
  loading.value = true
  result.value = null
  error.value = ''
  try {
    // 调用后端 API 执行刮削
    const r = await window.api.scrapeMovie(ph.value.trim(), source.value)
    if (r.ok) {
      result.value = r.data
    } else {
      error.value = r.error || '刮削失败'
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

// 重新刮削的处理函数：清空结果、错误和番号输入
// 触发时机：用户点击"重新刮削"按钮
function onReset() {
  result.value = null
  error.value = ''
  ph.value = ''
}

// 编辑后保存的处理函数：将刮削结果传给父组件，切换到手动编辑表单
// 触发时机：用户点击"编辑后保存"按钮
function onEdit() {
  if (!result.value) return
  emit('selected', { ...result.value })
}

// 直接保存的处理函数：调用后端 API 直接创建影片记录
// 触发时机：用户点击"直接保存"按钮
async function onSave() {
  if (!result.value || !window.api) return
  // 调用后端 API 创建影片
  const r = await window.api.createMovie({ ...result.value })
  if (r.ok) {
    ElMessage.success('添加成功！')
    // 通知父组件影片已创建，传递新影片 ID
    emit('create', r.id)
  } else {
    ElMessage.error('添加失败：' + r.error)
  }
}
</script>

<style scoped>
/* 刮削表单主体最小高度 */
.scrape-form { min-height: 200px; }
/* 加载中提示样式 */
.loading-tip { text-align: center; padding: 40px 0; color: var(--muted); }
/* 加载图标旋转动画 */
.loading-tip .is-loading { animation: rotate 1.5s linear infinite; }
/* 旋转动画关键帧 */
@keyframes rotate { to { transform: rotate(360deg); } }
/* 结果区域 */
.result { margin-top: 10px; }
/* 结果主体：封面和信息表格横向排列 */
.result-body { display: flex; gap: 16px; }
/* 封面预览容器：2:3 宽高比 */
.cover-preview {
  width: 160px; flex-shrink: 0;
  aspect-ratio: 2/3;
  border: 1px solid var(--border); border-radius: var(--r-sm);
  overflow: hidden; background: var(--surface-2);
}
/* 封面预览图片 */
.cover-preview img { width: 100%; height: 100%; object-fit: cover; }
/* 结果信息区域：自适应填充剩余空间 */
.result-info { flex: 1; min-width: 0; }
/* 错误提示区域 */
.error-tip { margin-top: 10px; }
</style>
