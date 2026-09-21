/**
 * buildScrapeUpdate 单测（纯函数，无需网络 / Electron）
 * 重点验证「补全字段」模式：只写当前为空的字段，已有值一律跳过；普通模式行为不变。
 */
import { buildScrapeUpdate, SCRAPE_FIELD_LABELS, statsFillHint } from '../src/utils/global.js'

let pass = 0, fail = 0
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('  [OK]   ' + label + (extra ? '  ' + extra : '')) }
  else { fail++; console.log('  [FAIL] ' + label + (extra ? '  ' + extra : '')) }
}

// 一次「齐全」的刮削结果
const SCRAPED = {
  pm: '片子名', fl: '有码', fxrq: '2024-01-01', yy: '演员A', dy: '导演B',
  ps: '制作商C', fx: '发行商D', xl: '系列E', bq: '标签1，标签2',
  cover: 'covers/X.jpg', previews: ['covers/p1.jpg', 'covers/p2.jpg'],
  want: 1234, watched: 567, score: 4.5, cast: [{ name: '演员A', gender: 'f' }]
}

console.log('=== ① 普通模式（回归）：非空字段全部写入 ===')
{
  const u = buildScrapeUpdate(SCRAPED)
  ok('15 个字段全部映射', Object.keys(u).length === 15, JSON.stringify(Object.keys(u).length))
  ok('yy → yid 映射正确', u.yid === '演员A')
  ok('previews/cast 序列化为 JSON 字符串', typeof u.previews === 'string' && typeof u.cast_json === 'string')
  ok('want/watched/score 为数字', u.want === 1234 && u.watched === 567 && u.score === 4.5)
}

console.log('=== ② 补全模式：字段全空 → 全部写入 ===')
{
  const cur = { pm: '', fl: '', fxrq: '', yid: '', dy: '', ps: '', fx: '', xl: '', bq: '', cover: '', previews: '', want: 0, watched: 0, score: 0, cast_json: '' }
  const u = buildScrapeUpdate(SCRAPED, cur, { fillOnly: true })
  ok('全空记录被全部补齐', Object.keys(u).length === 15, JSON.stringify(Object.keys(u).length))
}

console.log('=== ③ 补全模式：字段齐全 → 一个都不写 ===')
{
  const cur = { pm: '已有', fl: '有码', fxrq: '2020-01-01', yid: '老演员', dy: '老导演', ps: '老制作', fx: '老发行', xl: '老系列', bq: '老标签', cover: 'covers/old.jpg', previews: '["covers/old.jpg"]', want: 9, watched: 9, score: 3.9, cast_json: '[{}]' }
  const u = buildScrapeUpdate(SCRAPED, cur, { fillOnly: true })
  ok('无需补全时返回空对象（调用方据此跳过写库）', Object.keys(u).length === 0, JSON.stringify(u))
}

console.log('=== ④ 补全模式：只缺评分与想看/看过（用户主要场景）===')
{
  const cur = { pm: '已有片名', fl: '有码', fxrq: '2020-01-01', yid: '演员A', dy: '导演B', ps: '制作商C', fx: '发行商D', xl: '系列E', bq: '标签1', cover: 'covers/x.jpg', previews: '["covers/p.jpg"]', want: 0, watched: 0, score: 0, cast_json: '[{"name":"演员A"}]' }
  const u = buildScrapeUpdate(SCRAPED, cur, { fillOnly: true })
  const keys = Object.keys(u).sort()
  ok('只写了 want/watched/score 三项', JSON.stringify(keys) === '["score","want","watched"]', JSON.stringify(keys))
  ok('已有片名未被覆盖', u.pm === undefined)
  ok('已有标签未被覆盖', u.bq === undefined)
}

console.log('=== ⑤ 补全模式：0 视为空（可被补齐），非 0 不覆盖 ===')
{
  const u1 = buildScrapeUpdate(SCRAPED, { score: 0, want: 0, watched: 0 }, { fillOnly: true })
  ok('0 → 补齐', u1.score === 4.5 && u1.want === 1234 && u1.watched === 567)
  const u2 = buildScrapeUpdate(SCRAPED, { score: 4.9, want: 1, watched: 1 }, { fillOnly: true })
  ok('已有非 0 值 → 不覆盖', u2.score === undefined && u2.want === undefined && u2.watched === undefined)
}

console.log("=== ⑥ 补全模式：空数组序列化 '[]' 视为空 ===")
{
  const u = buildScrapeUpdate(SCRAPED, { previews: '[]', cast_json: '[]' }, { fillOnly: true })
  ok("previews '[]' 可被补齐", typeof u.previews === 'string')
  ok("cast_json '[]' 可被补齐", typeof u.cast_json === 'string')
}

console.log('=== ⑦ 边界：current 传 null 时不误判为空而丢字段 ===')
{
  const u = buildScrapeUpdate(SCRAPED, null, { fillOnly: true })
  // 无参照记录时退化为「只写刮削到的、且不因空值跳过」：不能把一个字段都不写
  ok('仍有字段被写入（不会静默不补）', Object.keys(u).length > 0, JSON.stringify(Object.keys(u).length))
}

console.log('=== ⑧ 刮削结果为空/缺字段 ===')
{
  ok('d 为 null → 空对象', Object.keys(buildScrapeUpdate(null)).length === 0)
  const u = buildScrapeUpdate({ pm: '', score: 0, want: null }, { pm: '' }, { fillOnly: true })
  ok('刮削结果本身为空值 → 不写入', Object.keys(u).length === 0, JSON.stringify(u))
}

console.log('=== ⑨ 提示用的中文字段名齐全 ===')
{
  const need = ['pm', 'fl', 'fxrq', 'yid', 'dy', 'ps', 'fx', 'xl', 'bq', 'cover', 'previews', 'want', 'watched', 'score', 'cast_json']
  const miss = need.filter(k => !SCRAPE_FIELD_LABELS[k])
  ok('15 个字段都有中文名', miss.length === 0, miss.length ? '缺 ' + miss.join(',') : '')
}

console.log('=== ⑩ statsFillHint：统计字段缺失提示 ===')
{
  ok('三项都缺 → 全部列出', statsFillHint({ score: 0, want: 0, watched: 0 }, true) === '评分、想看人数、看过人数', statsFillHint({ score: 0, want: 0, watched: 0 }, true))
  ok('都不缺 → 空串', statsFillHint({ score: 4.5, want: 1, watched: 2 }, true) === '')
  ok('只缺评分 → 只列评分', statsFillHint({ score: 0, want: 9, watched: 9 }, true) === '评分')
  ok('未开启统计抓取 → 不提示', statsFillHint({ score: 0, want: 0, watched: 0 }, false) === '')
  ok('current 为 null → 空串', statsFillHint(null, true) === '')
}

console.log(`\n==== 结果: 通过 ${pass} / 失败 ${fail} ====`)
process.exit(fail ? 1 : 0)
