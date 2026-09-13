/**
 * @file scrape.js
 * @module src/store/scrape
 * @description 刮削任务进度 store（2026-09-10 新增，2026-09-13 引入「待刮削」队列状态）。
 *              配合顶栏铃铛按钮：批量刮削时先把全部影片登记为 pending（待刮削），
 *              再逐个 begin（pending→running）执行，完成/失败时更新或移除。
 *              铃铛角标显示「待刮削 + 进行中」总数，面板分「正在刮削 / 待刮削 / 刮削失败」三组展示。
 *              取代此前批量刮削使用 ElNotification 右上角弹窗的交互。
 */
import { defineStore } from 'pinia'

export const useScrapeStore = defineStore('scrape', {
  state: () => ({
    // 任务列表（新任务 unshift 到最前）：{ key, ph, pm, status, error }
    // status: 'pending' 待刮削 | 'running' 正在刮削 | 'fail' 失败
    // （成功的任务在 done(ok) 时从列表移除，不再占位）
    tasks: []
  }),

  getters: {
    /** 正在刮削数量 */
    runningCount: (s) => s.tasks.filter(t => t.status === 'running').length,
    /** 待刮削（排队中）数量 */
    pendingCount: (s) => s.tasks.filter(t => t.status === 'pending').length,
    /** 失败数量 */
    failedCount: (s) => s.tasks.filter(t => t.status === 'fail').length,
    /** 待刮削任务总数（排队 + 进行中）——铃铛红标 */
    todoCount: (s) => s.tasks.filter(t => t.status === 'pending' || t.status === 'running').length,
    /** 分组：正在刮削 / 待刮削 / 失败 */
    runningTasks: (s) => s.tasks.filter(t => t.status === 'running'),
    pendingTasks: (s) => s.tasks.filter(t => t.status === 'pending'),
    failedTasks: (s) => s.tasks.filter(t => t.status === 'fail')
  },

  actions: {
    /** 生成唯一任务 key */
    _key(ph) {
      return `${ph || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    },
    /** 列表上限 50 条，防止长期使用膨胀 */
    _cap() {
      if (this.tasks.length > 50) this.tasks.length = 50
    },

    /**
     * 登记一个待刮削任务（进入排队队列，状态 pending）
     * @param {string} ph - 影片番号
     * @param {string} pm - 影片标题（可空）
     * @returns {string} 任务 key
     */
    enqueue(ph, pm) {
      const key = this._key(ph)
      this.tasks.unshift({ key, ph: ph || '—', pm: pm || '', status: 'pending', error: '' })
      this._cap()
      return key
    },

    /**
     * 登记一个立即开始的任务（单部刮削，直接 running，无排队阶段）
     * @param {string} ph - 影片番号
     * @param {string} pm - 影片标题（可空）
     * @returns {string} 任务 key
     */
    start(ph, pm) {
      const key = this._key(ph)
      this.tasks.unshift({ key, ph: ph || '—', pm: pm || '', status: 'running', error: '' })
      this._cap()
      return key
    },

    /**
     * 将待刮削任务转为正在刮削
     * @param {string} key - enqueue 返回的任务 key
     */
    begin(key) {
      const t = this.tasks.find(t => t.key === key)
      if (t) t.status = 'running'
    },

    /**
     * 更新任务完成状态：成功则从列表移除（不再占位），失败则标记失败并记录原因
     * @param {string} key - start/enqueue 返回的任务 key
     * @param {boolean} ok - 是否成功
     * @param {string} [error] - 失败原因
     */
    done(key, ok, error = '') {
      const t = this.tasks.find(t => t.key === key)
      if (!t) return
      if (ok) {
        this.tasks = this.tasks.filter(x => x.key !== key)
      } else {
        t.status = 'fail'
        t.error = error
      }
    },

    /**
     * 清除失败的刮削任务（进行中与排队的保留）
     */
    clear() {
      this.tasks = this.tasks.filter(t => t.status !== 'fail')
    }
  }
})
