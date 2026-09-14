<!--
  ============================================================
  文件名：Website.vue
  所属模块：视图 / 网址导航页
  功能描述：管理收藏的网址。支持按分组展示、添加新网址
           （名称、URL、分组）、删除网址、点击卡片在新窗口
           打开网址。使用 WebStore（settings.js）管理数据。
  ============================================================
-->
<template>
  <div>
    <!-- 顶部标题与添加按钮 -->
    <div class="page-head">
      <h3>网址导航</h3>
      <el-button type="primary" @click="addShow = true">
        <AppIcon name="plus" :size="15" style="margin-right:4px" />添加网址
      </el-button>
    </div>

    <!-- 空状态提示 -->
    <el-empty v-if="!groups.length" description="还没有收藏网址" />
    <!-- 分组卡片展示 -->
    <div v-else>
      <div v-for="(items,grp) in groups" :key="grp" class="grp">
        <!-- 分组标题 -->
        <div class="grp-title">{{ grp || '未分组' }}</div>
        <!-- 网址卡片网格 -->
        <div class="cards">
          <div v-for="w in items" :key="w.id" class="card" @click="open(w.url)">
            <!-- 网站名称 + 外链图标 -->
            <div class="name">
              <span>{{ w.name }}</span>
              <AppIcon name="external" :size="13" class="ext-icon" />
            </div>
            <!-- 网址（溢出省略） -->
            <div class="url" :title="w.url">{{ w.url }}</div>
            <!-- 删除按钮 -->
            <button class="del-btn" title="删除" @click.stop="remove(w)">
              <AppIcon name="trash" :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加网址对话框 -->
    <el-dialog v-model="addShow" title="添加网址" width="500px">
      <el-form :model="form" label-width="80px">
        <!-- 网站名称 -->
        <el-form-item label="名称"><el-input v-model="form.name" placeholder="网站名称" /></el-form-item>
        <!-- URL 地址 -->
        <el-form-item label="URL"><el-input v-model="form.url" placeholder="https://..." /></el-form-item>
        <!-- 分组（可选） -->
        <el-form-item label="分组"><el-input v-model="form.grp" placeholder="自定义分组名（可选）" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addShow = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useWebStore } from '@/store/website'
import AppIcon from '@/components/AppIcon.vue'

// 网址 store 实例
const s = useWebStore()
// 添加对话框显示状态
const addShow = ref(false)
// 添加表单数据
const form = reactive({ name: '', url: '', grp: '' })

/**
 * 计算属性：按分组聚合的网址映射
 * @returns {Object} { 分组名: [网址数组] }
 */
const groups = computed(() => {
  const g = {}
  for (const w of s.list) {
    const k = w.grp || ''
    if (!g[k]) g[k] = []
    g[k].push(w)
  }
  return g
})

/**
 * 在新窗口打开网址
 * @param {string} url - 网址，自动补全 http 前缀
 */
function open(url) {
  if (!url) return
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  window.open(url, '_blank')
}

/**
 * 保存新网址
 * 功能：校验表单，调用 store 创建，成功后重置表单
 */
async function save() {
  if (!form.name || !form.url) return ElMessage.warning('请填写名称和URL')
  const r = await s.create(form)
  if (r.ok) {
    ElMessage.success('已添加')
    form.name = ''; form.url = ''; form.grp = ''
    addShow.value = false
  }
}

/**
 * 删除网址（带二次确认）
 * @param {Object} w - 网址对象
 */
async function remove(w) {
  try {
    await ElMessageBox.confirm('删除：' + w.name)
    await s.remove(w.id)
    ElMessage.success('已删除')
  } catch {}
}

/**
 * 组件挂载时：加载网址列表
 */
onMounted(() => s.load())
</script>

<style scoped>
/* 分组容器间距 */
.grp { margin-bottom: 22px; }
/* 分组标题：底部墨黑下划线 */
.grp-title {
  font-weight: 700; color: var(--text);
  font-family: var(--font-display);
  padding: 4px 0 8px;
  border-bottom: 2px solid var(--primary);
  display: inline-block; min-width: 120px;
  letter-spacing: -0.01em;
}
/* 网址卡片网格 */
.cards { margin-top: 14px; display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
/* 单个卡片：统一面板样式，悬停高亮 */
.card {
  position: relative;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--r-md); padding: 14px;
  cursor: pointer;
  transition: border-color var(--dur-fast) ease, box-shadow var(--dur-fast) var(--ease-out),
              transform var(--dur-fast) var(--ease-out);
}
.card:hover { border-color: var(--primary); box-shadow: var(--sh-1); transform: translateY(-2px); }
/* 网站名称 + 外链图标 */
.name {
  display: flex; align-items: center; gap: 6px;
  font-weight: 600; color: var(--text);
}
.ext-icon { color: var(--muted); transition: color var(--dur-fast) ease; }
.card:hover .ext-icon { color: var(--primary); }
/* 网址文本：溢出省略 */
.url { color: var(--muted); font-size: 12px; margin: 6px 0 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 删除图标按钮：定位到卡片右上角，悬停卡片时显现 */
.del-btn {
  position: absolute; top: 10px; right: 10px;
  width: var(--icon-btn-md); height: var(--icon-btn-md);
  border: none; border-radius: 50%;
  background: transparent; color: var(--muted);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0;
  transition: opacity var(--dur-fast) ease, background var(--dur-fast) ease,
              color var(--dur-fast) ease, transform var(--dur-press) var(--ease-out);
}
.card:hover .del-btn { opacity: 1; }
.del-btn:active { transform: scale(0.96); }
.del-btn:hover { background: var(--danger-soft); color: var(--danger); }
</style>
