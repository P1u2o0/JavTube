/**
 * @file index.js
 * @module src/player
 * @description 播放内核工厂 —— 播放页唯一的入口。
 *
 * 页面通过 `createBackend()` 拿后端实例，因此**不需要 import 任何具体内核**；
 * 换内核只在这里加一个分支即可，播放页代码一行不用动（2026-10-07 抽象时就为这一步铺的路）。
 *
 * @dependencies ./backend, ./chromium-backend, ./mpv-backend
 */

import { PLAYER_KINDS } from './backend'
import { ChromiumBackend, prewarmChromiumBackend } from './chromium-backend'
import { MpvBackend } from './mpv-backend'

/**
 * 创建一个播放内核后端。
 * @param {string} [kind] - 内核标识，取值见 PLAYER_KINDS
 * @returns {import('./backend.js').PlayerBackend} 实现 ./backend.js 契约的实例
 */
export function createBackend(kind = PLAYER_KINDS.CHROMIUM) {
  switch (kind) {
    case PLAYER_KINDS.MPV:
      return new MpvBackend()
    case PLAYER_KINDS.CHROMIUM:
      return new ChromiumBackend()
    default:
      throw new Error(`未知的播放内核：${kind}`)
  }
}

/** 某个内核在当前环境是否可用（mpv 需要主进程通道在场；打包漏了 mpv.exe 时也能提前发现） */
export function isBackendAvailable(kind) {
  if (kind === PLAYER_KINDS.MPV) return typeof window.api?.mpvControl === 'function'
  return true
}

/**
 * 按内核做「空闲预热」（可选优化，失败无副作用）。
 * 目前只有 Chromium 内核需要（ArtPlayer 的构造有一次性开销）；mpv 是独立进程，无需预热。
 * @param {string} [kind] - 内核标识
 * @returns {boolean} 是否预热
 */
export function prewarmPlayerKernel(kind) {
  if (kind === PLAYER_KINDS.CHROMIUM) return prewarmChromiumBackend()
  return false
}

export { PLAYER_EVENTS, PLAYER_KINDS } from './backend'
