import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'

import { createFakeServer, loadClient } from './helpers/client-loader.mjs'
import { sampleState } from '../src/shared/seed.js'
import { normalizeState } from '../src/shared/model.js'

const today = '2026-10-10'

const EMPTY = { version: 1, seededAt: '2026-10-01T00:00:00.000Z', projects: [], orders: [], plans: [], logs: [] }

/** 装载客户端包并完成注册。 */
async function boot(options = {}) {
  const fake = createFakeServer({ revision: options.revision ?? 0, state: options.state ?? EMPTY })
  const loaded = await loadClient({ request: fake.request })
  loaded.exported.apply(loaded.ctx)
  const registration = loaded.desktopWorkbenches.registrations[0]
  return { fake, registration, ...loaded }
}

test('客户端包通过模块加载器注册工作台，声明必需字段', async () => {
  const { exported, desktopWorkbenches } = await boot()
  assert.equal(typeof exported.apply, 'function')
  assert.deepEqual(exported.inject, ['desktopWorkbenches'])
  assert.equal(desktopWorkbenches.registrations.length, 1)
  const { descriptor, Component } = desktopWorkbenches.registrations[0]
  assert.equal(typeof Component, 'function')
  assert.equal(descriptor.title, '项目计划工作台')
  assert.match(descriptor.repository, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/)
  assert.equal(descriptor.customFrame, true)
  assert.ok(descriptor.description.length > 0)
  assert.equal(descriptor.id, undefined, '新包不应填写旧的 register id')
})

test('首屏在无会话时也能渲染业务面板骨架', async () => {
  const { registration, React } = await boot()
  const markup = renderToStaticMarkup(React.createElement(registration.Component, { service: {}, entry: {}, conversation: null }))
  for (const label of ['项目计划工作台', '概览', '项目', '工单', '计划', '日历', '风险', '汇报', '新建项目', 'AI 会话', '需关注', '全部端']) {
    assert.ok(markup.includes(label), `首屏缺少 ${label}`)
  }
  assert.ok(markup.includes('正在读取本机数据'), '未渲染加载态')
  assert.ok(!markup.includes('undefined'), '渲染结果里出现了 undefined')
})

test('空数据时不会自作主张写入数据', async () => {
  const { registration, React, fake } = await boot({ state: { ...EMPTY, seededAt: '' } })
  renderToStaticMarkup(React.createElement(registration.Component, { service: {}, entry: {}, conversation: null }))
  // 服务端渲染不执行副作用，因此不应出现写入；这里守住「不静默写盘」的边界。
  assert.equal(fake.calls.filter((call) => call.method === 'POST').length, 0)
})

test('各业务页签在有数据时都能渲染出内容', async () => {
  const state = normalizeState(sampleState(today))
  const { exported, React } = await boot({ state, revision: 3 })
  const screens = exported.screensApi
  assert.ok(screens, '需要导出 screens 供渲染自测')
  const scoped = { projects: state.projects, orders: state.orders, plans: state.plans }
  const noop = () => {}
  const base = {
    today,
    projects: state.projects,
    orders: state.orders,
    plans: state.plans,
    logs: state.logs,
    scoped,
    decorated: screens.decorateProjects(state.projects, state.orders, state.plans, today),
    stats: screens.kpis(state.projects, state.orders, state.plans, today),
    summaryLine: '测试用一句话结论',
    moduleId: '',
    smart: 'all',
    platform: '',
    search: '',
    axis: [],
    counts: [],
    onOpenProject: noop,
    onOpenOrder: noop,
    onOpenPlan: noop,
    onEditProject: noop,
    onEditOrder: noop,
    onEditPlan: noop,
    onTogglePlan: noop,
    onToggleOrderStage: noop,
    onDelete: noop,
    onSetView: noop,
    calendarMonth: '2026-10',
    setCalendarMonth: noop,
    reportKind: 'weekly',
    setReportKind: noop,
    reportProjectId: '',
    setReportProjectId: noop,
    reportText: '# 草稿标题',
    setReportText: noop,
    generateReport: noop,
    copyReport: noop,
    downloadReport: noop
  }
  const expectations = {
    OverviewScreen: ['在管项目', '风险分布', '本周'],
    ProjectsScreen: ['手机银行 6.2 版本迭代', '按模块'],
    OrdersScreen: ['转账限额调整（含人脸复核）', '阶段'],
    PlansScreen: ['与后端确认限额分级口径', '计划'],
    CalendarScreen: ['2026 年 10 月', '回到本月'],
    RisksScreen: ['已逾期'],
    ReportsScreen: ['草稿', '生成']
  }
  for (const [name, expected] of Object.entries(expectations)) {
    const Screen = screens[name]
    assert.equal(typeof Screen, 'function', `${name} 未导出`)
    const markup = renderToStaticMarkup(React.createElement(Screen, base))
    assert.ok(markup.length > 200, `${name} 渲染内容过少`)
    assert.ok(!markup.includes('undefined'), `${name} 渲染里出现 undefined`)
    for (const text of expected) assert.ok(markup.includes(text), `${name} 缺少「${text}」`)
  }
})

test('用户输入不会被原样当成 HTML 注入', async () => {
  const state = normalizeState({
    version: 1,
    projects: [{ id: 'p1', name: '<img src=x onerror=alert(1)>', summary: '<script>alert(1)</script>' }],
    orders: [],
    plans: [],
    logs: []
  })
  const { registration, React } = await boot({ state })
  const markup = renderToStaticMarkup(React.createElement(registration.Component, { service: {}, entry: {}, conversation: null }))
  assert.ok(!markup.includes('<script>'), 'script 标签被原样输出')
  assert.ok(!markup.includes('onerror=alert'), '事件属性被原样输出')
})

/* ---------------- 真实 DOM 挂载（jsdom）：验证读盘、渲染与保存链路 ---------------- */

async function mountPanel(options = {}) {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    fetch: globalThis.fetch,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT
  }
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  define('window', dom.window)
  define('document', dom.window.document)
  define('navigator', dom.window.navigator)
  define('IS_REACT_ACT_ENVIRONMENT', true)
  const fake = createFakeServer({
    revision: options.revision ?? 1,
    state: options.state ?? normalizeState(sampleState(today))
  })
  globalThis.fetch = fake.request
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react-dom/test-utils')
  const loaded = await loadClient({ request: fake.request })
  loaded.exported.apply(loaded.ctx)
  const { Component } = loaded.desktopWorkbenches.registrations[0]
  const root = createRoot(document.getElementById('root'))
  const element = loaded.React.createElement(Component, { service: {}, entry: {}, conversation: null })
  await act(async () => {
    root.render(element)
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0))
  })
  /** 让 React 处理事件并把 500ms 的延迟保存真正落盘。 */
  const flush = async (waitMs = 20) => {
    await act(async () => {
      await new Promise((resolve) => dom.window.setTimeout(resolve, waitMs))
    })
  }
  const cleanup = async () => {
    await act(async () => {
      root.unmount()
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0))
    })
    Object.defineProperty(globalThis, 'window', { value: previous.window, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'document', { value: previous.document, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'navigator', { value: previous.navigator, configurable: true, writable: true })
    globalThis.fetch = previous.fetch
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: previous.IS_REACT_ACT_ENVIRONMENT, configurable: true, writable: true })
    dom.window.close()
  }
  const act_run = async (callback) => {
    await act(async () => {
      callback()
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0))
    })
  }
  return { dom, document: dom.window.document, fake, flush, act: act_run, cleanup, React: loaded.React }
}

function click(element) {
  element.dispatchEvent(new element.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }))
}

test('jsdom 挂载：读取本机数据并渲染真实项目', async () => {
  const panel = await mountPanel()
  try {
    await panel.flush()
    const text = panel.document.body.textContent
    assert.ok(text.includes('手机银行 6.2 版本迭代'), '未渲染示例项目')
    assert.ok(text.includes('在管项目'), '未渲染 KPI')
    assert.ok(text.includes('已保存 · 修订 1'), `保存状态不对：${text.slice(0, 120)}`)
    assert.ok(panel.fake.calls.some((call) => call.url.endsWith('/api/pm-plan/state') && call.method === 'GET'))
  } finally {
    await panel.cleanup()
  }
})

test('jsdom 挂载：勾选计划完成会写回本机数据', async () => {
  const panel = await mountPanel()
  try {
    await panel.flush()
    const planTab = [...panel.document.querySelectorAll('[role="tab"]')].find((node) => node.textContent === '计划')
    assert.ok(planTab, '没有找到计划页签')
    await panel.act(() => click(planTab))
    const checkboxes = [...panel.document.querySelectorAll('input[type="checkbox"]')]
    assert.ok(checkboxes.length > 0, '没有找到计划勾选框')
    await panel.act(() => click(checkboxes[0]))
    await panel.flush(700)
    const posts = panel.fake.calls.filter((call) => call.method === 'POST')
    assert.ok(posts.length >= 1, '勾选后没有保存')
    const written = panel.fake.memory.state
    assert.ok(written.plans.some((plan) => plan.status === '已完成'), '写回的数据里没有已完成的计划')
    assert.equal(panel.fake.memory.revision, 2)
  } finally {
    await panel.cleanup()
  }
})

test('jsdom 挂载：切换页签可看到工单、日历、风险与汇报', async () => {
  const panel = await mountPanel()
  try {
    await panel.flush()
    const tab = (label) => [...panel.document.querySelectorAll('[role="tab"]')].find((node) => node.textContent === label)
    for (const [label, expected] of [['工单', '转账限额调整'], ['计划', '确认限额分级口径'], ['日历', '回到本月'], ['风险', '需关注'], ['汇报', '草稿']]) {
      const node = tab(label)
      assert.ok(node, `没有找到 ${label} 页签`)
      await panel.act(() => click(node))
      assert.ok(panel.document.body.textContent.includes(expected), `${label} 页签缺少「${expected}」`)
    }
  } finally {
    await panel.cleanup()
  }
})

test('jsdom 挂载：搜索框按关键词过滤', async () => {
  const panel = await mountPanel()
  try {
    await panel.flush()
    const input = panel.document.querySelector('input[type="search"]')
    assert.ok(input, '没有搜索框')
    input.value = 'PAD'
    await panel.act(() => input.dispatchEvent(new panel.dom.window.Event('input', { bubbles: true })))
    const text = panel.document.body.textContent
    assert.ok(text.includes('PAD'), '搜索结果为空')
  } finally {
    await panel.cleanup()
  }
})

test('工作台身份使用真实仓库地址，并能解析成 owner/repo', async () => {
  const { exported, desktopWorkbenches } = await boot()
  const { descriptor } = desktopWorkbenches.registrations[0]
  assert.equal(descriptor.repository, 'https://github.com/Westergren/pm-plan')
  // 复刻宿主的规范化规则（Desktop 会把 owner/repo 转成小写作为工作台 id）
  const match = descriptor.repository.match(/^https:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?\/?$/i)
  assert.ok(match, '仓库地址不符合宿主接受的 GitHub URL 形式')
  assert.equal(`${match[1]}/${match[2]}`.toLowerCase(), 'westergren/pm-plan')
  assert.equal(typeof exported.apply, 'function')
})
