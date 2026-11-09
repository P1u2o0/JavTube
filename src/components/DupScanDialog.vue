<!--
  文件名：DupScanDialog.vue
  所属模块：组件 / 维护工具
  功能描述：目录查重（2026-11-08）。**只找「同一目录里出现两次以上同番号」的视频**
           （2026-11-09 按用户澄清收窄语义：不与片库比对）。
           选一个目录 → 只读扫描 → 按番号分组，只列出 ≥2 个文件的组 →
           用户逐条决定：在资源管理器定位 / 移入系统回收站。
           **绝不自动删除**；库内正在使用的视频文件由主进程拒绝处置。
-->
<template>
  <el-dialog v-model="visible" title="目录查重" width="900px" top="7vh" :close-on-click-modal="false" @closed="reset">
    <div class="dup-bar">
      <el-button :disabled="scanning" @click="pickDir">选择目录</el-button>
      <!-- 也可以直接粘贴路径（NAS/UNC 路径用选择框点很麻烦，用户 2026-11-08 需求） -->
      <el-input v-model="dir" class="dup-input" placeholder="选择目录，或直接粘贴路径（如 \\NAS\Video）" clearable />
      <el-button type="primary" :disabled="!dir || scanning" :loading="scanning" @click="scan">开始扫描</el-button>
    </div>

    <div class="dup-note">
      只做只读扫描：把同一目录里出现<b>两次以上</b>的同番号视频列出来（跨子目录也算），
      处置只有两种：在资源管理器里定位，或把多余那份<b>移入回收站</b>（可从回收站还原）。
    </div>

    <div v-if="summary" class="dup-sum">{{ summary }}</div>
    <div v-if="unparsed" class="dup-note">另有 {{ unparsed }} 个文件解析不出番号，已跳过。</div>

    <div v-if="groups.length" class="dup-list">
      <div v-for="g in groups" :key="g.code" class="dup-group">
        <div class="dup-head">
          <span class="dup-code">{{ g.code }}</span>
          <span class="dup-badge">同番号 {{ g.files.filter(f => !f.trashed).length }} 个</span>
          <span class="dup-count">按体积从大到小排</span>
        </div>
        <div v-for="f in g.files" :key="f.path" class="dup-file" :class="{ trashed: f.trashed }">
          <span class="df-file-main">
            <span class="df-name" :title="f.path">{{ f.name }}</span>
            <span class="df-path" :title="f.path">{{ subPath(f.path) }}</span>
          </span>
          <span class="df-size">{{ fmtSize(f.size) }}</span>
          <span class="df-time">{{ fmtDate(f.mtime) }}</span>
          <span class="df-flag">{{ f.trashed ? '已移入回收站' : f.flag }}</span>
          <span class="df-acts">
            <button v-if="!f.trashed" class="df-btn" @click="reveal(f)">定位</button>
            <button v-if="!f.trashed" class="df-btn danger" title="移入回收站（可还原）"
                    @click="trash(f, g)">移入回收站</button>
          </span>
        </div>
      </div>
    </div>
    <div v-else-if="scanned && !groups.length" class="dup-empty">这个目录里没有同番号重复的视频 👍</div>

    <template #footer>
      <span class="dup-foot">扫描结果仅供参考，处置由你决定</span>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { extractCode } from '@/utils/global'

const visible = ref(false)
const dir = ref('')
const scanning = ref(false)
const scanned = ref(false)
const summary = ref('')
const unparsed = ref(0)
const groups = ref([])
/** 扫描序号：关闭/重开或换目录后，旧那次扫描的回包不再写界面（2026-11-09 审计） */
let scanSeq = 0

/** 打开对话框（供设置页调用） */
function open() {
  visible.value = true
}
defineExpose({ open })

function reset() {
  scanSeq++          // 让还在跑的扫描失效
  dir.value = ''
  scanning.value = false
  scanned.value = false
  summary.value = ''
  unparsed.value = 0
  groups.value = []
}

/**
 * 换目录 = 旧结果作废（2026-11-09 审计）。
 * 不清的话界面会同时显示「新路径 + 上一轮的重复结果」，用户很可能对着旧结果点回收站。
 */
watch(dir, (v, old) => {
  if (!old || v === old) return
  if (scanning.value) return
  if (!groups.value.length && !summary.value) return
  scanSeq++
  groups.value = []
  unparsed.value = 0
  scanned.value = false
  summary.value = '路径已变更，请重新扫描'
})

async function pickDir() {
  // ⚠️ openDirDialog 返回的是**字符串路径**（主进程 doOpen 只回第一个选中路径），
  //    不是 Electron 原生 `{ canceled, filePaths }` —— 之前按对象解构，导致「选完目录没反应」。
  const d = await window.api?.openDirDialog?.()
  if (typeof d === 'string' && d.trim()) dir.value = d
}

async function scan() {
  if (!dir.value) return
  const seq = ++scanSeq
  scanning.value = true
  groups.value = []
  summary.value = ''
  unparsed.value = 0
  try {
    const scanR = await window.api?.dupScan?.(dir.value).catch(() => null)
    if (seq !== scanSeq) return          // 期间关窗/换目录了，丢弃这次结果
    if (!scanR || !scanR.ok) return ElMessage.error(scanR?.error || '扫描失败')

    // 按番号分组（同一目录里跨子目录一起算）
    const byCode = new Map()
    let bad = 0
    for (const f of scanR.data?.files || []) {
      const code = extractCode(f.name)
      if (!code) { bad++; continue }
      if (!byCode.has(code)) byCode.set(code, [])
      byCode.get(code).push(f)
    }
    unparsed.value = bad

    // 只保留「同番号 ≥ 2 个文件」的组 —— 这就是用户要查的重复
    const out = []
    for (const [code, files] of byCode) {
      if (files.length < 2) continue
      // 体积从大到小排，第一行标「体积最大」，方便判断该留哪个（纯客观提示，不替用户决定）
      const marked = files
        .slice()
        .sort((a, b) => (b.size || 0) - (a.size || 0) || String(a.name).localeCompare(String(b.name)))
        .map((f, i) => ({ ...f, flag: i === 0 ? '体积最大' : '', trashed: false }))
      out.push({ code, files: marked })
    }
    out.sort((a, b) => b.files.length - a.files.length || a.code.localeCompare(b.code))
    groups.value = out

    const dupFiles = out.reduce((s, g) => s + g.files.length, 0)
    summary.value = `扫描到 ${scanR.data?.files?.length || 0} 个视频，其中 ${out.length} 组番号重复（共 ${dupFiles} 个文件，每组留一个即可）`
      + (scanR.data?.truncatedBy === 'depth' ? '（目录层级过深，已跳过更深的子目录）'
        : scanR.data?.truncated ? `（文件过多，已截断到 ${scanR.data?.maxFiles || 8000} 个）` : '')
    scanned.value = true
  } finally {
    scanning.value = false
  }
}

async function reveal(f) {
  const r = await window.api?.dupReveal?.(f.path).catch(() => null)
  if (!r?.ok) ElMessage.error(r?.error || '定位失败')
}

async function trash(f, g) {
  // 双重保护：文案里明确写清"可恢复"和"不可撤销的部分"，并要求再次确认
  try {
    await ElMessageBox.confirm(
      `把「${f.name}」移入回收站？文件进系统回收站可还原，库内记录不受影响。`,
      '移入回收站', { type: 'warning', confirmButtonText: '移入回收站', cancelButtonText: '取消' }
    )
  } catch { return }
  const r = await window.api?.dupTrash?.(f.path).catch(() => null)
  if (!r?.ok) return ElMessage.error(r?.error || '处置失败')
  f.trashed = true
  const alive = g.files.filter(x => !x.trashed).length
  ElMessage.success(alive > 1 ? `已移入回收站，该番号还剩 ${alive} 个文件` : '已移入回收站')
}

/**
 * 文件相对扫描根的子目录（没有子目录就返回「根目录」）。
 * 为什么需要：同番号的两份文件经常**文件名完全一样**，只差在哪个子目录，
 * 不显示路径根本分不清该处置哪一份（2026-11-09 审计）。
 */
function subPath(p) {
  const root = String(dir.value || '').replace(/[\\/]+$/, '')
  let rel = String(p || '')
  if (root && rel.toLowerCase().startsWith(root.toLowerCase())) {
    rel = rel.slice(root.length).replace(/^[\\/]+/, '')
  }
  const parts = rel.split(/[\\/]/)
  parts.pop()                       // 去掉文件名
  return parts.length ? parts.join(' / ') : '根目录'
}

function fmtSize(n) {
  const b = Number(n) || 0
  if (b >= 1 << 30) return (b / (1 << 30)).toFixed(2) + ' GB'
  if (b >= 1 << 20) return (b / (1 << 20)).toFixed(1) + ' MB'
  return Math.max(1, Math.round(b / 1024)) + ' KB'
}
function fmtDate(ms) {
  const d = new Date(Number(ms) || 0)
  if (!d.getTime()) return '—'
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
</script>

<style scoped>
.dup-bar { display: flex; align-items: center; gap: 10px; }
.dup-input { flex: 1; min-width: 0; }
.dup-note { margin-top: 10px; color: var(--muted); font-size: var(--fs-xs); line-height: 1.7; }
.dup-note b { color: var(--text); }
.dup-sum { margin-top: 10px; font-size: var(--fs-sm); color: var(--text); }
.dup-list { margin-top: 10px; max-height: 48vh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
/* ⚠️ 必须 flex-shrink:0：`.dup-list` 是带 max-height 的纵向 flex，
   几十个分组挤在一起时浏览器会把每个 group 压缩到几像素高、内容被 overflow 裁掉，
   界面上就只剩一串「横线」（2026-11-09 用户实测 37 组时踩到）。 */
.dup-group { flex: 0 0 auto; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
.dup-head {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; background: var(--surface-2);
}
.dup-code { font-family: var(--font-display); font-weight: 700; color: var(--text); }
.dup-badge { padding: 1px 8px; border-radius: var(--r-pill); font-size: var(--fs-xs); background: var(--filetag-gold-soft); color: var(--filetag-gold); }
.dup-count { margin-left: auto; color: var(--muted); font-size: var(--fs-xs); }
.dup-file {
  display: flex; align-items: center; gap: 10px; min-height: 44px;
  padding: 7px 12px; border-top: 1px solid var(--border);
  font-size: var(--fs-sm);
  flex: 0 0 auto;      /* 同理：行也不能被压缩（见 .dup-group 的注释） */
}
.dup-file.trashed { opacity: .55; }
/* 文件名 + 相对子目录两行：同番号同名文件靠第二行区分 */
.df-file-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.df-path { font-size: var(--fs-xs); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.df-name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
.df-size { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.df-time { color: var(--text-2); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.df-time { width: 78px; }
.df-size { width: 70px; text-align: right; }
.df-flag { width: 108px; flex-shrink: 0; color: var(--muted); font-size: var(--fs-xs); }
.df-acts { display: flex; gap: 6px; flex-shrink: 0; }
.df-btn {
  padding: 5px 12px; height: 28px; border-radius: var(--r-tag);
  border: 1px solid var(--border); background: var(--surface); color: var(--text-2);
  font-size: var(--fs-xs); cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.df-btn:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
.df-btn.danger { color: var(--danger); border-color: var(--danger); }
.df-btn.danger:hover:not(:disabled) { background: var(--danger); color: #fff; border-color: var(--danger); }
.df-btn:disabled { opacity: .45; cursor: not-allowed; }
.dup-empty { padding: 30px 0; text-align: center; color: var(--muted); }
.dup-foot { float: left; color: var(--muted); font-size: var(--fs-xs); line-height: 32px; }
</style>
