import test from 'node:test'
import assert from 'node:assert/strict'

import {
  RISK_LEVELS,
  decorateProjects,
  headline,
  isOrderDone,
  isPlanDone,
  kpis,
  needsAttention,
  orderRisk,
  ownerWorkload,
  planRisk,
  platformLoad,
  projectRisk,
  riskBreakdown,
  riskItems,
  stageProgress,
  statusColumns,
  timeRatio,
  todayBuckets,
  dateRiskLevel
} from '../src/shared/metrics.js'
import { todayISO, addDays } from '../src/shared/date.js'

const today = '2026-10-10'

const project = (patch) => ({
  id: 'p1', name: '手机银行迭代', module: '移动端开发', platform: '移动手机', status: '进行中',
  owner: '我', startedOn: addDays(today, -10), dueDate: addDays(today, 10), progress: 50,
  link: '', summary: '', tags: [], createdAt: '', updatedAt: '',
  ...patch
})

const order = (patch) => ({
  id: 'o1', projectId: 'p1', title: '限额调整', kind: '迭代需求', priority: '中', stage: '开发中',
  owner: '我', target: '', estDays: 3, dueDate: addDays(today, 5), description: '', createdAt: new Date().toISOString(), updatedAt: '',
  ...patch
})

const plan = (patch) => ({
  id: 'n1', projectId: 'p1', orderId: '', title: '确认口径', owner: '我', status: '进行中',
  startedOn: addDays(today, -5), dueDate: addDays(today, 2), progress: 40, note: '', createdAt: '', updatedAt: '',
  ...patch
})

test('dateRiskLevel 覆盖逾期 / 紧急 / 临近 / 正常 / 未排期', () => {
  assert.equal(dateRiskLevel(addDays(today, -1), today), '已逾期')
  assert.equal(dateRiskLevel(addDays(today, 0), today), '紧急')
  assert.equal(dateRiskLevel(addDays(today, 2), today), '紧急')
  assert.equal(dateRiskLevel(addDays(today, 5), today), '临近')
  assert.equal(dateRiskLevel(addDays(today, 6), today), '正常')
  assert.equal(dateRiskLevel('', today), '未排期')
})

test('timeRatio 只在有起止日期时给出比例', () => {
  assert.equal(timeRatio(addDays(today, -5), addDays(today, 5), today), 50)
  assert.equal(timeRatio('', addDays(today, 5), today), null)
  assert.equal(timeRatio(addDays(today, -5), addDays(today, -5), today), null)
  assert.equal(stageProgress('开发中'), 40)
  assert.equal(stageProgress('已上线'), 100)
})

test('orderRisk：完成态、逾期、优先级紧急、进度落后', () => {
  assert.equal(orderRisk(order({ stage: '已上线' }), today), '已完成')
  assert.equal(orderRisk(order({ stage: '已取消' }), today), '已完成')
  assert.equal(orderRisk(order({ dueDate: addDays(today, -3) }), today), '已逾期')
  assert.equal(orderRisk(order({ stage: '待评审', priority: '紧急', dueDate: addDays(today, 20) }), today), '紧急')
  const lagging = order({ stage: '开发中', startedOn: addDays(today, -10), createdAt: new Date(Date.now() - 10 * 86400000).toISOString(), dueDate: addDays(today, 1) })
  assert.equal(orderRisk(lagging, today), '紧急')
  assert.equal(orderRisk(order({ dueDate: '' }), today), '未排期')
})

test('planRisk：完成态、未开始且未到开始日、逾期、进度落后', () => {
  assert.equal(planRisk(plan({ status: '已完成' }), today), '已完成')
  assert.equal(planRisk(plan({ status: '已取消' }), today), '已完成')
  assert.equal(planRisk(plan({ status: '未开始', startedOn: addDays(today, 3), dueDate: addDays(today, 8) }), today), '正常')
  assert.equal(planRisk(plan({ dueDate: addDays(today, -1) }), today), '已逾期')
  assert.equal(planRisk(plan({ startedOn: addDays(today, -9), dueDate: addDays(today, 1), progress: 5 }), today), '紧急')
  assert.equal(planRisk(plan({ startedOn: addDays(today, -20), dueDate: addDays(today, 10), progress: 5 }), today), '进度风险')
  assert.equal(planRisk(plan({ dueDate: '' }), today), '未排期')
})

test('projectRisk 取项目自身与子项里最严重的一档', () => {
  const healthy = project({ progress: 60 })
  assert.equal(projectRisk(healthy, [], [], today), '正常')
  const blocked = project({ status: '阻塞' })
  assert.equal(projectRisk(blocked, [], [], today), '阻塞')
  assert.equal(projectRisk(project({ status: '已完成' }), [], [], today), '已完成')
  assert.equal(projectRisk(project({ dueDate: addDays(today, -2) }), [], [], today), '已逾期')
  // 子工单逾期，项目也要标成已逾期
  assert.equal(projectRisk(healthy, [order({ dueDate: '' })], [], today), '未排期')
  assert.equal(projectRisk(healthy, [order({ dueDate: '' })], [/* 无计划 */], today), '未排期')
  assert.equal(projectRisk(healthy, [order({ dueDate: addDays(today, -1) })], [], today), '已逾期')
  // 未完成子项全部正常时，项目本身正常
  assert.equal(projectRisk(healthy, [order({ dueDate: addDays(today, 9), stage: '开发中' })], [plan({ dueDate: addDays(today, 20), progress: 80 })], today), '正常')
  // 没有排期的项目
  assert.equal(projectRisk(project({ startedOn: '', dueDate: '' }), [], [], today), '未排期')
})

test('decorateProjects 汇总子项计数与需关注标记', () => {
  const projects = [project({})]
  const orders = [order({ id: 'o1' }), order({ id: 'o2', dueDate: addDays(today, -1) }), order({ id: 'o3', stage: '已上线' })]
  const plans = [plan({ id: 'n1' }), plan({ id: 'n2', status: '已完成' })]
  const [decorated] = decorateProjects(projects, orders, plans, today)
  assert.equal(decorated.orderTotal, 3)
  assert.equal(decorated.orderOpen, 2)
  assert.equal(decorated.orderOverdue, 1)
  assert.equal(decorated.planOpen, 1)
  assert.equal(decorated.risk, '已逾期')
  assert.equal(decorated.attention, true)
  assert.equal(decorated.daysLeft, 10)
})

test('kpis 与 riskBreakdown 覆盖全部口径', () => {
  const projects = [project({ id: 'p1', progress: 40 }), project({ id: 'p2', status: '已完成', progress: 100 })]
  const orders = [order({ id: 'o1', projectId: 'p1', dueDate: addDays(today, 1) }), order({ id: 'o2', projectId: 'p1', dueDate: addDays(today, -2) })]
  const plans = [plan({ id: 'n1', projectId: 'p1', dueDate: '' })]
  const data = kpis(projects, orders, plans, today)
  assert.equal(data.projects, 2)
  assert.equal(data.active, 1)
  assert.equal(data.avgProgress, 40)
  assert.equal(data.orderOpen, 2)
  assert.equal(data.orderOverdue, 1)
  assert.equal(data.orderWeek, 1)
  assert.equal(data.planOpen, 1)
  assert.ok(data.unscheduled >= 1)
  const breakdown = riskBreakdown(projects, orders, plans, today)
  assert.equal(breakdown.length, RISK_LEVELS.length)
  assert.equal(breakdown.reduce((sum, row) => sum + row.count, 0), 2)
  assert.ok(headline(projects, orders, plans, today).length > 0)
  assert.ok(headline([], [], [], today).includes('还没有登记项目'))
})

test('riskItems / todayBuckets 把工单、计划、项目统一成可排序条目', () => {
  const projects = [project({})]
  const orders = [order({ id: 'o1', dueDate: addDays(today, -1) })]
  const plans = [plan({ id: 'n1', dueDate: today })]
  const items = riskItems(projects, orders, plans, today)
  assert.ok(items.some((item) => item.kind === 'order' && item.risk === '已逾期'))
  assert.ok(items.some((item) => item.kind === 'plan'))
  const buckets = todayBuckets(projects, orders, plans, today)
  // 项目 p1 因为挂了逾期工单，本身也判定为已逾期，所以逾期桶是 2 条
  assert.equal(buckets.overdue.length, 2)
  assert.ok(buckets.dueToday.length >= 1)
  assert.equal(needsAttention('临近'), false)
  assert.equal(needsAttention('进度风险'), true)
})

test('statusColumns / platformLoad / ownerWorkload 聚合正确', () => {
  const projects = [project({ id: 'p1', owner: '我' }), project({ id: 'p2', owner: '张三', platform: '小程序', status: '阻塞' })]
  const orders = [order({ id: 'o1', projectId: 'p1', owner: '我' }), order({ id: 'o2', projectId: 'p2', owner: '张三', stage: '待上线' })]
  const columns = statusColumns(projects, orders, [], today)
  assert.equal(columns.find((column) => column.status === '进行中').count, 1)
  assert.equal(columns.find((column) => column.status === '阻塞').count, 1)
  const platforms = platformLoad(projects, orders, today)
  assert.equal(platforms.length, 2)
  const owners = ownerWorkload(projects, orders, [], today)
  assert.equal(owners.length, 2)
  assert.equal(owners[0].total >= owners[1].total, true)
})

test('isOrderDone / isPlanDone 口径一致', () => {
  assert.equal(isOrderDone({ stage: '已上线' }), true)
  assert.equal(isOrderDone({ stage: '待上线' }), false)
  assert.equal(isPlanDone({ status: '已完成' }), true)
  assert.equal(isPlanDone({ status: '已取消' }), true)
  assert.equal(isPlanDone({ status: '进行中' }), false)
  assert.equal(todayISO(new Date(2026, 9, 10)), '2026-10-10')
})
