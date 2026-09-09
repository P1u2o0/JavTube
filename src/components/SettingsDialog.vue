<!--
  ============================================================
  文件名：SettingsDialog.vue
  所属模块：公共组件 / 设置对话框
  功能描述：应用设置弹出窗口（2026-09-09 由独立设置页改造，后又按用户
           反馈改为固定尺寸 + 统一双栏网格布局）。
           对话框整体固定尺寸（820px × 74vh），切换标签页大小不变；
           每个标签页固定分为左右两栏：左列选项名称（右端对齐中心线）、
           右列选项控件；选项说明小字统一放选项下方。
           五个标签页：基础设置 / 标签设置（标签类别+标签映射）/
           刮削设置 / 辅助设置 / 关于。
  ============================================================
-->
<template>
  <!-- 设置对话框：v-model 控制显隐，align-center 垂直水平居中，整体固定尺寸 -->
  <el-dialog v-model="show" title="设置" width="820px" align-center destroy-on-close class="settings-dialog">
    <!-- 标签页容器 -->
    <el-tabs v-model="tab">
      <!-- ============ 基础设置 ============ -->
      <el-tab-pane label="基础设置" name="basic">
        <div class="set-grid">
          <!-- 播放器路径（输入框与选择按钮并排） -->
          <div class="g-label">播放器路径</div>
          <div class="g-control">
            <div class="player-row">
              <el-input v-model="st.player_path" placeholder="留空使用系统默认播放器" class="player-input" />
              <el-button @click="choosePlayer">选择</el-button>
            </div>
            <span class="g-tip">填入本地播放器的可执行文件路径，播放影片时优先使用它打开</span>
          </div>
          <!-- 点击卡片默认动作 -->
          <div class="g-label">点击卡片动作</div>
          <div class="g-control">
            <el-select v-model="st.click_action" style="max-width: 260px;">
              <el-option label="进入详情页" value="detail" />
              <el-option label="直接播放" value="play" />
            </el-select>
            <span class="g-tip">在片库中单击影片卡片时执行的动作（详情页内播放不受影响）</span>
          </div>
          <!-- 每行显示数量 -->
          <div class="g-label">每行显示数量</div>
          <div class="g-control">
            <el-input-number v-model="colsPerRowN" :min="3" :max="8" :step="1" />
            <span class="g-tip">片库海报墙每一行显示的影片卡片数（3 - 8）</span>
          </div>
          <!-- 每页显示数量 -->
          <div class="g-label">每页显示数量</div>
          <div class="g-control">
            <el-input-number v-model="pageSizeN" :min="10" :max="200" :step="10" />
            <span class="g-tip">片库列表每页加载的影片数量（10 - 200）</span>
          </div>
          <!-- 保存与恢复按钮 -->
          <div class="g-label"></div>
          <div class="g-control">
            <el-button type="primary" @click="save">保存设置</el-button>
            <el-button @click="load" style="margin-left: 10px;">恢复</el-button>
          </div>
        </div>
      </el-tab-pane>

      <!-- ============ 标签设置 ============ -->
      <el-tab-pane label="标签设置" name="cats">
        <div class="set-grid">
          <!-- 标签类别：右列为添加按钮 + 行列表 -->
          <div class="g-label">标签类别</div>
          <div class="g-control">
            <el-button class="add-btn" @click="addCat">
              <AppIcon name="plus" :size="14" style="margin-right:4px" />添加类别
            </el-button>
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
            <span class="g-tip">每个类别一行，类别内的标签用中文逗号「，」分隔；未添加标签的类别不会显示在片库筛选区</span>
          </div>
          <!-- 标签映射 -->
          <div class="g-label">标签映射</div>
          <div class="g-control">
            <el-button class="add-btn" @click="addMap">
              <AppIcon name="plus" :size="14" style="margin-right:4px" />添加映射
            </el-button>
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
            <span class="g-tip">刮削获得的标签若与左侧「原标签」相同，入库时自动替换为右侧「新标签」（新标签留空表示删除该标签），无需逐部手动修改</span>
          </div>
          <!-- 保存按钮 -->
          <div class="g-label"></div>
          <div class="g-control">
            <el-button type="primary" @click="saveCats">保存标签设置</el-button>
            <el-button @click="loadCats" style="margin-left: 10px;">恢复</el-button>
          </div>
        </div>
      </el-tab-pane>

      <!-- ============ 刮削设置 ============ -->
      <el-tab-pane label="刮削设置" name="scrape">
        <div class="set-grid">
          <!-- 刮削来源 -->
          <div class="g-label">刮削来源</div>
          <div class="g-control">
            <el-select v-model="st.scrape_source" style="max-width: 320px;">
              <el-option label="自动（JAVBUS 优先，JAVDB 兜底）" value="auto" />
              <el-option label="仅使用 JAVBUS" value="javbus" />
              <el-option label="仅使用 JAVDB" value="javdb" />
            </el-select>
            <span class="g-tip">自动模式下先刮 JAVBUS，失败自动换 JAVDB；指定来源失败不再兜底</span>
          </div>
          <!-- 下载预览图 -->
          <div class="g-label">下载预览图</div>
          <div class="g-control">
            <el-switch v-model="st.scrape_previews" active-value="y" inactive-value="n" />
            <span class="g-tip">开启后刮削时自动下载影片预览图到本地预览图目录，详情页底部可浏览</span>
          </div>
          <!-- 预览图数量 -->
          <div class="g-label">预览图数量</div>
          <div class="g-control">
            <el-input-number v-model="previewCountN" :min="0" :max="50" :step="1" />
            <span class="g-tip">每次刮削最多下载几张预览图（0 = 全部下载）</span>
          </div>
          <!-- 想看/看过/评分 -->
          <div class="g-label">想看/看过/评分</div>
          <div class="g-control">
            <el-switch v-model="st.scrape_stats" active-value="y" inactive-value="n" />
            <span class="g-tip">刮削 JAVDB 时同时抓取想看人数、看过人数与评分，并在影片详情页展示</span>
          </div>
          <!-- 使用本机代理 -->
          <div class="g-label">使用本机代理</div>
          <div class="g-control">
            <el-switch v-model="st.proxy_enabled" active-value="y" inactive-value="n" />
            <span class="g-tip">访问 JAVDB 需要科学上网，开启后刮削请求走下方代理地址，保存后立即生效</span>
          </div>
          <!-- 代理地址 -->
          <div class="g-label">代理地址</div>
          <div class="g-control">
            <el-input v-model="st.proxy_url" placeholder="http://127.0.0.1:7890" style="max-width: 320px;" />
            <span class="g-tip">本机代理的 HTTP 地址，常用 Clash 默认端口 7890、v2rayN 默认 10809</span>
          </div>
          <!-- 保存按钮 -->
          <div class="g-label"></div>
          <div class="g-control">
            <el-button type="primary" @click="saveScrape">保存刮削设置</el-button>
          </div>
        </div>
      </el-tab-pane>

      <!-- ============ 辅助设置 ============ -->
      <el-tab-pane label="辅助设置" name="aux">
        <div class="set-grid">
          <!-- 数据库管理 -->
          <div class="g-label">数据库</div>
          <div class="g-control">
            <div style="display:flex; gap: 10px; flex-wrap: wrap;">
              <!-- 备份按钮 -->
              <el-button @click="backupDb">
                <AppIcon name="import" :size="14" style="margin-right:5px" />备份数据库到…
              </el-button>
              <!-- 恢复按钮 -->
              <el-button @click="restoreDb">
                <AppIcon name="reset" :size="14" style="margin-right:5px" />从备份文件恢复…
              </el-button>
              <!-- 清空按钮（危险操作） -->
              <el-button class="act-del" @click="clearDb">
                <AppIcon name="trash" :size="14" style="margin-right:5px" />清空所有数据
              </el-button>
            </div>
            <span class="g-tip">清空为不可逆操作，执行前请先备份；恢复会覆盖当前全部数据</span>
          </div>
        </div>
      </el-tab-pane>

      <!-- ============ 关于 ============ -->
      <el-tab-pane label="关于" name="about">
        <div class="set-grid">
          <div class="g-label">应用信息</div>
          <div class="g-control">
            <div class="about-line"><b>JavTube</b>　v1.1.0</div>
            <div class="about-line">框架：Electron 30 + Vue 3 + Vite 5 + sql.js</div>
            <div class="about-line about-muted">2026 · 纯本地管理，数据仅保存在本软件 data 目录内，不上传任何内容。</div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useMoviesStore } from '@/store/movies'
import AppIcon from '@/components/AppIcon.vue'

// 组件 props / emit：支持 v-model 控制对话框显隐
const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])

// 对话框显示状态（v-model 双向绑定）
const show = computed({
  get() { return props.modelValue },
  set(v) { emit('update:modelValue', v) }
})

// 每次打开对话框时重新加载全部设置（保证读到最新值）
watch(show, (v) => { if (v) load() })

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
 * 加载设置（对话框每次打开时调用）
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
</script>

<style scoped>
/* ====== 统一双栏网格：左列选项名称（右端贴中心线）+ 右列选项 ====== */
.set-grid {
  display: grid;
  grid-template-columns: 120px 1fr;  /* 左列固定宽 → 名称最后一个字贴中心线 */
  column-gap: 22px;
  row-gap: 22px;
  align-items: start;
}
/* 左列：选项名称，右对齐，与默认控件（32px 高）基线对齐 */
.g-label {
  text-align: right;
  color: var(--text-2);
  font-size: 14px;
  font-weight: 500;
  line-height: 32px;
}
/* 右列：选项控件 + 说明小字 */
.g-control { min-width: 0; }
.g-tip {
  display: block;
  margin-top: 6px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

/* 播放器路径行：完整胶囊输入框 + 独立胶囊按钮并排 */
.player-row { display: flex; gap: 10px; width: 100%; }
.player-input { flex: 1; }

/* 标签类别 / 标签映射行 */
.row-list { margin-top: 2px; }
.cat-row-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.row-idx {
  width: 20px; text-align: center;
  color: var(--muted); font-size: 12px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.cat-name-input { width: 170px; flex-shrink: 0; }
.cat-tags-input { flex: 1; }
.map-row-item { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
.map-input { flex: 1; max-width: 250px; }
.map-arrow { color: var(--muted); font-size: 12px; flex-shrink: 0; }
/* 行删除按钮 */
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

/* 辅助设置清空按钮：hover 危险色 */
.act-del:hover,
.act-del:focus {
  background: var(--danger-soft) !important;
  border-color: var(--danger) !important;
  color: var(--danger) !important;
}

/* 关于页文字行 */
.about-line { padding: 3px 0; color: var(--text-2); font-size: 13.5px; }
.about-line b { color: var(--text); font-family: var(--font-display); }
.about-muted { color: var(--muted); font-size: 12.5px; }
</style>

<style>
/* ====== 设置对话框整体固定尺寸（非 scoped：class 落在 el-dialog 根上） ======
   高度固定 74vh：切换标签页时对话框大小完全不变；body 弹性填充并内部滚动 */
.settings-dialog {
  height: 74vh;
  display: flex;
  flex-direction: column;
  margin-bottom: 0 !important;
}
.settings-dialog .el-dialog__header { flex-shrink: 0; }
.settings-dialog .el-dialog__body {
  flex: 1;
  overflow-y: auto;
  padding-top: 4px;
}
.settings-dialog .el-dialog__body::-webkit-scrollbar { width: 8px; }
.settings-dialog .el-dialog__body::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 4px;
}
.settings-dialog .el-dialog__body::-webkit-scrollbar-track { background: transparent; }
</style>
