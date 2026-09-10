/**
 * @file scrape.js
 * @module src/store/scrape
 * @description 刮削任务进度 store（2026-09-10 新增）。
 *              配合顶栏铃铛按钮：影片开始刮削时登记任务，完成/失败时更新状态，
 *              铃铛角标显示进行中数量，下拉面板展示每部影片的刮削结果与失败原因。
 *              取代此前批量刮削使用 ElNotification 右上角弹窗的交互。
 */
import { defineStore } from 'pinia'

export const useScrapeStore = defineStore('scrape', {
  state: () => ({
    // 任务列表（新任务 unshift 到最前）：{ key, ph, pm, status, error }
    // status: 'running' 进行中 | 'ok' 成功 | 'fail' 失败
    tasks: []
  }),

  getters: {
    /** 进行中的刮削数量（铃铛角标） */
    runningCount: (s) => s.tasks.filter(t => t.status === 'running').length
  },

  actions: {
    /**
     * 登记一个刮削任务
     * @param {string} ph - 影片番号
     * @param {string} pm - 影片标题（可空）
     * @returns {string} 任务 key（完成后回传用于更新状态）
     */
    start(ph, pm) {
      const key = `${ph || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      this.tasks.unshift({ key, ph: ph || '—', pm: pm || '', status: 'running', error: '' })
      // 列表最多保留 50 条，防止长期使用膨胀
      if (this.tasks.length > 50) this.tasks.length = 50
      return key
    },

    /**
     * 更新任务完成状态
     * @param {string} key - start 返回的任务 key
     * @param {boolean} ok - 是否成功
     * @param {string} [error] - 失败原因
     */
    done(key, ok, error = '') {
      const t = this.tasks.find(t => t.key === key)
      if (t) {
        t.status = ok ? 'ok' : 'fail'
        t.error = error
      }
    },

    /**
     * 清除已完成的任务（进行中的保留）
     */
    clear() {
      this.tasks = this.tasks.filter(t => t.status === 'running')
    }
  }
})
