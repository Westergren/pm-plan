import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  DEFAULT_MODULES,
  DEFAULT_PLATFORMS,
  ORDER_STAGES,
  createId,
  emptyState,
  nextStage,
  normalizeState,
  suggestedProgress
} from '../src/shared/model.js'

test('createId 生成唯一且带前缀的 id', () => {
  const ids = new Set()
  for (let index = 0; index < 500; index += 1) ids.add(createId('prj'))
  assert.equal(ids.size, 500)
  for (const id of ids) assert.match(id, /^prj-/)
})

test('normalizeState 在空输入下给出可用的空结构', () => {
  const state = normalizeState(null)
  assert.equal(state.version, 1)
  assert.deepEqual(state.projects, [])
  assert.deepEqual(state.orders, [])
  assert.deepEqual(state.plans, [])
  assert.deepEqual(state.logs, [])
  assert.deepEqual(state.config.modules, DEFAULT_MODULES)
  assert.deepEqual(state.config.platforms, DEFAULT_PLATFORMS)
})

test('config 来自数据、可自定义，并能清洗非法项', () => {
  const custom = normalizeState({ config: { modules: ['甲', '乙', '甲', '  ', 3, '丙'], platforms: '不是数组' } })
  assert.deepEqual(custom.config.modules, ['甲', '乙', '丙'])
  assert.deepEqual(custom.config.platforms, DEFAULT_PLATFORMS, '配置坏了要回落到默认值')

  const blank = normalizeState({ config: { modules: [], platforms: ['  '] } })
  assert.deepEqual(blank.config.modules, DEFAULT_MODULES)
  assert.deepEqual(blank.config.platforms, DEFAULT_PLATFORMS)
})

test('normalizeState 丢弃脏数据、补默认值、统一枚举', () => {
  const state = normalizeState({
    projects: [
      { id: 'p1', name: '手机银行迭代', platform: '不存在的端', status: '瞎写', progress: 260, tags: ['示例', '示例', '  ', '后端'] },
      { name: '   ' },
      { id: 'p1', name: '重复 id' },
      null,
      { id: 'p2', name: 'PAD 建档', module: '移动端开发', startedOn: '2026-10-01', dueDate: '2026/10/10' }
    ],
    orders: [
      { id: 'o1', projectId: 'p1', title: '限额调整', stage: '不存在的阶段', priority: '特急', kind: '迭代需求', estDays: 999 },
      { id: 'o9', projectId: 'ghost', title: '孤儿工单' }
    ],
    plans: [
      { id: 'n1', projectId: 'p1', orderId: 'o1', title: '确认口径', status: '瞎写', progress: -5 },
      { id: 'n2', projectId: 'ghost', title: '孤儿计划' }
    ],
    logs: [
      { refType: 'project', refId: 'p1', text: '评审通过', kind: '进展', at: '2026-10-01T00:00:00.000Z' },
      { refType: 'project', refId: '不存在', text: '幽灵记录' },
      { refType: 'plan', refId: 'n1', text: '等待回复', kind: '瞎写' }
    ]
  })

  assert.equal(state.projects.length, 2)
  // 端与模块都是可配置的自由文本：不认识的历史取值原样保留，不再被强改成「其他」
  assert.equal(state.projects[0].platform, '不存在的端')
  assert.equal(state.projects[0].status, '进行中')
  assert.equal(state.projects[0].progress, 100)
  assert.deepEqual(state.projects[0].tags, ['示例', '后端'])
  assert.equal(state.projects[1].module, '移动端开发')
  assert.equal(state.projects[1].dueDate, '')

  assert.equal(state.orders.length, 2)
  assert.equal(state.orders[0].stage, '待评审')
  assert.equal(state.orders[0].priority, '中')
  assert.equal(state.orders[0].estDays, 365)
  assert.equal(state.orders[1].projectId, '')

  assert.equal(state.plans.length, 2)
  assert.equal(state.plans[0].status, '未开始')
  assert.equal(state.plans[0].progress, 0)

  assert.equal(state.logs.length, 2)
  assert.ok(state.logs.every((log) => log.id))
  assert.ok(!state.logs.some((log) => log.refId === '不存在'))
  assert.equal(state.logs.find((log) => log.refId === 'n1').kind, '进展')
})

test('normalizeState 结果稳定：二次收敛不改变数据', () => {
  const once = normalizeState({
    projects: [{ id: 'p1', name: 'A', progress: 30 }],
    orders: [{ id: 'o1', projectId: 'p1', title: 'B' }],
    plans: [{ id: 'n1', projectId: 'p1', orderId: 'o1', title: 'C' }],
    logs: [{ refType: 'project', refId: 'p1', text: 'D' }]
  })
  const twice = normalizeState(once)
  assert.deepEqual(twice, once)
})

test('emptyState / nextStage / suggestedProgress', () => {
  assert.equal(emptyState().version, 1)
  assert.equal(nextStage('开发中'), '联调中')
  assert.equal(nextStage('已上线'), '')
  assert.equal(nextStage('不存在'), '')
  assert.ok(DEFAULT_MODULES.includes('移动端开发'))
  assert.equal(ORDER_STAGES.length, 8)

  const project = { id: 'p1', progress: 20 }
  const orders = [
    { projectId: 'p1', stage: '已上线' },
    { projectId: 'p1', stage: '开发中' },
    { projectId: 'p2', stage: '已上线' }
  ]
  const plans = [{ projectId: 'p1', status: '已完成' }, { projectId: 'p1', status: '进行中' }]
  assert.equal(suggestedProgress(project, orders, plans), 50)
  assert.equal(suggestedProgress(project, [], []), 20)
})

test('仓库里没有把业务数据写死在客户端入口', async () => {
  const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8')
  assert.ok(source.includes('desktopWorkbenches.register'))
  assert.ok(!source.includes('localStorage'))
})
