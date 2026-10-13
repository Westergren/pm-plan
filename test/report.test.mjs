import test from 'node:test'
import assert from 'node:assert/strict'

import { REPORT_KINDS, buildReport, periodStats, projectReport, quarterlyReport, weeklyReport } from '../src/shared/report.js'
import { addDays } from '../src/shared/date.js'
import { normalizeState } from '../src/shared/model.js'

const today = '2026-10-10'

const project = (patch) => ({
  id: 'p1', name: '手机银行迭代', module: '移动端开发', platform: '移动手机', status: '进行中',
  owner: '我', startedOn: addDays(today, -20), dueDate: addDays(today, 5), progress: 50,
  link: '', summary: '转账限额与消息中心改版', tags: [], createdAt: '', updatedAt: '',
  ...patch
})

const order = (patch) => ({
  id: 'o1', code: 'WO-1', module: '移动端开发', title: '限额调整', kind: '迭代需求', priority: '高', stage: '开发中',
  owner: '我', target: '', dueDate: addDays(today, 2), createdOn: '2026-09-25', description: '', createdAt: '', updatedAt: '',
  ...patch
})

const plan = (patch) => ({
  id: 'n1', module: '移动端开发', title: '确认限额口径', owner: '我', status: '进行中',
  startedOn: addDays(today, -3), dueDate: today, note: '', createdAt: '', updatedAt: '',
  ...patch
})

const stateOf = (projects, orders, plans, logs) => normalizeState({
  projects: projects.map((project) => ({ ...project })),
  orders: orders.map((order) => ({ ...order })),
  plans: plans.map((plan) => ({ ...plan })),
  logs: logs.map((log) => ({ ...log }))
})

const logs = [
  { id: 'l1', refType: 'project', refId: 'p1', at: new Date().toISOString(), kind: '进展', text: '评审通过' },
  { id: 'l2', refType: 'order', refId: 'o1', at: new Date().toISOString(), kind: '阻塞', text: '等待口径' }
]

test('periodStats 按区间统计完成与到期', () => {
  const stats = periodStats([project({})], [order({ id: 'o1', stage: '已上线', dueDate: addDays(today, -1) }), order({ id: 'o2' })], [plan({ id: 'n1', status: '已完成', dueDate: today })], addDays(today, -6), today, today)
  assert.equal(stats.doneOrders.length, 1)
  assert.equal(stats.donePlans.length, 1)
  assert.equal(stats.doneCount, 2)
  assert.equal(stats.totalCount, 3)
})

test('weeklyReport 包含六个小节并引用真实数据', () => {
  const state = stateOf([project({})], [order({})], [plan({})], logs)
  const text = weeklyReport(state.projects, state.orders, state.plans, today)
  assert.match(text, /^# 工作周报/)
  assert.match(text, /## 一、本周概览/)
  assert.match(text, /## 六、需要支持/)
  assert.match(text, /手机银行迭代/)
  // 计划今天到期 -> 出现在「本周期内到期」；工单后天（下周一）到期 -> 出现在「下周计划」
  assert.match(text, /确认限额口径/)
  const sectionOf = (start, end) => text.slice(text.indexOf(start), text.indexOf(end))
  assert.match(sectionOf('## 三、进行中的重点', '## 四、风险与待跟进'), /确认限额口径/)
  assert.match(sectionOf('## 五、下周计划', '## 六、需要支持'), /限额调整/)
})

test('weeklyReport 把本周期内到期的工单列进重点', () => {
  const state = stateOf([project({})], [order({ dueDate: addDays(today, 1) })], [plan({})], logs)
  const text = weeklyReport(state.projects, state.orders, state.plans, today)
  const section = text.slice(text.indexOf('### 本周期内到期'), text.indexOf('## 四'))
  assert.match(section, /限额调整/)
  assert.match(section, /确认限额口径/)
})

test('weeklyReport 在没有项目时也能产出可读文档', () => {
  const text = weeklyReport([], [], [], today)
  assert.match(text, /在管项目 0 个/)
  assert.ok(text.length > 100)
})

test('quarterlyReport 输出季度区间与多端进展', () => {
  const state = stateOf([project({})], [order({ stage: '已上线', dueDate: today })], [plan({ status: '已完成', dueDate: today })], logs)
  const text = quarterlyReport(state.projects, state.orders, state.plans, today)
  assert.match(text, /季度工作汇报（2026 年 Q4）/)
  assert.match(text, /2026-10-01/)
  assert.match(text, /## 三、多端进展/)
  assert.match(text, /移动手机/)
})

test('projectReport 只讲项目自身与它的进展记录', () => {
  const state = stateOf([project({})], [order({})], [plan({})], logs)
  const text = projectReport(state.projects[0], state.logs, today)
  assert.match(text, /^# 手机银行迭代 · 状态汇报/)
  assert.match(text, /模块：移动端开发｜端：移动手机/)
  assert.match(text, /投产：/)
  // 工单与计划都挂模块、不归项目，所以项目汇报里两节都没有了
  assert.ok(!text.includes('## 需求与变更工单'))
  assert.ok(!text.includes('## 工作计划与跟进'))
  assert.match(text, /## 最近进展/)
  assert.match(text, /评审通过/)
  // 工单的日志不算进项目汇报
  assert.ok(!text.includes('等待口径'))
})

test('buildReport 按类型分发，project 缺项目时给出兜底文案', () => {
  const data = stateOf([project({})], [order({})], [plan({})], logs)
  assert.match(buildReport('weekly', data, { today }), /工作周报/)
  assert.match(buildReport('quarterly', data, { today }), /季度工作汇报/)
  assert.match(buildReport('project', data, { today, projectId: 'p1' }), /手机银行迭代/)
  assert.match(buildReport('project', { projects: [], orders: [], plans: [], logs: [] }, { today }), /没有可汇报的项目/)
  assert.equal(REPORT_KINDS.length, 3)
})
