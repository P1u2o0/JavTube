#!/usr/bin/env node
/**
 * ============================================================
 * 文件名：check-undefined.js
 * 功能：主进程代码「调用了但未定义」的静态检查（防脚本批量替换误删函数定义）。
 *
 * 背景（2026-09-13 教训）：用脚本按区间替换代码块时，把夹在区间内的
 * throttleByHost 函数定义一并删掉，而 node --check 只查语法、查不出
 * 未定义引用，直到运行时才报 "throttleByHost is not defined"。
 * 本脚本扫描 electron/ 下所有 .js，列出「明显调用但找不到定义」的标识符候选。
 *
 * 用法：node scripts/check-undefined.js
 * 退出码：0 = 无候选（或仅有白名单内），1 = 发现可疑引用
 * ============================================================
 */
const fs = require('fs')
const path = require('path')

// 扫描根目录（相对项目根）
const ROOTS = ['electron']
// 内置/全局/依赖注入标识符白名单（不参与检查）
const WHITELIST = new Set([
  'require', 'module', 'exports', 'process', 'console', 'Buffer', 'global', 'globalThis',
  'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Promise', 'Set', 'Map', 'WeakMap', 'WeakSet', 'Date', 'RegExp', 'Error', 'TypeError',
  'RangeError', 'SyntaxError', 'Function', 'Proxy', 'Reflect', 'Intl',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'escape', 'unescape', 'structuredClone', 'queueMicrotask',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'fetch', 'URL', 'URLSearchParams', 'AbortSignal', 'AbortController', 'TextEncoder', 'TextDecoder',
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'new', 'delete', 'void',
  'function', 'class', 'super', 'this', 'import', 'expect', 'describe', 'it', 'test',
  // 浏览器 / Electron 全局构造器与命名空间
  'Response', 'Request', 'Headers', 'Blob', 'FormData', 'File', 'FileReader', 'Event',
  'CustomEvent', 'MessageChannel', 'WebSocket', 'Image', 'Audio', 'Notification',
  'Document', 'Window', 'Element', 'HTMLElement', 'Node', 'Worker', 'URLPattern',
  // Promise / 回调常见参数名
  'resolve', 'reject', 'next', 'done', 'callback', 'cb', 'handler'
])

/**
 * 递归收集目录下所有 .js 文件
 * @param {string} dir - 目录
 * @param {string[]} out - 结果累加
 */
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      walk(full, out)
    } else if (e.name.endsWith('.js')) out.push(full)
  }
}

/**
 * 从源码中收集「已定义」的标识符：函数声明、变量声明、参数、解构导入、类
 * @param {string} src - 源码
 * @returns {Set<string>} 定义名集合
 */
function collectDefined(src) {
  const defs = new Set()
  const add = (n) => { if (n && !WHITELIST.has(n)) defs.add(n) }
  // function xxx / async function xxx
  for (const m of src.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) add(m[1])
  // class Xxx
  for (const m of src.matchAll(/class\s+([A-Za-z_$][\w$]*)/g)) add(m[1])
  // const/let/var 声明（含多变量声明）
  for (const m of src.matchAll(/(?:const|let|var)\s+([^=\n;]+)[=;]/g)) {
    for (const part of m[1].split(',')) add(part.trim().split(/[\s:]/)[0])
  }
  // 解构声明 const { a, b: c } = ...
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.includes(':') ? part.split(':')[1] : part
      add(name.trim().split(/[\s=]/)[0])
    }
  }
  // 函数参数（含解构参数中的属性名）：function f(a, { b, c }) / (a, b) =>
  for (const m of src.matchAll(/function[^(]*\(([^)]*)\)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.replace(/[{}[\]]/g, '').split(/[:=]/)[0].trim()
      add(name)
      // 解构参数内的字段名（可能被当作变量使用）
      for (const sub of part.split(/[,:{}[\]]+/)) add(sub.trim())
    }
  }
  // 箭头函数参数 (a, b) => / a =>
  for (const m of src.matchAll(/\(([^)]*)\)\s*=>/g)) {
    for (const part of m[1].split(',')) add(part.replace(/[{}[\]]/g, '').split(/[:=]/)[0].trim())
  }
  for (const m of src.matchAll(/(?:^|[\s(,])([A-Za-z_$][\w$]*)\s*=>/gm)) add(m[1])
  // for...of / for...in 的循环变量
  for (const m of src.matchAll(/for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1])
  return defs
}

/**
 * 收集可能是「函数调用」的标识符：形如 name( 但不含 . 前缀（排除对象方法）
 * @param {string} src - 源码（已剔除注释与字符串）
 * @returns {Map<string, number[]>} 标识符 → 行号列表
 */
function collectCalls(src) {
  const calls = new Map()
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    // 跳过 import/export/require 行与对象属性定义行
    if (/\b(import|export)\b/.test(line) && !/\(/.test(line)) return
    // 跳过 for...of / for...in 语句行（其中的 of( / in( 不是函数调用）
    if (/\bfor\s*\(/.test(line) && /\b(of|in)\b/.test(line)) return
    for (const m of line.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[2]
      if (WHITELIST.has(name)) continue
      // 关键字式误报（async( / await( / return( / typeof( 等）
      if (['async', 'await', 'return', 'typeof', 'instanceof', 'of', 'in', 'new', 'delete', 'void', 'case', 'switch', 'do', 'else', 'try', 'catch', 'finally', 'yield'].includes(name)) continue
      if (!calls.has(name)) calls.set(name, [])
      calls.get(name).push(i + 1)
    }
  })
  return calls
}

/**
 * 去除注释与字符串字面量（避免误报）
 * @param {string} src - 源码
 * @returns {string} 清理后的源码
 */
function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
}

// === 主流程 ===
const root = process.cwd()
const files = []
for (const r of ROOTS) {
  const dir = path.join(root, r)
  if (fs.existsSync(dir)) walk(dir, files)
}

let suspicious = 0
for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8')
  const src = stripCommentsAndStrings(raw)
  const defined = collectDefined(src)
  const calls = collectCalls(src)
  for (const [name, at] of calls) {
    if (defined.has(name)) continue
    // 过滤：单个字符、常见缩写属性（如 map/filter）等误报源
    if (name.length <= 1) continue
    console.log(`⚠ ${path.relative(root, file)}:${at[0]} 可能未定义: ${name}(`)
    suspicious++
  }
}

if (suspicious === 0) {
  console.log('✓ 未发现「调用但未定义」的标识符候选')
  process.exit(0)
} else {
  console.log(`\n共 ${suspicious} 处候选——请人工确认（可能是参数/动态调用等误报）`)
  process.exit(1)
}
