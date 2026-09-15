<!--
  ============================================================
  文件名：Actress.vue
  所属模块：视图 / 女优管理页
  功能描述：管理女优信息。以卡片网格展示女优列表，支持
           添加/编辑/删除女优、查看女优详情（含参演影片），
           可设置头像、身高、三围、罩杯、生日、出道日等属性。
           使用 ActressStore（settings.js）管理数据。
  ============================================================
-->
<template>
  <div>
    <!-- 顶部标题与添加按钮 -->
    <div class="page-head">
      <h3>女优管理（{{ list.length }}）</h3>
      <el-button type="primary" @click="openAdd">
        <AppIcon name="plus" :size="15" style="margin-right:4px" />添加女优
      </el-button>
    </div>
    <!-- 空状态提示 -->
    <div v-if="!list.length" class="empty-tip">还没有添加女优</div>
    <!-- 女优卡片网格 -->
    <div class="grid" v-else>
      <div v-for="a in list" :key="a.id" class="card" @click="showDetail(a)">
        <!-- 头像：有图显示图片，无图显示首字母 -->
        <div class="avatar">
          <img v-if="a.img" :src="resolveCover(a.img)" />
          <span v-else>{{ a.name?.slice(0,1) || '?' }}</span>
        </div>
        <!-- 名字 -->
        <div class="name">{{ a.name }}</div>
        <!-- 附属信息：罩杯、身高 -->
        <div class="sub">
          <span v-if="a.zb">{{ a.zb }}罩杯</span>
          <span v-if="a.height"> / {{ a.height }}cm</span>
        </div>
        <!-- 操作按钮 -->
        <div class="ops">
          <button class="del-btn" title="删除" @click.stop="remove(a)">
            <AppIcon name="trash" :size="15" />
          </button>
        </div>
      </div>
    </div>

    <!-- 添加/编辑对话框 -->
    <el-dialog v-model="dlgShow" :title="editId ? '编辑女优' : '添加女优'" width="560px">
      <el-form :model="form" label-width="100px">
        <!-- 名字 -->
        <el-form-item label="名字"><el-input v-model="form.name" /></el-form-item>
        <!-- 头像：可输入路径或选择图片 -->
        <el-form-item label="头像">
          <el-input v-model="form.img" />
          <el-button size="small" @click="chooseImg" style="margin-top:6px">选择图片</el-button>
        </el-form-item>
        <!-- 三围数据行 -->
        <el-row :gutter="12">
          <el-col :span="6"><el-form-item label="身高"><el-input-number v-model="form.height" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="胸围"><el-input-number v-model="form.bust" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="腰围"><el-input-number v-model="form.waist" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="臀围"><el-input-number v-model="form.hip" /></el-form-item></el-col>
        </el-row>
        <!-- 罩杯、生日、出道日 -->
        <el-row :gutter="12">
          <el-col :span="6"><el-form-item label="罩杯"><el-input v-model="form.zb" maxlength="3" /></el-form-item></el-col>
          <el-col :span="9"><el-form-item label="生日"><el-date-picker v-model="form.birthday" value-format="YYYY-MM-DD" /></el-form-item></el-col>
          <el-col :span="9"><el-form-item label="出道日"><el-date-picker v-model="form.debut" value-format="YYYY-MM-DD" /></el-form-item></el-col>
        </el-row>
        <!-- 备注 -->
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgShow = false">取消</el-button>
        <el-button type="primary" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailShow" :title="detail?.name" size="420px">
      <div v-if="detail" class="det">
        <!-- 详情头像大图 -->
        <img :src="resolveCover(detail.img)" v-if="detail.img" style="width:100%; max-height:260px; object-fit:cover; border-radius: var(--r-sm);" />
        <!-- 基本信息区 -->
        <h4 style="margin: 16px 0 8px;">基本信息</h4>
        <p v-if="detail.zb">罩杯：{{ detail.zb }}</p>
        <p v-if="detail.height">身高：{{ detail.height }} cm</p>
        <p v-if="detail.bust">三围：B{{ detail.bust }} / W{{ detail.waist }} / H{{ detail.hip }}</p>
        <p v-if="detail.birthday">生日：{{ detail.birthday }}</p>
        <p v-if="detail.debut">出道日期：{{ detail.debut }}</p>
        <p v-if="detail.remark" style="color: var(--muted)">{{ detail.remark }}</p>
        <!-- 参演影片列表 -->
        <h4 style="margin: 20px 0 8px;">参演影片（{{ detail.movies?.length || 0 }}）</h4>
        <div v-if="detail.movies?.length">
          <div v-for="m in detail.movies" :key="m.id" style="padding: 8px 0; border-bottom: 1px dashed var(--border);">
            <el-link @click="goMovie(m.id)" type="primary">{{ m.ph }}</el-link>
            <span style="margin-left: 8px; color: var(--text-2)">{{ m.pm }}</span>
          </div>
        </div>
        <div v-else style="color: var(--muted)">暂无参演记录</div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useActressStore } from '@/store/actress'
import AppIcon from '@/components/AppIcon.vue'
import { resolveCover } from '@/utils/global'

// 女优 store 实例
const s = useActressStore()
// 女优列表（计算属性，来自 store）
const list = computed(() => s.list)

// 对话框与详情控制
const dlgShow = ref(false)       // 添加/编辑对话框显示状态
const editId = ref(null)         // 编辑时的女优 ID（null 表示新增）
const detailShow = ref(false)    // 详情抽屉显示状态
const detail = ref(null)        // 当前查看的女优详情数据

// 表单数据（响应式）
const form = reactive(blank())

/**
 * 创建空白表单对象
 * @returns {Object} 空白表单数据
 */
function blank() { return { name: '', img: '', height: null, bust: null, waist: null, hip: null, zb: '', birthday: '', debut: '', remark: '' } }

/**
 * 打开添加对话框（重置表单）
 */
async function openAdd() {
  Object.assign(form, blank()); editId.value = null; dlgShow.value = true
}

/**
 * 删除女优（带二次确认）
 * @param {Object} a - 女优对象
 */
async function remove(a) {
  try {
    await ElMessageBox.confirm('删除女优：' + a.name, '提示', { type: 'warning' })
    const r = await s.remove(a.id)
    if (r?.ok) ElMessage.success('已删除')
  } catch {}
}

/**
 * 查看女优详情（含参演影片）
 * @param {Object} a - 女优对象
 */
async function showDetail(a) {
  const d = await s.getOne(a.id)
  if (d) { detail.value = d; detailShow.value = true }
  else ElMessage.warning('获取女优详情失败')
}

/**
 * 保存女优信息（新增或更新）
 * 功能：校验名字，根据 editId 判断新增/更新，调用对应 API
 */
async function onSave() {
  if (!form.name.trim()) return ElMessage.warning('请输入名字')
  const plain = JSON.parse(JSON.stringify(form))
  // 根据 editId 决定新增或更新（统一走 store，与 create/remove 路径一致）
  const r = editId.value
    ? await s.update(editId.value, plain)
    : await s.create(plain)
  if (r.ok) {
    ElMessage.success('保存成功')
    dlgShow.value = false
    await s.load()
  } else ElMessage.error(r.error)
}

/**
 * 选择头像图片文件
 * 功能：调用系统文件选择对话框，将路径填入表单
 */
async function chooseImg() {
  if (window.api) { const p = await window.api.openImageDialog(); if (p) form.img = p }
}

// 路由实例，用于跳转到影片详情
const router = useRouter()

/**
 * 跳转到影片详情页
 * @param {number} id - 影片 ID
 */
function goMovie(id) { router.push(`/detail/${id}`) }

/**
 * 组件挂载时：加载女优列表
 */
onMounted(() => s.load())
</script>

<style scoped>
/* 女优卡片网格布局 */
.grid {
  display: grid; gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}
/* 单个卡片：统一面板样式，悬停上浮，错峰入场 */
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--r-md); padding: 14px;
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out),
              box-shadow var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) ease;
  animation: rise var(--dur-base) var(--ease-out) both;
}
@keyframes rise {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: none; }
}
.card:hover { transform: translateY(-3px); box-shadow: var(--sh-2); border-color: var(--border-strong); }
/* 头像：圆形，居中，无图时显示首字母 */
.avatar {
  width: 100%; aspect-ratio: 1; background: var(--surface-2); border-radius: 50%; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  color: var(--primary); font-size: 34px; font-weight: 600;
  font-family: var(--font-display);
}
.avatar img { width: 100%; height: 100%; object-fit: cover; }
/* 名字样式 */
.name { margin-top: 10px; font-weight: 600; text-align: center; color: var(--text); }
/* 附属信息样式 */
.sub { margin-top: 4px; text-align: center; color: var(--muted); font-size: var(--fs-sm); }
/* 操作按钮区域 */
.ops { margin-top: 10px; text-align: center; }
/* 删除图标按钮：默认弱化，悬停显示危险色 */
.del-btn {
  width: var(--icon-btn-md); height: var(--icon-btn-md);
  border: none; border-radius: 50%;
  background: transparent; color: var(--muted);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease,
              transform var(--dur-press) var(--ease-out);
}
.del-btn:hover { background: var(--danger-soft); color: var(--danger); }
.del-btn:active { transform: scale(0.96); }
/* 空状态提示 */
.empty-tip { text-align: center; color: var(--muted); padding: 60px 0; }
/* 详情抽屉段落间距 */
.det p { margin: 4px 0; }
</style>
