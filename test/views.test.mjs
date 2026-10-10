import test from 'node:test'
import assert from 'node:assert/strict'

import { addDays } from '../src/shared/date.js'
import {
  MODULES,
  SMART_VIEWS,
  applyView,
  attachProjectName,
  groupByModule,
  groupByPlatform,
  moduleAxis,
  moduleOf,
  smartCounts,
  sortOrders,
  sortPlans,
  weekBoard
} from '../src/shared/views.js'

const today = '2026-10-10'

const project = (patch) => ({
  id: 'p1', name: '手机银行迭代', module: '移动端开发', platform: '移动手机', status: '进行中',
  owner: '我', startedOn: addDays(today, -10), dueDate: addDays(today, 10), progress: 50,
  link: '', summary: '转账限额与消息中心', tags: ['后端'], createdAt: '', updatedAt: '',
  ...patch
})

const order = (patch) => ({
  id: 'o1', projectId: 'p1', title: '限额调整', kind: '迭代需求', priority: '中', stage: '开发中',
  owner: '我', target: '', estDays: 3, dueDate: addDays(today, 3), description: '', createdAt: '', updatedAt: '',
  ...patch
})

const plan = (patch) => ({
  id: 'n1', projectId: 'p1', orderId: '', title: '确认口径', owner: '我', status: '进行中',
  startedOn: addDays(today, -2), dueDate: addDays(today, 1), progress: 30, note: '', createdAt: '', updatedAt: '',
  ...patch
})

test('moduleOf 缺省归到第一个模块', () => {
  assert.equal(moduleOf({}), MODULES[0])
  assert.equal(moduleOf({ module: '  日常工作 ' }), '日常工作')
})

test('moduleAxis 给出全部 + 固定模块 + 自定义模块，并带计数', () => {
  const projects = [project({ id: 'p1' }), project({ id: 'p2', module: '专项攻坚', status: '阻塞' })]
  const orders = [order({ id: 'o1', projectId: 'p1' }), order({ id: 'o2', projectId: 'p1', stage: '已上线' })]
  const axis = moduleAxis(projects, orders, [], today)
  assert.equal(axis[0].id, '')
  assert.equal(axis[0].count, 2)
  assert.equal(axis[0].openOrders, 1)
  assert.ok(axis.some((row) => row.id === '专项攻坚' && row.count === 1))
  assert.ok(axis.some((row) => row.id === '日常工作' && row.count === 0))
})

test('applyView：默认排除已完成，smart 视图各自过滤', () => {
  const projects = [project({ id: 'p1' }), project({ id: 'p2', status: '已完成' }), project({ id: 'p3', dueDate: addDays(today, -2) })]
  const orders = [order({ id: 'o1', projectId: 'p1' }), order({ id: 'o2', projectId: 'p1', dueDate: addDays(today, -1) })]
  const plans = [plan({ id: 'n1', projectId: 'p1', dueDate: addDays(today, 1) })]

  const all = applyView(projects, orders, plans, { view: 'all' }, today)
  assert.deepEqual(all.projects.map((item) => item.id), ['p1', 'p3'])
  assert.equal(all.orders.length, 2)
  assert.equal(all.plans.length, 1)

  const overdue = applyView(projects, orders, plans, { view: 'overdue' }, today)
  // p1 未逾期；p3 自身逾期，且它没有子项
  assert.deepEqual(overdue.projects.map((item) => item.id), ['p3'])
  assert.deepEqual(overdue.orders.map((item) => item.id), ['o2'])

  const done = applyView(projects, orders, plans, { view: 'done' }, today)
  assert.deepEqual(done.projects.map((item) => item.id), ['p2'])

  const week = applyView(projects, orders, plans, { view: 'week' }, today)
  assert.ok(week.orders.every((item) => item.dueDate >= today))

  const unscheduled = applyView([project({ id: 'p9', startedOn: '', dueDate: '' })], [order({ projectId: 'p9', dueDate: '' })], [plan({ projectId: 'p9', dueDate: '' })], { view: 'unscheduled' }, today)
  assert.equal(unscheduled.projects.length, 1)
  assert.equal(unscheduled.orders.length, 1)
  assert.equal(unscheduled.plans.length, 1)
})

test('applyView：模块、平台与关键词筛选', () => {
  const projects = [project({ id: 'p1' }), project({ id: 'p2', module: '日常工作', platform: '小程序', name: '周例会' })]
  const orders = [order({ id: 'o1', projectId: 'p1' }), order({ id: 'o2', projectId: 'p2', title: '例会纪要', description: '' })]
  const plans = [plan({ id: 'n1', projectId: 'p1' }), plan({ id: 'n2', projectId: 'p2', title: '整理周报' })]

  const byModule = applyView(projects, orders, plans, { moduleId: '日常工作' }, today)
  assert.deepEqual(byModule.projects.map((item) => item.id), ['p2'])
  assert.deepEqual(byModule.orders.map((item) => item.id), ['o2'])

  const byPlatform = applyView(projects, orders, plans, { platform: '移动手机' }, today)
  assert.deepEqual(byPlatform.projects.map((item) => item.id), ['p1'])

  const byKeyword = applyView(projects, orders, plans, { search: '例会' }, today)
  assert.deepEqual(byKeyword.projects.map((item) => item.id), ['p2'])
  assert.ok(byKeyword.orders.some((item) => item.id === 'o2'))

  const none = applyView(projects, orders, plans, { search: '不存在的关键词' }, today)
  assert.equal(none.projects.length, 0)
  assert.equal(none.orders.length, 0)
  assert.equal(none.plans.length, 0)
})

test('smartCounts 覆盖全部智能视图', () => {
  const counts = smartCounts([project({})], [order({})], [plan({})], {}, today)
  assert.equal(counts.length, SMART_VIEWS.length)
  assert.equal(counts[0].id, 'all')
  assert.ok(counts[0].count >= 1)
  assert.ok(counts.every((row) => Number.isFinite(row.count)))
})

test('groupByModule / groupByPlatform 分区且按风险排序', () => {
  const projects = [project({ id: 'p1' }), project({ id: 'p2', status: '阻塞' }), project({ id: 'p3', module: '日常工作', platform: '小程序' })]
  const modules = groupByModule(projects, [], [], today)
  const mobile = modules.find((group) => group.module === '移动端开发')
  assert.equal(mobile.count, 2)
  assert.equal(mobile.items[0].id, 'p2')
  const platforms = groupByPlatform(projects, [], [], today)
  assert.ok(platforms.some((group) => group.platform === '小程序'))
})

test('sortOrders / sortPlans 支持多种排序', () => {
  const projects = [project({})]
  const orders = [order({ id: 'o1', dueDate: addDays(today, 9), priority: '低' }), order({ id: 'o2', dueDate: addDays(today, -1), priority: '紧急' })]
  assert.equal(sortOrders(orders, projects, today, 'due')[0].id, 'o2')
  assert.equal(sortOrders(orders, projects, today, 'priority')[0].id, 'o2')
  assert.equal(sortOrders(orders, projects, today, 'risk')[0].id, 'o2')
  assert.equal(attachProjectName(orders, projects)[0].projectName, '手机银行迭代')
  const plans = [plan({ id: 'n1', dueDate: addDays(today, 9) }), plan({ id: 'n2', dueDate: addDays(today, 1) })]
  assert.equal(sortPlans(plans, projects, today, 'due')[0].id, 'n2')
  assert.equal(sortPlans(plans, projects, today, 'risk')[0].id, 'n2')
  const donePlan = plan({ id: 'n3', status: '已完成', dueDate: addDays(today, 40) })
  assert.equal(sortPlans([...plans, donePlan], projects, today, 'risk').some((item) => item.id === 'n3'), true)
})

test('weekBoard 把工单与计划落到周一到周日', () => {
  const projects = [project({})]
  const orders = [order({ id: 'o1', dueDate: '2026-10-12' })]
  const plans = [plan({ id: 'n1', dueDate: '2026-10-15' })]
  const board = weekBoard(orders, plans, projects, today)
  assert.equal(board.start, '2026-10-05')
  assert.equal(board.end, '2026-10-11')
  assert.equal(board.days.length, 7)
  const monday = board.days.find((day) => day.date === '2026-10-12')
  assert.equal(monday, undefined)
  const next = weekBoard(orders, plans, projects, '2026-10-12')
  assert.equal(next.start, '2026-10-12')
  assert.equal(next.days[0].items.length, 1)
  assert.equal(next.days[3].items.length, 1)
})
