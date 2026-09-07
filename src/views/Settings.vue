<!--
  ============================================================
  文件名：Settings.vue
  所属模块：视图 / 设置页
  功能描述：应用程序设置页面。包含四个标签页：
           1. 基础 - 播放器路径、每页数量、每行数量、点击动作
           2. 标签类别（9大类） - 自定义分类名称与标签
           3. 辅助 - 数据库备份、恢复、清空
           4. 关于 - 应用信息
  ============================================================
-->
<template>
  <div class="settings-page">
    <div class="page-head"><h3>设置</h3></div>
    <!-- 标签页容器 -->
    <el-tabs v-model="tab">
      <!-- ============ 基础设置 ============ -->
      <el-tab-pane label="基础" name="basic">
        <el-form label-width="160px" style="max-width: 760px;">
          <!-- 播放器路径设置 -->
          <el-form-item label="播放器路径">
            <el-input v-model="st.player_path" placeholder="留空使用系统默认播放器">
              <template #append><el-button @click="choosePlayer">选择</el-button></template>
            </el-input>
          </el-form-item>
          <!-- 每页显示数量 -->
          <el-form-item label="每页显示数量">
            <el-input-number v-model="pageSizeN" :min="10" :max="200" :step="10" />
          </el-form-item>
          <!-- 每行显示数量（滑块控制） -->
          <el-form-item label="每行显示数量">
            <div class="slider-row">
              <el-slider v-model="colsPerRowN" :min="3" :max="8" :step="1" :marks="{3:'3',4:'4',5:'5',6:'6',7:'7',8:'8'}" style="max-width: 300px;" />
              <span class="slider-value">{{ colsPerRowN }}</span>
            </div>
            <div style="margin-top:6px;color:var(--muted);font-size:12px;">控制首页海报墙每行显示的影片数</div>
          </el-form-item>
          <!-- 点击卡片默认动作 -->
          <el-form-item label="点击卡片动作">
            <el-select v-model="st.click_action">
              <el-option label="进入详情页" value="detail" />
              <el-option label="直接播放" value="play" />
            </el-select>
          </el-form-item>
          <!-- 保存与恢复按钮 -->
          <el-form-item>
            <el-button type="primary" @click="save">保存设置</el-button>
            <el-button @click="load" style="margin-left: 10px;">恢复</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- ============ 标签类别配置 ============ -->
      <el-tab-pane label="标签类别（9大类）" name="cats">
        <p style="color: var(--muted); margin-bottom: 16px;">支持自定义每个类别的显示名与所有标签。标签用<b>中文逗号 ，</b>分隔。空类别不显示在筛选区。</p>
        <!-- 类别编辑表格 -->
        <el-table :data="categories" size="default" border style="margin-bottom: 20px;">
          <!-- 序号列 -->
          <el-table-column label="#" width="60" align="center">
            <template #default="{ $index }">{{ $index + 1 }}</template>
          </el-table-column>
          <!-- 类别名称列 -->
          <el-table-column label="类别名称" min-width="150">
            <template #default="{ row }">
              <el-input v-model="row.cat" size="small" placeholder="类别名：主题" />
            </template>
          </el-table-column>
          <!-- 标签列 -->
          <el-table-column label="所有标签（中文逗号分隔）">
            <template #default="{ row }">
              <el-input v-model="row._tags" type="textarea" :rows="2" size="small" placeholder="标签1，标签2，标签3" />
            </template>
          </el-table-column>
        </el-table>
        <div>
          <el-button type="primary" @click="saveCats">保存类别配置</el-button>
          <el-button @click="loadCats" style="margin-left: 10px;">恢复</el-button>
        </div>
      </el-tab-pane>

      <!-- ============ 辅助工具（数据库管理） ============ -->
      <el-tab-pane label="辅助" name="aux">
        <el-card shadow="never" style="margin-bottom: 16px;">
          <template #header>
            <span style="display:inline-flex; align-items:center; gap:6px;">
              <AppIcon name="database" :size="16" />数据库
            </span>
          </template>
          <div style="display:flex; gap: 10px; flex-wrap: wrap;">
            <!-- 备份按钮 -->
            <el-button @click="backupDb">
              <AppIcon name="import" :size="15" style="margin-right:5px" />备份数据库到…
            </el-button>
            <!-- 恢复按钮 -->
            <el-button @click="restoreDb">
              <AppIcon name="reset" :size="15" style="margin-right:5px" />从备份文件恢复…
            </el-button>
            <!-- 清空按钮（危险操作） -->
            <el-button type="danger" @click="clearDb">
              <AppIcon name="trash" :size="15" style="margin-right:5px" />清空所有数据
            </el-button>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- ============ 关于信息 ============ -->
      <el-tab-pane label="关于" name="about">
        <div class="about-box">
          <!-- 应用图标徽章 -->
          <div class="about-badge"><img src="/app-icon.png" alt="JavTube" /></div>
          <h2 style="margin: 0 0 8px;">JavTube</h2>
          <p style="margin: 4px 0; color: var(--text-2);">版本：v1.0.0</p>
          <p style="margin: 4px 0; color: var(--text-2);">框架：Electron 30 + Vue 3 + Vite 5 + sql.js</p>
          <p style="margin: 4px 0; color: var(--muted);">2026 · 纯本地管理，数据仅保存在本软件 data 目录内，不上传任何内容。</p>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useMoviesStore } from '@/store/movies'
import AppIcon from '@/components/AppIcon.vue'

// Pinia store 实例（用于更新标签分类配置）
const store = useMoviesStore()

// 当前激活的标签页
const tab = ref('basic')
// 基础设置表单（响应式）
const st = reactive({ player_path: '', click_action: 'detail', page_size: '20', cols_per_row: '5', cover_dir: 'covers' })
// 每页显示数量（数字类型，绑定到 input-number）
const pageSizeN = ref(20)
// 每行显示数量（数字类型，绑定到 slider）
const colsPerRowN = ref(5)
// 标签类别配置数组（9大类）
const categories = ref([])

/**
 * 加载设置
 * 功能：从数据库读取设置项，填充表单
 */
async function load() {
  if (!window.api) return
  const r = await window.api.getSettings()
  if (r.ok) {
    Object.assign(st, r.data || {})
    pageSizeN.value = Number(st.page_size || 20)
    colsPerRowN.value = Number(st.cols_per_row || 5)
  }
}

/**
 * 保存设置
 * 功能：将表单值写入数据库，刷新页面使设置生效
 */
async function save() {
  if (!window.api) return
  st.page_size = String(pageSizeN.value)
  st.cols_per_row = String(colsPerRowN.value)
  // 逐个写入设置项
  for (const [k, v] of Object.entries(st)) {
    await window.api.updateSetting(k, String(v ?? ''))
  }
  // 刷新 pinia 里的 pageSize 等
  location.reload()
  ElMessage.success('设置已保存')
}

/**
 * 选择播放器可执行文件
 */
async function choosePlayer() {
  if (!window.api) return
  const p = await window.api.openFileDialog()
  if (p) st.player_path = p
}

/**
 * 加载标签类别配置
 * 功能：从数据库读取 9 大标签分类，不足 9 类时补齐空类别
 */
async function loadCats() {
  if (!window.api) return
  const r = await window.api.getTagCategories()
  if (r.ok) {
    const arr = r.data || []
    categories.value = arr.map(c => ({ cat: c.cat, tags: c.tags || [], _tags: (c.tags || []).join('，') }))
    // 不足 9 类补齐
    while (categories.value.length < 9) categories.value.push({ cat: `C${categories.value.length+1}`, tags: [], _tags: '' })
  }
}

/**
 * 保存标签类别配置
 * 功能：将编辑后的类别配置写入数据库，同步更新 store
 */
async function saveCats() {
  if (!window.api) return
  // 将文本区域内容按中文逗号分割为标签数组
  const arr = categories.value.map(c => ({
    cat: c.cat,
    tags: (c._tags || '').split(/[，,]/).map(s => s.trim()).filter(Boolean)
  }))
  // 不足 9 类补齐
  while (arr.length < 9) arr.push({ cat: `C${arr.length+1}`, tags: [] })
  const r = await window.api.saveTagCategories(arr.slice(0, 9))
  if (r.ok) {
    store.categories = arr.slice(0, 9)
    await store.loadAllDbTags()
    ElMessage.success('标签类别已保存，已实时生效')
  }
  else ElMessage.error(r.error)
}

/**
 * 备份数据库到指定路径
 */
async function backupDb() {
  if (!window.api) return
  const target = await window.api.saveDbDialog()
  if (!target) return
  const r = await window.api.backupDb(target)
  if (r.ok) ElMessage.success('备份成功：' + target)
  else ElMessage.error('备份失败：' + r.error)
}

/**
 * 从备份文件恢复数据库（带二次确认）
 */
async function restoreDb() {
  if (!window.api) return
  try {
    await ElMessageBox.confirm('恢复将覆盖当前所有数据，确定？', '提示', { type: 'warning' })
    const src = await window.api.openDbDialog()
    if (!src) return
    const r = await window.api.restoreDb(src)
    if (r.ok) {
      ElMessage.success('恢复成功：' + (r.info || '请重启软件'))
    } else ElMessage.error(r.error)
  } catch {}
}

/**
 * 清空所有数据（带双重确认，危险操作）
 */
async function clearDb() {
  try {
    await ElMessageBox.confirm('此操作将删除所有影片、女优、网址数据，确定？', '危险操作', { type: 'error' })
    await ElMessageBox.confirm('再次确认：真的要清空所有数据？请先备份！', '二次确认', { type: 'error' })
    const r = await window.api.clearDb()
    if (r.ok) { ElMessage.success('已清空'); location.reload() }
  } catch {}
}

/**
 * 组件挂载时：加载基础设置和标签类别配置
 */
onMounted(async () => { await load(); await loadCats() })
</script>

<style scoped>
/* 滑块行容器：水平排列滑块与数值 */
.slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 350px;
}
/* 滑块当前值显示 */
.slider-value {
  min-width: 24px;
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  color: var(--primary);
}
/* 关于页布局 */
.about-box { padding: 10px 0; }
/* 关于页图标徽章：LOGO 为宽幅（图标+文字），用 contain 完整显示，不被裁剪 */
.about-badge {
  display: inline-flex;
  height: 48px;
  padding: 0 16px;
  align-items: center;
  border-radius: var(--r-md);
  box-shadow: var(--sh-2);
  margin-bottom: 14px;
  background: var(--surface);
  border: 1px solid var(--border);
}
.about-badge img { height: 34px; width: auto; object-fit: contain; display: block; }
</style>
