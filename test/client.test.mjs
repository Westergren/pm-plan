import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'

import { createFakeServer, loadClient } from './helpers/client-loader.mjs'
import { sampleState } from '../src/shared/seed.js'
import { normalizeState } from '../src/shared/model.js'
import { moduleOptions, orderSmartCounts, platformOptions, projectSmartCounts, targetOptions } from '../src/shared/views.js'

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
  for (const label of ['项目计划工作台', '概览', '项目', '工单', '计划', '文档', '日历', '风险', '汇报', '设置', '新建项目', 'AI 会话']) {
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
  const moduleNames = moduleOptions(state.config.modules, state.projects)
  const platformNames = platformOptions(state.config.platforms, state.projects)
  const targetNames = targetOptions(state.config.platforms, state.orders)
  const projectCounts = projectSmartCounts(state.projects, state.orders, state.plans, {}, today)
  const orderCounts = orderSmartCounts(state.projects, state.orders, state.plans, {}, today)
  const base = {
    today,
    projects: state.projects,
    orders: state.orders,
    plans: state.plans,
    logs: state.logs,
    config: state.config,
    scoped,
    decorated: screens.decorateProjects(state.projects, state.orders, state.plans, today),
    stats: screens.kpis(state.projects, state.orders, state.plans, today),
    summaryLine: '测试用一句话结论',
    moduleNames,
    platformNames,
    targetNames,
    scope: { smart: 'all', moduleId: '', platform: '', target: '' },
    setScope: noop,
    onOpenSmart: noop,
    counts: projectCounts,
    search: '',
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
  const docsProps = {
    docs: [
      { id: 'd1', path: '手机银行/需求说明书.md', name: '需求说明书.md', folder: '手机银行', kind: 'markdown', editable: true, size: 2048, projectId: 'p1', orderId: '', title: '', tags: ['需求'], note: '', version: 'V1.0', addedAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', missing: false },
      { id: 'd2', path: '手机银行/接口清单.xlsx', name: '接口清单.xlsx', folder: '手机银行', kind: 'excel', editable: false, size: 40960, projectId: 'p1', orderId: '', title: '', tags: [], note: '', version: '', addedAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', missing: false },
      { id: 'd3', path: '旧稿/已删除.docx', name: '已删除.docx', folder: '旧稿', kind: 'word', editable: false, size: 0, projectId: '', orderId: '', title: '', tags: [], note: '', version: '', addedAt: '', updatedAt: '', missing: true }
    ],
    docsRoot: { root: '/Users/x/Documents/项目计划工作台文档', exists: true, indexFile: '/Users/x/Documents/项目计划工作台文档/index.json' },
    docsRootDraft: '/Users/x/Documents/项目计划工作台文档',
    docsLoading: false,
    docsError: '',
    docsUploading: false,
    projects: state.projects,
    orders: state.orders,
    onReloadDocs: noop, onSetDocsRootDraft: noop, onConfirmDocsRoot: noop, onPickDocsRoot: noop,
    onUploadDocs: noop, onOpenDoc: noop, onEditDoc: noop, onEditDocMeta: noop, onDeleteDoc: noop,
    onOpenProject: noop, onNewDoc: noop
  }
  const expectations = {
    OverviewScreen: ['在管项目', '风险分布', '本周', '需关注', '未排期', '模块', '端'],
    ProjectsScreen: ['手机银行 6.2 版本迭代', '按模块', '智能视图', '在管'],
    OrdersScreen: ['转账限额调整（含人脸复核）', '阶段', '目标端'],
    PlansScreen: ['与后端确认限额分级口径', '计划'],
    CalendarScreen: ['2026 年 10 月', '回到本月'],
    RisksScreen: ['已逾期'],
    ReportsScreen: ['草稿', '生成'],
    DocsScreen: ['文档库位置', '需求说明书.md', '接口清单.xlsx', 'Markdown', 'Excel', '找不到', '导入文档', '新建 Markdown']
  }
  for (const [name, expected] of Object.entries(expectations)) {
    const Screen = screens[name]
    assert.equal(typeof Screen, 'function', `${name} 未导出`)
    const own = name === 'OrdersScreen' ? { ...base, counts: orderCounts } : base
    const props = name === 'DocsScreen' ? { ...base, ...docsProps } : own
    const markup = renderToStaticMarkup(React.createElement(Screen, props))
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
  const fake = createFakeServer(
    {
      revision: options.revision ?? 1,
      state: options.state ?? normalizeState(sampleState(today))
    },
    { docsPayload: options.docsPayload }
  )
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

/**
 * 给受控输入框赋值。
 * 不能直接写 `input.value = x`：React 在 DOM 节点上用 value tracker 记录了上次渲染的值，
 * 直接赋值会让 tracker 认为「值没变」，onChange 永远不会触发（假绿）。
 * 必须走原生 setter 绕过 tracker，再派发 input 事件。
 */
function typeInto(panel, element, value) {
  const setter = Object.getOwnPropertyDescriptor(panel.dom.window.HTMLInputElement.prototype, 'value').set
  setter.call(element, value)
  element.dispatchEvent(new panel.dom.window.Event('input', { bubbles: true }))
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
    for (const [label, expected] of [['工单', '转账限额调整'], ['计划', '确认限额分级口径'], ['日历', '回到本月'], ['风险', '阻塞 / 紧急'], ['汇报', '草稿']]) {
      const node = tab(label)
      assert.ok(node, `没有找到 ${label} 页签`)
      await panel.act(() => click(node))
      assert.ok(panel.document.body.textContent.includes(expected), `${label} 页签缺少「${expected}」`)
    }
  } finally {
    await panel.cleanup()
  }
})

test('jsdom 挂载：概览的智能视图卡点开就是项目页的对应视图', async () => {
  const panel = await mountPanel()
  try {
    await panel.flush()
    const cards = [...panel.document.querySelectorAll('.pmplan-smart-card')]
    assert.equal(cards.length, 6, `概览应有一排智能视图卡，实际 ${cards.length} 个`)
    const done = cards.find((node) => node.textContent.includes('已完成'))
    assert.ok(done, '没有找到「已完成」统计卡')
    await panel.act(() => click(done))

    const tab = (label) => [...panel.document.querySelectorAll('[role="tab"]')].find((node) => node.textContent === label)
    assert.equal(tab('项目').getAttribute('aria-selected'), 'true', '点统计卡应跳到项目页')
    const pressed = [...panel.document.querySelectorAll('.pmplan-chip[aria-pressed="true"]')].map((node) => node.textContent)
    assert.ok(pressed.some((text) => text.includes('已完成')), `项目页没有切到「已完成」视图：${pressed.join(' / ')}`)
    assert.ok(panel.document.body.textContent.includes('上季度移动端质量复盘'), '已完成视图里应能看到已完成项目')
  } finally {
    await panel.cleanup()
  }
})

test('jsdom 挂载：页内筛查条只作用于本页，切页签不会互相冲掉', async () => {
  const panel = await mountPanel()
  try {
    await panel.flush()
    const tab = (label) => [...panel.document.querySelectorAll('[role="tab"]')].find((node) => node.textContent === label)
    const chips = () => [...panel.document.querySelectorAll('.pmplan-chip')]

    await panel.act(() => click(tab('项目')))
    const moduleChip = chips().find((node) => node.textContent.trim() === '移动端开发')
    assert.ok(moduleChip, `项目页没有「移动端开发」筛选项：${chips().map((node) => node.textContent).join(' / ')}`)
    await panel.act(() => click(moduleChip))
    assert.equal(moduleChip.getAttribute('aria-pressed'), 'true', '点过的筛选项应处于选中态')
    assert.ok(panel.document.body.textContent.includes('清除筛选'), '有筛选条件时应出现「清除筛选」')
    assert.ok(!panel.document.body.textContent.includes('上季度移动端质量复盘'), '别的模块的项目不该出现在筛选结果里')

    await panel.act(() => click(tab('工单')))
    assert.ok(chips().some((node) => node.textContent.trim() === '全部端'), '工单页缺少目标端筛选')
    assert.equal(
      chips().find((node) => node.textContent.trim() === '移动端开发').getAttribute('aria-pressed'),
      'false',
      '工单页不该继承项目页的模块筛选'
    )
  } finally {
    await panel.cleanup()
  }
})

test('jsdom 挂载：设置弹窗改模块名会落盘并级联到已有项目', async () => {
  const panel = await mountPanel()
  try {
    await panel.flush()
    const settings = [...panel.document.querySelectorAll('button')].find((node) => node.textContent === '设置')
    assert.ok(settings, '顶栏没有「设置」按钮')
    await panel.act(() => click(settings))

    const input = panel.document.querySelector('input[aria-label="模块 2"]')
    assert.ok(input, '设置弹窗里没有模块名称输入框')
    assert.equal(input.value, '移动端开发')
    await panel.act(() => typeInto(panel, input, '自研终端'))

    const save = [...panel.document.querySelectorAll('button')].find((node) => node.textContent.startsWith('保存'))
    assert.ok(save, '设置弹窗没有保存按钮')
    assert.match(save.textContent, /改名/, `保存按钮应提示改名项数：${save.textContent}`)
    await panel.act(() => click(save))
    await panel.flush(700)

    const written = panel.fake.memory.state
    assert.ok(written.config.modules.includes('自研终端'), `模块配置没落盘：${JSON.stringify(written.config.modules)}`)
    assert.ok(written.projects.every((project) => project.module !== '移动端开发'), '改名后旧模块名应被级联替换')
    assert.ok(written.projects.some((project) => project.module === '自研终端'), '项目应改到新模块名下')

    const tab = (label) => [...panel.document.querySelectorAll('[role="tab"]')].find((node) => node.textContent === label)
    await panel.act(() => click(tab('项目')))
    assert.ok(
      [...panel.document.querySelectorAll('.pmplan-chip')].some((node) => node.textContent.trim() === '自研终端'),
      '项目页筛选条应立刻出现新模块名'
    )
  } finally {
    await panel.cleanup()
  }
})

test('jsdom 挂载：改「端」名会同时级联项目与工单目标端', async () => {
  const panel = await mountPanel()
  try {
    await panel.flush()
    await panel.act(() => click([...panel.document.querySelectorAll('button')].find((node) => node.textContent === '设置')))

    const input = panel.document.querySelector('input[aria-label="端 1"]')
    assert.ok(input, '设置弹窗里没有端名称输入框')
    assert.equal(input.value, '移动手机')
    await panel.act(() => typeInto(panel, input, '手机端'))

    const save = [...panel.document.querySelectorAll('button')].find((node) => node.textContent.startsWith('保存'))
    assert.match(save.textContent, /含 1 项改名/, `保存按钮应提示 1 项改名：${save.textContent}`)
    await panel.act(() => click(save))
    await panel.flush(700)

    const written = panel.fake.memory.state
    assert.ok(written.config.platforms.includes('手机端'), '端配置没落盘')
    assert.ok(!written.config.platforms.includes('移动手机'), '旧端名应被替换')
    assert.ok(written.projects.every((project) => project.platform !== '移动手机'), '项目的端没级联')
    assert.ok(written.projects.some((project) => project.platform === '手机端'), '项目应改到新端名下')
    assert.ok(written.orders.every((order) => order.target !== '移动手机'), '工单的目标端没级联')
    assert.ok(written.orders.some((order) => order.target === '手机端'), '工单应改到新端名下')
  } finally {
    await panel.cleanup()
  }
})

test('jsdom 挂载：删掉在用的模块不会清空数据，旧名称退回历史取值继续可筛', async () => {
  const panel = await mountPanel()
  try {
    await panel.flush()
    assert.equal(
      panel.document.querySelectorAll('.pmplan-side').length,
      0,
      '这个用例的断言建立在没有左侧栏的前提上'
    )
    await panel.act(() => click([...panel.document.querySelectorAll('button')].find((node) => node.textContent === '设置')))

    const moduleDim = panel.document.querySelectorAll('.pmplan-dim')[0]
    const rows = [...moduleDim.querySelectorAll('.pmplan-dim-row')]
    assert.equal(rows.length, 4, `模块应有 4 行，实际 ${rows.length}`)
    const target = rows[1]
    assert.equal(target.querySelector('input').value, '移动端开发')
    assert.match(target.querySelector('.pmplan-dim-usage').textContent, /引用 \d+/, '每行应显示引用数')

    const before = panel.fake.memory.state.projects.filter((project) => project.module === '移动端开发').length
    assert.ok(before > 0, '示例数据里应有「移动端开发」的项目')
    await panel.act(() => click(target.querySelector('button')))

    const save = [...panel.document.querySelectorAll('button')].find((node) => node.textContent.startsWith('保存'))
    assert.equal(save.textContent, '保存', '删除不是改名，不该提示改名项数')
    await panel.act(() => click(save))
    await panel.flush(700)

    const written = panel.fake.memory.state
    assert.ok(!written.config.modules.includes('移动端开发'), '配置里应已删掉该模块')
    assert.equal(
      written.projects.filter((project) => project.module === '移动端开发').length,
      before,
      '删除配置项不该改动已有项目数据'
    )

    await panel.act(() => click([...panel.document.querySelectorAll('[role="tab"]')].find((node) => node.textContent === '项目')))
    assert.ok(
      [...panel.document.querySelectorAll('.pmplan-chip')].some((node) => node.textContent.trim() === '移动端开发'),
      '已删除模块的历史取值应继续出现在筛选项里，否则这些项目就再也筛不出来了'
    )
  } finally {
    await panel.cleanup()
  }
})

test('jsdom 挂载：设置里出现重名或删空时禁止保存并说明原因', async () => {
  const panel = await mountPanel()
  try {
    await panel.flush()
    await panel.act(() => click([...panel.document.querySelectorAll('button')].find((node) => node.textContent === '设置')))
    const save = () => [...panel.document.querySelectorAll('button')].find((node) => node.textContent.startsWith('保存'))

    assert.equal(save().disabled, false, '初始状态应可保存')
    await panel.act(() => typeInto(panel, panel.document.querySelector('input[aria-label="模块 2"]'), '公司项目'))
    assert.equal(save().disabled, true, '重名时应禁止保存')
    assert.ok(panel.document.body.textContent.includes('同一维度里的名称不能重复'), '没有说明重名原因')

    await panel.act(() => typeInto(panel, panel.document.querySelector('input[aria-label="模块 2"]'), '移动端开发'))
    assert.equal(save().disabled, false, '改回来应恢复可保存')

    const moduleDim = panel.document.querySelectorAll('.pmplan-dim')[0]
    for (const row of [...moduleDim.querySelectorAll('.pmplan-dim-row')].slice(0, 3)) {
      await panel.act(() => click(row.querySelector('button')))
    }
    assert.equal(moduleDim.querySelectorAll('.pmplan-dim-row').length, 1, '应保留最后一行不允许删空')
    assert.equal(moduleDim.querySelector('.pmplan-dim-row button').disabled, true, '只剩一行时删除按钮应禁用')
  } finally {
    await panel.cleanup()
  }
})

test('jsdom 挂载：需求文档页在服务端有文档数据时正常渲染', async () => {
  const docsPayload = {
    root: '/Users/x/Documents/项目计划工作台文档',
    indexFile: '/Users/x/Documents/项目计划工作台文档/index.json',
    documents: [
      { id: 'd1', path: '手机银行/需求说明书.md', name: '需求说明书.md', folder: '手机银行', kind: 'markdown', editable: true, size: 2048, projectId: '', orderId: '', title: '', tags: [], note: '', version: '', addedAt: '', updatedAt: '', missing: false }
    ],
    count: 1,
    missing: 0
  }
  const panel = await mountPanel({ docsPayload })
  try {
    await panel.flush()
    const docsTab = [...panel.document.querySelectorAll('[role="tab"]')].find((node) => node.textContent === '文档')
    assert.ok(docsTab, '没有找到文档页签')
    await panel.act(() => click(docsTab))
    await panel.flush(60)
    const text = panel.document.body.textContent
    assert.ok(text.includes('文档库位置'), '缺少文档库位置卡片')
    assert.ok(text.includes('需求说明书.md'), '没有列出文档')
    assert.ok(text.includes('导入文档'), '缺少导入按钮')
    assert.ok(panel.fake.calls.some((call) => call.url.endsWith('/api/pm-plan/docs')), '没有请求文档列表')
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
    await panel.act(() => typeInto(panel, input, 'PAD'))
    const text = panel.document.body.textContent
    assert.ok(text.includes('移动展业 PAD 端客户建档重构'), '搜索结果为空')
    assert.ok(!text.includes('信贷平台移动端需求池梳理'), '不匹配的项目应被过滤掉')
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
