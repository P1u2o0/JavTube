<!--
  ============================================================
  文件名：Settings.vue
  所属模块：视图 / 设置页
  功能描述：应用程序设置页面。2026-09-09 按用户需求重组为五个标签页：
           1. 基础设置 - 播放器路径、点击卡片动作、每行/每页显示数量
           2. 标签设置 - 标签类别（行式布局，加号添加，空类别单行）
                        + 标签映射（原标签映射为新标签，刮削后自动替换）
           3. 刮削设置 - 来源、预览图下载（开关/数量）、想看看过评分、本机代理
           4. 辅助设置 - 数据库备份、恢复、清空
           5. 关于 - 应用信息
           所有设置说明文字统一位于选项下一行并与选项左对齐（.form-tip）。
  ============================================================
-->
<template>
  <div class="settings-page">
    <div class="page-head"><h3>设置</h3></div>
    <!-- 标签页容器 -->
    <el-tabs v-model="tab">
      <!-- ============ 基础设置 ============ -->
      <el-tab-pane label="基础设置" name="basic">
        <el-form label-width="160px" style="max-width: 760px;">
          <!-- 播放器路径设置（输入框与选择按钮并排，均为独立胶囊样式） -->
          <el-form-item label="播放器路径">
            <div class="player-row">
              <el-input v-model="st.player_path" placeholder="留空使用系统默认播放器" class="player-input" />
              <el-button @click="choosePlayer">选择</el-button>
            </div>
            <span class="form-tip">填入本地播放器的可执行文件路径，播放影片时优先使用它打开</span>
          </el-form-item>
          <!-- 点击卡片默认动作 -->
          <el-form-item label="点击卡片动作">
            <el-select v-model="st.click_action" style="max-width: 260px;">
              <el-option label="进入详情页" value="detail" />
              <el-option label="直接播放" value="play" />
            </el-select>
            <span class="form-tip">在片库中单击影片卡片时执行的动作（详情页内播放不受影响）</span>
          </el-form-item>
          <!-- 每行显示数量（胶囊数字输入，与每页显示数量样式一致） -->
          <el-form-item label="每行显示数量">
            <el-input-number v-model="colsPerRowN" :min="3" :max="8" :step="1" />
            <span class="form-tip">片库海报墙每一行显示的影片卡片数（3 - 8）</span>
          </el-form-item>
          <!-- 每页显示数量 -->
          <el-form-item label="每页显示数量">
            <el-input-number v-model="pageSizeN" :min="10" :max="200" :step="10" />
            <span class="form-tip">片库列表每页加载的影片数量（10 - 200）</span>
          </el-form-item>
          <!-- 保存与恢复按钮 -->
          <el-form-item>
            <el-button type="primary" @click="save">保存设置</el-button>
            <el-button @click="load" style="margin-left: 10px;">恢复</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- ============ 标签设置 ============ -->
      <el-tab-pane label="标签设置" name="cats">
        <!-- 内容区缩进与表单控件列对齐（label-width 160px） -->
        <div class="sec-wrap">
          <!-- 标签类别 -->
          <div class="sec-head">
            <span class="sec-title">标签类别</span>
            <el-button class="add-btn" @click="addCat">
              <AppIcon name="plus" :size="14" style="margin-right:4px" />添加类别
            </el-button>
          </div>
          <span class="form-tip" style="margin-top:0">每个类别一行，类别内的标签用中文逗号「，」分隔；未添加标签的类别不会显示在片库筛选区</span>
          <div class="row-list">
            <div v-for="(row, idx) in catRows" :key="row._key" class="cat-row-item">
              <span class="row-idx">{{ idx + 1 }}</span>
              <el-input v-model="row.cat" placeholder="类别名（如：主题）" class="cat-name-input" />
              <el-input v-model="row.tags" placeholder="标签1，标签2，标签3" class="cat-tags-input" />
              <button class="row-del" title="删除该类别" @click="catRows.splice(idx, 1)">
                <AppIcon name="close" :size="14" />
              </button>
            </div>
          </div>

          <!-- 标签映射 -->
          <div class="sec-head" style="margin-top: 26px;">
            <span class="sec-title">标签映射</span>
            <el-button class="add-btn" @click="addMap">
              <AppIcon name="plus" :size="14" style="margin-right:4px" />添加映射
            </el-button>
          </div>
          <span class="form-tip" style="margin-top:0">刮削获得的标签若与左侧「原标签」相同，入库时自动替换为右侧「新标签」（新标签留空表示删除该标签），无需逐部手动修改</span>
          <div class="row-list">
            <div v-for="(row, idx) in mapRows" :key="row._key" class="map-row-item">
              <el-input v-model="row.from" placeholder="原标签（如：偶像术人）" class="map-input" />
              <span class="map-arrow">映射为</span>
              <el-input v-model="row.to" placeholder="新标签（如：偶像）" class="map-input" />
              <button class="row-del" title="删除该映射" @click="mapRows.splice(idx, 1)">
                <AppIcon name="close" :size="14" />
              </button>
            </div>
          </div>

          <div style="margin-top: 20px;">
            <el-button type="primary" @click="saveCats">保存标签设置</el-button>
            <el-button @click="loadCats" style="margin-left: 10px;">恢复</el-button>
          </div>
        </div>
      </el-tab-pane>

      <!-- ============ 刮削设置 ============ -->
      <el-tab-pane label="刮削设置" name="scrape">
        <el-form label-width="160px" style="max-width: 760px;">
          <!-- 刮削来源 -->
          <el-form-item label="刮削来源">
            <el-select v-model="st.scrape_source" style="max-width: 320px;">
              <el-option label="自动（JAVBUS 优先，JAVDB 兜底）" value="auto" />
              <el-option label="仅使用 JAVBUS" value="javbus" />
              <el-option label="仅使用 JAVDB" value="javdb" />
            </el-select>
            <span class="form-tip">自动模式下先刮 JAVBUS，失败自动换 JAVDB；指定来源失败不再兜底。详情页刮削按钮旁可临时切换</span>
          </el-form-item>
          <!-- 下载预览图 -->
          <el-form-item label="下载预览图">
            <el-switch v-model="st.scrape_previews" active-value="y" inactive-value="n" />
            <span class="form-tip">开启后刮削时自动下载影片预览图到本地预览图目录，详情页底部可浏览</span>
          </el-form-item>
          <!-- 预览图数量 -->
          <el-form-item label="预览图数量">
            <el-input-number v-model="previewCountN" :min="0" :max="50" :step="1" />
            <span class="form-tip">每次刮削最多下载几张预览图（0 = 全部下载）</span>
          </el-form-item>
          <!-- 想看/看过/评分 -->
          <el-form-item label="想看/看过/评分">
            <el-switch v-model="st.scrape_stats" active-value="y" inactive-value="n" />
            <span class="form-tip">刮削 JAVDB 时同时抓取想看人数、看过人数与评分，并在影片详情页展示</span>
          </el-form-item>
          <!-- 使用本机代理 -->
          <el-form-item label="使用本机代理">
            <el-switch v-model="st.proxy_enabled" active-value="y" inactive-value="n" />
            <span class="form-tip">访问 JAVDB 需要科学上网，开启后刮削请求走下方代理地址，保存后立即生效</span>
          </el-form-item>
          <!-- 代理地址 -->
          <el-form-item label="代理地址">
            <el-input v-model="st.proxy_url" placeholder="http://127.0.0.1:7890" style="max-width: 320px;" />
            <span class="form-tip">本机代理的 HTTP 地址，常用 Clash 默认端口 7890、v2rayN 默认 10809</span>
          </el-form-item>
          <!-- 保存按钮 -->
          <el-form-item>
            <el-button type="primary" @click="saveScrape">保存刮削设置</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- ============ 辅助设置（数据库管理） ============ -->
      <el-tab-pane label="辅助设置" name="aux">
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
          <p style="margin: 4px 0; color: var(--text-2);">版本：v1.1.0</p>
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
// 基础 + 刮削设置表单（响应式；分 tab 保存）
const st = reactive({
  player_path: '', click_action: 'detail', page_size: '20', cols_per_row: '5', cover_dir: 'covers',
  scrape_source: 'auto', scrape_previews: 'n', scrape_stats: 'y',
  proxy_enabled: 'n', proxy_url: 'http://127.0.0.1:7890'
})
// 每页显示数量（数字类型，绑定到 input-number）
const pageSizeN = ref(20)
// 每行显示数量（数字类型，绑定到 input-number）
const colsPerRowN = ref(5)
// 预览图下载数量（数字类型，0 = 全部；settings 中为字符串）
const previewCountN = ref(0)

// 标签类别行 / 标签映射行（_key 为渲染 key，自增避免复用错乱）
let keySeq = 0
const catRows = ref([])
const mapRows = ref([])

/**
 * 加载设置
 * 功能：从数据库读取设置项，填充基础/刮削表单，并加载标签类别与映射
 */
async function load() {
  if (!window.api) return
  const r = await window.api.getSettings()
  if (r.ok) {
    Object.assign(st, r.data || {})
    pageSizeN.value = Number(st.page_size || 20)
    colsPerRowN.value = Number(st.cols_per_row || 5)
    previewCountN.value = Number(st.preview_count || 0)
  }
  await loadCats()
}

/**
 * 加载标签类别与标签映射
 * 类别只显示「有标签」的行（未添加标签的类别不占位）；全部为空时给一行默认类别
 */
async function loadCats() {
  if (!window.api) return
  const r = await window.api.getTagCategories()
  if (r.ok) {
    const arr = r.data || []
    const used = arr
      .filter(c => (c.tags || []).length > 0)
      .map(c => ({ _key: ++keySeq, cat: c.cat, tags: (c.tags || []).join('，') }))
    catRows.value = used.length
      ? used
      : [{ _key: ++keySeq, cat: 'C1', tags: '' }]
  }
  await loadMapping()
}

/**
 * 加载标签映射规则（settings.tag_mapping 为 JSON 数组 [[原标签,新标签],...]）
 */
async function loadMapping() {
  if (!window.api) return
  const r = await window.api.getSettings()
  if (r.ok) {
    try {
      const arr = JSON.parse(r.data.tag_mapping || '[]')
      mapRows.value = (Array.isArray(arr) ? arr : [])
        .map(pair => ({
          _key: ++keySeq,
          from: Array.isArray(pair) ? (pair[0] || '') : '',
          to: Array.isArray(pair) ? (pair[1] || '') : ''
        }))
    } catch { mapRows.value = [] }
  }
  if (!mapRows.value.length) mapRows.value = [{ _key: ++keySeq, from: '', to: '' }]
}

/**
 * 添加一行标签类别（类别名自动避开现有名称）
 */
function addCat() {
  let i = catRows.value.length + 1
  let name = `C${i}`
  while (catRows.value.some(r => r.cat === name)) name = `C${++i}`
  catRows.value.push({ _key: ++keySeq, cat: name, tags: '' })
}

/**
 * 添加一行标签映射
 */
function addMap() {
  mapRows.value.push({ _key: ++keySeq, from: '', to: '' })
}

/**
 * 保存标签设置（类别 + 映射）
 * 类别行过滤掉类别名为空的行，自动补齐至 9 大类（片库筛选按 9 类工作）
 */
async function saveCats() {
  if (!window.api) return
  const cats = catRows.value
    .map(r => ({ cat: (r.cat || '').trim(), tags: (r.tags || '').split(/[，,]/).map(s => s.trim()).filter(Boolean) }))
    .filter(c => c.cat)
  let i = 1
  while (cats.length < 9) {
    const name = `C${i++}`
    if (!cats.some(c => c.cat === name)) cats.push({ cat: name, tags: [] })
  }
  const arr = cats.slice(0, 9)
  const r = await window.api.saveTagCategories(arr)
  // 标签映射入库（JSON 数组，过滤两侧皆空的行）
  const mapping = mapRows.value
    .filter(m => (m.from || '').trim() || (m.to || '').trim())
    .map(m => [(m.from || '').trim(), (m.to || '').trim()])
  await window.api.updateSetting('tag_mapping', JSON.stringify(mapping))
  if (r.ok) {
    store.categories = arr
    await store.loadAllDbTags()
    await loadCats()
    ElMessage.success('标签设置已保存，实时生效')
  }
  else ElMessage.error(r.error)
}

/**
 * 保存基础设置（播放器路径/点击动作/每行/每页）
 */
async function save() {
  if (!window.api) return
  st.page_size = String(pageSizeN.value)
  st.cols_per_row = String(colsPerRowN.value)
  const keys = ['player_path', 'click_action', 'page_size', 'cols_per_row']
  for (const k of keys) {
    await window.api.updateSetting(k, String(st[k] ?? ''))
  }
  location.reload()
  ElMessage.success('设置已保存')
}

/**
 * 保存刮削设置（来源/预览图/统计/代理；代理变更由主进程即时应用）
 */
async function saveScrape() {
  if (!window.api) return
  st.preview_count = String(previewCountN.value)
  const keys = ['scrape_source', 'scrape_previews', 'preview_count', 'scrape_stats', 'proxy_enabled', 'proxy_url']
  for (const k of keys) {
    await window.api.updateSetting(k, String(st[k] ?? ''))
  }
  ElMessage.success('刮削设置已保存')
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
 * 组件挂载时：加载基础/刮削设置和标签类别与映射
 */
onMounted(async () => { await load() })
</script>

<style scoped>
/* 设置页容器 */
.settings-page { padding-bottom: 20px; }

/* 播放器路径行：完整胶囊输入框 + 独立胶囊按钮并排（不再用 append 拼接） */
.player-row { display: flex; gap: 10px; width: 100%; }
.player-input { flex: 1; }

/* 标签设置内容区：缩进 160px 与其他标签页的表单控件列对齐 */
.sec-wrap { max-width: 760px; padding-left: 160px; }

/* 分组小标题行：标题 + 加号按钮 */
.sec-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 4px 0 6px;
}
/* 分组标题文字：与 el-form label 统一（14px / 次要文字色 / 中等字重） */
.sec-title {
  font-size: 14px;
  color: var(--text-2);
  font-weight: 500;
  font-family: var(--font-body);
}

/* 类别行：序号 + 类别名 + 标签 + 删除 */
.cat-row-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.row-idx {
  width: 20px;
  text-align: center;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.cat-name-input { width: 180px; flex-shrink: 0; }
.cat-tags-input { flex: 1; }

/* 映射行：原标签 → 映射为 → 新标签 → 删除 */
.map-row-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
}
.map-input { flex: 1; max-width: 280px; }
.map-arrow { color: var(--muted); font-size: 12px; flex-shrink: 0; }

/* 行删除按钮：圆形弱化，hover 危险色（与女优卡片删除按钮同风格） */
.row-del {
  width: 28px; height: 28px;
  flex-shrink: 0;
  border: none; border-radius: 50%;
  background: transparent; color: var(--muted);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
}
.row-del:hover { background: var(--danger-soft); color: var(--danger); }

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
