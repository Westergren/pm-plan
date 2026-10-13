import test from 'node:test'
import assert from 'node:assert/strict'

import { addDays } from '../src/shared/date.js'
import { DEFAULT_MODULES, DEFAULT_PLATFORMS } from '../src/shared/model.js'
import {
  SMART_VIEWS,
  applyView,
  attachModuleName,
  attachProjectName,
  groupByModule,
  groupByPlatform,
  moduleOf,
  moduleOptions,
  orderSmartCounts,
  platformOptions,
  projectSmartCounts,
  sortOrders,
  sortPlans,
  targetOptions,
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
  id: 'o1', code: '', module: '移动端开发', title: '限额调整', kind: '迭代需求', priority: '中', stage: '开发中',
  owner: '我', target: '', dueDate: addDays(today, 3), createdOn: '2026-09-20', description: '', createdAt: '', updatedAt: '',
  ...patch
})

const plan = (patch) => ({
  id: 'n1', projectId: 'p1', orderId: '', title: '确认口径', owner: '我', status: '进行中',
  startedOn: addDays(today, -2), dueDate: addDays(today, 1), progress: 30, note: '', createdAt: '', updatedAt: '',
  ...patch
})

test('moduleOf 缺省归到配置里的第一个模块', () => {
  assert.equal(moduleOf({}), DEFAULT_MODULES[0])
  assert.equal(moduleOf({}, ['甲', '乙']), '甲')
  assert.equal(moduleOf({ module: '  日常工作 ' }), '日常工作')
})

test('moduleOptions / platformOptions / targetOptions 并入配置与历史取值', () => {
  const projects = [project({ id: 'p1' }), project({ id: 'p2', module: '专项攻坚', platform: '平板' })]
  const orders = [order({ id: 'o1', target: '移动手机' }), order({ id: 'o2', target: '车机' })]

  const modules = moduleOptions(DEFAULT_MODULES, projects)
  assert.equal(modules[0], DEFAULT_MODULES[0])
  assert.ok(modules.includes('专项攻坚'), '数据里的自定义模块要出现在筛选条里')
  assert.equal(new Set(modules).size, modules.length, '取值不重复')

  const platforms = platformOptions(DEFAULT_PLATFORMS, projects)
  assert.ok(platforms.includes('平板'), '配置里没有的端也要保留')
  assert.equal(platforms[0], DEFAULT_PLATFORMS[0])

  const targets = targetOptions(DEFAULT_PLATFORMS, orders)
  assert.ok(targets.includes('车机'))
  assert.ok(targets.every((name) => name.trim() === name && name))
})

test('applyView：view 为空不做状态过滤，smart 视图各自过滤', () => {
  const projects = [project({ id: 'p1' }), project({ id: 'p2', status: '已完成' }), project({ id: 'p3', dueDate: addDays(today, -2) })]
  const orders = [order({ id: 'o1' }), order({ id: 'o2', dueDate: addDays(today, -1) })]
  const plans = [plan({ id: 'n1', projectId: 'p1', dueDate: addDays(today, 1) })]

  // 不传 view 是项目/工单页的默认口径：全量保留，已完成的项目也在列表里。
  // 这两个页面不再摆智能视图筛选项，默认口径就不能自带任何状态过滤。
  const plain = applyView(projects, orders, plans, {}, today)
  assert.deepEqual(plain.projects.map((item) => item.id), ['p1', 'p2', 'p3'])
  assert.equal(plain.orders.length, 2)
  assert.equal(plain.plans.length, 1)

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

  const unscheduled = applyView([project({ id: 'p9', startedOn: '', dueDate: '' })], [order({ module: '移动端开发', dueDate: '' })], [plan({ projectId: 'p9', dueDate: '' })], { view: 'unscheduled' }, today)
  assert.equal(unscheduled.projects.length, 1)
  assert.equal(unscheduled.orders.length, 1)
  assert.equal(unscheduled.plans.length, 1)
})

test('applyView：模块、平台与关键词筛选', () => {
  const projects = [project({ id: 'p1' }), project({ id: 'p2', module: '日常工作', platform: '小程序', name: '周例会' })]
  const orders = [order({ id: 'o1' }), order({ id: 'o2', module: '日常工作', title: '例会纪要', description: '' })]
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

test('applyView：目标端只筛工单，不动项目与计划', () => {
  const projects = [project({ id: 'p1' }), project({ id: 'p2' })]
  const orders = [order({ id: 'o1', target: '移动手机' }), order({ id: 'o2', module: '日常工作', target: '车机' })]
  const plans = [plan({ id: 'n1', projectId: 'p1' })]

  const scoped = applyView(projects, orders, plans, { target: '车机' }, today)
  assert.deepEqual(scoped.orders.map((item) => item.id), ['o2'])
  assert.equal(scoped.projects.length, 2, '目标端不是项目维度')
  assert.equal(scoped.plans.length, 1)
})

test('projectSmartCounts / orderSmartCounts 覆盖全部智能视图且口径各自独立', () => {
  const projects = [project({ id: 'p1' }), project({ id: 'p2', status: '已完成' })]
  const orders = [order({ id: 'o1' }), order({ id: 'o2', stage: '已上线' })]
  const plans = [plan({ id: 'n1', projectId: 'p1' })]
  const today2 = '2026-10-10'

  const projects2 = projectSmartCounts(projects, orders, plans, {}, today2)
  assert.equal(projects2.length, SMART_VIEWS.length)
  assert.equal(projects2[0].id, 'all')
  assert.equal(projects2[0].count, 1, '在管口径排除已完成项目')
  assert.equal(projects2.find((row) => row.id === 'done').count, 1)
  assert.ok(projects2.every((row) => Number.isFinite(row.count)))

  const orders2 = orderSmartCounts(projects, orders, plans, {}, today2)
  assert.equal(orders2.length, SMART_VIEWS.length)
  assert.equal(orders2[0].count, 1, '在管口径排除已上线工单')
  assert.equal(orders2.find((row) => row.id === 'done').count, 1)

  // 模块与端筛选同样影响统计口径
  const narrowed = projectSmartCounts(projects, orders, plans, { moduleId: '不存在的模块' }, today2)
  assert.ok(narrowed.every((row) => row.count === 0))
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

test('groupByModule / groupByPlatform 跟随配置，并保留配置外的历史取值', () => {
  const projects = [project({ id: 'p1', module: '自研', platform: '车机' })]

  // 配置里没有的取值不能被丢掉，否则改配置后旧项目会从界面上消失
  const modules = groupByModule(projects, [], [], today, ['移动端开发'])
  assert.deepEqual(modules.map((group) => group.module), ['自研'])
  assert.equal(modules[0].count, 1)

  const platforms = groupByPlatform(projects, [], [], today, ['移动手机'])
  assert.deepEqual(platforms.map((group) => group.platform), ['车机'])

  // 空分组不进看板：项目页本来也不该出现 0 条的模块
  const empty = groupByModule([], [], [], today, ['移动端开发', '日常工作'])
  assert.deepEqual(empty, [])
})

test('sortOrders / sortPlans 支持多种排序', () => {
  const projects = [project({})]
  const orders = [order({ id: 'o1', dueDate: addDays(today, 9), priority: '低' }), order({ id: 'o2', dueDate: addDays(today, -1), priority: '紧急' })]
  assert.equal(sortOrders(orders, today, 'due')[0].id, 'o2')
  assert.equal(sortOrders(orders, today, 'priority')[0].id, 'o2')
  assert.equal(sortOrders(orders, today, 'risk')[0].id, 'o2')
  // 工单不再显示归属项目，而是它挂的模块
  assert.equal(attachModuleName(orders)[0].moduleName, '移动端开发')
  assert.equal(attachModuleName([order({ module: '' })])[0].moduleName, '未归模块')
  assert.equal(attachProjectName([plan({})], projects)[0].projectName, '手机银行迭代')
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
