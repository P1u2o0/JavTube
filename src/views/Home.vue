<!--
  ============================================================
  文件名：Home.vue
  所属模块：视图 / 首页
  功能描述：应用程序的首页视图。当前为占位页面，
           显示"首页建设中"的空状态提示与片库快捷入口。
           后续可扩展为概览面板、统计信息或快捷入口等内容。
  ============================================================
-->
<template>
  <!-- 首页根容器 -->
  <div class="home-page">
    <!-- 空状态占位区域 -->
    <div class="empty-state">
      <!-- 图标徽章 -->
      <div class="icon-badge">
        <AppIcon name="home" :size="30" :sw="1.6" />
      </div>
      <!-- 标题与提示文案 -->
      <h2 class="empty-title">首页建设中</h2>
      <p class="empty-desc">统计概览与快捷入口正在路上，先去片库看看吧</p>
      <!-- 片库快捷入口 -->
      <el-button type="primary" @click="$router.push('/library')">
        <AppIcon name="library" :size="15" style="margin-right:5px" />前往片库
      </el-button>
    </div>
  </div>
</template>

<script setup>
// 引入统一图标组件
import AppIcon from '@/components/AppIcon.vue'
</script>

<style scoped>
/* 首页容器：全屏水平垂直居中 */
.home-page {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
/* 空状态区域：纵向排列，错峰入场 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.empty-state > * {
  animation: rise var(--dur-base) var(--ease-out) both;
}
.empty-state > *:nth-child(2) { animation-delay: 70ms; }
.empty-state > *:nth-child(3) { animation-delay: 140ms; }
.empty-state > *:nth-child(4) { animation-delay: 210ms; }
@keyframes rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: none; }
}
/* 图标徽章：墨黑底白图标 */
.icon-badge {
  width: 68px; height: 68px;
  border-radius: 20px;
  background: var(--primary);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: var(--sh-2);
  margin-bottom: 18px;
}
/* 标题 */
.empty-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
}
/* 描述文案 */
.empty-desc {
  margin: 0 0 20px;
  color: var(--muted);
  font-size: 13.5px;
}
</style>
