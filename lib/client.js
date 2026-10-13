// 本文件由 scripts/build-client.mjs 从 src/ 生成，请勿直接修改。
window.__ModuleLoader__.load({
  id: "dsh-workbench-pm-plan",
  factory: (require) => {
    const __factories = Object.create(null)
    const __cache = Object.create(null)
    function __require(id) {
      if (__factories[id] === undefined) return require(id)
      if (__cache[id] !== undefined) return __cache[id].exports
      const module = { exports: {} }
      __cache[id] = module
      __factories[id](module.exports, module, __require)
      return module.exports
    }
  __factories["client/index.js"] = function (exports, module, __require) {
const { PlanWorkbench } = __require("client/panel.js")
const screens = __require("client/screens.js")
const { decorateProjects, kpis } = __require("shared/metrics.js")
/**
 * 工作台客户端入口：向 Desktop 注册业务面板。
 *
 * 只做注册，不创建会话、不改写会话归属、不操作工作区。
 */

const React = require('react')
const { injectStyles } = __require("client/ui.js")

// 工作台身份：Desktop 用规范化的 GitHub owner/repo 作为工作台 id。
// 本工作台只在本机自用、不上架，这个地址只是一个稳定且不与他人冲突的身份标识，
// 安装记录与侧栏入口都用它；将来真要上架时再把它换成公开仓库即可。
const REPOSITORY = 'https://github.com/Westergren/pm-plan'

function apply(ctx) {
  injectStyles()
  ctx.effect(() => ctx.desktopWorkbenches.register({
    title: '项目计划工作台',
    repository: REPOSITORY,
    description: '移动端多端项目的需求变更工单、工作计划、跟进事项、风险与周季报，一屏管到底。',
    panelTitle: '项目计划工作台',
    category: '项目管理',
    icon: '🗂️',
    // 业务操作优先（看板 / 表格 / 日历），所以用 customFrame：占满宿主分配的主内容区，
    // 会话按需从右侧抽屉展开，不默认占用半屏。
    customFrame: true
  }, PlanWorkbench), 'pm-plan: register workbench')
}

const inject = ['desktopWorkbenches']

// 方便不启动 Desktop 时做渲染自测；模块加载器只读取 apply/inject。
const screensApi = { ...screens, decorateProjects, kpis }



module.exports = { apply, inject, PlanWorkbench, React, screensApi }
  }
  __factories["client/panel.js"] = function (exports, module, __require) {
const { useCallback, useEffect, useMemo, useRef, useState } = __require("react")
const { ApiError, docAction, readDoc, readDocs, readState, setDocsRoot, updateDocMeta, uploadDoc, writeDoc, writeState } = __require("client/api.js")
const { Badge, Banner, Button, Card, Drawer, Empty, FieldRow, KeyValues, Modal, Progress, Select, TextArea, TextField, Toast, injectStyles } = __require("client/ui.js")
const { OverviewScreen, ProjectsScreen, OrdersScreen, PlansScreen, CalendarScreen, RisksScreen, ReportsScreen, DocsScreen } = __require("client/screens.js")
const { DEFAULT_MODULES, DEFAULT_PLATFORMS, LOG_KINDS, MAX_DIMENSION_ITEMS, MAX_DIMENSION_LENGTH, ORDER_KINDS, ORDER_STAGES, PLAN_STATUS, PRIORITIES, PROJECT_STATUS, createId, normalizeState } = __require("shared/model.js")
const { RISK_TONE, decorateProjects, headline, kpis, orderRisk, planRisk, projectRisk, riskTone } = __require("shared/metrics.js")
const { applyView, moduleOptions, platformOptions, projectSmartCounts, smartViewLabel, targetOptions } = __require("shared/views.js")
const { buildReport } = __require("shared/report.js")
const { addDays, formatDate, formatDateTime, todayISO } = __require("shared/date.js")
const { isEmptyState, sampleState } = __require("shared/seed.js")
/**
 * 项目计划工作台面板。
 *
 * 顶栏（品牌 / 搜索 / 刷新 / 新建 / 设置 / 保存状态 / AI 会话）＋ 八个主导航页签
 * （概览 · 项目 · 工单 · 计划 · 文档 · 日历 · 风险 · 汇报）＋ 主内容区 ＋ 详情抽屉/编辑弹窗。
 *
 * 导航不再有左侧栏：筛选下沉到各自页面——概览用一排可点击的智能视图统计卡，
 * 项目与工单各有自己的「模块 + 端」筛查条。模块与端是**用户可配置项**，
 * 在顶栏「设置」里增删改，取值落盘在 state.config。
 *
 * 依赖会话的动作只有「AI 会话」按钮：它把宿主提供的 `conversation` 节点放进右侧抽屉，
 * 面板自己不创建会话、不改写会话归属、不碰工作区；其余业务在没有会话时也能完整使用。
 */

const h = require('react').createElement

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'projects', label: '项目' },
  { id: 'orders', label: '工单' },
  { id: 'plans', label: '计划' },
  { id: 'docs', label: '文档' },
  { id: 'calendar', label: '日历' },
  { id: 'risks', label: '风险' },
  { id: 'reports', label: '汇报' }
]

const toOptions = (values) => values.map((value) => ({ value, label: value }))

/**
 * 下拉选项：配置项 + 当前值。
 * 旧数据里可能存着后来被用户从配置中删掉的名称，补进选项才不会一编辑就把它悄悄改掉。
 */
const withCurrent = (names, current) => {
  const list = [...names]
  const value = String(current == null ? '' : current).trim()
  if (value && !list.includes(value)) list.push(value)
  return list
}

/** 设置弹窗里每一行都要有稳定 key，才能在改名/删除/排序时不串行。 */
let dimensionKeySeed = 0
const keyedRows = (names) => names.map((name) => {
  dimensionKeySeed += 1
  return { key: `dim-${dimensionKeySeed}`, name, original: name }
})

const EMPTY_PROJECT = (config) => ({
  code: '',
  name: '',
  module: config.modules[0],
  platform: config.platforms[0],
  status: '进行中',
  owner: '我',
  startedOn: todayISO(),
  dueDate: addDays(todayISO(), 14),
  progress: 0,
  link: '',
  summary: ''
})

/** 工单直接挂模块（不再有 projectId）；`module` 缺省用模块列表的第一项。 */
const EMPTY_ORDER = (config) => ({
  code: '',
  module: config.modules[0],
  title: '',
  kind: '迭代需求',
  priority: '中',
  stage: '待评审',
  owner: '我',
  target: '',
  createdOn: todayISO(),
  dueDate: addDays(todayISO(), 7),
  description: ''
})

const EMPTY_PLAN = (module) => ({
  module: module || '',
  title: '',
  owner: '我',
  status: '未开始',
  startedOn: todayISO(),
  dueDate: addDays(todayISO(), 3),
  note: ''
})

function replaceById(list, item) {
  const index = list.findIndex((entry) => entry.id === item.id)
  if (index < 0) return [...list, item]
  const next = [...list]
  next[index] = item
  return next
}

function dropById(list, id) {
  return list.filter((entry) => entry.id !== id)
}

function PlanWorkbench({ service, entry, conversation }) {
  const [view, setView] = useState('overview')
  // 筛选按页各自持有，互不干扰：概览按模块/端收窄，项目按模块/端，工单按模块/目标端。
  // 只有概览的统计卡能把智能视图带进项目页（projectScope.smart）。
  const [overviewScope, setOverviewScope] = useState({ moduleId: '', platform: '' })
  // 项目/工单页默认不套智能视图（smart 为空串）——页面上不再摆智能视图筛选项，
  // 默认口径必须是全量，否则就会变成一个看不见来源的隐藏筛选。
  const [projectScope, setProjectScope] = useState({ smart: '', moduleId: '', platform: '' })
  const [orderScope, setOrderScope] = useState({ moduleId: '', target: '' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [data, setData] = useState(() => ({ revision: 0, state: normalizeState({}) }))
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [drawer, setDrawer] = useState(null)
  const [editor, setEditor] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => todayISO().slice(0, 7))
  const [reportKind, setReportKind] = useState('weekly')
  const [reportProjectId, setReportProjectId] = useState('')
  const [reportText, setReportText] = useState('')
  const [logDraft, setLogDraft] = useState({ kind: '进展', text: '' })
  const [docs, setDocs] = useState([])
  const [docsRoot, setDocsRootInfo] = useState(null)
  const [docsRootDraft, setDocsRootDraft] = useState('')
  const [docsLoading, setDocsLoading] = useState(false)
  const [docsError, setDocsError] = useState('')
  const [docsUploading, setDocsUploading] = useState(false)
  const [docEditor, setDocEditor] = useState(null)
  const [docMeta, setDocMeta] = useState(null)
  const [docConfirm, setDocConfirm] = useState(null)
  const saveTimer = useRef(null)
  const toastTimer = useRef(null)
  const dataRef = useRef(data)
  dataRef.current = data
  const today = todayISO()

  const showToast = useCallback((text) => {
    setToast(text)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => {
      toastTimer.current = null
      setToast((current) => (current === text ? '' : current))
    }, 2600)
  }, [])

  const load = useCallback(async () => {
    setStatus('loading')
    setError('')
    try {
      const payload = await readState()
      let next = payload.state
      let revision = payload.revision
      if (isEmptyState(next) && !next.seededAt) {
        next = normalizeState(sampleState(today))
        const saved = await writeState(revision, next)
        revision = saved.revision
        next = saved.state
        showToast('已生成示例数据，可在左侧「清空」后录入真实项目。')
      }
      setData({ revision, state: next })
      setDirty(false)
      setStatus('ready')
    } catch (loadError) {
      setStatus('error')
      setError(loadError instanceof ApiError ? loadError.message : '读取数据失败。')
    }
  }, [showToast, today])

  useEffect(() => {
    injectStyles()
    load()
  }, [load])

  const persist = useCallback(async (nextState, revision) => {
    setSaving(true)
    try {
      const saved = await writeState(revision, nextState)
      setData({ revision: saved.revision, state: saved.state })
      setDirty(false)
      setError('')
      setStatus('ready')
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 409) {
        setError('数据已被另一个窗口修改，请点「重新加载」后再保存。')
      } else {
        setError(saveError instanceof ApiError ? saveError.message : '保存失败。')
      }
      setDirty(true)
    } finally {
      setSaving(false)
    }
  }, [])

  /** 业务改动入口：更新内存状态、标记未保存，并延迟整体保存。 */
  const mutate = useCallback((updater, message) => {
    const current = dataRef.current
    const nextState = normalizeState(updater(current.state))
    dataRef.current = { revision: current.revision, state: nextState }
    setData(dataRef.current)
    setDirty(true)
    if (message) showToast(message)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      persist(dataRef.current.state, dataRef.current.revision)
    }, 500)
  }, [persist, showToast])

  // 卸载时取消所有还没触发的延迟动作，避免在界面已经消失后继续改状态。
  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    saveTimer.current = null
    toastTimer.current = null
  }, [])

  const projects = data.state.projects
  const orders = data.state.orders
  const plans = data.state.plans
  const logs = data.state.logs
  const config = data.state.config

  // 可配置维度的候选值：配置项 + 数据里出现过的历史取值，两边都不会丢。
  const moduleNames = useMemo(() => moduleOptions(config.modules, projects), [config.modules, projects])
  const platformNames = useMemo(() => platformOptions(config.platforms, projects), [config.platforms, projects])
  const targetNames = useMemo(() => targetOptions(config.platforms, orders), [config.platforms, orders])

  // 概览的模块/端表按「在管」口径统计在办工作——这里显式传 view，
  // 不依赖 applyView 的默认值（默认值现在是「不套用智能视图」）。
  const overviewScoped = useMemo(
    () => applyView(projects, orders, plans, { moduleId: overviewScope.moduleId, view: 'all', platform: overviewScope.platform, search }, today),
    [projects, orders, plans, overviewScope, search, today]
  )
  const overviewCounts = useMemo(
    () => projectSmartCounts(projects, orders, plans, { moduleId: overviewScope.moduleId, platform: overviewScope.platform }, today),
    [projects, orders, plans, overviewScope, today]
  )
  const projectScoped = useMemo(
    () => applyView(projects, orders, plans, { moduleId: projectScope.moduleId, view: projectScope.smart, platform: projectScope.platform, search }, today),
    [projects, orders, plans, projectScope, search, today]
  )
  const orderScoped = useMemo(
    () => applyView(projects, orders, plans, { moduleId: orderScope.moduleId, target: orderScope.target, search }, today),
    [projects, orders, plans, orderScope, search, today]
  )
  // 计划/日历/风险/汇报不参与页内筛查，始终看全量。
  const allScoped = useMemo(() => ({ projects, orders, plans }), [projects, orders, plans])

  const stats = useMemo(() => kpis(projects, orders, plans, today), [projects, orders, plans, today])
  const summaryLine = useMemo(() => headline(projects, orders, plans, today), [projects, orders, plans, today])
  const decorated = useMemo(() => decorateProjects(projects, orders, plans, today), [projects, orders, plans, today])

  const openProject = useCallback((projectId) => {
    if (projectId) setDrawer({ type: 'project', id: projectId })
  }, [])
  const openOrder = useCallback((orderId) => {
    if (orderId) setDrawer({ type: 'order', id: orderId })
  }, [])
  const openPlan = useCallback((planId) => {
    if (planId) setDrawer({ type: 'plan', id: planId })
  }, [])

  const drawerItem = useMemo(() => {
    if (!drawer) return null
    if (drawer.type === 'project') return projects.find((item) => item.id === drawer.id) || null
    if (drawer.type === 'order') return orders.find((item) => item.id === drawer.id) || null
    return plans.find((item) => item.id === drawer.id) || null
  }, [drawer, projects, orders, plans])

  const saveProject = useCallback((form) => {
    const now = new Date().toISOString()
    const payload = { ...form, id: form.id || createId('prj'), createdAt: form.createdAt || now, updatedAt: now, tags: form.tags || [] }
    mutate((state) => ({ ...state, projects: replaceById(state.projects, payload) }), '项目已保存')
    setEditor(null)
    setDrawer({ type: 'project', id: payload.id })
  }, [mutate])

  const saveOrder = useCallback((form) => {
    const now = new Date().toISOString()
    const payload = { ...form, id: form.id || createId('ord'), createdAt: form.createdAt || now, updatedAt: now }
    mutate((state) => ({ ...state, orders: replaceById(state.orders, payload) }), '工单已保存')
    setEditor(null)
    setDrawer({ type: 'order', id: payload.id })
  }, [mutate])

  const savePlan = useCallback((form) => {
    const now = new Date().toISOString()
    const payload = { ...form, id: form.id || createId('pln'), createdAt: form.createdAt || now, updatedAt: now }
    mutate((state) => ({ ...state, plans: replaceById(state.plans, payload) }), '计划已保存')
    setEditor(null)
    setDrawer({ type: 'plan', id: payload.id })
  }, [mutate])

  /**
   * 保存模块 / 端配置，并把「改名」沿用到既有数据上。
   * 只做改名级联，不做删除级联：删掉一个选项时历史数据原样保留，旧名称仍会作为
   * 「历史取值」出现在下拉框里——避免误删一个选项就把项目上的归属悄悄清空。
   */
  const saveConfig = useCallback((next) => {
    const moduleMap = new Map(next.renamed?.modules || [])
    const platformMap = new Map(next.renamed?.platforms || [])
    mutate((state) => ({
      ...state,
      config: { modules: next.modules, platforms: next.platforms },
      projects: state.projects.map((project) => ({
        ...project,
        module: moduleMap.get(project.module) || project.module,
        platform: platformMap.get(project.platform) || project.platform
      })),
      orders: state.orders.map((order) => ({
        ...order,
        target: platformMap.get(order.target) || order.target
      }))
    }), '设置已保存')
    setSettingsOpen(false)
  }, [mutate])

  const removeItem = useCallback((type, id) => {
    mutate((state) => {
      if (type === 'project') {
        // 工单与计划都挂在模块上，不归项目——删项目只删项目自己与它的进展记录。
        return {
          ...state,
          projects: dropById(state.projects, id),
          logs: state.logs.filter((log) => !(log.refType === 'project' && log.refId === id))
        }
      }
      const refType = type === 'order' ? 'order' : 'plan'
      const patch = type === 'order'
        ? { orders: dropById(state.orders, id) }
        : { plans: dropById(state.plans, id) }
      return { ...state, ...patch, logs: state.logs.filter((log) => !(log.refType === refType && log.refId === id)) }
    }, '已删除')
    setDrawer(null)
  }, [mutate])

  const setOrderStage = useCallback((order, stage) => {
    mutate((state) => ({
      ...state,
      orders: replaceById(state.orders, { ...order, stage, updatedAt: new Date().toISOString() })
    }), `工单状态：${stage}`)
  }, [mutate])

  const togglePlanDone = useCallback((plan) => {
    const done = plan.status === '已完成'
    mutate((state) => ({
      ...state,
      plans: replaceById(state.plans, {
        ...plan,
        status: done ? '进行中' : '已完成',
        updatedAt: new Date().toISOString()
      })
    }), done ? '计划已恢复' : '计划已完成')
  }, [mutate])

  const addLog = useCallback((refType, refId) => {
    if (!logDraft.text.trim()) return
    const text = logDraft.text.trim()
    const kind = logDraft.kind
    mutate((state) => ({
      ...state,
      logs: [{ id: createId('log'), refType, refId, at: new Date().toISOString(), kind, text }, ...state.logs]
    }), '进展已记录')
    setLogDraft({ kind, text: '' })
  }, [logDraft, mutate])

  const loadDocs = useCallback(async () => {
    setDocsLoading(true)
    setDocsError('')
    try {
      const payload = await readDocs()
      setDocs(Array.isArray(payload.documents) ? payload.documents : [])
      setDocsRootInfo({ root: payload.root, exists: true, indexFile: payload.indexFile || '' })
      setDocsRootDraft((current) => current || payload.root)
    } catch (docsLoadError) {
      const message = docsLoadError instanceof ApiError ? docsLoadError.message : '读取文档库失败。'
      if (docsLoadError instanceof ApiError && docsLoadError.status === 404) {
        setDocsError('服务端还没有加载文档接口：请重启 Harness 后再试。')
      } else {
        setDocsError(message)
      }
    } finally {
      setDocsLoading(false)
    }
  }, [])

  const confirmDocsRoot = useCallback(async () => {
    try {
      const info = await setDocsRoot(docsRootDraft)
      setDocsRootInfo(info)
      setDocsRootDraft(info.root)
      await loadDocs()
      showToast(`文档库已就绪：${info.root}`)
    } catch (docsRootError) {
      setDocsError(docsRootError instanceof ApiError ? docsRootError.message : '设置文档库目录失败。')
    }
  }, [docsRootDraft, loadDocs, showToast])

  const uploadDocs = useCallback(async (files) => {
    setDocsUploading(true)
    setDocsError('')
    try {
      const list = [...files]
      const paths = list.map(file => (typeof file.path === 'string' ? file.path : '')).filter(Boolean)
      let commonDir = ''
      if (paths.length > 1) {
        const segments = paths.map(p => p.split('/').slice(0, -1))
        const first = segments[0]
        const shared = []
        for (let i = 0; i < first.length; i += 1) {
          const part = first[i]
          if (segments.every(seg => seg[i] === part)) shared.push(part)
          else break
        }
        commonDir = shared.length ? `${shared.join('/')}/` : ''
      }
      for (const file of list) {
        const relative = commonDir && typeof file.path === 'string' && file.path.startsWith(commonDir)
          ? file.path.slice(commonDir.length)
          : (file.webkitRelativePath && file.webkitRelativePath.includes('/')
              ? file.webkitRelativePath.slice(file.webkitRelativePath.indexOf('/') + 1)
              : file.name)
        const clean = relative.split('/').filter(Boolean).join('/') || file.name
        const folder = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : ''
        const base64 = await fileToBase64(file)
        await uploadDoc({ name: clean.slice(clean.lastIndexOf('/') + 1), folder, base64 })
      }
      await loadDocs()
      showToast(`已导入 ${list.length} 个文档`)
    } catch (uploadError) {
      setDocsError(uploadError instanceof ApiError ? uploadError.message : '导入文档失败。')
    } finally {
      setDocsUploading(false)
    }
  }, [loadDocs, showToast])

  const openDocFile = useCallback(async (doc) => {
    try {
      await docAction(doc.path, 'open')
      showToast(`已用系统默认程序打开：${doc.name}`)
    } catch (openError) {
      setDocsError(openError instanceof ApiError ? openError.message : '打开失败。')
    }
  }, [showToast])

  const openDocEditor = useCallback(async (doc, text) => {
    setDocsError('')
    try {
      const content = typeof text === 'string' ? { path: doc.path, text, kind: doc.kind, editable: doc.editable } : await readDoc(doc.path)
      setDocEditor({ doc, text: content.text || '', original: content.text || '' })
    } catch (readError) {
      setDocsError(readError instanceof ApiError ? readError.message : '读取文档内容失败。')
    }
  }, [])

  const saveDocEditor = useCallback(async () => {
    if (!docEditor) return
    try {
      await writeDoc(docEditor.doc.path, docEditor.text)
      setDocEditor(null)
      await loadDocs()
      showToast('文档已保存')
    } catch (saveError) {
      setDocsError(saveError instanceof ApiError ? saveError.message : '保存文档失败。')
    }
  }, [docEditor, loadDocs, showToast])

  const createDoc = useCallback(async () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
    const name = `未命名需求文档-${stamp}.md`
    try {
      const created = await uploadDoc({
        name,
        base64: typeof btoa === 'function' ? btoa(unescape(encodeURIComponent('# 新建需求文档\n\n'))) : '',
        title: name
      })
      await loadDocs()
      const doc = { path: created.path, name, kind: 'markdown', editable: true }
      setDocEditor({ doc, text: '# 新建需求文档\n\n', original: '# 新建需求文档\n\n' })
      showToast('已新建 Markdown 文档')
    } catch (createError) {
      setDocsError(createError instanceof ApiError ? createError.message : '新建文档失败。')
    }
  }, [loadDocs, showToast])

  const saveDocMeta = useCallback(async (patch) => {
    if (!docMeta) return
    try {
      await updateDocMeta(docMeta.path, patch)
      setDocMeta(null)
      await loadDocs()
      showToast('文档属性已保存')
    } catch (metaError) {
      setDocsError(metaError instanceof ApiError ? metaError.message : '保存文档属性失败。')
    }
  }, [docMeta, loadDocs, showToast])

  const removeDoc = useCallback(async (doc, deleteFile) => {
    try {
      await docAction(doc.path, 'delete', { deleteFile: Boolean(deleteFile) })
      setDocConfirm(null)
      await loadDocs()
      showToast(deleteFile ? '文件已删除' : '已从索引移除，文件仍在原处')
    } catch (removeError) {
      setDocsError(removeError instanceof ApiError ? removeError.message : '移除失败。')
    }
  }, [loadDocs, showToast])

  const generateReport = useCallback(() => {
    setReportText(buildReport(reportKind, { projects, orders, plans, logs }, { today, projectId: reportProjectId || projects[0]?.id }))
  }, [reportKind, projects, orders, plans, logs, today, reportProjectId])

  useEffect(() => {
    if (view === 'reports' && !reportText) generateReport()
  }, [view, reportText, generateReport])

  useEffect(() => {
    if (view === 'docs' && !docsLoading && !docs.length && !docsError) loadDocs()
  }, [view, docs.length, docsLoading, docsError, loadDocs])

  const copyReport = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(reportText)
        showToast('汇报已复制到剪贴板')
      } else {
        showToast('当前环境不支持自动复制，请手动选中复制')
      }
    } catch {
      showToast('复制失败，请手动选中复制')
    }
  }, [reportText, showToast])

  const downloadReport = useCallback(() => {
    try {
      const blob = new Blob([reportText], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `pm-report-${reportKind}-${today}.md`
      anchor.click()
      URL.revokeObjectURL(url)
      showToast('已开始下载 .md')
    } catch {
      showToast('下载失败，请手动复制')
    }
  }, [reportText, reportKind, today, showToast])

  // 各页共用的一套 props；带筛查条的页面在下面按页覆盖 scoped/counts/scope。
  const screenProps = {
    today,
    projects,
    orders,
    plans,
    logs,
    decorated,
    stats,
    summaryLine,
    config,
    moduleNames,
    platformNames,
    targetNames,
    search,
    onOpenProject: openProject,
    onOpenOrder: openOrder,
    onOpenPlan: openPlan,
    onEditProject: (project) => setEditor({ type: 'project', form: project || EMPTY_PROJECT(config) }),
    onEditOrder: (order) => setEditor({ type: 'order', form: order || EMPTY_ORDER(config) }),
    onEditPlan: (plan) => setEditor({ type: 'plan', form: plan || EMPTY_PLAN(moduleNames[0]) }),
    onTogglePlan: togglePlanDone,
    onToggleOrderStage: setOrderStage,
    onDelete: (type, id) => setConfirm({ type, id }),
    onSetView: setView,
    calendarMonth,
    setCalendarMonth,
    reportKind,
    setReportKind,
    reportProjectId,
    setReportProjectId,
    reportText,
    setReportText,
    generateReport,
    copyReport,
    downloadReport
  }

  /** 概览页：只按模块/端收窄；点统计卡会带着这个范围跳到项目页的对应智能视图。 */
  const overviewProps = {
    ...screenProps,
    scoped: overviewScoped,
    counts: overviewCounts,
    scope: overviewScope,
    setScope: setOverviewScope,
    onOpenSmart: (id) => {
      setProjectScope((scope) => ({ ...scope, smart: id, moduleId: overviewScope.moduleId, platform: overviewScope.platform }))
      setView('projects')
    }
  }

  const projectProps = {
    ...screenProps,
    scoped: projectScoped,
    scope: projectScope,
    setScope: setProjectScope,
    // 智能视图只可能来自概览的统计卡；在页面上把它显示成一枚可关闭的标记。
    view: smartViewLabel(projectScope.smart),
    onClearView: () => setProjectScope((scope) => ({ ...scope, smart: '' }))
  }

  const orderProps = {
    ...screenProps,
    scoped: orderScoped,
    scope: orderScope,
    setScope: setOrderScope
  }

  // 计划/日历/风险/汇报不参与页内筛查，始终看全量。
  const plainProps = { ...screenProps, scoped: allScoped }

  const rendered = () => {
    if (status === 'loading') return h(Empty, { text: '正在读取本机数据…' })
    if (status === 'error') {
      return h(Empty, {
        text: error || '读取数据失败。',
        action: h(Button, { variant: 'primary', onClick: load }, '重试')
      })
    }
    if (view === 'overview') return h(OverviewScreen, overviewProps)
    if (view === 'projects') return h(ProjectsScreen, projectProps)
    if (view === 'orders') return h(OrdersScreen, orderProps)
    if (view === 'plans') return h(PlansScreen, plainProps)
    if (view === 'docs') {
      return h(DocsScreen, {
        docs,
        docsRoot,
        docsRootDraft,
        docsLoading,
        docsError,
        docsUploading,
        projects,
        orders,
        onReloadDocs: loadDocs,
        onSetDocsRootDraft: setDocsRootDraft,
        onConfirmDocsRoot: confirmDocsRoot,
        onPickDocsRoot: (file) => {
          const path = typeof file.path === 'string' && file.path ? file.path : ''
          if (path) {
            const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : path
            setDocsRootDraft(dir)
            showToast(`已填入目录：${dir}`)
          } else {
            const first = file.webkitRelativePath ? file.webkitRelativePath.split('/')[0] : ''
            showToast(first
              ? `浏览器没有给出完整路径，请把文档库目录粘贴到输入框（例如 ~/Documents/${first}）`
              : '浏览器没有给出完整路径，请手动粘贴文档库目录')
          }
        },
        onUploadDocs: uploadDocs,
        onOpenDoc: (doc) => (doc.editable ? openDocEditor(doc) : openDocFile(doc)),
        onEditDoc: (doc) => openDocEditor(doc),
        onEditDocMeta: (doc) => setDocMeta(doc),
        onDeleteDoc: (doc) => setDocConfirm(doc),
        onOpenProject: openProject,
        onNewDoc: createDoc
      })
    }
    if (view === 'calendar') return h(CalendarScreen, plainProps)
    if (view === 'risks') return h(RisksScreen, plainProps)
    return h(ReportsScreen, plainProps)
  }

  return h('div', { className: 'pmplan' },
    h('header', { className: 'pmplan-topbar' },
      h('span', { className: 'pmplan-brand' },
        h('span', { className: 'pmplan-brand-icon', 'aria-hidden': 'true' }, '🗂️'),
        '项目计划工作台'
      ),
      h('span', { className: 'pmplan-topbar-spacer' }),
      h('input', {
        className: 'pmplan-input pmplan-search',
        type: 'search',
        placeholder: '搜索项目 / 工单 / 计划',
        value: search,
        'aria-label': '搜索',
        onChange: (event) => setSearch(event.target.value)
      }),
      h(Button, { onClick: load, title: '重新加载本机数据' }, '刷新'),
      h(Button, { variant: 'primary', onClick: () => setEditor({ type: 'project', form: EMPTY_PROJECT(config) }) }, '新建项目'),
      h(Button, { onClick: () => setEditor({ type: 'order', form: EMPTY_ORDER(config) }) }, '新建工单'),
      h(Button, { onClick: () => setEditor({ type: 'plan', form: EMPTY_PLAN(moduleNames[0]) }) }, '新建计划'),
      h(Button, { onClick: () => setSettingsOpen(true), title: '配置模块、端与示例数据' }, '设置'),
      h(Button, {
        onClick: () => setChatOpen((open) => !open),
        'aria-pressed': chatOpen ? 'true' : 'false',
        title: '展开宿主原生会话，用于让 Agent 读数据或写文档'
      }, chatOpen ? '收起会话' : 'AI 会话'),
      h('span', { className: 'pmplan-topbar-status', 'data-tone': error ? 'danger' : '' },
        saving ? '正在保存…' : dirty ? '未保存' : `已保存 · 修订 ${data.revision}`
      )
    ),
    h('div', { className: 'pmplan-body' },
      h('main', { className: 'pmplan-main' },
        h('div', { className: 'pmplan-tabs', role: 'tablist', 'aria-label': '看板页签' },
          TABS.map((tab) => h('button', {
            key: tab.id,
            type: 'button',
            role: 'tab',
            className: 'pmplan-tab',
            'aria-selected': view === tab.id ? 'true' : 'false',
            onClick: () => setView(tab.id)
          }, tab.label))
        ),
        error && status === 'ready'
          ? h('div', { style: { padding: '8px 12px 0' } },
              h(Banner, {
                tone: 'danger',
                children: error,
                actions: h(Button, { size: 'small', onClick: load }, '重新加载')
              })
            )
          : null,
        h('div', { className: 'pmplan-content' }, rendered())
      ),
      chatOpen
        ? h('aside', { className: 'pmplan-chat', 'aria-label': '原生会话' },
            h('div', { className: 'pmplan-chat-head' },
              h('strong', null, 'AI 会话'),
              h('span', { className: 'pmplan-spacer' }),
              h('span', { className: 'pmplan-small pmplan-muted' }, '数据仍在本机'),
              h(Button, { size: 'small', variant: 'ghost', onClick: () => setChatOpen(false) }, '收起')
            ),
            h('div', { className: 'pmplan-chat-body' },
              conversation || h('div', { className: 'pmplan-empty' }, '宿主还没有提供会话区域；先在当前工作台新建一个会话即可。')
            )
          )
        : null
    ),
    drawerItem
      ? h(DetailDrawer, {
          type: drawer.type,
          item: drawerItem,
          projects,
          orders,
          plans,
          logs,
          docs,
          today,
          logDraft,
          setLogDraft,
          onClose: () => setDrawer(null),
          onEdit: (item) => setEditor({ type: drawer.type, form: item }),
          onDelete: () => setConfirm({ type: drawer.type, id: drawerItem.id }),
          onAddLog: addLog,
          onSetOrderStage: setOrderStage,
          onOpenProject: openProject,
          onOpenOrder: openOrder,
          onOpenPlan: openPlan,
          onSelectView: (next) => { setView(next); setDrawer(null) }
        })
      : null,
    settingsOpen
      ? h(SettingsModal, {
          config,
          projects,
          orders,
          maxItems: MAX_DIMENSION_ITEMS,
          maxLength: MAX_DIMENSION_LENGTH,
          onClose: () => setSettingsOpen(false),
          onSave: saveConfig,
          onSample: () => {
            setSettingsOpen(false)
            mutate(() => sampleState(today), '已重新生成示例数据')
          },
          onClear: () => {
            setSettingsOpen(false)
            setConfirm({ type: 'clear' })
          }
        })
      : null,
    editor
      ? h(EditorModal, {
          type: editor.type,
          form: editor.form,
          projects,
          orders,
          moduleNames,
          platformNames,
          onClose: () => setEditor(null),
          onSubmit: editor.type === 'project' ? saveProject : editor.type === 'order' ? saveOrder : savePlan
        })
      : null,
    docEditor
      ? h(DocumentModal, {
          doc: docEditor.doc,
          text: docEditor.text,
          dirty: docEditor.text !== docEditor.original,
          onChange: (value) => setDocEditor((current) => (current ? { ...current, text: value } : current)),
          onClose: () => setDocEditor(null),
          onSave: saveDocEditor,
          onOpenSystem: () => openDocFile(docEditor.doc)
        })
      : null,
    docMeta
      ? h(DocMetaModal, {
          doc: docMeta,
          projects,
          orders,
          onClose: () => setDocMeta(null),
          onSubmit: saveDocMeta
        })
      : null,
    docConfirm
      ? h(DocConfirmModal, {
          doc: docConfirm,
          onClose: () => setDocConfirm(null),
          onRemoveOnly: () => removeDoc(docConfirm, false),
          onDeleteFile: () => removeDoc(docConfirm, true)
        })
      : null,
    confirm
      ? h(ConfirmModal, {
          payload: confirm,
          onClose: () => setConfirm(null),
          onConfirm: () => {
            if (confirm.type === 'clear') {
              mutate((state) => ({
                version: state.version,
                seededAt: state.seededAt,
                updatedAt: state.updatedAt,
                projects: [],
                orders: [],
                plans: [],
                logs: []
              }), '已清空全部数据')
              setConfirm(null)
              return
            }
            removeItem(confirm.type, confirm.id)
            setConfirm(null)
          }
        })
      : null,
    h(Toast, { text: toast })
  )
}

/* ---------------- 详情抽屉 ---------------- */

function DetailDrawer({ type, item, projects, orders, plans, logs, docs, today, logDraft, setLogDraft, onClose, onEdit, onDelete, onAddLog, onSetOrderStage, onOpenProject, onOpenOrder, onOpenPlan, onSelectView }) {
  if (!item) return null

  if (type === 'project') {
    const relatedLogs = logs.filter((log) => log.refType === 'project' && log.refId === item.id)
    const risk = projectRisk(item, today)
    return h(Drawer, {
      title: item.name,
      subtitle: `${item.code ? `${item.code} · ` : ''}${item.module} · ${item.platform} · ${item.status}`,
      onClose,
      footer: [
        h(Button, { key: 'edit', variant: 'primary', onClick: () => onEdit(item) }, '编辑'),
        h(Button, { key: 'delete', variant: 'danger', onClick: onDelete }, '删除'),
        h(Button, { key: 'close', onClick: onClose }, '关闭')
      ]
    },
      h('div', { className: 'pmplan-row' },
        h(Badge, { tone: riskTone(risk), children: `风险 ${risk}` }),
        h(Badge, { tone: 'info', children: `进度 ${item.progress}%` }),
        h(Badge, { tone: 'muted', children: item.dueDate ? `投产 ${formatDate(item.dueDate)}` : '未排期' })
      ),
      h(Progress, { value: item.progress, tone: RISK_TONE[risk] }),
      h(KeyValues, {
        rows: [
          ['项目编号', item.code || '—'],
          ['负责人', item.owner || '未指派'],
          ['开始 / 投产', `${formatDate(item.startedOn, '未填')} ~ ${formatDate(item.dueDate, '未填')}`],
          ['链接', item.link ? h('a', { href: item.link, target: '_blank', rel: 'noreferrer' }, item.link) : '—'],
          ['标签', item.tags?.length ? item.tags.join('、') : '—'],
          ['更新于', formatDateTime(item.updatedAt, '—')]
        ]
      }),
      item.summary ? h(Card, { title: '说明' }, h('div', { className: 'pmplan-soft' }, item.summary)) : null,
      h(Card, {
        title: `本模块工单（${orders.filter((order) => order.module === item.module).length}）`,
        actions: h(Button, { size: 'small', onClick: () => onSelectView('orders') }, '去工单页')
      },
        orders.filter((order) => order.module === item.module).length
          ? h('div', { className: 'pmplan-small pmplan-muted', style: { marginBottom: 6 } }, '工单挂在模块上，不是挂在单个项目上，下面是同模块的工单。')
          : null,
        orders.filter((order) => order.module === item.module).length
          ? h('div', { className: 'pmplan-col' }, orders.filter((order) => order.module === item.module).map((order) => h('button', {
              key: order.id,
              type: 'button',
              className: 'pmplan-item',
              onClick: () => onOpenOrder(order.id)
            },
              h('span', { className: 'pmplan-item-title' }, order.title),
              h('span', { className: 'pmplan-item-meta' },
                h(Badge, { tone: RISK_TONE[orderRisk(order, today)], children: orderRisk(order, today) }),
                `${order.kind} · ${order.stage} · 投产 ${formatDate(order.dueDate)}`
              )
            )))
          : h('div', { className: 'pmplan-small pmplan-muted' }, '该模块下还没有工单。')
      ),
      h(Card, {
        title: `关联需求文档（${(docs || []).filter((doc) => doc.projectId === item.id).length}）`,
        actions: h(Button, { size: 'small', onClick: () => onSelectView('docs') }, '去文档页')
      },
        (docs || []).filter((doc) => doc.projectId === item.id).length
          ? h('div', { className: 'pmplan-col' }, (docs || []).filter((doc) => doc.projectId === item.id).map((doc) => h('div', {
              key: doc.path,
              className: 'pmplan-item'
            },
              h('span', { className: 'pmplan-item-title' }, doc.name),
              h('span', { className: 'pmplan-item-meta' },
                doc.missing ? h(Badge, { tone: 'danger', children: '找不到' }) : null,
                doc.version ? `版本 ${doc.version}` : '',
                doc.tags && doc.tags.length ? doc.tags.join('、') : ''
              )
            )))
          : h('div', { className: 'pmplan-small pmplan-muted' }, '还没有关联文档，去「需求文档」页导入后把属性挂到这个项目。')
      ),
      h(Card, { title: '进展记录' },
        h(LogList, { logs: relatedLogs }),
        h(LogComposer, { draft: logDraft, setDraft: setLogDraft, onSubmit: () => onAddLog('project', item.id) })
      )
    )
  }

  if (type === 'order') {
    const relatedLogs = logs.filter((log) => log.refType === 'order' && log.refId === item.id)
    const risk = orderRisk(item, today)
    return h(Drawer, {
      title: item.title,
      subtitle: `${item.code ? `${item.code} · ` : ''}${item.kind} · ${item.priority}优先级 · ${item.stage}`,
      onClose,
      footer: [
        h(Button, { key: 'edit', variant: 'primary', onClick: () => onEdit(item) }, '编辑'),
        h(Button, { key: 'delete', variant: 'danger', onClick: onDelete }, '删除'),
        h(Button, { key: 'close', onClick: onClose }, '关闭')
      ]
    },
      h('div', { className: 'pmplan-row' },
        h(Badge, { tone: RISK_TONE[risk], children: `风险 ${risk}` }),
        h(Badge, { tone: 'info', children: item.stage }),
        h(Badge, { tone: 'muted', children: `模块：${item.module || '未归模块'}` })
      ),
      h(KeyValues, {
        rows: [
          ['工单编号', item.code || '—'],
          ['模块', item.module || '未归模块'],
          ['负责人', item.owner || '未指派'],
          ['目标端', item.target || '未填'],
          ['创建日期', formatDate(item.createdOn, '未填')],
          ['投产日期', formatDate(item.dueDate, '未排期')],
          ['更新于', formatDateTime(item.updatedAt, '—')]
        ]
      }),
      item.description ? h(Card, { title: '描述' }, h('div', { className: 'pmplan-soft' }, item.description)) : null,
      h(Card, { title: '状态流转' },
        h('div', { className: 'pmplan-row' },
          ORDER_STAGES.map((stage) => h(Button, {
            key: stage,
            size: 'small',
            variant: stage === item.stage ? 'primary' : 'default',
            onClick: () => onSetOrderStage(item, stage)
          }, stage))
        )
      ),
      h(Card, { title: '进展记录' },
        h(LogList, { logs: relatedLogs }),
        h(LogComposer, { draft: logDraft, setDraft: setLogDraft, onSubmit: () => onAddLog('order', item.id) })
      )
    )
  }

  const relatedLogs = logs.filter((log) => log.refType === 'plan' && log.refId === item.id)
  const risk = planRisk(item, today)
  return h(Drawer, {
    title: item.title,
    subtitle: `${item.module || '未归模块'} · ${item.status}`,
    onClose,
    footer: [
      h(Button, { key: 'edit', variant: 'primary', onClick: () => onEdit(item) }, '编辑'),
      h(Button, { key: 'delete', variant: 'danger', onClick: onDelete }, '删除'),
      h(Button, { key: 'close', onClick: onClose }, '关闭')
    ]
  },
    h('div', { className: 'pmplan-row' },
      h(Badge, { tone: RISK_TONE[risk], children: `风险 ${risk}` }),
      h(Badge, { tone: 'info', children: item.status }),
      h(Badge, { tone: 'muted', children: `模块：${item.module || '未归模块'}` })
    ),
    h(KeyValues, {
      rows: [
        ['负责人', item.owner || '未指派'],
        ['起止', `${formatDate(item.startedOn, '未填')} ~ ${formatDate(item.dueDate, '未填')}`],
        ['更新于', formatDateTime(item.updatedAt, '—')]
      ]
    }),
    item.note ? h(Card, { title: '备注' }, h('div', { className: 'pmplan-soft' }, item.note)) : null,
    h(Card, { title: '进展记录' },
      h(LogList, { logs: relatedLogs }),
      h(LogComposer, { draft: logDraft, setDraft: setLogDraft, onSubmit: () => onAddLog('plan', item.id) })
    )
  )
}

function LogList({ logs }) {
  if (!logs.length) return h('div', { className: 'pmplan-small pmplan-muted' }, '还没有记录。')
  return h('div', { className: 'pmplan-log' },
    logs.map((log) => h('div', { className: 'pmplan-log-item', key: log.id, 'data-kind': log.kind },
      h('div', { className: 'pmplan-small pmplan-muted' }, `${formatDateTime(log.at, '')} · ${log.kind}`),
      h('div', { className: 'pmplan-soft' }, log.text)
    ))
  )
}

function LogComposer({ draft, setDraft, onSubmit }) {
  return h('div', { className: 'pmplan-col', style: { marginTop: 8 } },
    h(FieldRow, null,
      h(Select, {
        label: '类型',
        value: draft.kind,
        onChange: (value) => setDraft({ ...draft, kind: value }),
        options: toOptions(LOG_KINDS)
      })
    ),
    h(TextArea, {
      label: '追加一条进展',
      value: draft.text,
      onChange: (value) => setDraft({ ...draft, text: value }),
      placeholder: '例如：与后端确认限额口径，接口字段已对齐'
    }),
    h('div', { className: 'pmplan-row' },
      h(Button, { variant: 'primary', size: 'small', onClick: onSubmit, disabled: !draft.text.trim() }, '记录进展')
    )
  )
}

/* ---------------- 编辑弹窗 ---------------- */

function EditorModal({ type, form, projects, orders, moduleNames, platformNames, onClose, onSubmit }) {
  const [draft, setDraft] = useState(form)
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }))
  const title = type === 'project'
    ? (draft.id ? '编辑项目' : '新建项目')
    : type === 'order'
      ? (draft.id ? '编辑工单' : '新建工单')
      : (draft.id ? '编辑计划' : '新建计划')
  const valid = type === 'project' ? draft.name.trim().length > 0 : draft.title.trim().length > 0
  const projectFields = [
    h(FieldRow, { key: 'row0' },
      h(TextField, { label: '项目编号', value: draft.code, onChange: (value) => set({ code: value }), placeholder: '例如：PRJ-2610' }),
      h(TextField, { label: '项目名称', value: draft.name, onChange: (value) => set({ name: value }), placeholder: '例如：手机银行 6.2 版本迭代' })
    ),
    h(FieldRow, { key: 'row1' },
      h(Select, { label: '模块', value: draft.module, onChange: (value) => set({ module: value }), options: toOptions(withCurrent(moduleNames, draft.module)) }),
      h(Select, { label: '端', value: draft.platform, onChange: (value) => set({ platform: value }), options: toOptions(withCurrent(platformNames, draft.platform)) }),
      h(Select, { label: '状态', value: draft.status, onChange: (value) => set({ status: value }), options: toOptions(PROJECT_STATUS) })
    ),
    h(FieldRow, { key: 'row2' },
      h(TextField, { label: '负责人', value: draft.owner, onChange: (value) => set({ owner: value }) }),
      h(TextField, { label: '开始日期', type: 'date', value: draft.startedOn, onChange: (value) => set({ startedOn: value }) }),
      h(TextField, { label: '投产日期', type: 'date', value: draft.dueDate, onChange: (value) => set({ dueDate: value }) })
    ),
    h(FieldRow, { key: 'row3' },
      h(TextField, { label: '进度 %', type: 'number', min: 0, max: 100, value: draft.progress, onChange: (value) => set({ progress: value }) }),
      h(TextField, { label: '链接', value: draft.link, onChange: (value) => set({ link: value }), placeholder: '需求文档 / 看板地址' })
    ),
    h(TextArea, { key: 'summary', label: '说明', value: draft.summary, onChange: (value) => set({ summary: value }), placeholder: '这个项目要解决什么、边界是什么' })
  ]

  const orderFields = [
    h(FieldRow, { key: 'row0' },
      h(TextField, { label: '工单编号', value: draft.code, onChange: (value) => set({ code: value }), placeholder: '例如：WO-2609' }),
      h(TextField, { label: '工单标题', value: draft.title, onChange: (value) => set({ title: value }), placeholder: '例如：转账限额调整（含人脸复核）' })
    ),
    h(FieldRow, { key: 'row1' },
      h(Select, { label: '模块', value: draft.module, onChange: (value) => set({ module: value }), options: toOptions(withCurrent(moduleNames, draft.module)), allowEmpty: true, emptyLabel: '未归模块' }),
      h(Select, { label: '类型', value: draft.kind, onChange: (value) => set({ kind: value }), options: toOptions(ORDER_KINDS) }),
      h(Select, { label: '优先级', value: draft.priority, onChange: (value) => set({ priority: value }), options: toOptions(PRIORITIES) })
    ),
    h(FieldRow, { key: 'row2' },
      h(Select, { label: '阶段', value: draft.stage, onChange: (value) => set({ stage: value }), options: toOptions(ORDER_STAGES) }),
      h(Select, { label: '目标端', value: draft.target, onChange: (value) => set({ target: value }), options: toOptions(withCurrent(platformNames, draft.target)), allowEmpty: true, emptyLabel: '未指定' }),
      h(TextField, { label: '负责人', value: draft.owner, onChange: (value) => set({ owner: value }) })
    ),
    h(FieldRow, { key: 'row3' },
      h(TextField, { label: '创建日期', type: 'date', value: draft.createdOn, onChange: (value) => set({ createdOn: value }) }),
      h(TextField, { label: '投产日期', type: 'date', value: draft.dueDate, onChange: (value) => set({ dueDate: value }) })
    ),
    h(TextArea, { key: 'description', label: '描述', value: draft.description, onChange: (value) => set({ description: value }), placeholder: '变更点、验收口径、影响范围' })
  ]

  const planFields = [
    h(TextField, { key: 'title', label: '计划标题', value: draft.title, onChange: (value) => set({ title: value }), placeholder: '例如：与后端确认限额分级口径' }),
    h(FieldRow, { key: 'row1' },
      h(Select, { label: '模块', value: draft.module, onChange: (value) => set({ module: value }), options: toOptions(withCurrent(moduleNames, draft.module)), allowEmpty: true, emptyLabel: '未归模块' }),
      h(Select, { label: '状态', value: draft.status, onChange: (value) => set({ status: value }), options: toOptions(PLAN_STATUS) })
    ),
    h(FieldRow, { key: 'row2' },
      h(TextField, { label: '负责人', value: draft.owner, onChange: (value) => set({ owner: value }) }),
      h(TextField, { label: '开始日期', type: 'date', value: draft.startedOn, onChange: (value) => set({ startedOn: value }) }),
      h(TextField, { label: '投产日期', type: 'date', value: draft.dueDate, onChange: (value) => set({ dueDate: value }) })
    ),
    h(TextArea, { key: 'note', label: '备注', value: draft.note, onChange: (value) => set({ note: value }), placeholder: '产出物、依赖、风险' })
  ]

  return h(Modal, {
    title,
    onClose,
    footer: [
      h(Button, { key: 'save', variant: 'primary', onClick: () => { if (valid) onSubmit(draft) }, disabled: !valid }, '保存'),
      h(Button, { key: 'cancel', onClick: onClose }, '取消')
    ]
  },
    type === 'project' ? projectFields : type === 'order' ? orderFields : planFields
  )
}

/* ---------------- 设置弹窗（模块 / 端 可配置） ---------------- */

/**
 * 模块与端以前是写死在源码里的常量，想改就得改代码、重新打包。
 * 这里把它们变成配置项：可增、可删、可改名，改完落盘在 state.config。
 * - 改名：级联到既有项目（module/platform）与工单（target）。
 * - 删除：不动历史数据，旧名称仍作为「历史取值」出现在下拉框里。
 * 每一行都显示「引用 n」，让人在删之前先看到会影响多少个条目。
 */
function SettingsModal({ config, projects, orders, maxItems, maxLength, onClose, onSave, onSample, onClear }) {
  const [modules, setModules] = useState(() => keyedRows(config.modules))
  const [platforms, setPlatforms] = useState(() => keyedRows(config.platforms))

  const clean = (rows) => rows.map((row) => row.name.trim()).filter(Boolean)
  const hasDuplicate = (rows) => {
    const names = clean(rows)
    return names.length !== new Set(names).size
  }
  const moduleNames = clean(modules)
  const platformNames = clean(platforms)
  const tooLong = [...modules, ...platforms].some((row) => row.name.trim().length > maxLength)
  const invalid = moduleNames.length === 0 || platformNames.length === 0 || hasDuplicate(modules) || hasDuplicate(platforms) || tooLong

  const invalidReason = moduleNames.length === 0 || platformNames.length === 0
    ? '模块和端至少各保留一项。'
    : hasDuplicate(modules) || hasDuplicate(platforms)
      ? '同一维度里的名称不能重复。'
      : `单项名称不能超过 ${maxLength} 个字符。`

  const renamesOf = (rows) => rows
    .filter((row) => row.original && row.name.trim() && row.name.trim() !== row.original)
    .map((row) => [row.original, row.name.trim()])

  const renameCount = (rows) => renamesOf(rows).length

  const setRow = (setRows, key, name) => setRows((rows) => rows.map((row) => (row.key === key ? { ...row, name } : row)))
  const dropRow = (setRows, key) => setRows((rows) => (rows.length > 1 ? rows.filter((row) => row.key !== key) : rows))
  const addRow = (setRows) => setRows((rows) => (rows.length >= maxItems ? rows : [...rows, ...keyedRows([''])]))
  const resetRows = (setRows, names) => setRows(keyedRows(names))

  const usage = (rows, items, field) => rows.map((row) => (
    row.original ? items.filter((item) => item[field] === row.original).length : 0
  ))

  const dimension = (title, hint, rows, setRows, items, field, defaults) => {
    const counts = usage(rows, items, field)
    return h('div', { className: 'pmplan-dim' },
      h('div', { className: 'pmplan-dim-head' },
        h('div', null,
          h('strong', null, title),
          h('div', { className: 'pmplan-small pmplan-muted' }, hint)
        ),
        h('div', { className: 'pmplan-settings-actions' },
          h(Button, { size: 'small', onClick: () => addRow(setRows), disabled: rows.length >= maxItems }, '添加'),
          h(Button, { size: 'small', variant: 'ghost', onClick: () => resetRows(setRows, defaults), title: '恢复为出厂默认值' }, '恢复默认')
        )
      ),
      rows.map((row, index) => h('div', { className: 'pmplan-dim-row', key: row.key },
        h('span', { className: 'pmplan-dim-index' }, String(index + 1)),
        h('input', {
          className: 'pmplan-input',
          value: row.name,
          maxLength,
          placeholder: '名称',
          'aria-label': `${title} ${index + 1}`,
          onChange: (event) => setRow(setRows, row.key, event.target.value)
        }),
        h('span', { className: 'pmplan-dim-usage' }, `引用 ${counts[index]}`),
        h(Button, {
          size: 'small',
          variant: 'ghost',
          disabled: rows.length <= 1,
          title: '删除该项。已有数据不会被清空，旧名称会作为历史取值保留在下拉框里。',
          onClick: () => dropRow(setRows, row.key)
        }, '删除')
      ))
    )
  }

  const renamed = renameCount(modules) + renameCount(platforms)

  return h(Modal, {
    title: '设置',
    width: 720,
    onClose,
    footer: [
      h(Button, {
        key: 'save',
        variant: 'primary',
        disabled: invalid,
        onClick: () => onSave({
          modules: moduleNames,
          platforms: platformNames,
          renamed: { modules: renamesOf(modules), platforms: renamesOf(platforms) }
        })
      }, renamed > 0 ? `保存（含 ${renamed} 项改名）` : '保存'),
      h(Button, { key: 'cancel', onClick: onClose }, '取消')
    ]
  },
    h('div', { className: 'pmplan-settings' },
      h('p', { className: 'pmplan-small pmplan-muted' },
        '模块和端是可配置项：改完会立刻出现在新建/编辑下拉框、页内筛选条和看板分组里。改名会把已有项目、工单上的旧名称一并改过来；删除不会清空数据。'
      ),
      invalid ? h(Banner, { tone: 'warn', children: invalidReason }) : null,
      dimension('模块', `${moduleNames.length}/${maxItems} · 项目按它分组，概览/项目/工单都可筛查`, modules, setModules, projects, 'module', DEFAULT_MODULES),
      dimension('端', `${platformNames.length}/${maxItems} · 项目登记「端」，工单登记「目标端」`, platforms, setPlatforms, projects, 'platform', DEFAULT_PLATFORMS),
      h('div', { className: 'pmplan-dim' },
        h('div', { className: 'pmplan-dim-head' },
          h('div', null,
            h('strong', null, '演示数据'),
            h('div', { className: 'pmplan-small pmplan-muted' }, '重新生成会用一套示例项目 / 工单 / 计划覆盖当前全部内容')
          )
        ),
        h('div', { className: 'pmplan-settings-actions' },
          h(Button, { size: 'small', onClick: onSample }, '重新生成示例数据'),
          h(Button, { size: 'small', variant: 'danger', onClick: onClear }, '清空全部数据')
        )
      )
    )
  )
}

/** 读文件为 base64（云端/浏览器都可用）。 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取本地文件失败。'))
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma < 0 ? '' : result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

/** 文档编辑器：Markdown / 纯文本可在这里直接改，保存走服务端原子写入。 */
function DocumentModal({ doc, text, dirty, onChange, onClose, onSave, onOpenSystem }) {
  const lines = String(text || '').split('\n').length
  const chars = String(text || '').length
  return h(Modal, {
    title: doc.name,
    onClose,
    footer: [
      h(Button, { key: 'save', variant: 'primary', onClick: onSave, disabled: !dirty }, dirty ? '保存' : '已保存'),
      h(Button, { key: 'sys', onClick: onOpenSystem }, '用系统程序打开'),
      h(Button, { key: 'close', onClick: onClose }, '关闭')
    ]
  },
    h('div', { className: 'pmplan-row pmplan-small pmplan-muted' },
      h('span', null, doc.path),
      h('span', { className: 'pmplan-spacer' }),
      h('span', null, `${lines} 行 · ${chars} 字符`),
      dirty ? h(Badge, { tone: 'warn', children: '未保存' }) : null
    ),
    h('textarea', {
      className: 'pmplan-textarea',
      style: { minHeight: '46vh', fontFamily: 'var(--dsw-font-family-mono, ui-monospace, monospace)', fontSize: 12.5 },
      value: text,
      'aria-label': `${doc.name} 内容`,
      onChange: (event) => onChange(event.target.value)
    })
  )
}

/** 文档属性：挂到项目/工单、标题、版本、标签、备注。 */
function DocMetaModal({ doc, projects, orders, onClose, onSubmit }) {
  const [draft, setDraft] = useState({
    projectId: doc.projectId || '',
    orderId: doc.orderId || '',
    title: doc.title || doc.name,
    version: doc.version || '',
    tags: (doc.tags || []).join('、'),
    note: doc.note || ''
  })
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }))
  // 工单挂模块不挂项目，所以「关联工单」按所选项目所在模块给候选。
  const draftProject = projects.find((project) => project.id === draft.projectId)
  const relatedOrders = draftProject ? orders.filter((order) => order.module === draftProject.module) : []
  return h(Modal, {
    title: `文档属性 · ${doc.name}`,
    onClose,
    footer: [
      h(Button, { key: 'save', variant: 'primary', onClick: () => onSubmit({ ...draft, tags: draft.tags.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean) }) }, '保存'),
      h(Button, { key: 'cancel', onClick: onClose }, '取消')
    ]
  },
    h(TextField, { label: '显示标题', value: draft.title, onChange: (value) => set({ title: value }) }),
    h(FieldRow, null,
      h(Select, {
        label: '所属项目',
        value: draft.projectId,
        onChange: (value) => set({ projectId: value, orderId: '' }),
        options: projects.map((project) => ({ value: project.id, label: project.name })),
        allowEmpty: true,
        emptyLabel: '不挂项目'
      }),
      h(Select, {
        label: '关联工单',
        value: draft.orderId,
        onChange: (value) => set({ orderId: value }),
        options: relatedOrders.map((order) => ({ value: order.id, label: order.title })),
        allowEmpty: true,
        emptyLabel: '不关联'
      }),
      h(TextField, { label: '版本', value: draft.version, onChange: (value) => set({ version: value }), placeholder: '例如 V1.2' })
    ),
    h(TextField, { label: '标签（用、分隔）', value: draft.tags, onChange: (value) => set({ tags: value }), placeholder: '例如 需求、评审通过' }),
    h(TextArea, { label: '备注', value: draft.note, onChange: (value) => set({ note: value }), rows: 3 }),
    h('div', { className: 'pmplan-small pmplan-muted' }, `文件位置：${doc.path}`)
  )
}

/** 移除文档：默认只从索引移除，文件留在原处；删文件需要单独确认。 */
function DocConfirmModal({ doc, onClose, onRemoveOnly, onDeleteFile }) {
  return h(Modal, {
    title: '移除文档',
    onClose,
    footer: [
      h(Button, { key: 'only', variant: 'primary', onClick: onRemoveOnly }, '只从索引移除'),
      h(Button, { key: 'file', variant: 'danger', onClick: onDeleteFile }, '同时删除本机文件'),
      h(Button, { key: 'cancel', onClick: onClose }, '取消')
    ]
  },
    h('p', null, doc.name),
    h('p', { className: 'pmplan-small pmplan-muted' }, `索引位置：${doc.path}`),
    h('p', { className: 'pmplan-small' }, '「只从索引移除」不会动你的文件，之后重新导入即可恢复登记。'),
    h('p', { className: 'pmplan-small pmplan-muted' }, '「同时删除本机文件」会真的删掉磁盘上的文件，无法从界面恢复。')
  )
}

function ConfirmModal({ payload, onClose, onConfirm }) {
  const label = payload.type === 'clear'
    ? '清空所有数据（项目、工单、计划、进展记录）'
    : payload.type === 'project'
      ? '删除该项目及其下的计划与进展记录（工单挂在模块上，不受影响）'
      : payload.type === 'order'
        ? '删除该工单（关联计划的关联关系会解除）'
        : '删除该计划'
  return h(Modal, {
    title: '确认操作',
    onClose,
    footer: [
      h(Button, { key: 'ok', variant: 'danger', onClick: onConfirm }, '确认执行'),
      h(Button, { key: 'cancel', onClick: onClose }, '取消')
    ]
  },
    h('p', null, label),
    h('p', { className: 'pmplan-small pmplan-muted' }, '本机数据会立即写入，删除后无法从界面恢复。')
  )
}



module.exports = { PlanWorkbench, TABS, EMPTY_PROJECT, EMPTY_ORDER, EMPTY_PLAN }
  }
  __factories["client/api.js"] = function (exports, module, __require) {
/**
 * 针对本工作台接口的薄封装。
 */

const PREFIX = '/api/pm-plan'

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function parse(response) {
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) {
    throw new ApiError((payload && payload.error) || `请求失败（HTTP ${response.status}）`, response.status)
  }
  return payload
}

async function readState() {
  const response = await fetch(`${PREFIX}/state`, { credentials: 'same-origin', cache: 'no-store' })
  const payload = await parse(response)
  if (!payload || typeof payload !== 'object' || !payload.state) {
    throw new ApiError('服务端返回了无法识别的数据。', 500)
  }
  return { revision: Number(payload.revision) || 0, state: payload.state }
}

/** 整体保存；revision 不一致会抛 409，由界面提示「重新加载」。 */
async function writeState(revision, state) {
  const response = await fetch(`${PREFIX}/state`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, state })
  })
  return parse(response)
}

/* ---------------- 需求文档库 ---------------- */

async function readDocs() {
  return parse(await fetch(`${PREFIX}/docs`, { credentials: 'same-origin', cache: 'no-store' }))
}

/** 指定/确认文档库根目录（服务端此时才创建目录）。 */
async function setDocsRoot(root) {
  const response = await fetch(`${PREFIX}/docs`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'root', root })
  })
  return parse(response)
}

async function readDoc(path) {
  const url = `${PREFIX}/docs/file?path=${encodeURIComponent(path)}`
  return parse(await fetch(url, { credentials: 'same-origin', cache: 'no-store' }))
}

async function writeDoc(path, text) {
  const response = await fetch(`${PREFIX}/docs/file`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'write', path, text })
  })
  return parse(response)
}

async function uploadDoc(payload) {
  const response = await fetch(`${PREFIX}/docs/file`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'upload', ...payload })
  })
  return parse(response)
}

async function updateDocMeta(path, patch) {
  const response = await fetch(`${PREFIX}/docs/meta`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, ...patch })
  })
  return parse(response)
}

async function docAction(path, action, extra = {}) {
  const response = await fetch(`${PREFIX}/docs/action`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, action, ...extra })
  })
  return parse(response)
}



module.exports = { ApiError, readState, writeState, readDocs, setDocsRoot, readDoc, writeDoc, uploadDoc, updateDocMeta, docAction, PREFIX }
  }
  __factories["client/ui.js"] = function (exports, module, __require) {
const { styles } = __require("client/styles.js")
/**
 * 基础组件与样式注入。用 React.createElement，不依赖 JSX。
 */

const React = require('react')

const h = React.createElement
const STYLE_ID = 'pm-plan-workbench-styles'

let styleInjected = false

/** 幂等注入样式；没有 document 的环境（Node 渲染自测）静默跳过。 */
function injectStyles(doc) {
  if (styleInjected) return
  const target = doc || (typeof document !== 'undefined' ? document : null)
  if (!target || !target.head) return
  if (target.getElementById(STYLE_ID)) {
    styleInjected = true
    return
  }
  const element = target.createElement('style')
  element.id = STYLE_ID
  element.textContent = styles
  target.head.appendChild(element)
  styleInjected = true
}

function cx(...values) {
  return values.filter(Boolean).join(' ')
}

function Button({ variant, size, children, ...rest }) {
  return h('button', {
    type: 'button',
    className: 'pmplan-btn',
    'data-variant': variant || 'default',
    'data-size': size || '',
    ...rest
  }, children)
}

function Badge({ tone = 'muted', children, title }) {
  return h('span', { className: 'pmplan-badge', 'data-tone': tone, title }, children)
}

function Progress({ value = 0, tone = 'info', label }) {
  const width = Math.max(0, Math.min(100, Number(value) || 0))
  return h('div', {
    className: 'pmplan-progress',
    'data-tone': tone,
    role: 'progressbar',
    'aria-valuenow': width,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-label': label || `进度 ${width}%`
  }, h('span', { style: { width: `${width}%` } }))
}

function TextField({ label, value, onChange, type = 'text', placeholder, min, max, className }) {
  return h('div', { className: cx('pmplan-field', className) },
    label ? h('label', null, label) : null,
    h('input', {
      className: 'pmplan-input',
      type,
      value: value ?? '',
      placeholder: placeholder || '',
      min,
      max,
      onChange: (event) => onChange?.(event.target.value)
    })
  )
}

function TextArea({ label, value, onChange, placeholder, rows = 3 }) {
  return h('div', { className: 'pmplan-field' },
    label ? h('label', null, label) : null,
    h('textarea', {
      className: 'pmplan-textarea',
      value: value ?? '',
      rows,
      placeholder: placeholder || '',
      onChange: (event) => onChange?.(event.target.value)
    })
  )
}

function Select({ label, value, onChange, options, allowEmpty, emptyLabel = '未指定', className }) {
  const items = allowEmpty ? [{ value: '', label: emptyLabel }, ...options] : options
  return h('div', { className: cx('pmplan-field', className) },
    label ? h('label', null, label) : null,
    h('select', {
      className: 'pmplan-select',
      value: value ?? '',
      onChange: (event) => onChange?.(event.target.value)
    }, items.map((item) => h('option', { key: String(item.value), value: item.value }, item.label)))
  )
}

function FieldRow({ children }) {
  return h('div', { className: 'pmplan-field-row' }, children)
}

function Card({ title, actions, children, className }) {
  const head = title || actions
    ? h('header', { className: 'pmplan-card-head' },
        title ? h('span', { className: 'pmplan-card-title' }, title) : null,
        h('span', { className: 'pmplan-spacer' }),
        actions || null
      )
    : null
  return h('section', { className: cx('pmplan-card', className) }, head, children)
}

function Empty({ text, action }) {
  return h('div', { className: 'pmplan-empty' }, h('span', null, text), action || null)
}

/** 右侧抽屉式详情：覆盖在面板容器内，不越过宿主分配的主内容区。 */
function Drawer({ title, subtitle, onClose, children, footer, closeLabel = '关闭' }) {
  return h('div', {
    className: 'pmplan-scrim',
    role: 'presentation',
    onClick: (event) => {
      if (event.target === event.currentTarget) onClose?.()
    }
  },
    h('aside', { className: 'pmplan-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', { className: 'pmplan-drawer-head' },
        h('div', { className: 'pmplan-col' },
          h('span', { className: 'pmplan-drawer-title' }, title),
          subtitle ? h('span', { className: 'pmplan-small pmplan-muted' }, subtitle) : null
        ),
        h('span', { className: 'pmplan-spacer' }),
        Button({ variant: 'ghost', size: 'small', onClick: onClose, 'aria-label': closeLabel }, '✕')
      ),
      h('div', { className: 'pmplan-drawer-body' }, children),
      footer ? h('footer', { className: 'pmplan-drawer-foot' }, footer) : null
    )
  )
}

function Modal({ title, onClose, children, footer, width }) {
  return h('div', {
    className: 'pmplan-scrim',
    'data-center': 'true',
    role: 'presentation',
    onClick: (event) => {
      if (event.target === event.currentTarget) onClose?.()
    }
  },
    h('div', { className: 'pmplan-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: width ? { width } : undefined },
      h('header', { className: 'pmplan-drawer-head' },
        h('span', { className: 'pmplan-drawer-title' }, title),
        h('span', { className: 'pmplan-spacer' }),
        Button({ variant: 'ghost', size: 'small', onClick: onClose, 'aria-label': '关闭' }, '✕')
      ),
      h('div', { className: 'pmplan-modal-body' }, children),
      footer ? h('footer', { className: 'pmplan-drawer-foot' }, footer) : null
    )
  )
}

function Toast({ text }) {
  if (!text) return null
  return h('div', { className: 'pmplan-toast', role: 'status' }, text)
}

function Banner({ tone = 'warn', children, actions }) {
  return h('div', { className: 'pmplan-banner', 'data-tone': tone, role: 'alert' },
    h('span', null, children),
    actions ? h('span', { className: 'pmplan-spacer' }) : null,
    actions || null
  )
}

function Kpi({ label, value, hint, tone }) {
  return h('div', { className: 'pmplan-kpi' },
    h('div', { className: 'pmplan-kpi-label' }, label),
    h('div', { className: 'pmplan-kpi-value', style: tone ? { color: `var(--pm-${tone})` } : undefined }, value),
    hint ? h('div', { className: 'pmplan-kpi-hint' }, hint) : null
  )
}

function KeyValues({ rows }) {
  const children = []
  rows.filter(Boolean).forEach((row, index) => {
    children.push(h('dt', { key: `k${index}` }, row[0]))
    children.push(h('dd', { key: `v${index}` }, row[1]))
  })
  return h('dl', { className: 'pmplan-kv' }, children)
}



module.exports = { injectStyles, cx, Button, Badge, Progress, TextField, TextArea, Select, FieldRow, Card, Empty, Drawer, Modal, Toast, Banner, Kpi, KeyValues, styles, h }
  }
  __factories["client/styles.js"] = function (exports, module, __require) {
/**
 * 面板样式：优先复用宿主的 `--dsw-*` 设计令牌，拿不到时退回自己的回退值，
 * 这样在 Desktop 里跟主题一致，在 Node 里做渲染自测也能跑。
 *
 * 布局用容器查询而不是媒体查询：面板宽度由宿主分配，与视口宽度无关。
 */

const styles = `
.pmplan {
  --pm-bg: var(--dsw-alias-bg-layer-1, #ffffff);
  --pm-bg-soft: var(--dsw-alias-bg-layer-2, #f6f7f9);
  --pm-bg-sunken: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2, #eef0f4));
  --pm-fg: var(--dsw-alias-label-primary, #1b1d21);
  --pm-fg-soft: var(--dsw-alias-label-secondary, #5b6270);
  --pm-fg-muted: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-caption, #8b93a2));
  --pm-border: var(--dsw-alias-border-l2, #e2e5ea);
  --pm-border-strong: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2, #cdd2da));
  --pm-accent: var(--dsw-alias-brand-primary, var(--dsw-alias-button-primary-fill, #2f6fed));
  --pm-accent-soft: color-mix(in srgb, var(--pm-accent) 12%, transparent);
  --pm-danger: var(--dsw-alias-state-error-primary, #d93a3a);
  --pm-warn: var(--dsw-alias-state-warn-primary, #d9820a);
  --pm-ok: var(--dsw-alias-state-success-primary, #1f9d63);
  --pm-info: var(--dsw-alias-state-business-primary, var(--pm-accent));
  --pm-radius: var(--dsw-radius-md, 12px);
  --pm-radius-s: var(--dsw-radius-sm, 8px);
  --pm-shadow: 0 6px 24px rgba(15, 23, 42, 0.12);
  --pm-gap: 12px;

  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  container-type: inline-size;
  container-name: pmplan;
  background: var(--pm-bg);
  color: var(--pm-fg);
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif);
  font-size: 13px;
  line-height: 1.5;
}

.pmplan *,
.pmplan *::before,
.pmplan *::after { box-sizing: border-box; }

.pmplan :focus-visible {
  outline: 2px solid var(--pm-accent);
  outline-offset: 1px;
}

/* ---------- 顶栏 ---------- */

.pmplan-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  padding-left: calc(12px + var(--dsh-frame-leading-clearance, 0px));
  min-height: 48px;
  border-bottom: 1px solid var(--pm-border);
  background: var(--pm-bg);
  position: relative;
  z-index: 3;
}

.pmplan-brand {
  display: flex;
  align-items: center;
  gap: 7px;
  font-weight: 700;
  font-size: 14px;
  white-space: nowrap;
}

.pmplan-brand-icon { font-size: 16px; }

.pmplan-topbar-spacer { flex: 1 1 auto; min-width: 4px; }

.pmplan-topbar-status {
  color: var(--pm-fg-muted);
  font-size: 11.5px;
  white-space: nowrap;
}

.pmplan-topbar-status[data-tone="danger"] { color: var(--pm-danger); }

/* ---------- 布局 ---------- */

.pmplan-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}

.pmplan-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pmplan-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px 0;
  border-bottom: 1px solid var(--pm-border);
  overflow-x: auto;
  scrollbar-width: thin;
}

.pmplan-tab {
  appearance: none;
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  color: var(--pm-fg-soft);
  font: inherit;
  padding: 6px 10px;
  border-radius: var(--pm-radius-s) var(--pm-radius-s) 0 0;
  cursor: pointer;
  white-space: nowrap;
}

.pmplan-tab[aria-selected="true"] {
  background: var(--pm-bg);
  border-color: var(--pm-border);
  color: var(--pm-fg);
  font-weight: 600;
  margin-bottom: -1px;
  border-bottom: 1px solid var(--pm-bg);
}

.pmplan-tab:hover { color: var(--pm-fg); }

.pmplan-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: var(--pm-gap);
}

/* ---------- 页内筛查条 ---------- */

.pmplan-filters {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--pm-border);
  border-radius: var(--pm-radius);
  background: var(--pm-bg-soft);
}

.pmplan-filter-row { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }

.pmplan-filter-label {
  flex: 0 0 auto;
  width: 56px;
  padding-top: 4px;
  font-size: 11px;
  color: var(--pm-fg-muted);
  letter-spacing: 0.04em;
}

.pmplan-chips { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }

.pmplan-chip {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  border: 1px solid var(--pm-border);
  background: var(--pm-bg);
  color: var(--pm-fg-soft);
  font: inherit;
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 999px;
  cursor: pointer;
}

.pmplan-chip:hover { background: var(--pm-bg-sunken); }

.pmplan-chip[aria-pressed="true"] {
  border-color: var(--pm-accent);
  background: var(--pm-accent-soft);
  color: var(--pm-fg);
  font-weight: 600;
}

.pmplan-chip-count {
  font-size: 11px;
  color: var(--pm-fg-muted);
  font-variant-numeric: tabular-nums;
}

.pmplan-chip[aria-pressed="true"] .pmplan-chip-count { color: inherit; }

/* 从概览点卡带进来的「当前视图」标记，末尾的 ✕ 表示点一下即可清除。 */
.pmplan-chip-x {
  font-size: 10px;
  opacity: 0.7;
}
.pmplan-chip[aria-pressed="true"] .pmplan-chip-x { opacity: 0.9; }

/* ---------- 概览的智能视图卡 ---------- */

.pmplan-smart {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(124px, 1fr));
  gap: 8px;
}

.pmplan-smart-card {
  appearance: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid var(--pm-border);
  border-left: 3px solid var(--pm-accent);
  border-radius: var(--pm-radius);
  background: var(--pm-bg-soft);
  color: var(--pm-fg);
}

.pmplan-smart-card:hover { background: var(--pm-bg-sunken); }
.pmplan-smart-card[data-tone="warn"] { border-left-color: var(--pm-danger); }
.pmplan-smart-value { font-size: 21px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.25; }
.pmplan-smart-label { font-size: 12px; }
.pmplan-smart-hint { font-size: 11px; color: var(--pm-fg-muted); }

/* ---------- 设置弹窗 ---------- */

.pmplan-settings { display: flex; flex-direction: column; gap: 14px; }

.pmplan-dim {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--pm-border);
  border-radius: var(--pm-radius);
  padding: 10px 11px;
  background: var(--pm-bg-soft);
}

.pmplan-dim-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.pmplan-dim-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pmplan-dim-row .pmplan-input { flex: 1 1 auto; min-width: 0; }
.pmplan-dim-index { flex: 0 0 auto; width: 16px; font-size: 11px; color: var(--pm-fg-muted); font-variant-numeric: tabular-nums; }
.pmplan-dim-usage { flex: 0 0 auto; font-size: 11px; color: var(--pm-fg-muted); font-variant-numeric: tabular-nums; }
.pmplan-settings-actions { display: flex; flex-wrap: wrap; gap: 6px; }

/* ---------- 通用块 ---------- */

.pmplan-card {
  border: 1px solid var(--pm-border);
  border-radius: var(--pm-radius);
  background: var(--pm-bg);
  padding: 12px;
  min-width: 0;
}

.pmplan-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.pmplan-card-title { font-weight: 600; font-size: 13px; }

.pmplan-muted { color: var(--pm-fg-muted); }
.pmplan-soft { color: var(--pm-fg-soft); }
.pmplan-small { font-size: 11.5px; }
.pmplan-nowrap { white-space: nowrap; }
.pmplan-nums { font-variant-numeric: tabular-nums; }

.pmplan-section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--pm-fg-soft);
  letter-spacing: 0.02em;
}

.pmplan-grid {
  display: grid;
  gap: var(--pm-gap);
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  min-width: 0;
}

.pmplan-grid-wide { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }

.pmplan-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.pmplan-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pmplan-spacer { flex: 1 1 auto; }

/* ---------- KPI ---------- */

.pmplan-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 8px;
}

.pmplan-kpi {
  border: 1px solid var(--pm-border);
  border-radius: var(--pm-radius);
  padding: 9px 11px;
  background: var(--pm-bg-soft);
  min-width: 0;
}

.pmplan-kpi-label { font-size: 11.5px; color: var(--pm-fg-muted); }
.pmplan-kpi-value { font-size: 21px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.25; }
.pmplan-kpi-hint { font-size: 11px; color: var(--pm-fg-muted); }

.pmplan-headline {
  border-left: 3px solid var(--pm-accent);
  background: var(--pm-bg-soft);
  padding: 8px 10px;
  border-radius: 0 var(--pm-radius-s) var(--pm-radius-s) 0;
  color: var(--pm-fg-soft);
}

/* ---------- 徽标 / 进度 ---------- */

.pmplan-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  border: 1px solid var(--pm-border-strong);
  color: var(--pm-fg-soft);
  background: var(--pm-bg-soft);
  white-space: nowrap;
}

.pmplan-badge[data-tone="danger"] { color: var(--pm-danger); border-color: color-mix(in srgb, var(--pm-danger) 45%, transparent); background: color-mix(in srgb, var(--pm-danger) 10%, transparent); }
.pmplan-badge[data-tone="warn"] { color: var(--pm-warn); border-color: color-mix(in srgb, var(--pm-warn) 45%, transparent); background: color-mix(in srgb, var(--pm-warn) 10%, transparent); }
.pmplan-badge[data-tone="info"] { color: var(--pm-info); border-color: color-mix(in srgb, var(--pm-info) 45%, transparent); background: color-mix(in srgb, var(--pm-info) 10%, transparent); }
.pmplan-badge[data-tone="ok"] { color: var(--pm-ok); border-color: color-mix(in srgb, var(--pm-ok) 45%, transparent); background: color-mix(in srgb, var(--pm-ok) 10%, transparent); }
.pmplan-badge[data-tone="muted"] { color: var(--pm-fg-muted); }

.pmplan-progress {
  height: 6px;
  border-radius: 999px;
  background: var(--pm-bg-sunken);
  overflow: hidden;
  min-width: 48px;
}

.pmplan-progress > span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--pm-accent);
}

.pmplan-progress[data-tone="danger"] > span { background: var(--pm-danger); }
.pmplan-progress[data-tone="warn"] > span { background: var(--pm-warn); }
.pmplan-progress[data-tone="ok"] > span { background: var(--pm-ok); }

/* ---------- 按钮 / 输入 ---------- */

.pmplan-btn {
  appearance: none;
  font: inherit;
  border: 1px solid var(--pm-border-strong);
  background: var(--pm-bg);
  color: var(--pm-fg);
  border-radius: var(--pm-radius-s);
  padding: 4px 10px;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.pmplan-btn:hover { background: var(--pm-bg-sunken); }
/* 卡片内的标题按钮：允许换行，占满卡片宽度（看板标题超长时不再顶出卡片）。 */
.pmplan-btn-block {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: left;
}
.pmplan-btn-block:hover { background: transparent; text-decoration: underline; }
.pmplan-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pmplan-btn[data-variant="primary"] { background: var(--pm-accent); border-color: var(--pm-accent); color: #fff; }
.pmplan-btn[data-variant="primary"]:hover { filter: brightness(1.06); background: var(--pm-accent); }
.pmplan-btn[data-variant="ghost"] { border-color: transparent; background: transparent; color: var(--pm-fg-soft); }
.pmplan-btn[data-variant="ghost"]:hover { background: var(--pm-bg-sunken); }
.pmplan-btn[data-variant="danger"] { color: var(--pm-danger); border-color: color-mix(in srgb, var(--pm-danger) 45%, transparent); }
.pmplan-btn[data-size="small"] { padding: 2px 7px; font-size: 11.5px; }

.pmplan-input,
.pmplan-select,
.pmplan-textarea {
  font: inherit;
  color: var(--pm-fg);
  background: var(--pm-bg);
  border: 1px solid var(--pm-border-strong);
  border-radius: var(--pm-radius-s);
  padding: 4px 8px;
  min-width: 0;
  width: 100%;
}

.pmplan-textarea { min-height: 62px; resize: vertical; }
.pmplan-input[type="date"] { min-width: 128px; }
.pmplan-input[type="number"] { min-width: 72px; }
.pmplan-select { min-width: 96px; }

.pmplan-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.pmplan-field > label { font-size: 11.5px; color: var(--pm-fg-muted); }
.pmplan-field-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 8px; }
.pmplan-search { max-width: 240px; }

/* ---------- 表格 ---------- */

.pmplan-table-wrap { overflow: auto; border: 1px solid var(--pm-border); border-radius: var(--pm-radius); }

.pmplan-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }

.pmplan-table th,
.pmplan-table td {
  text-align: left;
  padding: 6px 9px;
  border-bottom: 1px solid var(--pm-border);
  vertical-align: middle;
}

.pmplan-table thead th {
  position: sticky;
  top: 0;
  background: var(--pm-bg-soft);
  font-size: 11.5px;
  color: var(--pm-fg-muted);
  font-weight: 600;
  z-index: 1;
}

.pmplan-table tbody tr:hover { background: var(--pm-bg-soft); }
.pmplan-table td.pmplan-cell-actions { text-align: right; white-space: nowrap; }
.pmplan-title-cell { font-weight: 600; }
.pmplan-clickable { cursor: pointer; }

/* ---------- 看板 ---------- */

/* 阶段列按行平铺、放不下就换行，不再横向滚动（阶段多的时候也整页可见）。 */
.pmplan-board {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  align-items: start;
  gap: 10px;
  min-width: 0;
}

.pmplan-board-col {
  border: 1px solid var(--pm-border);
  border-radius: var(--pm-radius);
  background: var(--pm-bg-soft);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 96px;
}

.pmplan-board-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--pm-border);
  font-weight: 600;
  font-size: 12.5px;
}

.pmplan-board-body { padding: 7px; display: flex; flex-direction: column; gap: 7px; }

.pmplan-item {
  border: 1px solid var(--pm-border);
  border-radius: var(--pm-radius-s);
  background: var(--pm-bg);
  padding: 8px 9px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  width: 100%;
}

.pmplan-item:hover { border-color: var(--pm-accent); }
.pmplan-item-title { font-weight: 600; overflow-wrap: anywhere; }
.pmplan-item-meta { font-size: 11.5px; color: var(--pm-fg-muted); display: flex; gap: 6px; flex-wrap: wrap; }

.pmplan-module-section { display: flex; flex-direction: column; gap: 8px; }

.pmplan-module-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  border-bottom: 1px dashed var(--pm-border-strong);
  padding-bottom: 4px;
  flex-wrap: wrap;
}

.pmplan-module-name { font-weight: 700; font-size: 13px; }

/* ---------- 条形图 / 环形图 ---------- */

.pmplan-bars { display: flex; flex-direction: column; gap: 6px; }

.pmplan-bar-row { display: grid; grid-template-columns: minmax(58px, 22%) 1fr auto; align-items: center; gap: 8px; }

.pmplan-bar-track { height: 12px; border-radius: 999px; background: var(--pm-bg-sunken); overflow: hidden; }
.pmplan-bar-fill { height: 100%; border-radius: 999px; background: var(--pm-accent); }
.pmplan-bar-fill[data-tone="danger"] { background: var(--pm-danger); }
.pmplan-bar-fill[data-tone="warn"] { background: var(--pm-warn); }
.pmplan-bar-fill[data-tone="ok"] { background: var(--pm-ok); }
.pmplan-bar-fill[data-tone="muted"] { background: var(--pm-border-strong); }

.pmplan-donut-wrap { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.pmplan-legend { display: flex; flex-direction: column; gap: 3px; font-size: 12px; min-width: 128px; }
.pmplan-legend-row { display: flex; align-items: center; gap: 6px; }
.pmplan-dot { width: 9px; height: 9px; border-radius: 999px; flex: 0 0 auto; background: var(--pm-border-strong); }
.pmplan-dot[data-tone="danger"] { background: var(--pm-danger); }
.pmplan-dot[data-tone="warn"] { background: var(--pm-warn); }
.pmplan-dot[data-tone="info"] { background: var(--pm-info); }
.pmplan-dot[data-tone="ok"] { background: var(--pm-ok); }
.pmplan-dot[data-tone="muted"] { background: var(--pm-border-strong); }

/* ---------- 日历 ---------- */

.pmplan-calendar { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

.pmplan-calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(84px, 1fr));
  gap: 4px;
  min-width: 0;
}

.pmplan-calendar-weekday {
  text-align: center;
  font-size: 11.5px;
  color: var(--pm-fg-muted);
  padding: 2px 0;
}

.pmplan-day {
  border: 1px solid var(--pm-border);
  border-radius: var(--pm-radius-s);
  min-height: 76px;
  padding: 4px 5px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: var(--pm-bg);
  min-width: 0;
  overflow: hidden;
}

.pmplan-day[data-outside="true"] { background: var(--pm-bg-soft); opacity: 0.62; }
.pmplan-day[data-today="true"] { border-color: var(--pm-accent); box-shadow: inset 0 0 0 1px var(--pm-accent); }

.pmplan-day-head { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: var(--pm-fg-muted); }
.pmplan-day-num { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--pm-fg-soft); }

.pmplan-day-item {
  font-size: 11px;
  border-radius: 4px;
  padding: 1px 4px;
  background: var(--pm-bg-sunken);
  border-left: 3px solid var(--pm-border-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: inherit;
  width: 100%;
}

.pmplan-day-item[data-tone="danger"] { border-left-color: var(--pm-danger); }
.pmplan-day-item[data-tone="warn"] { border-left-color: var(--pm-warn); }
.pmplan-day-item[data-tone="info"] { border-left-color: var(--pm-info); }
.pmplan-day-item[data-tone="ok"] { border-left-color: var(--pm-ok); }

/* ---------- 时间线 ---------- */

.pmplan-timeline { display: flex; flex-direction: column; gap: 4px; min-width: 0; overflow-x: auto; }

.pmplan-timeline-row {
  display: grid;
  grid-template-columns: minmax(140px, 200px) 1fr;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.pmplan-timeline-label { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pmplan-timeline-track {
  position: relative;
  height: 20px;
  background: var(--pm-bg-sunken);
  border-radius: 4px;
  min-width: 240px;
  overflow: hidden;
}

.pmplan-timeline-bar {
  position: absolute;
  top: 4px;
  height: 12px;
  border-radius: 999px;
  background: var(--pm-accent);
  border: none;
  padding: 0;
  cursor: pointer;
  min-width: 3px;
}

.pmplan-timeline-bar[data-tone="danger"] { background: var(--pm-danger); }
.pmplan-timeline-bar[data-tone="warn"] { background: var(--pm-warn); }
.pmplan-timeline-bar[data-tone="info"] { background: var(--pm-info); }
.pmplan-timeline-bar[data-tone="ok"] { background: var(--pm-ok); }
.pmplan-timeline-bar[data-tone="muted"] { background: var(--pm-border-strong); }

.pmplan-timeline-today {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--pm-accent);
  opacity: 0.7;
}

.pmplan-timeline-scale {
  display: grid;
  grid-template-columns: minmax(140px, 200px) 1fr;
  gap: 8px;
  font-size: 11px;
  color: var(--pm-fg-muted);
}

.pmplan-timeline-ticks { display: flex; justify-content: space-between; min-width: 240px; }

/* ---------- 抽屉 / 弹窗 ---------- */

.pmplan-scrim {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.28);
  display: flex;
  justify-content: flex-end;
  z-index: 20;
}

.pmplan-scrim[data-center="true"] { justify-content: center; align-items: center; }

.pmplan-drawer {
  width: min(520px, 100%);
  max-width: 100%;
  background: var(--pm-bg);
  border-left: 1px solid var(--pm-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  box-shadow: var(--pm-shadow);
}

.pmplan-drawer-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--pm-border);
}

.pmplan-drawer-title { font-weight: 700; font-size: 14px; overflow-wrap: anywhere; }
.pmplan-drawer-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.pmplan-drawer-foot { border-top: 1px solid var(--pm-border); padding: 8px 12px; display: flex; gap: 6px; flex-wrap: wrap; }

.pmplan-modal {
  width: min(620px, 100%);
  max-height: 100%;
  background: var(--pm-bg);
  border-radius: var(--pm-radius);
  border: 1px solid var(--pm-border);
  box-shadow: var(--pm-shadow);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.pmplan-modal-body { padding: 12px; overflow: auto; display: flex; flex-direction: column; gap: 10px; min-height: 0; }

.pmplan-kv { display: grid; grid-template-columns: minmax(72px, auto) 1fr; gap: 4px 10px; font-size: 12.5px; }
.pmplan-kv dt { color: var(--pm-fg-muted); }
.pmplan-kv dd { margin: 0; overflow-wrap: anywhere; }

.pmplan-log { display: flex; flex-direction: column; gap: 6px; }
.pmplan-log-item { border-left: 3px solid var(--pm-border-strong); padding: 2px 0 2px 8px; }
.pmplan-log-item[data-kind="阻塞"] { border-left-color: var(--pm-danger); }
.pmplan-log-item[data-kind="进展"] { border-left-color: var(--pm-info); }
.pmplan-log-item[data-kind="决策"] { border-left-color: var(--pm-warn); }
.pmplan-log-item[data-kind="变更"] { border-left-color: var(--pm-warn); }
.pmplan-log-item[data-kind="上线"] { border-left-color: var(--pm-ok); }

.pmplan-report {
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--pm-bg-soft);
  border: 1px solid var(--pm-border);
  border-radius: var(--pm-radius-s);
  padding: 10px;
  max-height: 420px;
  overflow: auto;
  margin: 0;
  min-height: 120px;
}

.pmplan-toast {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  background: var(--pm-fg);
  color: var(--pm-bg);
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12px;
  z-index: 40;
  max-width: 80%;
  box-shadow: var(--pm-shadow);
}

.pmplan-banner {
  border: 1px solid color-mix(in srgb, var(--pm-warn) 45%, transparent);
  background: color-mix(in srgb, var(--pm-warn) 10%, transparent);
  color: var(--pm-fg);
  border-radius: var(--pm-radius-s);
  padding: 8px 10px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.pmplan-banner[data-tone="danger"] {
  border-color: color-mix(in srgb, var(--pm-danger) 45%, transparent);
  background: color-mix(in srgb, var(--pm-danger) 10%, transparent);
}

.pmplan-empty {
  border: 1px dashed var(--pm-border-strong);
  border-radius: var(--pm-radius);
  padding: 18px;
  text-align: center;
  color: var(--pm-fg-muted);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}

/* ---------- 会话抽屉 ---------- */

.pmplan-chat {
  width: min(420px, 46%);
  min-width: 300px;
  border-left: 1px solid var(--pm-border);
  background: var(--pm-bg);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.pmplan-chat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--pm-border);
}

.pmplan-chat-body { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; }

/* ---------- 窄容器适配（按业务容器宽度，不是视口） ---------- */

@container pmplan (max-width: 1080px) {
  .pmplan-filter-label { width: 48px; }
  .pmplan-timeline-row,
  .pmplan-timeline-scale { grid-template-columns: minmax(110px, 150px) 1fr; }
  .pmplan-calendar-grid { grid-template-columns: repeat(7, minmax(72px, 1fr)); }
}

@container pmplan (max-width: 900px) {
  .pmplan-body { flex-direction: column; }
  .pmplan-filter-row { flex-direction: column; gap: 4px; }
  .pmplan-filter-label { width: auto; padding-top: 0; }
  .pmplan-smart { grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); }
  .pmplan-calendar-grid { grid-template-columns: repeat(7, minmax(58px, 1fr)); }
  .pmplan-day { min-height: 62px; }
  .pmplan-chat { width: 100%; min-width: 0; }
  .pmplan-scrim { flex-direction: column; }
  .pmplan-drawer { width: 100%; border-left: none; border-top: 1px solid var(--pm-border); }
}

@container pmplan (max-width: 620px) {
  .pmplan-kpis { grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
  .pmplan-smart { grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); }
  .pmplan-smart-value { font-size: 18px; }
  .pmplan-content { padding: 8px; }
  .pmplan-calendar-grid { grid-template-columns: repeat(7, minmax(44px, 1fr)); }
  .pmplan-day { min-height: 54px; padding: 3px; }
  .pmplan-day-item { font-size: 10px; }
  .pmplan-search { max-width: 100%; }
}
`

const __default = styles


module.exports = { styles, default: __default }
  }
  __factories["client/screens.js"] = function (exports, module, __require) {
const { useState } = __require("react")
const { Badge, Button, Card, Empty, Kpi, Progress, Select, TextArea } = __require("client/ui.js")
const { BarList, Donut, StackedBars } = __require("client/charts.js")
const { RISK_TONE, headline, orderBoardColumns, orderRisk, ownerWorkload, planRisk, platformLoad, projectRisk, riskBreakdown, riskItems, statusColumns, todayBuckets } = __require("shared/metrics.js")
const { groupByModule, groupByPlatform, sortOrders, sortPlans, weekBoard } = __require("shared/views.js")
const { REPORT_KINDS } = __require("shared/report.js")
const { WEEKDAY_LABELS, formatDate, formatDayLabel, formatShortDate, monthGrid, shiftMonth } = __require("shared/date.js")
const { PLAN_STATUS } = __require("shared/model.js")
/**
 * 七个业务页签的视图组件。
 *
 * 全部是纯展示：数据与回调都来自面板，组件自己不读写本机数据。
 */

const h = require('react').createElement

function toneOf(level) {
  return RISK_TONE[level] || 'muted'
}

function ItemButton({ title, meta, tone, onClick, key }) {
  return h('button', { type: 'button', className: 'pmplan-item', onClick, key },
    h('span', { className: 'pmplan-item-title' }, title),
    h('span', { className: 'pmplan-item-meta' },
      tone ? h(Badge, { tone, children: tone }) : null,
      meta || null
    )
  )
}

function openItem(item, handlers) {
  if (item.kind === 'project') handlers.onOpenProject(item.id)
  else if (item.kind === 'order') handlers.onOpenOrder(item.id)
  else handlers.onOpenPlan(item.id)
}

/* ---------------- 页内筛查条 ---------------- */

/** 智能视图的一句话说明：鼠标悬停能看懂「这个视图到底筛什么」。 */
const SMART_HINTS = {
  all: '未结束的项目',
  attention: '逾期 / 阻塞 / 进度风险',
  overdue: '已过截止日期',
  week: '本周内到期',
  unscheduled: '缺开始或截止日期',
  done: '已完成、已归档'
}

function ChipRow({ label, children }) {
  return h('div', { className: 'pmplan-filter-row' },
    h('span', { className: 'pmplan-filter-label' }, label),
    h('div', { className: 'pmplan-chips' }, children)
  )
}

/**
 * 页内筛查条。这些筛选以前挂在左侧栏、对所有页面生效；现在下沉到页面自己身上，
 * 每页只显示与自己有关的维度——项目页看「模块 + 端」，工单页看「模块 + 目标端」。
 * 筛选状态由面板按页持有，所以来回切页签不会互相冲掉。
 *
 * 智能视图不在这条上罗列（它只在概览的统计卡里）。但概览的卡是可点的，点进来会
 * 带上一个视图；这时显示一枚可关闭的「当前视图」标记，免得列表被悄悄收窄而看不出来源。
 */
function FilterBar({ scope, setScope, dims, view, onClearView }) {
  const dirty = dims.some((dim) => scope[dim.key]) || Boolean(view)
  const reset = () => setScope((current) => {
    const next = { ...current }
    if (view) next.smart = ''
    for (const dim of dims) next[dim.key] = ''
    return next
  })

  const chip = (key, label, active, onClick, extra) => h('button', {
    key,
    type: 'button',
    className: 'pmplan-chip',
    'aria-pressed': active ? 'true' : 'false',
    onClick
  }, h('span', null, label), extra || null)

  return h('div', { className: 'pmplan-filters' },
    view
      ? h(ChipRow, { label: '视图' },
          h('button', {
            key: 'view',
            type: 'button',
            className: 'pmplan-chip',
            'aria-pressed': 'true',
            title: `${SMART_HINTS[scope.smart] || ''} · 来自概览，点一下清除`,
            onClick: onClearView
          }, h('span', null, view), h('span', { className: 'pmplan-chip-x' }, '✕'))
        )
      : null,
    dims.map((dim) => h(ChipRow, { key: dim.key, label: dim.label },
      chip(`${dim.key}-all`, dim.emptyLabel || '全部', !scope[dim.key], () => setScope((current) => ({ ...current, [dim.key]: '' }))),
      dim.names.map((name) => chip(
        name,
        name,
        scope[dim.key] === name,
        () => setScope((current) => ({ ...current, [dim.key]: current[dim.key] === name ? '' : name }))
      ))
    )),
    dirty
      ? h('div', { className: 'pmplan-filter-row' },
          h('span', { className: 'pmplan-filter-label' }, ' '),
          h(Button, { size: 'small', variant: 'ghost', onClick: reset }, '清除筛选')
        )
      : null
  )
}

/** 概览页的智能视图统计卡：每个数字都能点，点开就是项目页对应的智能视图。 */
function SmartCards({ counts, onOpenSmart }) {
  return h('div', { className: 'pmplan-smart' },
    counts.map((row) => h('button', {
      key: row.id,
      type: 'button',
      className: 'pmplan-smart-card',
      'data-tone': row.id === 'attention' || row.id === 'overdue' ? 'warn' : 'info',
      title: `${SMART_HINTS[row.id] || ''} · 点开看项目`,
      onClick: () => onOpenSmart(row.id)
    },
      h('span', { className: 'pmplan-smart-value' }, String(row.count)),
      h('span', { className: 'pmplan-smart-label' }, row.label),
      h('span', { className: 'pmplan-smart-hint' }, SMART_HINTS[row.id] || '')
    ))
  )
}

/* ---------------- 概览 ---------------- */

function OverviewScreen(props) {
  const { projects, orders, plans, scoped, stats, summaryLine, today, onOpenProject, onOpenOrder, onOpenPlan, onSetView, counts, scope, setScope, onOpenSmart, moduleNames, platformNames } = props
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const breakdown = riskBreakdown(scoped.projects, scoped.orders, scoped.plans, today)
  const modules = groupByModule(scoped.projects, scoped.orders, today, moduleNames)
  const platforms = platformLoad(scoped.projects, scoped.orders, today, platformNames)
  const owners = ownerWorkload(scoped.projects, scoped.orders, scoped.plans, today)
  const board = weekBoard(scoped.orders, scoped.plans, today)
  const buckets = todayBuckets(scoped.projects, scoped.orders, scoped.plans, today)
  const handlers = { onOpenProject, onOpenOrder, onOpenPlan }
  const decorated = scoped.projects.map((project) => ({ ...project, risk: projectRisk(project, today) }))

  const ask = () => {
    const keyword = question.trim().toLowerCase()
    if (!keyword) {
      setAnswer('')
      return
    }
    const hits = []
    const projectHits = scoped.projects.filter((project) => [project.name, project.summary].join(' ').toLowerCase().includes(keyword))
    if (projectHits.length) hits.push(`项目：${projectHits.map((project) => `${project.name}（${project.status}｜${project.progress}%）`).join('；')}`)
    const orderHits = scoped.orders.filter((order) => [order.title, order.description, order.kind].join(' ').toLowerCase().includes(keyword))
    if (orderHits.length) hits.push(`工单：${orderHits.map((order) => `${order.title}（${order.stage}）`).join('；')}`)
    const planHits = scoped.plans.filter((plan) => [plan.title, plan.note].join(' ').toLowerCase().includes(keyword))
    if (planHits.length) hits.push(`计划：${planHits.map((plan) => `${plan.title}（${plan.status}）`).join('；')}`)
    if (/逾期|延期|超期/.test(keyword)) {
      const overdue = riskItems(scoped.projects, scoped.orders, scoped.plans, today).filter((item) => item.risk === '已逾期')
      hits.push(overdue.length ? `逾期 ${overdue.length} 项：${overdue.map((item) => `${item.title}（${item.sourceName}）`).join('；')}` : '当前没有逾期项。')
    }
    if (/本周|这周|周内/.test(keyword)) hits.push(`本周到期：工单 ${stats.orderWeek} 条、计划 ${stats.planWeek} 条。`)
    if (/风险|关注/.test(keyword)) hits.push(`需关注项目 ${stats.attention} 个，逾期工单 ${stats.orderOverdue} 条，逾期计划 ${stats.planOverdue} 条。`)
    setAnswer(hits.join('\n') || '没有匹配的条目，换个关键词试试。')
  }

  const renderItems = (items, limit) => h('div', { className: 'pmplan-col' },
    items.slice(0, limit).map((item) => h(ItemButton, {
      key: `${item.kind}-${item.id}`,
      title: item.title,
      tone: item.risk,
      meta: `${item.sourceName} · ${item.owner || '未指派'}`,
      onClick: () => openItem(item, handlers)
    }))
  )

  return [
    h(SmartCards, { key: 'smart', counts, onOpenSmart }),
    h(FilterBar, {
      key: 'filters',
      scope,
      setScope,
      dims: [
        { key: 'moduleId', label: '模块', names: moduleNames },
        { key: 'platform', label: '端', names: platformNames }
      ]
    }),
    h('div', { className: 'pmplan-kpis', key: 'kpis' },
      h(Kpi, { key: 'a', label: '在管项目', value: stats.active, hint: `共 ${stats.projects} 个` }),
      h(Kpi, { key: 'b', label: '需关注', value: stats.attention, hint: `逾期 ${stats.overdue}`, tone: stats.attention ? 'danger' : undefined }),
      h(Kpi, { key: 'c', label: '未结束工单', value: stats.orderOpen, hint: `逾期 ${stats.orderOverdue}` }),
      h(Kpi, { key: 'd', label: '未完成计划', value: stats.planOpen, hint: `本周到期 ${stats.planWeek}` }),
      h(Kpi, { key: 'e', label: '平均进度', value: `${stats.avgProgress}%` }),
      h(Kpi, { key: 'f', label: '未排期', value: stats.unscheduled, hint: '缺开始或投产' })
    ),
    h('div', { className: 'pmplan-headline', key: 'headline' }, summaryLine),
    h('div', { className: 'pmplan-grid', key: 'charts' },
      h(Card, { key: 'risk', title: '风险分布' },
        h(Donut, { slices: breakdown, centerHint: '个项目' })
      ),
      h(Card, { key: 'module', title: '模块负载' },
        h(StackedBars, {
          rows: modules.map((group) => ({
            key: group.module,
            label: group.module,
            total: group.items.length + group.orders.length,
            segments: [
              { label: '项目', value: group.items.length, tone: 'info' },
              { label: '工单', value: group.orders.length, tone: 'warn' }
            ],
            text: `${group.items.length} 个 / ${group.orders.length} 单`
          })),
          emptyText: '还没有项目或工单。'
        })
      ),
      h(Card, { key: 'platform', title: '按端分布' },
        h(StackedBars, {
          rows: platforms.map((row) => ({
            key: row.platform,
            label: row.platform,
            total: row.projects,
            segments: [{ label: '项目', value: row.projects, tone: 'info' }, { label: '未结束工单', value: row.open, tone: 'warn' }],
            text: `${row.projects} 个 / ${row.open} 单`
          })),
          emptyText: '还没有项目。'
        })
      ),
      h(Card, { key: 'owner', title: '负责人负载' },
        h(BarList, {
          rows: owners.map((row) => ({ key: row.owner, label: row.owner, value: row.total, text: `${row.total}（逾期 ${row.overdue}）`, tone: row.overdue ? 'danger' : 'info' })),
          emptyText: '还没有分配。'
        })
      )
    ),
    h(Card, {
      key: 'now',
      title: '需要马上处理',
      actions: h(Button, { size: 'small', onClick: () => onSetView('risks') }, '看全部风险')
    },
      h('div', { className: 'pmplan-grid pmplan-grid-wide' },
        h('div', { className: 'pmplan-module-section' },
          h('div', { className: 'pmplan-section-title' }, `已逾期（${buckets.overdue.length}）`),
          buckets.overdue.length
            ? renderItems(buckets.overdue, 6)
            : h('div', { className: 'pmplan-small pmplan-muted' }, '没有逾期项。')
        ),
        h('div', { className: 'pmplan-module-section' },
          h('div', { className: 'pmplan-section-title' }, `今天到期（${buckets.dueToday.length}）`),
          buckets.dueToday.length
            ? renderItems(buckets.dueToday, 6)
            : h('div', { className: 'pmplan-small pmplan-muted' }, '今天没有到期项。')
        )
      )
    ),
    h(Card, { key: 'week', title: `本周（${board.start} ~ ${board.end}）` },
      h('div', { className: 'pmplan-board' },
        board.days.map((day) => h('div', { className: 'pmplan-board-col', key: day.date },
          h('div', { className: 'pmplan-board-head' },
            h('span', null, formatDayLabel(day.date)),
            h('span', { className: 'pmplan-spacer' }),
            h('span', { className: 'pmplan-small pmplan-muted' }, String(day.count)),
            day.date === today ? h(Badge, { tone: 'info', children: '今天' }) : null
          ),
          h('div', { className: 'pmplan-board-body' },
            day.items.length
              ? day.items.map((item) => h('div', { className: 'pmplan-item', key: `${item.kind}-${item.id}` },
                  h('button', {
                    type: 'button',
                    className: 'pmplan-btn',
                    'data-variant': 'ghost',
                    style: { textAlign: 'left', padding: 0 },
                    onClick: () => (item.kind === 'order' ? onOpenOrder(item.id) : onOpenPlan(item.id))
                  }, h('span', { className: 'pmplan-item-title' }, item.title)),
                  h('span', { className: 'pmplan-item-meta' },
                    h(Badge, { tone: toneOf(item.risk), children: item.risk }),
                    `${item.sourceName} · ${item.meta}`
                  )
                ))
              : h('div', { className: 'pmplan-small pmplan-muted' }, '无到期项')
          )
        ))
      )
    ),
    h('div', { className: 'pmplan-grid pmplan-grid-wide', key: 'bottom' },
      h(Card, { title: '项目状态一览' },
        decorated.length
          ? h('div', { className: 'pmplan-col' }, decorated.map((project) => h('div', { className: 'pmplan-row', key: project.id },
              h('button', {
                type: 'button',
                className: 'pmplan-btn',
                'data-variant': 'ghost',
                style: { textAlign: 'left', flex: '1 1 auto', minWidth: 0 },
                onClick: () => onOpenProject(project.id)
              }, project.name),
              h(Badge, { tone: toneOf(project.risk), children: project.risk }),
              h('span', { style: { width: 88, flex: '0 0 auto' } }, h(Progress, { value: project.progress, tone: toneOf(project.risk) })),
              h('span', { className: 'pmplan-small pmplan-muted pmplan-nowrap' }, `${project.platform} · ${formatShortDate(project.dueDate)}`)
            )))
          : h(Empty, { text: '还没有项目，先点「新建项目」。' })
      ),
      h(Card, { title: '问一句' },
        h('div', { className: 'pmplan-col' },
          h('div', { className: 'pmplan-row' },
            h('input', {
              className: 'pmplan-input',
              placeholder: '例如：逾期 / 本周 / 手机银行',
              value: question,
              'aria-label': '问一句',
              onChange: (event) => setQuestion(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') ask() }
            }),
            h(Button, { onClick: ask }, '查询')
          ),
          h('div', { className: 'pmplan-row pmplan-small' },
            ['逾期', '本周', '风险'].map((hint) => h(Button, { key: hint, size: 'small', variant: 'ghost', onClick: () => setQuestion(hint) }, hint))
          ),
          answer
            ? h('div', { className: 'pmplan-report', style: { minHeight: 0, maxHeight: 200 } }, answer)
            : h('div', { className: 'pmplan-small pmplan-muted' }, '在本地数据里直接查，不联网、不改数据。')
        )
      )
    )
  ]
}

/* ---------------- 项目 ---------------- */

function ProjectsScreen(props) {
  const { scoped, today, onOpenProject, onOpenOrder, onOpenPlan, onEditProject, onDelete, scope, setScope, view, onClearView, moduleNames, platformNames } = props
  const [grouping, setGrouping] = useState('module')
  const [expanded, setExpanded] = useState('')
  const groups = grouping === 'platform'
    ? groupByPlatform(scoped.projects, scoped.orders, today, platformNames)
    : grouping === 'status'
      ? statusColumns(scoped.projects, today).map((column) => ({ module: column.status, items: column.items, orders: [], count: column.count, orderCount: 0 }))
      : groupByModule(scoped.projects, scoped.orders, today, moduleNames)

  const visible = groups.filter((group) => group.count)

  return [
    h(FilterBar, {
      key: 'filters',
      scope,
      setScope,
      view,
      onClearView,
      dims: [
        { key: 'moduleId', label: '模块', names: moduleNames },
        { key: 'platform', label: '端', names: platformNames }
      ]
    }),
    h('div', { className: 'pmplan-row', key: 'head' },
      h('span', { className: 'pmplan-section-title' }, `项目 ${scoped.projects.length} 个`),
      h('span', { className: 'pmplan-spacer' }),
      h(Select, {
        value: grouping,
        onChange: setGrouping,
        options: [
          { value: 'module', label: '按模块' },
          { value: 'platform', label: '按端' },
          { value: 'status', label: '按状态' }
        ]
      }),
      h(Button, { onClick: () => onEditProject(null) }, '新建项目')
    ),
    scoped.projects.length === 0
      ? h(Empty, {
          key: 'empty',
          text: scope.smart === 'all' ? '当前筛选下没有项目。' : '该视图下没有项目。',
          action: h(Button, { variant: 'primary', onClick: () => onEditProject(null) }, '新建项目')
        })
      : visible.map((group) => {
          const name = group.module || group.platform
          const isOpen = expanded === name
          const groupOrders = group.orders || []
          return h('section', { className: 'pmplan-module-section', key: name },
            h('div', { className: 'pmplan-module-head' },
              h('span', { className: 'pmplan-module-name' }, name),
              h(Badge, { tone: 'muted', children: `${group.count} 个项目` }),
              groupOrders.length ? h(Badge, { tone: 'info', children: `${groupOrders.length} 个工单` }) : null,
              h('span', { className: 'pmplan-spacer' }),
              groupOrders.length
                ? h(Button, { size: 'small', variant: 'ghost', onClick: () => setExpanded(isOpen ? '' : name) }, isOpen ? '收起工单' : '展开工单')
                : null
            ),
            isOpen && groupOrders.length
              ? h('div', { className: 'pmplan-col', style: { marginBottom: 8 } },
                  groupOrders.map((order) => h('button', {
                    key: order.id,
                    type: 'button',
                    className: 'pmplan-item',
                    onClick: () => onOpenOrder(order.id)
                  },
                    h('span', { className: 'pmplan-item-title' }, `${order.code ? `${order.code} ` : ''}${order.title}`),
                    h('span', { className: 'pmplan-item-meta' },
                      h(Badge, { tone: toneOf(orderRisk(order, today)), children: orderRisk(order, today) }),
                      `${order.stage} · 投产 ${formatShortDate(order.dueDate)}`
                    )
                  ))
                )
              : null,
            h('div', { className: 'pmplan-grid pmplan-grid-wide' },
              group.items.map((project) => h('div', { className: 'pmplan-card', key: project.id },
                h('div', { className: 'pmplan-card-head' },
                  h('button', {
                    type: 'button',
                    className: 'pmplan-btn',
                    'data-variant': 'ghost',
                    style: { fontWeight: 600, padding: 0, textAlign: 'left' },
                    onClick: () => onOpenProject(project.id)
                  }, project.name),
                  h('span', { className: 'pmplan-spacer' }),
                  h(Badge, { tone: toneOf(project.risk), children: project.risk })
                ),
                project.code ? h('div', { className: 'pmplan-small pmplan-muted' }, project.code) : null,
                h('div', { className: 'pmplan-row pmplan-small pmplan-muted' },
                  `${project.platform} · ${project.status} · ${project.owner}`,
                  h('span', { className: 'pmplan-spacer' }),
                  project.dueDate ? `投产 ${formatDate(project.dueDate)}` : '未排期'
                ),
                h('div', { className: 'pmplan-row', style: { marginTop: 6 } },
                  h('span', { style: { flex: '1 1 auto' } }, h(Progress, { value: project.progress, tone: toneOf(project.risk) })),
                  h('span', { className: 'pmplan-small pmplan-nums' }, `${project.progress}%`)
                ),
                h('div', { className: 'pmplan-row', style: { marginTop: 8 } },
                  h(Button, { size: 'small', onClick: () => onEditProject(project) }, '编辑'),
                  h(Button, { size: 'small', variant: 'danger', onClick: () => onDelete('project', project.id) }, '删除')
                )
              ))
            )
          )
        })
  ]
}

/* ---------------- 工单 ---------------- */

function OrdersScreen(props) {
  const { scoped, today, onOpenOrder, onEditOrder, onDelete, scope, setScope, moduleNames, targetNames } = props
  const [mode, setMode] = useState('table')
  const [sortMode, setSortMode] = useState('risk')
  const rows = sortOrders(scoped.orders, today, sortMode)
  const columns = orderBoardColumns(scoped.orders, today)

  return [
    h(FilterBar, {
      key: 'filters',
      scope,
      setScope,
      dims: [
        { key: 'moduleId', label: '模块', names: moduleNames },
        { key: 'target', label: '目标端', names: targetNames, emptyLabel: '全部端' }
      ]
    }),
    h('div', { className: 'pmplan-row', key: 'head' },
      h('span', { className: 'pmplan-section-title' }, `工单 ${rows.length} 条`),
      h('span', { className: 'pmplan-spacer' }),
      h(Button, { size: 'small', variant: mode === 'table' ? 'primary' : 'default', onClick: () => setMode('table') }, '列表'),
      h(Button, { size: 'small', variant: mode === 'board' ? 'primary' : 'default', onClick: () => setMode('board') }, '看板'),
      h(Select, {
        value: sortMode,
        onChange: setSortMode,
        options: [
          { value: 'risk', label: '按风险' },
          { value: 'due', label: '按截止' },
          { value: 'priority', label: '按优先级' },
          { value: 'stage', label: '按阶段' }
        ]
      }),
      h(Button, { variant: 'primary', onClick: () => onEditOrder(null) }, '新建工单')
    ),
    rows.length === 0
      ? h(Empty, {
          key: 'empty',
          text: '当前筛选下没有工单。',
          action: h(Button, { variant: 'primary', onClick: () => onEditOrder(null) }, '新建工单')
        })
      : mode === 'table'
        ? h('div', { className: 'pmplan-table-wrap', key: 'table' },
            h('table', { className: 'pmplan-table' },
              h('thead', null, h('tr', null,
                h('th', null, '工单编号'),
                h('th', null, '工单'),
                h('th', null, '模块'),
                h('th', null, '类型'),
                h('th', null, '优先级'),
                h('th', null, '阶段'),
                h('th', null, '负责人'),
                h('th', null, '创建日期'),
                h('th', null, '投产日期'),
                h('th', null, '风险'),
                h('th', { className: 'pmplan-cell-actions' }, '操作')
              )),
              h('tbody', null, rows.map((order) => h('tr', { key: order.id },
                h('td', { className: 'pmplan-muted pmplan-nums' }, order.code || '—'),
                h('td', { className: 'pmplan-title-cell' },
                  h('button', { type: 'button', className: 'pmplan-btn', 'data-variant': 'ghost', style: { padding: 0 }, onClick: () => onOpenOrder(order.id) }, order.title)
                ),
                h('td', { className: 'pmplan-muted' }, order.moduleName),
                h('td', null, order.kind),
                h('td', null, h(Badge, { tone: order.priority === '紧急' ? 'danger' : order.priority === '高' ? 'warn' : 'muted', children: order.priority })),
                h('td', null, h(Badge, { tone: 'info', children: order.stage })),
                h('td', { className: 'pmplan-muted' }, order.owner || '未指派'),
                h('td', { className: 'pmplan-nums pmplan-muted' }, formatDate(order.createdOn, '未填')),
                h('td', { className: 'pmplan-nums' }, formatDate(order.dueDate, '未排期')),
                h('td', null, h(Badge, { tone: toneOf(order.risk), children: order.risk })),
                h('td', { className: 'pmplan-cell-actions' },
                  h(Button, { size: 'small', onClick: () => onEditOrder(order) }, '编辑'),
                  h(Button, { size: 'small', variant: 'danger', onClick: () => onDelete('order', order.id) }, '删除')
                )
              )))
            )
          )
        : h('div', { className: 'pmplan-board', key: 'board' },
            columns.map((column) => h('div', { className: 'pmplan-board-col', key: column.stage },
              h('div', { className: 'pmplan-board-head' },
                h('span', null, column.stage),
                h('span', { className: 'pmplan-spacer' }),
                h('span', { className: 'pmplan-small pmplan-muted' }, String(column.count))
              ),
              h('div', { className: 'pmplan-board-body' },
                column.items.length
                  ? column.items.map((order) => h('div', { className: 'pmplan-item', key: order.id },
                      h('button', { type: 'button', className: 'pmplan-btn pmplan-btn-block', 'data-variant': 'ghost', onClick: () => onOpenOrder(order.id) },
                        h('span', { className: 'pmplan-item-title' }, order.title)
                      ),
                      h('span', { className: 'pmplan-item-meta' },
                        h(Badge, { tone: toneOf(order.risk), children: order.risk }),
                        `${order.moduleName} · ${order.priority}`
                      ),
                      h('span', { className: 'pmplan-small pmplan-muted' }, `${formatDate(order.dueDate, '未排期')} · ${order.owner || '未指派'}`)
                    ))
                  : h('div', { className: 'pmplan-small pmplan-muted' }, '空')
              )
            ))
          )
  ]
}

/* ---------------- 计划 ---------------- */

function PlansScreen(props) {
  const { scoped, today, onOpenPlan, onEditPlan, onDelete, onTogglePlan } = props
  const [mode, setMode] = useState('table')
  const [sortMode, setSortMode] = useState('risk')
  const rows = sortPlans(scoped.plans, today, sortMode)
  const buckets = PLAN_STATUS.map((status) => ({ status, items: rows.filter((plan) => plan.status === status) }))

  return [
    h('div', { className: 'pmplan-row', key: 'head' },
      h('span', { className: 'pmplan-section-title' }, `计划 ${rows.length} 条`),
      h('span', { className: 'pmplan-spacer' }),
      h(Button, { size: 'small', variant: mode === 'table' ? 'primary' : 'default', onClick: () => setMode('table') }, '列表'),
      h(Button, { size: 'small', variant: mode === 'board' ? 'primary' : 'default', onClick: () => setMode('board') }, '看板'),
      h(Select, {
        value: sortMode,
        onChange: setSortMode,
        options: [
          { value: 'risk', label: '按风险' },
          { value: 'due', label: '按截止' },
          { value: 'status', label: '按状态' }
        ]
      }),
      h(Button, { variant: 'primary', onClick: () => onEditPlan(null) }, '新建计划')
    ),
    rows.length === 0
      ? h(Empty, {
          key: 'empty',
          text: '当前筛选下没有计划。',
          action: h(Button, { variant: 'primary', onClick: () => onEditPlan(null) }, '新建计划')
        })
      : mode === 'table'
        ? h('div', { className: 'pmplan-table-wrap', key: 'table' },
            h('table', { className: 'pmplan-table' },
              h('thead', null, h('tr', null,
                h('th', null, '完成'),
                h('th', null, '计划'),
                h('th', null, '模块'),
                h('th', null, '状态'),
                h('th', null, '负责人'),
                h('th', null, '投产日期'),
                h('th', null, '风险'),
                h('th', { className: 'pmplan-cell-actions' }, '操作')
              )),
              h('tbody', null, rows.map((plan) => h('tr', { key: plan.id },
                h('td', null, h('input', {
                  type: 'checkbox',
                  checked: plan.status === '已完成',
                  'aria-label': `完成 ${plan.title}`,
                  onChange: () => onTogglePlan(plan)
                })),
                h('td', { className: 'pmplan-title-cell' },
                  h('button', { type: 'button', className: 'pmplan-btn', 'data-variant': 'ghost', style: { padding: 0 }, onClick: () => onOpenPlan(plan.id) }, plan.title)
                ),
                h('td', { className: 'pmplan-muted' }, plan.moduleName),
                h('td', null, h(Badge, { tone: plan.status === '已完成' ? 'ok' : plan.status === '进行中' ? 'info' : 'muted', children: plan.status })),
                h('td', { className: 'pmplan-muted' }, plan.owner || '未指派'),
                h('td', { className: 'pmplan-nums' }, formatDate(plan.dueDate, '未排期')),
                h('td', null, h(Badge, { tone: toneOf(plan.risk), children: plan.risk })),
                h('td', { className: 'pmplan-cell-actions' },
                  h(Button, { size: 'small', onClick: () => onEditPlan(plan) }, '编辑'),
                  h(Button, { size: 'small', variant: 'danger', onClick: () => onDelete('plan', plan.id) }, '删除')
                )
              )))
            )
          )
        : h('div', { className: 'pmplan-board', key: 'board' },
            buckets.map((bucket) => h('div', { className: 'pmplan-board-col', key: bucket.status },
              h('div', { className: 'pmplan-board-head' },
                h('span', null, bucket.status),
                h('span', { className: 'pmplan-spacer' }),
                h('span', { className: 'pmplan-small pmplan-muted' }, String(bucket.items.length))
              ),
              h('div', { className: 'pmplan-board-body' },
                bucket.items.length
                  ? bucket.items.map((plan) => h('div', { className: 'pmplan-item', key: plan.id },
                      h('button', { type: 'button', className: 'pmplan-btn pmplan-btn-block', 'data-variant': 'ghost', style: { padding: 0, textAlign: 'left' }, onClick: () => onOpenPlan(plan.id) },
                        h('span', { className: 'pmplan-item-title' }, plan.title)
                      ),
                      h('span', { className: 'pmplan-item-meta' },
                        h(Badge, { tone: toneOf(plan.risk), children: plan.risk }),
                        plan.moduleName
                      ),
                      h('span', { className: 'pmplan-small pmplan-muted' }, `${formatDate(plan.dueDate, '未排期')} · ${plan.owner || '未指派'}`)
                    ))
                  : h('div', { className: 'pmplan-small pmplan-muted' }, '空')
              )
            ))
          )
  ]
}

/* ---------------- 日历 ---------------- */

function CalendarScreen(props) {
  const { scoped, projects, orders, today, onOpenProject, onOpenOrder, onOpenPlan, calendarMonth, setCalendarMonth } = props
  const grid = monthGrid(calendarMonth)
  const items = new Map()
  const push = (date, item) => {
    if (!date) return
    if (!items.has(date)) items.set(date, [])
    items.get(date).push(item)
  }
  for (const plan of scoped.plans) {
    if (plan.status === '已完成' || plan.status === '已取消' || !plan.dueDate) continue
    push(plan.dueDate, { kind: 'plan', id: plan.id, title: plan.title, risk: planRisk(plan, today), sourceName: plan.module || '未归模块' })
  }
  for (const order of scoped.orders) {
    if (order.stage === '已上线' || order.stage === '已取消' || !order.dueDate) continue
    push(order.dueDate, { kind: 'order', id: order.id, title: order.title, risk: orderRisk(order, today), sourceName: order.module || '未归模块' })
  }
  for (const project of scoped.projects) {
    if (project.status === '已完成' || !project.dueDate) continue
    push(project.dueDate, { kind: 'project', id: project.id, title: `投产：${project.name}`, risk: projectRisk(project, today), sourceName: project.name })
  }

  return [
    h('div', { className: 'pmplan-row', key: 'head' },
      h(Button, { size: 'small', onClick: () => setCalendarMonth(shiftMonth(calendarMonth, -1)) }, '‹ 上个月'),
      h('span', { className: 'pmplan-section-title' }, grid.label),
      h(Button, { size: 'small', onClick: () => setCalendarMonth(shiftMonth(calendarMonth, 1)) }, '下个月 ›'),
      h(Button, { size: 'small', variant: 'ghost', onClick: () => setCalendarMonth(today.slice(0, 7)) }, '回到本月'),
      h('span', { className: 'pmplan-spacer' }),
      h('span', { className: 'pmplan-small pmplan-muted' }, '点条目打开详情')
    ),
    h('div', { className: 'pmplan-calendar', key: 'calendar' },
      h('div', { className: 'pmplan-calendar-grid' }, WEEKDAY_LABELS.map((label) => h('div', { className: 'pmplan-calendar-weekday', key: label }, label))),
      h('div', { className: 'pmplan-calendar-grid' },
        grid.weeks.flat().map((cell) => {
          const dayItems = items.get(cell.date) || []
          return h('div', {
            className: 'pmplan-day',
            key: cell.date,
            'data-outside': cell.inMonth ? 'false' : 'true',
            'data-today': cell.date === today ? 'true' : 'false'
          },
            h('div', { className: 'pmplan-day-head' },
              h('span', { className: 'pmplan-day-num' }, String(cell.day)),
              dayItems.length ? h('span', null, String(dayItems.length)) : null
            ),
            dayItems.slice(0, 4).map((item) => h('button', {
              key: `${item.kind}-${item.id}`,
              type: 'button',
              className: 'pmplan-day-item',
              'data-tone': toneOf(item.risk),
              title: `${item.title}｜${item.sourceName}｜${item.risk}`,
              onClick: () => openItem(item, { onOpenProject, onOpenOrder, onOpenPlan })
            }, item.title)),
            dayItems.length > 4 ? h('span', { className: 'pmplan-small pmplan-muted' }, `+${dayItems.length - 4}`) : null
          )
        })
      )
    )
  ]
}

/* ---------------- 风险 ---------------- */

function RisksScreen(props) {
  const { scoped, today, onOpenProject, onOpenOrder, onOpenPlan } = props
  const items = riskItems(scoped.projects, scoped.orders, scoped.plans, today)
  const buckets = [
    { label: '已逾期', rows: items.filter((item) => item.risk === '已逾期') },
    { label: '阻塞 / 紧急', rows: items.filter((item) => item.risk === '阻塞' || item.risk === '紧急') },
    { label: '进度风险', rows: items.filter((item) => item.risk === '进度风险') },
    { label: '临近到期', rows: items.filter((item) => item.risk === '临近') },
    { label: '未排期', rows: items.filter((item) => item.risk === '未排期') }
  ]
  const handlers = { onOpenProject, onOpenOrder, onOpenPlan }

  return [
    h('div', { className: 'pmplan-headline', key: 'summary' }, headline(scoped.projects, scoped.orders, scoped.plans, today)),
    ...buckets.map((bucket) => h(Card, {
      key: bucket.label,
      title: `${bucket.label}（${bucket.rows.length}）`
    },
      bucket.rows.length
        ? h('div', { className: 'pmplan-col' }, bucket.rows.map((item) => h(ItemButton, {
            key: `${item.kind}-${item.id}`,
            title: item.title,
            tone: item.risk,
            meta: `${item.kind === 'project' ? '项目' : item.kind === 'order' ? '工单' : '计划'} · ${item.sourceName} · ${formatDate(item.dueDate, '未排期')} · ${item.owner || '未指派'}`,
            onClick: () => openItem(item, handlers)
          })))
        : h('div', { className: 'pmplan-small pmplan-muted' }, '无')
    ))
  ]
}

/* ---------------- 汇报 ---------------- */

function ReportsScreen(props) {
  const { reportKind, setReportKind, reportProjectId, setReportProjectId, reportText, setReportText, generateReport, copyReport, downloadReport, projects } = props
  const projectOptions = projects.map((project) => ({ value: project.id, label: project.name }))
  return [
    h('div', { className: 'pmplan-row', key: 'head' },
      h(Select, {
        value: reportKind,
        onChange: (value) => { setReportKind(value); setReportText('') },
        options: REPORT_KINDS.map((kind) => ({ value: kind.id, label: kind.label }))
      }),
      reportKind === 'project'
        ? h(Select, {
            value: reportProjectId || projects[0]?.id || '',
            onChange: setReportProjectId,
            options: projectOptions,
            allowEmpty: true,
            emptyLabel: '选一个项目'
          })
        : null,
      h(Button, { variant: 'primary', onClick: generateReport }, '生成'),
      h(Button, { onClick: copyReport }, '复制'),
      h(Button, { onClick: downloadReport }, '下载 .md'),
      h('span', { className: 'pmplan-spacer' }),
      h('span', { className: 'pmplan-small pmplan-muted' }, '文档在本地生成，不会自动外发')
    ),
    h(Card, { key: 'draft', title: '草稿' },
      h(TextArea, {
        value: reportText,
        onChange: setReportText,
        rows: 22,
        placeholder: '点「生成」按当前数据产出草稿，可以在这里直接改。'
      })
    )
  ]
}


/* ---------------- 需求文档 ---------------- */

const KIND_LABEL = {
  markdown: 'Markdown',
  text: '文本',
  word: 'Word',
  excel: 'Excel',
  pdf: 'PDF',
  image: '图片',
  slide: 'PPT',
  archive: '压缩包',
  other: '其他'
}

function formatBytes(size) {
  const value = Number(size) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

function shortTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function DocsScreen(props) {
  const {
    docs, docsRoot, docsRootDraft, docsLoading, docsError, docsUploading,
    projects, orders, onReloadDocs, onSetDocsRootDraft, onConfirmDocsRoot, onPickDocsRoot,
    onUploadDocs, onOpenDoc, onEditDoc, onEditDocMeta, onDeleteDoc, onOpenProject, onNewDoc
  } = props
  const [kindFilter, setKindFilter] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [keyword, setKeyword] = useState('')

  const projectName = new Map(projects.map((project) => [project.id, project.name]))
  const rows = docs.filter((doc) => {
    if (kindFilter && doc.kind !== kindFilter) return false
    if (projectFilter && doc.projectId !== projectFilter) return false
    if (keyword) {
      const haystack = [doc.name, doc.path, doc.title, doc.note, ...(doc.tags || [])].join(' ').toLowerCase()
      if (!haystack.includes(keyword.toLowerCase())) return false
    }
    return true
  })
  const kinds = [...new Set(docs.map((doc) => doc.kind))]

  const rootBar = h('div', { className: 'pmplan-card' },
    h('div', { className: 'pmplan-card-head' },
      h('span', { className: 'pmplan-card-title' }, '文档库位置'),
      h('span', { className: 'pmplan-spacer' }),
      h(Badge, { tone: docsRoot && docsRoot.exists ? 'ok' : 'warn', children: docsRoot && docsRoot.exists ? '就绪' : '未建立' })
    ),
    h('div', { className: 'pmplan-row' },
      h('input', {
        className: 'pmplan-input',
        value: docsRootDraft,
        placeholder: '例如 ~/Documents/项目计划工作台文档',
        'aria-label': '文档库目录',
        onChange: (event) => onSetDocsRootDraft(event.target.value)
      }),
      h(Button, { variant: 'primary', onClick: onConfirmDocsRoot }, docsRoot && docsRoot.exists ? '切换到这个目录' : '建立文档库'),
      h('label', { className: 'pmplan-btn' },
        '选文件夹',
        h('input', {
          type: 'file',
          // 只用来取目录，不会上传所选内容；带 webkitdirectory 时浏览器会把选择范围限制为「目录内的文件」
          webkitdirectory: '',
          directory: '',
          multiple: true,
          style: { display: 'none' },
          onChange: (event) => {
            const file = event.target.files && event.target.files[0]
            if (file) onPickDocsRoot(file)
            event.target.value = ''
          }
        })
      )
    ),
    h('div', { className: 'pmplan-small pmplan-muted' },
      docsRoot
        ? `当前：${docsRoot.root}（索引文件 ${docsRoot.indexFile || 'index.json'}）`
        : '还没有指定文档库目录。点「建立文档库」会在上面这个路径下创建目录并写入 index.json。'
    ),
    h('div', { className: 'pmplan-small pmplan-muted' },
      '只有你点按钮确认时工作台才会创建目录；文档本体一直在本机，不会上传到任何地方。'
    )
  )

  const toolbar = h('div', { className: 'pmplan-row' },
    h('span', { className: 'pmplan-section-title' }, `文档 ${rows.length} / ${docs.length}`),
    docs.length && docs.some((doc) => doc.missing)
      ? h(Badge, { tone: 'danger', children: `${docs.filter((doc) => doc.missing).length} 个找不到` })
      : null,
    h('span', { className: 'pmplan-spacer' }),
    h('input', {
      className: 'pmplan-input pmplan-search',
      type: 'search',
      placeholder: '按文件名 / 标签 / 备注搜索',
      value: keyword,
      'aria-label': '搜索文档',
      onChange: (event) => setKeyword(event.target.value)
    }),
    h(Select, {
      value: kindFilter,
      onChange: setKindFilter,
      options: kinds.map((kind) => ({ value: kind, label: KIND_LABEL[kind] || kind })),
      allowEmpty: true,
      emptyLabel: '全部类型'
    }),
    h(Select, {
      value: projectFilter,
      onChange: setProjectFilter,
      options: projects.map((project) => ({ value: project.id, label: project.name })),
      allowEmpty: true,
      emptyLabel: '全部项目'
    }),
    h(Button, { onClick: onReloadDocs }, '刷新'),
    h(Button, { variant: 'primary', onClick: onNewDoc }, '新建 Markdown'),
    h('label', { className: 'pmplan-btn', 'data-variant': 'primary' },
      docsUploading ? '上传中…' : '导入文档',
      h('input', {
        type: 'file',
        multiple: true,
        style: { display: 'none' },
        onChange: (event) => {
          const files = [...(event.target.files || [])]
          if (files.length) onUploadDocs(files)
          event.target.value = ''
        }
      })
    )
  )

  const table = docs.length === 0
    ? h(Empty, {
        text: docsRoot && docsRoot.exists
          ? '文档库还是空的，可以「导入文档」或「新建 Markdown」。'
          : '先在上方建立或指定文档库目录。',
        action: h(Button, { variant: 'primary', onClick: onNewDoc, disabled: !(docsRoot && docsRoot.exists) }, '新建 Markdown')
      })
    : h('div', { className: 'pmplan-table-wrap' },
        h('table', { className: 'pmplan-table' },
          h('thead', null, h('tr', null,
            h('th', null, '文档'),
            h('th', null, '类型'),
            h('th', null, '所属项目'),
            h('th', null, '版本'),
            h('th', null, '标签'),
            h('th', null, '大小'),
            h('th', null, '更新于'),
            h('th', { className: 'pmplan-cell-actions' }, '操作')
          )),
          h('tbody', null, rows.map((doc) => h('tr', { key: doc.path },
            h('td', null,
              h('div', { className: 'pmplan-title-cell' }, doc.name),
              h('div', { className: 'pmplan-small pmplan-muted' }, doc.folder || '（根目录）'),
              doc.title && doc.title !== doc.name ? h('div', { className: 'pmplan-small pmplan-soft' }, doc.title) : null
            ),
            h('td', null,
              h(Badge, { tone: doc.editable ? 'info' : 'muted', children: KIND_LABEL[doc.kind] || doc.kind }),
              doc.missing ? h(Badge, { tone: 'danger', children: '找不到' }) : null
            ),
            h('td', { className: 'pmplan-muted' },
              doc.projectId
                ? h('button', {
                    type: 'button',
                    className: 'pmplan-btn',
                    'data-variant': 'ghost',
                    style: { padding: 0 },
                    onClick: () => onOpenProject(doc.projectId)
                  }, projectName.get(doc.projectId) || '已删除的项目')
                : h(Button, { size: 'small', variant: 'ghost', onClick: () => onEditDocMeta(doc) }, '挂到项目')
            ),
            h('td', { className: 'pmplan-muted' }, doc.version || '—'),
            h('td', { className: 'pmplan-muted' }, doc.tags && doc.tags.length ? doc.tags.join('、') : '—'),
            h('td', { className: 'pmplan-nums pmplan-muted' }, formatBytes(doc.size)),
            h('td', { className: 'pmplan-nums pmplan-muted' }, shortTime(doc.updatedAt || doc.addedAt)),
            h('td', { className: 'pmplan-cell-actions' },
              h(Button, { size: 'small', onClick: () => onOpenDoc(doc) }, doc.editable ? '打开' : '用系统程序打开'),
              doc.editable ? h(Button, { size: 'small', onClick: () => onEditDoc(doc) }, '编辑') : null,
              h(Button, { size: 'small', onClick: () => onEditDocMeta(doc) }, '属性'),
              h(Button, { size: 'small', variant: 'danger', onClick: () => onDeleteDoc(doc) }, '移除')
            )
          )))
        )
      )

  return [
    h('div', { key: 'root' }, rootBar),
    h('div', { key: 'toolbar' }, toolbar),
    docsError ? h(Banner, { key: 'err', tone: 'danger', children: docsError }) : null,
    docsLoading ? h('div', { key: 'loading', className: 'pmplan-muted pmplan-small' }, '正在读取文档库…') : h('div', { key: 'table' }, table)
  ]
}



module.exports = { OverviewScreen, ProjectsScreen, OrdersScreen, PlansScreen, CalendarScreen, RisksScreen, ReportsScreen, toneOf, DocsScreen, KIND_LABEL, formatBytes, shortTime }
  }
  __factories["client/charts.js"] = function (exports, module, __require) {
const { riskTone } = __require("shared/metrics.js")
const { daysBetween, formatShortDate } = __require("shared/date.js")
/**
 * 手写 SVG/CSS 图表：环形分布、条形排行、甘特时间线。
 * 不引入图表库，避免给客户端打包体积和宿主基线添麻烦。
 */

const h = require('react').createElement

const TONE_COLOR = {
  danger: 'var(--pm-danger)',
  warn: 'var(--pm-warn)',
  info: 'var(--pm-info)',
  ok: 'var(--pm-ok)',
  muted: 'var(--pm-border-strong)'
}

function Donut({ slices, size = 132, thickness = 16, centerLabel, centerHint }) {
  const total = slices.reduce((sum, item) => sum + item.count, 0)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0
  const circles = []
  if (total > 0) {
    for (const slice of slices) {
      if (!slice.count) continue
      const length = (slice.count / total) * circumference
      circles.push(h('circle', {
        key: slice.level,
        cx: size / 2,
        cy: size / 2,
        r: radius,
        fill: 'none',
        stroke: TONE_COLOR[riskTone(slice.level)] || TONE_COLOR.muted,
        strokeWidth: thickness,
        strokeDasharray: `${length} ${circumference - length}`,
        strokeDashoffset: -offset,
        transform: `rotate(-90 ${size / 2} ${size / 2})`
      }))
      offset += length
    }
  }
  return h('div', { className: 'pmplan-donut-wrap' },
    h('svg', { width: size, height: size, role: 'img', 'aria-label': centerLabel || '风险分布' },
      h('circle', {
        cx: size / 2, cy: size / 2, r: radius, fill: 'none',
        stroke: 'var(--pm-bg-sunken)', strokeWidth: thickness
      }),
      ...circles,
      h('text', { x: '50%', y: '46%', textAnchor: 'middle', fontSize: 22, fontWeight: 700, fill: 'var(--pm-fg)' }, String(total)),
      h('text', { x: '50%', y: '62%', textAnchor: 'middle', fontSize: 11, fill: 'var(--pm-fg-muted)' }, centerHint || '个项目')
    ),
    h('div', { className: 'pmplan-legend' },
      slices.map((slice) => h('div', { className: 'pmplan-legend-row', key: slice.level },
        h('span', { className: 'pmplan-dot', 'data-tone': riskTone(slice.level) }),
        h('span', { className: 'pmplan-nowrap' }, slice.level),
        h('span', { className: 'pmplan-spacer' }),
        h('span', { className: 'pmplan-nums pmplan-muted' }, String(slice.count))
      ))
    )
  )
}

function BarList({ rows, emptyText = '暂无数据' }) {
  if (!rows.length) return h('div', { className: 'pmplan-muted pmplan-small' }, emptyText)
  const max = rows.reduce((value, row) => Math.max(value, row.value || 0), 0) || 1
  return h('div', { className: 'pmplan-bars' },
    rows.map((row) => h('div', { className: 'pmplan-bar-row', key: row.key || row.label },
      h('span', { className: 'pmplan-small pmplan-soft pmplan-nowrap', title: row.label }, row.label),
      h('span', { className: 'pmplan-bar-track' },
        h('span', {
          className: 'pmplan-bar-fill',
          'data-tone': row.tone || 'info',
          style: { width: `${Math.round(((row.value || 0) / max) * 100)}%` }
        })
      ),
      h('span', { className: 'pmplan-small pmplan-nums pmplan-muted pmplan-nowrap' }, row.text || String(row.value || 0))
    ))
  )
}

/** 堆叠条：每行一个分组，段宽按 `segments[].value` 占比。 */
function StackedBars({ rows, emptyText = '暂无数据' }) {
  if (!rows.length) return h('div', { className: 'pmplan-muted pmplan-small' }, emptyText)
  const max = rows.reduce((value, row) => Math.max(value, row.total || 0), 0) || 1
  return h('div', { className: 'pmplan-bars' },
    rows.map((row) => h('div', { className: 'pmplan-bar-row', key: row.key || row.label },
      h('span', { className: 'pmplan-small pmplan-soft pmplan-nowrap', title: row.label }, row.label),
      h('span', { className: 'pmplan-bar-track', style: { display: 'flex' } },
        (row.segments || []).filter((segment) => segment.value > 0).map((segment) => h('span', {
          key: segment.label,
          title: `${segment.label} ${segment.value}`,
          style: {
            width: `${Math.round((segment.value / max) * 100)}%`,
            background: `var(--pm-${segment.tone || 'info'})`,
            height: '100%'
          }
        }))
      ),
      h('span', { className: 'pmplan-small pmplan-nums pmplan-muted pmplan-nowrap' }, row.text || String(row.total || 0))
    ))
  )
}

function positionOf(date, from, to) {
  const total = daysBetween(from, to)
  if (!total || total <= 0) return 0
  const offset = daysBetween(from, date)
  if (offset === null) return 0
  return Math.max(0, Math.min(100, (offset / total) * 100))
}

function Timeline({ model, onOpen }) {
  const { rows, from, to, today } = model
  if (!rows.length) return h('div', { className: 'pmplan-muted pmplan-small' }, '没有已排期的项目。')
  const todayLeft = positionOf(today, from, to)
  return h('div', { className: 'pmplan-timeline' },
    h('div', { className: 'pmplan-timeline-scale' },
      h('span', null, '项目 / 条目'),
      h('span', { className: 'pmplan-timeline-ticks' },
        h('span', null, formatShortDate(from, from)),
        h('span', null, formatShortDate(today, '今天')),
        h('span', null, formatShortDate(to, to))
      )
    ),
    rows.map((row) => {
      const left = positionOf(row.startedOn, from, to)
      const right = positionOf(row.dueDate, from, to)
      const width = Math.max(1.2, right - left)
      return h('div', { className: 'pmplan-timeline-row', key: row.kind + row.id },
        h('span', { className: 'pmplan-timeline-label', title: `${row.title}（${row.sourceName}）` },
          h('span', { className: 'pmplan-soft' }, row.sourceName === row.title ? '' : `${row.sourceName} · `),
          row.title
        ),
        h('span', { className: 'pmplan-timeline-track' },
          h('span', { className: 'pmplan-timeline-today', style: { left: `${todayLeft}%` } }),
          h('button', {
            type: 'button',
            className: 'pmplan-timeline-bar',
            'data-tone': riskTone(row.risk),
            style: { left: `${left}%`, width: `${width}%` },
            title: `${row.title}｜${formatShortDate(row.startedOn)} ~ ${formatShortDate(row.dueDate)}｜${row.risk}`,
            // 工单挂模块、没有 projectId：这类横条不打开项目详情。
            onClick: row.projectId ? () => onOpen?.(row.projectId) : undefined
          })
        )
      )
    }),
    h('div', { className: 'pmplan-row pmplan-small pmplan-muted' },
      h('span', null, `区间 ${from} ~ ${to}`),
      h('span', { className: 'pmplan-spacer' }),
      h('span', null, '点击横条打开项目详情（工单按模块归类，无项目详情）')
    )
  )
}


module.exports = { Donut, BarList, StackedBars, Timeline }
  }
  __factories["shared/metrics.js"] = function (exports, module, __require) {
const { DEFAULT_PLATFORMS, DONE_PLAN_STATUS, DONE_STAGES, PRIORITIES, PROJECT_STATUS, ORDER_STAGES, PLAN_STATUS } = __require("shared/model.js")
const { addDays, daysBetween, endOfWeek, todayISO } = __require("shared/date.js")
/**
 * 风险与统计：全部是纯函数。
 *
 * 风险等级从高到低，`RISK_ORDER` 用于排序与配色：
 * 已逾期 > 阻塞 > 紧急（距截止 ≤ 2 天）> 进度风险（时间过半而进度落后 ≥ 30%）> 临近（≤ 5 天）> 未排期 > 正常 > 已完成/已取消
 */

const RISK_LEVELS = ['已逾期', '阻塞', '紧急', '进度风险', '临近', '未排期', '正常', '已完成']

const RISK_ORDER = RISK_LEVELS.reduce((accumulator, level, index) => {
  accumulator[level] = index
  return accumulator
}, {})

const RISK_TONE = {
  已逾期: 'danger',
  阻塞: 'danger',
  紧急: 'warn',
  进度风险: 'warn',
  临近: 'info',
  未排期: 'muted',
  正常: 'ok',
  已完成: 'ok'
}

const PRIORITY_TONE = { 紧急: 'danger', 高: 'warn', 中: 'info', 低: 'muted' }

const STAGE_TONE = {
  待评审: 'muted',
  待排期: 'muted',
  开发中: 'info',
  联调中: 'info',
  测试中: 'warn',
  待上线: 'warn',
  已上线: 'ok',
  已取消: 'muted'
}

function riskRank(level) {
  return RISK_ORDER[level] ?? RISK_LEVELS.length
}

function isDone(stage) {
  return DONE_STAGES.includes(stage)
}

function isOrderDone(order) {
  return isDone(order.stage)
}

function isPlanDone(plan) {
  return DONE_PLAN_STATUS.includes(plan.status)
}

function isProjectDone(project) {
  return project.status === '已完成'
}

/** 时间消耗比例：0–100，未排期返回 null。 */
function timeRatio(startedOn, dueDate, today = todayISO()) {
  const total = daysBetween(startedOn, dueDate)
  if (total === null || total <= 0) return null
  const elapsed = daysBetween(startedOn, today)
  if (elapsed === null) return null
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)))
}

function dateRiskLevel(dueDate, today = todayISO()) {
  if (!dueDate) return '未排期'
  const left = daysBetween(today, dueDate)
  if (left === null) return '未排期'
  if (left < 0) return '已逾期'
  if (left <= 2) return '紧急'
  if (left <= 5) return '临近'
  return '正常'
}

/** 工单风险：完成态直接给「已完成」，否则取时间风险、优先级、进度落后中最高的一档。 */
function orderRisk(order, today = todayISO()) {
  if (order.stage === '已取消') return '已完成'
  if (order.stage === '已上线') return '已完成'
  const byDate = dateRiskLevel(order.dueDate, today)
  if (byDate === '已逾期') return '已逾期'
  const stages = ['待评审', '待排期']
  if (stages.includes(order.stage) && order.target) {
    const targetLeft = daysBetween(today, order.target)
    if (targetLeft !== null && targetLeft <= 2) return '紧急'
  }
  if (byDate === '紧急') return '紧急'
  if (order.priority === '紧急' && (order.stage === '待评审' || order.stage === '待排期')) return '紧急'
  const ratio = timeRatio(order.createdAt?.slice(0, 10) || '', order.dueDate, today)
  if (ratio !== null && ratio - stageProgress(order.stage) >= 30 && order.dueDate && byDate !== '正常') return '进度风险'
  if (byDate === '临近') return '临近'
  if (order.dueDate) return '正常'
  return '未排期'
}

/** 阶段折算的完成比例，仅用于进度落后判定。 */
function stageProgress(stage) {
  const index = ['待评审', '待排期', '开发中', '联调中', '测试中', '待上线', '已上线'].indexOf(stage)
  if (index < 0) return 100
  return [0, 10, 40, 60, 75, 90, 100][index]
}

/** 计划风险。 */
function planRisk(plan, today = todayISO()) {
  if (plan.status === '已取消') return '已完成'
  if (plan.status === '已完成') return '已完成'
  if (plan.status === '未开始' && plan.startedOn) {
    const left = daysBetween(today, plan.startedOn)
    if (left === null || left > 0) {
      const dueRisk = dateRiskLevel(plan.dueDate, today)
      return dueRisk === '已逾期' ? '已逾期' : dueRisk
    }
  }
  const byDate = dateRiskLevel(plan.dueDate, today)
  if (byDate === '已逾期') return '已逾期'
  if (byDate === '紧急') return '紧急'
  if (byDate === '临近') return '临近'
  if (!plan.dueDate) return plan.status === '进行中' ? '未排期' : '未排期'
  return '正常'
}

/**
 * 项目风险：只看项目自身（状态 + 截止 + 进度滞后）。
 *
 * 工单与计划都已改挂模块、不再归属项目，所以它们都不再参与项目风险的汇总。
 */
function projectRisk(project, today = todayISO()) {
  if (isProjectDone(project)) return '已完成'
  if (project.status === '阻塞') return '阻塞'
  const levels = []
  const byDate = dateRiskLevel(project.dueDate, today)
  levels.push(byDate)
  if (project.status !== '待启动' && project.status !== '暂停' && project.dueDate) {
    const ratio = timeRatio(project.startedOn, project.dueDate, today)
    if (ratio !== null && ratio - project.progress >= 30) levels.push('进度风险')
  }
  let worst = '正常'
  for (const level of levels) {
    if (riskRank(level) < riskRank(worst)) worst = level
  }
  if (worst === '正常' && !project.dueDate && !project.startedOn) return '未排期'
  return worst
}

function riskTone(level) {
  return RISK_TONE[level] || 'muted'
}

/** 把一组带「需关注」判定的项目拆开：需关注 = 风险低于「正常」。 */
function needsAttention(level) {
  return ['已逾期', '阻塞', '紧急', '进度风险'].includes(level)
}

/**
 * 给项目补上风险与剩余天数。
 *
 * 工单与计划都已改挂模块、不再归属项目，所以这里不再有「工单/计划 X/Y 未结束」这类汇总。
 */
function decorateProjects(projects, today = todayISO()) {
  return projects.map((project) => {
    const risk = projectRisk(project, today)
    return {
      ...project,
      risk,
      attention: needsAttention(risk),
      daysLeft: project.dueDate ? daysBetween(today, project.dueDate) : null
    }
  })
}

function kpis(projects, orders, plans, today = todayISO()) {
  const decorated = decorateProjects(projects, today)
  const active = decorated.filter((project) => !isProjectDone(project))
  const openOrders = orders.filter((order) => !isOrderDone(order))
  const openPlans = plans.filter((plan) => !isPlanDone(plan))
  const weekEnd = endOfWeek(today)
  const inWeek = (date) => Boolean(date) && date >= today && date <= weekEnd
  const avg = active.length ? Math.round(active.reduce((sum, project) => sum + project.progress, 0) / active.length) : 0
  return {
    projects: projects.length,
    active: active.length,
    attention: decorated.filter((project) => project.attention).length,
    overdue: decorated.filter((project) => project.risk === '已逾期').length,
    blocked: decorated.filter((project) => project.risk === '阻塞').length,
    avgProgress: avg,
    orderOpen: openOrders.length,
    orderOverdue: openOrders.filter((order) => orderRisk(order, today) === '已逾期').length,
    orderWeek: openOrders.filter((order) => inWeek(order.dueDate)).length,
    planOpen: openPlans.length,
    planOverdue: openPlans.filter((plan) => planRisk(plan, today) === '已逾期').length,
    planWeek: openPlans.filter((plan) => inWeek(plan.dueDate)).length,
    unscheduled: [...active.filter((project) => !project.dueDate).map(() => 1), ...openOrders.filter((order) => !order.dueDate).map(() => 1), ...openPlans.filter((plan) => !plan.dueDate).map(() => 1)].length
  }
}

function riskBreakdown(projects, orders, plans, today = todayISO()) {
  const counts = new Map(RISK_LEVELS.map((level) => [level, 0]))
  for (const project of decorateProjects(projects, today)) {
    counts.set(project.risk, (counts.get(project.risk) || 0) + 1)
  }
  return RISK_LEVELS.map((level) => ({ level, count: counts.get(level) || 0, tone: riskTone(level) }))
}

/**
 * 平台负载：项目按它登记的「端」归口，工单按它的「目标端」归口——两者取的是同一份
 * 端配置，所以能放进同一组桶里。端列表来自配置项 + 数据里出现过的历史取值。
 */
function platformLoad(projects, orders, today = todayISO(), platforms = DEFAULT_PLATFORMS) {
  const names = [...platforms]
  const remember = (value) => {
    const name = String(value == null ? '' : value).trim()
    if (name && !names.includes(name)) names.push(name)
  }
  for (const project of projects) remember(project.platform)
  for (const order of orders) remember(order.target)
  const rows = names.map((platform) => {
    const items = projects.filter((project) => project.platform === platform)
    const related = orders.filter((order) => order.target === platform && !isOrderDone(order))
    return {
      platform,
      projects: items.length,
      open: related.length,
      overdue: related.filter((order) => orderRisk(order, today) === '已逾期').length,
      avgProgress: items.length ? Math.round(items.reduce((sum, project) => sum + project.progress, 0) / items.length) : 0
    }
  })
  return rows.filter((row) => row.projects > 0 || row.open > 0)
}

function ownerWorkload(projects, orders, plans, today = todayISO()) {
  const owners = new Map()
  const touch = (owner) => {
    const key = owner || '未指派'
    if (!owners.has(key)) owners.set(key, { owner: key, projects: 0, orders: 0, plans: 0, overdue: 0, total: 0 })
    return owners.get(key)
  }
  for (const project of projects) {
    if (isProjectDone(project)) continue
    const row = touch(project.owner)
    row.projects += 1
    row.total += 1
  }
  for (const order of orders) {
    if (isOrderDone(order)) continue
    const row = touch(order.owner)
    row.orders += 1
    row.total += 1
    if (orderRisk(order, today) === '已逾期') row.overdue += 1
  }
  for (const plan of plans) {
    if (isPlanDone(plan)) continue
    const row = touch(plan.owner)
    row.plans += 1
    row.total += 1
    if (planRisk(plan, today) === '已逾期') row.overdue += 1
  }
  return [...owners.values()].sort((left, right) => right.total - left.total || left.owner.localeCompare(right.owner, 'zh-Hans-CN'))
}

/** 按状态分列的项目看板。 */
function statusColumns(projects, today = todayISO()) {
  const decorated = decorateProjects(projects, today)
  return PROJECT_STATUS.map((status) => {
    const items = decorated
      .filter((project) => project.status === status)
      .sort((left, right) => riskRank(left.risk) - riskRank(right.risk) || (left.dueDate || '9999') .localeCompare(right.dueDate || '9999'))
    return { status, items, count: items.length }
  })
}

/** 工单看板：按阶段分列。`moduleName` 是工单自己的归属模块，不再有项目名。 */
function orderBoardColumns(orders, today = todayISO()) {
  return ORDER_STAGES.map((stage) => {
    const items = orders
      .filter((order) => order.stage === stage)
      .map((order) => ({ ...order, risk: orderRisk(order, today), moduleName: order.module || '未归模块' }))
      .sort((left, right) => riskRank(left.risk) - riskRank(right.risk) || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
    return { stage, items, count: items.length }
  })
}

/** 全部需要盯的条目，统一成一条，便于「风险中心」与「今天做什么」。 */
/**
 * 全部需要盯的条目，统一成一条，便于「风险中心」与「今天做什么」。
 *
 * 每条带一个 `sourceName` 表示**归属**：项目归项目，工单与计划归模块。
 * `projectId` 只在真的挂了项目时才给（工单与计划都没有）。
 */
function riskItems(projects, orders, plans, today = todayISO()) {
  const items = []
  for (const project of decorateProjects(projects, today)) {
    if (!project.attention) continue
    items.push({
      kind: 'project',
      id: project.id,
      title: project.name,
      subtitle: `${project.platform} · ${project.status} · 进度 ${project.progress}%`,
      owner: project.owner,
      dueDate: project.dueDate,
      risk: project.risk,
      tone: riskTone(project.risk),
      projectId: project.id,
      sourceName: project.name
    })
  }
  for (const order of orders) {
    const risk = orderRisk(order, today)
    if (!needsAttention(risk) && risk !== '临近') continue
    items.push({
      kind: 'order',
      id: order.id,
      title: order.title,
      subtitle: `${order.kind} · ${order.stage} · ${order.priority}优先级`,
      owner: order.owner,
      dueDate: order.dueDate,
      risk,
      tone: riskTone(risk),
      projectId: '',
      sourceName: order.module || '未归模块'
    })
  }
  for (const plan of plans) {
    const risk = planRisk(plan, today)
    if (!needsAttention(risk) && risk !== '临近') continue
    items.push({
      kind: 'plan',
      id: plan.id,
      title: plan.title,
      subtitle: `${plan.status} · 计划`,
      owner: plan.owner,
      dueDate: plan.dueDate,
      risk,
      tone: riskTone(risk),
      projectId: '',
      sourceName: plan.module || '未归模块'
    })
  }
  return items.sort((left, right) => riskRank(left.risk) - riskRank(right.risk) || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
}

/**
 * 甘特：项目一行、工单一行、计划一行——工单与计划都改挂模块，不再挂在项目下面。
 * `sourceName` 是归属名（工单/计划→模块，项目→项目名），`projectId` 只在有项目时给。
 */
function timelineModel(projects, orders, plans, today = todayISO()) {
  const useOrders = orders
    .map((order) => ({
      kind: 'order',
      id: order.id,
      title: order.title,
      projectId: '',
      sourceName: order.module || '未归模块',
      startedOn: order.createdOn || (order.createdAt ? order.createdAt.slice(0, 10) : today),
      dueDate: order.dueDate || order.createdOn || (order.createdAt?.slice(0, 10) || ''),
      risk: orderRisk(order, today)
    }))
    .filter((item) => item.dueDate)
  const usePlans = plans
    .map((plan) => ({
      kind: 'plan',
      id: plan.id,
      title: plan.title,
      projectId: '',
      sourceName: plan.module || '未归模块',
      startedOn: plan.startedOn || (plan.createdAt ? plan.createdAt.slice(0, 10) : today),
      dueDate: plan.dueDate || plan.startedOn || '',
      risk: planRisk(plan, today)
    }))
    .filter((item) => item.dueDate)
  const rows = []
  for (const project of projects) {
    if (isProjectDone(project)) continue
    if (!project.startedOn && !project.dueDate) continue
    rows.push({
      kind: 'project',
      id: project.id,
      title: project.name,
      projectId: project.id,
      sourceName: project.name,
      startedOn: project.startedOn || project.dueDate,
      dueDate: project.dueDate || project.startedOn,
      risk: projectRisk(project, today)
    })
  }
  const all = [...rows, ...useOrders, ...usePlans]
  const dates = all.flatMap((item) => [item.startedOn, item.dueDate]).filter(Boolean)
  const min = dates.length ? dates.reduce((left, right) => (left < right ? left : right)) : today
  const max = dates.length ? dates.reduce((left, right) => (left > right ? left : right)) : today
  return { rows, from: addDays(min, -2), to: addDays(max, 2), today }
}

/** 「今天该做什么」：逾期的 + 今天到期的 + 本周内优先级高的。 */
function todayBuckets(projects, orders, plans, today = todayISO()) {
  const items = riskItems(projects, orders, plans, today)
  const weekEnd = endOfWeek(today)
  const overdue = items.filter((item) => item.risk === '已逾期')
  const dueToday = items.filter((item) => item.dueDate === today)
  const thisWeek = items.filter((item) => item.dueDate && item.dueDate > today && item.dueDate <= weekEnd)
  const later = items.filter((item) => !item.dueDate || item.dueDate > weekEnd)
  return { overdue, dueToday, thisWeek, later }
}

function priorityRank(priority) {
  const index = PRIORITIES.indexOf(priority)
  return index < 0 ? PRIORITIES.length : index
}

function stageRank(stage) {
  const index = ORDER_STAGES.indexOf(stage)
  return index < 0 ? ORDER_STAGES.length : index
}

function planStatusRank(status) {
  const index = PLAN_STATUS.indexOf(status)
  return index < 0 ? PLAN_STATUS.length : index
}

function headline(projects, orders, plans, today = todayISO()) {
  const data = kpis(projects, orders, plans, today)
  if (data.projects === 0) return '还没有登记项目，先建一个项目，再把需求工单和计划挂上去。'
  if (data.overdue > 0) return `${data.projects} 个项目里 ${data.overdue} 个已逾期、${data.attention} 个需要盯；未结束工单 ${data.orderOpen} 条，其中逾期 ${data.orderOverdue} 条。`
  if (data.attention > 0) return `${data.projects} 个项目在跑，${data.attention} 个需要关注；本周到期工单 ${data.orderWeek} 条、计划 ${data.planWeek} 条。`
  return `${data.projects} 个项目节奏正常，平均进度 ${data.avgProgress}%；未结束工单 ${data.orderOpen} 条、计划 ${data.planOpen} 条。`
}


module.exports = { RISK_LEVELS, RISK_ORDER, RISK_TONE, PRIORITY_TONE, STAGE_TONE, riskRank, isDone, isOrderDone, isPlanDone, isProjectDone, timeRatio, dateRiskLevel, orderRisk, stageProgress, planRisk, projectRisk, riskTone, needsAttention, decorateProjects, kpis, riskBreakdown, platformLoad, ownerWorkload, statusColumns, orderBoardColumns, riskItems, timelineModel, todayBuckets, priorityRank, stageRank, planStatusRank, headline }
  }
  __factories["shared/model.js"] = function (exports, module, __require) {
/**
 * 业务数据模型：常量、ID 生成、结构收敛（normalize）。
 *
 * 数据落盘在 DSH 数据目录的 `pm-plan/state.json`，结构为：
 * {
 *   version, updatedAt, seededAt,
 *   config:   { modules: [名称], platforms: [名称] },   // 用户可在「设置」里增删改，缺字段时回落到 DEFAULT_*
 *   projects: [{ id, code, name, module, platform, status, owner, startedOn, dueDate, progress, link, summary, tags, createdAt, updatedAt }],
 *   orders:   [{ id, code, module, title, kind, priority, stage, owner, target, dueDate, createdOn, description, createdAt, updatedAt }],
 *   plans:    [{ id, module, title, owner, status, startedOn, dueDate, note, createdAt, updatedAt }],
 *   logs:     [{ id, refType, refId, at, kind, text }]
 * }
 *
 * 工单与计划都不再归属某个项目，而是直接挂「模块」（order.module / plan.module）。
 * 存量数据里的 `order.projectId` 与 `plan.projectId` 只在收敛时用来推导模块，
 * 收敛后不再保留这两个字段；计划也一并去掉了 `orderId` 与 `progress`。
 */

const STATE_VERSION = 1

const PROJECT_STATUS = ['进行中', '待启动', '阻塞', '暂停', '已完成']

/**
 * 模块轴的出厂默认值。模块与端都是**用户可配置项**：真实取值随状态一起落盘在
 * `config` 里，这两个常量只在首次生成状态、以及状态里缺字段时兜底。
 */
const DEFAULT_MODULES = ['公司项目', '移动端开发', '日常工作', '其他项目']

/** 端的出厂默认值。 */
const DEFAULT_PLATFORMS = ['移动手机', '移动 PAD', '小程序', 'PC Web', '其他']

/** 单个名称的长度上限、一个维度的条目数上限，防止状态文件被撑坏。 */
const MAX_DIMENSION_LENGTH = 40
const MAX_DIMENSION_ITEMS = 24

/** 项目编号 / 工单编号的长度上限。 */
const MAX_CODE_LENGTH = 40

const ORDER_KINDS = ['迭代需求', '变更需求', '缺陷', '技术任务']

const ORDER_STAGES = ['待评审', '待排期', '开发中', '联调中', '测试中', '待上线', '已上线', '已取消']

const PRIORITIES = ['紧急', '高', '中', '低']

const PLAN_STATUS = ['未开始', '进行中', '已完成', '已取消']

const LOG_KINDS = ['进展', '阻塞', '决策', '变更', '上线']

/** 阶段顺序用于看板列与「推进到下一阶段」按钮；已取消不参与推进。 */
const STAGE_FLOW = ['待评审', '待排期', '开发中', '联调中', '测试中', '待上线', '已上线']

const DONE_STAGES = ['已上线', '已取消']

const DONE_PLAN_STATUS = ['已完成', '已取消']

let idSeed = 0

/** 生成短 ID：前缀 + 时间戳 36 进制 + 进程内自增，够本地单人使用。 */
function createId(prefix = 'id') {
  idSeed += 1
  const stamp = Date.now().toString(36)
  const seq = idSeed.toString(36)
  const rand = Math.random().toString(36).slice(2, 6)
  return `${prefix}-${stamp}${seq}${rand}`
}

function emptyState(now = new Date().toISOString()) {
  return {
    version: STATE_VERSION,
    updatedAt: now,
    seededAt: '',
    config: { modules: [...DEFAULT_MODULES], platforms: [...DEFAULT_PLATFORMS] },
    projects: [],
    orders: [],
    plans: [],
    logs: []
  }
}

function asText(value, fallback = '') {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function asEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

/**
 * 收敛可配置维度（模块、端）：去空、去重、限长、限量；整列为空时回落到出厂默认。
 * 与 asEnum 的关键区别是它**不做白名单校验**——用户自定义的名称一律原样保留。
 * 非字符串项直接丢弃：配置里混进数字/对象多半是坏数据，不该被当成一个模块名。
 */
function asNameList(value, defaults) {
  const seen = new Set()
  const result = []
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item !== 'string') continue
    const text = item.trim().slice(0, MAX_DIMENSION_LENGTH)
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
    if (result.length >= MAX_DIMENSION_ITEMS) break
  }
  return result.length ? result : [...defaults]
}

function asDate(value) {
  const text = asText(value).trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

/** 取时间戳的**本地**日历日（YYYY-MM-DD），用于从旧数据的 createdAt 推导创建日期。 */
function asDay(value) {
  const text = asText(value)
  if (!text) return ''
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function asProgress(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(100, Math.max(0, Math.round(number)))
}

function asTags(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const result = []
  for (const item of value) {
    const text = asText(item).trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text.slice(0, 24))
    if (result.length >= 12) break
  }
  return result
}

function asStamp(value, fallback) {
  const text = asText(value)
  if (!text) return fallback
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

/**
 * 把外部（旧版本、手改过的 JSON、导入）数据收敛成当前结构。
 * 未知字段丢弃，缺失字段补默认值，非法枚举回落到默认值，绝不抛错。
 */
function normalizeState(raw, { now = new Date().toISOString() } = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const base = emptyState(now)
  const projects = []
  const orders = []
  const plans = []
  const logs = []

  // 可配置维度先于业务数据收敛：项目的模块/端缺省值要按它回落。
  const config = {
    modules: asNameList(source.config?.modules, DEFAULT_MODULES),
    platforms: asNameList(source.config?.platforms, DEFAULT_PLATFORMS)
  }

  const projectIds = new Set()
  /** id → 模块，供存量工单从 projectId 迁移出 module 用。 */
  const projectModules = new Map()
  for (const item of Array.isArray(source.projects) ? source.projects : []) {
    if (!item || typeof item !== 'object') continue
    const name = asText(item.name).trim().slice(0, 120)
    if (!name) continue
    const id = asText(item.id).trim() || createId('prj')
    if (projectIds.has(id)) continue
    projectIds.add(id)
    const moduleValue = asText(item.module).trim().slice(0, MAX_DIMENSION_LENGTH)
    const platformValue = asText(item.platform).trim().slice(0, MAX_DIMENSION_LENGTH)
    const module = moduleValue || config.modules[0]
    projectModules.set(id, module)
    projects.push({
      id,
      code: asText(item.code).trim().slice(0, MAX_CODE_LENGTH),
      name,
      module,
      platform: platformValue || config.platforms[0],
      status: asEnum(item.status, PROJECT_STATUS, '进行中'),
      owner: asText(item.owner).trim().slice(0, 40) || '我',
      startedOn: asDate(item.startedOn),
      dueDate: asDate(item.dueDate),
      progress: asProgress(item.progress, 0),
      link: asText(item.link).trim().slice(0, 500),
      summary: asText(item.summary).slice(0, 2000),
      tags: asTags(item.tags),
      createdAt: asStamp(item.createdAt, now),
      updatedAt: asStamp(item.updatedAt, now)
    })
  }

  const orderIds = new Set()
  for (const item of Array.isArray(source.orders) ? source.orders : []) {
    if (!item || typeof item !== 'object') continue
    const title = asText(item.title).trim().slice(0, 200)
    if (!title) continue
    const id = asText(item.id).trim() || createId('ord')
    if (orderIds.has(id)) continue
    orderIds.add(id)
    const projectId = asText(item.projectId).trim()
    const moduleValue = asText(item.module).trim().slice(0, MAX_DIMENSION_LENGTH)
    const createdAt = asStamp(item.createdAt, now)
    orders.push({
      id,
      code: asText(item.code).trim().slice(0, MAX_CODE_LENGTH),
      // 存量工单没有 module：按它原先所属项目的模块迁移；项目已不在时留空（界面显示「未归模块」）。
      module: moduleValue || projectModules.get(projectId) || '',
      title,
      kind: asEnum(item.kind, ORDER_KINDS, '迭代需求'),
      priority: asEnum(item.priority, PRIORITIES, '中'),
      stage: asEnum(item.stage, ORDER_STAGES, '待评审'),
      owner: asText(item.owner).trim().slice(0, 40),
      target: asText(item.target).trim().slice(0, MAX_DIMENSION_LENGTH),
      dueDate: asDate(item.dueDate),
      createdOn: asDate(item.createdOn) || asDay(createdAt),
      description: asText(item.description).slice(0, 2000),
      createdAt,
      updatedAt: asStamp(item.updatedAt, now)
    })
  }

  const planIds = new Set()
  for (const item of Array.isArray(source.plans) ? source.plans : []) {
    if (!item || typeof item !== 'object') continue
    const title = asText(item.title).trim().slice(0, 200)
    if (!title) continue
    const id = asText(item.id).trim() || createId('pln')
    if (planIds.has(id)) continue
    planIds.add(id)
    const projectId = asText(item.projectId).trim()
    const moduleValue = asText(item.module).trim().slice(0, MAX_DIMENSION_LENGTH)
    plans.push({
      id,
      // 存量计划没有 module：按它原先所属项目的模块迁移；项目已不在时留空（界面显示「未归模块」）。
      module: moduleValue || projectModules.get(projectId) || '',
      title,
      owner: asText(item.owner).trim().slice(0, 40) || '我',
      status: asEnum(item.status, PLAN_STATUS, '未开始'),
      startedOn: asDate(item.startedOn),
      dueDate: asDate(item.dueDate),
      note: asText(item.note).slice(0, 2000),
      createdAt: asStamp(item.createdAt, now),
      updatedAt: asStamp(item.updatedAt, now)
    })
  }

  for (const item of Array.isArray(source.logs) ? source.logs : []) {
    if (!item || typeof item !== 'object') continue
    const text = asText(item.text).trim().slice(0, 2000)
    if (!text) continue
    const refType = asEnum(item.refType, ['project', 'order', 'plan'], 'project')
    const refId = asText(item.refId).trim()
    if (!refId) continue
    const known = refType === 'project' ? projectIds : refType === 'order' ? orderIds : planIds
    if (!known.has(refId)) continue
    logs.push({
      id: asText(item.id).trim() || createId('log'),
      refType,
      refId,
      at: asStamp(item.at, now),
      kind: asEnum(item.kind, LOG_KINDS, '进展'),
      text
    })
    if (logs.length >= 2000) break
  }

  logs.sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0))

  return {
    version: STATE_VERSION,
    updatedAt: asStamp(source.updatedAt, now),
    seededAt: asStamp(source.seededAt, ''),
    config,
    projects,
    orders,
    plans,
    logs
  }
}

function byId(list, id) {
  return list.find((item) => item.id === id) || null
}

function nextStage(stage) {
  const index = STAGE_FLOW.indexOf(stage)
  if (index < 0 || index >= STAGE_FLOW.length - 1) return ''
  return STAGE_FLOW[index + 1]
}


module.exports = { STATE_VERSION, PROJECT_STATUS, DEFAULT_MODULES, DEFAULT_PLATFORMS, MAX_DIMENSION_LENGTH, MAX_DIMENSION_ITEMS, MAX_CODE_LENGTH, ORDER_KINDS, ORDER_STAGES, PRIORITIES, PLAN_STATUS, LOG_KINDS, STAGE_FLOW, DONE_STAGES, DONE_PLAN_STATUS, createId, emptyState, normalizeState, byId, nextStage }
  }
  __factories["shared/date.js"] = function (exports, module, __require) {
/**
 * 日期与时间：全部按本地日历日比较，纯函数，可在 Node 里直接测试。
 * 约定：日期一律用 `YYYY-MM-DD` 字符串，时间戳用 ISO 字符串。
 */

function pad(value) {
  return String(value).padStart(2, '0')
}

function toISODate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function todayISO(now = new Date()) {
  return toISODate(now)
}

/** 把 `YYYY-MM-DD` 解析成当天零点的本地 Date；非法输入返回 null。 */
function parseISODate(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

function isValidDate(value) {
  return parseISODate(value) !== null
}

function addDays(value, days) {
  const date = parseISODate(value)
  if (!date) return ''
  date.setDate(date.getDate() + Number(days || 0))
  return toISODate(date)
}

/** `to - from` 的整天数；任一非法则返回 null。 */
function daysBetween(from, to) {
  const a = parseISODate(from)
  const b = parseISODate(to)
  if (!a || !b) return null
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/** 相对今天的剩余天数：负数表示已逾期。 */
function daysLeft(dueDate, today = todayISO()) {
  return daysBetween(today, dueDate)
}

function startOfWeek(value) {
  const date = parseISODate(value)
  if (!date) return ''
  const weekday = (date.getDay() + 6) % 7 // 周一为一周起点
  date.setDate(date.getDate() - weekday)
  return toISODate(date)
}

function endOfWeek(value) {
  const start = startOfWeek(value)
  return start ? addDays(start, 6) : ''
}

function inSameWeek(left, right) {
  return Boolean(left) && startOfWeek(left) === startOfWeek(right)
}

function monthKey(value) {
  const date = parseISODate(value)
  if (!date) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function quarterKey(value) {
  const date = parseISODate(value)
  if (!date) return ''
  return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`
}

function shiftMonth(monthKeyValue, delta) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKeyValue || ''))
  const year = match ? Number(match[1]) : new Date().getFullYear()
  const month = match ? Number(match[2]) : new Date().getMonth() + 1
  const date = new Date(year, month - 1 + Number(delta || 0), 1)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

/** 一周的 7 天，从周一开始；返回 `YYYY-MM-DD` 数组。 */
function weekDays(value) {
  const start = startOfWeek(value)
  if (!start) return []
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}

/**
 * 月历网格：按周一起始补齐整周，覆盖目标月。
 * 返回 `{ month, label, weeks }`，weeks 是二维数组，元素带 `{ date, day, inMonth }`。
 */
function monthGrid(monthKeyValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKeyValue || ''))
  const fallback = monthKey(todayISO())
  const key = match ? `${match[1]}-${match[2]}` : fallback
  const year = Number(key.slice(0, 4))
  const month = Number(key.slice(5, 7))
  const first = new Date(year, month - 1, 1)
  const last = new Date(year, month, 0)
  const start = new Date(first)
  start.setDate(start.getDate() - ((first.getDay() + 6) % 7))
  const weeks = []
  const cursor = new Date(start)
  while (cursor <= last || weeks.length < 5) {
    const week = []
    for (let index = 0; index < 7; index += 1) {
      const date = toISODate(cursor)
      week.push({ date, day: cursor.getDate(), inMonth: cursor.getMonth() === month - 1 })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
    if (weeks.length >= 6) break
  }
  return { month: key, label: `${year} 年 ${month} 月`, weeks }
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function formatDate(value, fallback = '未排期') {
  const date = parseISODate(value)
  if (!date) return fallback
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatShortDate(value, fallback = '—') {
  const date = parseISODate(value)
  if (!date) return fallback
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatDateTime(value, fallback = '') {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDayLabel(value) {
  const date = parseISODate(value)
  if (!date) return '未排期'
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}


module.exports = { pad, toISODate, todayISO, parseISODate, isValidDate, addDays, daysBetween, daysLeft, startOfWeek, endOfWeek, inSameWeek, monthKey, quarterKey, shiftMonth, weekDays, monthGrid, WEEKDAY_LABELS, formatDate, formatShortDate, formatDateTime, formatDayLabel }
  }
  __factories["shared/views.js"] = function (exports, module, __require) {
const { DEFAULT_MODULES, DEFAULT_PLATFORMS, DONE_PLAN_STATUS, DONE_STAGES } = __require("shared/model.js")
const { decorateProjects, isOrderDone, isPlanDone, isProjectDone, needsAttention, orderRisk, planRisk, priorityRank, projectRisk, riskRank } = __require("shared/metrics.js")
const { endOfWeek, startOfWeek, todayISO } = __require("shared/date.js")
/**
 * 视图层纯函数：可配置维度（模块、端）的取值、智能视图、搜索、分组与排序。
 *
 * 模块与端的**取值来自 state.config**，函数一律把配置当作参数传入，
 * 并且始终把数据里出现过的历史取值并进列表——用户改配置不会让旧数据消失。
 */

const SMART_VIEWS = [
  // 'all' 是「在管」口径：与 kpis.active 一致，默认排除已完成的项目/工单/计划。
  // 想看已完成请用 'done'；模块/端筛选条上的「全部」才是不分状态的全量口径。
  // 智能视图只在概览的统计卡上罗列，项目/工单页不再摆这一排筛选项；
  // 从概览点卡带上视图进来时，页内会显示一枚可关闭的「当前视图」标记。
  { id: 'all', label: '在管' },
  { id: 'attention', label: '需关注' },
  { id: 'overdue', label: '已逾期' },
  { id: 'week', label: '本周到期' },
  { id: 'unscheduled', label: '未排期' },
  { id: 'done', label: '已完成' }
]

function smartViewLabel(id) {
  const found = SMART_VIEWS.find((item) => item.id === id)
  return found ? found.label : ''
}

function moduleOf(project, modules = DEFAULT_MODULES) {
  const value = project && project.module ? String(project.module).trim() : ''
  return value || modules[0]
}

/** 过滤条/分组用的维度取值：配置项 + 数据里出现过的历史取值，保证不丢旧数据。 */
function mergeNames(configured, values) {
  const names = [...configured]
  for (const value of values) {
    const name = String(value == null ? '' : value).trim()
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

/** 「模块」筛选条的取值列表：配置项 + 项目用过的模块 + 工单挂过的模块。 */
function moduleOptions(modules, projects, orders = []) {
  return mergeNames(modules, [
    ...projects.map((project) => moduleOf(project, modules)),
    ...orders.map((order) => order.module)
  ])
}

/** 「端」筛选条的取值列表（按项目实际登记的端）。 */
function platformOptions(platforms, projects) {
  return mergeNames(platforms, projects.map((project) => project.platform))
}

/** 工单「目标端」筛选条的取值列表。 */
function targetOptions(platforms, orders) {
  return mergeNames(platforms, orders.map((order) => order.target))
}

function inModule(project, moduleId) {
  return !moduleId || moduleOf(project) === moduleId
}

/** 工单按它自己的 `module` 直接归口，不再经由所属项目。 */
function inModuleName(value, moduleId) {
  return !moduleId || String(value == null ? '' : value).trim() === moduleId
}

function matchesKeyword(text, keyword) {
  return String(text || '').toLowerCase().includes(keyword)
}

/**
 * 智能视图过滤。`moduleId` 决定项目、工单与计划的范围（三者的 `module` 字段），
 * `view` 决定保留哪些条目（空串 = 不套用智能视图，项目/工单/计划全部保留），
 * `target` 只收窄工单，`search` 对项目、工单、计划各自生效。
 * 返回 `{ projects, orders, plans }`，三者口径一致。
 */
function applyView(projects, orders, plans, { moduleId = '', view = '', platform = '', target = '', search = '' } = {}, today = todayISO()) {
  const weekEnd = endOfWeek(today)
  let scoped = projects.filter((project) => inModule(project, moduleId))
  if (platform) scoped = scoped.filter((project) => project.platform === platform)

  const keyword = String(search || '').trim().toLowerCase()
  let scopedOrders = orders.filter((order) => inModuleName(order.module, moduleId))
  if (target) scopedOrders = scopedOrders.filter((order) => order.target === target)

  let scopedPlans = plans.filter((plan) => inModuleName(plan.module, moduleId))
  if (keyword) {
    scoped = scoped.filter((project) =>
      matchesKeyword([project.code, project.name, project.summary, project.owner, project.platform, ...(project.tags || [])].join(' '), keyword)
    )
    // 工单按自己的内容（含挂的模块名）匹配即可，不再看它是否属于某个命中项目。
    scopedOrders = scopedOrders.filter((order) =>
      matchesKeyword([order.code, order.title, order.description, order.owner, order.stage, order.kind, order.priority, order.module].join(' '), keyword)
    )
    // 计划也直接挂模块，按自己的内容（含模块名）匹配即可，不再看它是否属于某个命中项目。
    scopedPlans = scopedPlans.filter((plan) =>
      matchesKeyword([plan.title, plan.note, plan.owner, plan.status, plan.module].join(' '), keyword)
    )
  }

  if (view === 'attention') {
    scoped = scoped.filter((project) => needsAttention(projectRisk(project, today)))
    scopedOrders = scopedOrders.filter((order) => needsAttention(orderRisk(order, today)))
    scopedPlans = scopedPlans.filter((plan) => needsAttention(planRisk(plan, today)))
  } else if (view === 'overdue') {
    // 「已逾期」按自身截止日期判断：项目不会因为挂了逾期工单而被列进来。
    scoped = scoped.filter((project) => Boolean(project.dueDate) && project.dueDate < today)
    scopedOrders = scopedOrders.filter((order) => orderRisk(order, today) === '已逾期')
    scopedPlans = scopedPlans.filter((plan) => planRisk(plan, today) === '已逾期')
  } else if (view === 'week') {
    const inWeek = (date) => Boolean(date) && date >= today && date <= weekEnd
    const weekPlans = scopedPlans.filter((plan) => inWeek(plan.dueDate))
    // 工单与计划都已经不在项目下面了，所以项目只看自己的投产日期。
    scoped = scoped.filter((project) => inWeek(project.dueDate))
    scopedOrders = scopedOrders.filter((order) => inWeek(order.dueDate))
    scopedPlans = weekPlans
  } else if (view === 'unscheduled') {
    scoped = scoped.filter((project) => !project.dueDate || !project.startedOn)
    scopedOrders = scopedOrders.filter((order) => !order.dueDate)
    scopedPlans = scopedPlans.filter((plan) => !plan.dueDate)
    // 上面三行都必须写回：视图口径要在 projects/orders/plans 之间保持一致
  } else if (view === 'done') {
    scoped = scoped.filter((project) => isProjectDone(project))
    scopedOrders = scopedOrders.filter((order) => isOrderDone(order))
    scopedPlans = scopedPlans.filter((plan) => isPlanDone(plan))
  } else if (view === 'all') {
    scoped = scoped.filter((project) => !isProjectDone(project))
    scopedOrders = scopedOrders.filter((order) => !isOrderDone(order))
    scopedPlans = scopedPlans.filter((plan) => !isPlanDone(plan))
  }
  // view 为空串 = 不套用任何智能视图。项目/工单页的默认口径是全量，
  // 页面上不再摆智能视图筛选项，所以更不能留一个看不见来源的隐藏筛选。

  return { projects: scoped, orders: scopedOrders, plans: scopedPlans }
}

/**
 * 各页的智能视图计数：只数本页的主对象。
 * 「项目」页数项目、「工单」页数工单——统计卡点进去之后，页内筛查条上的数字必须对得上。
 */
function projectSmartCounts(projects, orders, plans, { moduleId = '', platform = '' } = {}, today = todayISO()) {
  return SMART_VIEWS.map((view) => ({
    ...view,
    count: applyView(projects, orders, plans, { moduleId, view: view.id, platform }, today).projects.length
  }))
}

function orderSmartCounts(projects, orders, plans, { moduleId = '', target = '' } = {}, today = todayISO()) {
  return SMART_VIEWS.map((view) => ({
    ...view,
    count: applyView(projects, orders, plans, { moduleId, view: view.id, target }, today).orders.length
  }))
}

/**
 * 按模块分区（模块视图）。模块列表来自配置项 + 数据里出现过的历史取值。
 *
 * 每个分区同时给出该模块下的项目与工单——工单是直接挂模块的，所以两边都算这个模块的内容。
 */
function groupByModule(projects, orders, today = todayISO(), modules = DEFAULT_MODULES) {
  const decorated = decorateProjects(projects, today)
  const names = mergeNames(modules, [
    ...decorated.map((project) => moduleOf(project, modules)),
    ...orders.map((order) => order.module)
  ])
  const groups = []
  for (const name of names) {
    const items = decorated
      .filter((project) => moduleOf(project) === name)
      .sort((left, right) => riskRank(left.risk) - riskRank(right.risk) || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
    const scopedOrders = orders.filter((order) => inModuleName(order.module, name))
    if (!items.length && !scopedOrders.length) continue
    groups.push({ module: name, items, orders: scopedOrders, count: items.length, orderCount: scopedOrders.length })
  }
  return groups
}

/** 按端分区（多端视角）。项目看它登记的端，工单看它的目标端——两者共用同一份端命名。 */
function groupByPlatform(projects, orders, today = todayISO(), platforms = DEFAULT_PLATFORMS) {
  const decorated = decorateProjects(projects, today)
  const groups = []
  for (const name of mergeNames(platforms, [...decorated.map((project) => project.platform), ...orders.map((order) => order.target)])) {
    const items = decorated
      .filter((project) => project.platform === name)
      .sort((left, right) => riskRank(left.risk) - riskRank(right.risk) || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
    const scopedOrders = orders.filter((order) => order.target === name)
    if (!items.length && !scopedOrders.length) continue
    groups.push({ platform: name, items, orders: scopedOrders, count: items.length, orderCount: scopedOrders.length })
  }
  return groups
}

/** 给工单与计划补上它们挂的模块名（两者都不再有归属项目，界面上显示的就是模块）。 */
function attachModuleName(items) {
  return items.map((item) => ({ ...item, moduleName: item.module || '未归模块' }))
}

function sortOrders(orders, today = todayISO(), mode = 'risk') {
  const items = attachModuleName(orders.map((order) => ({ ...order, risk: orderRisk(order, today) })))
  if (mode === 'due') return items.sort((left, right) => (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
  if (mode === 'priority') return items.sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority) || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
  if (mode === 'stage') return items.sort((left, right) => left.stage.localeCompare(right.stage, 'zh-Hans-CN') || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
  return items.sort((left, right) => riskRank(left.risk) - riskRank(right.risk) || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
}

function sortPlans(plans, today = todayISO(), mode = 'risk') {
  const items = attachModuleName(plans.map((plan) => ({ ...plan, risk: planRisk(plan, today) })))
  if (mode === 'due') return items.sort((left, right) => (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
  if (mode === 'status') return items.sort((left, right) => left.status.localeCompare(right.status, 'zh-Hans-CN') || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
  return items.sort((left, right) => riskRank(left.risk) - riskRank(right.risk) || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
}

/** 本周视图：按天分桶（周一到周日）。`sourceName` 是归属名——工单与计划都看模块。 */
function weekBoard(orders, plans, today = todayISO()) {
  const start = startOfWeek(today)
  const days = []
  for (let index = 0; index < 7; index += 1) {
    const date = addDaysLocal(start, index)
    const items = []
    for (const order of orders) {
      if (isOrderDone(order) || order.dueDate !== date) continue
      items.push({
        kind: 'order', id: order.id, title: order.title, risk: orderRisk(order, today),
        sourceName: order.module || '未归模块', owner: order.owner, meta: `${order.stage} · ${order.priority}`
      })
    }
    for (const plan of plans) {
      if (isPlanDone(plan) || plan.dueDate !== date) continue
      items.push({
        kind: 'plan', id: plan.id, title: plan.title, risk: planRisk(plan, today),
        sourceName: plan.module || '未归模块', owner: plan.owner, meta: plan.status
      })
    }
    items.sort((left, right) => riskRank(left.risk) - riskRank(right.risk))
    days.push({ date, items, count: items.length })
  }
  return { start, end: addDaysLocal(start, 6), days }
}

function addDaysLocal(value, days) {
  const [year, month, day] = String(value).split('-').map(Number)
  const date = new Date(year, month - 1, day + days)
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}



module.exports = { SMART_VIEWS, smartViewLabel, moduleOf, moduleOptions, platformOptions, targetOptions, inModule, inModuleName, applyView, projectSmartCounts, orderSmartCounts, groupByModule, groupByPlatform, attachModuleName, sortOrders, sortPlans, weekBoard, DONE_PLAN_STATUS, DONE_STAGES }
  }
  __factories["shared/report.js"] = function (exports, module, __require) {
const { decorateProjects, isOrderDone, isPlanDone, kpis, orderRisk, ownerWorkload, planRisk, platformLoad, projectRisk, riskItems, riskRank } = __require("shared/metrics.js")
const { addDays, endOfWeek, formatDate, monthKey, quarterKey, startOfWeek, todayISO } = __require("shared/date.js")
/**
 * 周报 / 季报 / 项目状态汇报的文档草稿：纯字符串生成，不依赖宿主。
 */

const KIND_LABEL = { project: '项目', order: '工单', plan: '计划' }

/** 同名字段在不同对象上叫法不同：项目与工单的 dueDate 是「投产日期」，计划的仍是「截止日期」。 */
function dueLabel(kind) {
  return kind === 'plan' ? '截止' : '投产'
}

function line(...parts) {
  return parts.filter((part) => part !== undefined && part !== null && part !== '').join('')
}

function bullet(items, render, limit = 12) {
  if (!items.length) return '- 无\n'
  return items
    .slice(0, limit)
    .map((item) => `- ${render(item)}`)
    .join('\n') + '\n'
}

function riskBadge(level) {
  return level ? `【${level}】` : ''
}

/** 一段时间内的完成情况：按截止日期落在区间内的「已完成」条目统计。 */
function periodStats(projects, orders, plans, from, to, today = todayISO()) {
  const inRange = (date) => Boolean(date) && date >= from && date <= to
  const doneOrders = orders.filter((order) => order.stage === '已上线' && inRange(order.dueDate || order.updatedAt?.slice(0, 10)))
  const donePlans = plans.filter((plan) => plan.status === '已完成' && inRange(plan.dueDate || plan.updatedAt?.slice(0, 10)))
  const openOrders = orders.filter((order) => !isOrderDone(order))
  const openPlans = plans.filter((plan) => !isPlanDone(plan))
  return {
    from,
    to,
    doneOrders,
    donePlans,
    dueOrders: openOrders.filter((order) => inRange(order.dueDate)),
    duePlans: openPlans.filter((plan) => inRange(plan.dueDate)),
    newOrders: orders.filter((order) => inRange(order.createdAt?.slice(0, 10))),
    newPlans: plans.filter((plan) => inRange(plan.createdAt?.slice(0, 10))),
    doneCount: doneOrders.length + donePlans.length,
    totalCount: orders.length + plans.length
  }
}

/** 周报：本周区间默认取「今天所在周」。 */
function weeklyReport(projects, orders, plans, today = todayISO(), options = {}) {
  const from = options.from || startOfWeek(today)
  const to = options.to || endOfWeek(today)
  const stats = periodStats(projects, orders, plans, from, to, today)
  const data = kpis(projects, orders, plans, today)
  const decorated = decorateProjects(projects, today)
  const risks = riskItems(projects, orders, plans, today)
  const overdue = risks.filter((item) => item.risk === '已逾期')
  const blocked = decorated.filter((project) => project.risk === '阻塞')
  const attention = decorated.filter((project) => project.attention)

  const lines = []
  lines.push(`# 工作周报（${formatDate(from, from)} ~ ${formatDate(to, to)}）\n`)
  lines.push(`生成时间：${today}\n`)
  lines.push('## 一、本周概览\n')
  lines.push(`- 在管项目 ${data.active} 个，平均进度 ${data.avgProgress}%，其中需关注 ${data.attention} 个`)
  lines.push(`- 未结束工单 ${data.orderOpen} 条（逾期 ${data.orderOverdue}，本周到期 ${data.orderWeek}）`)
  lines.push(`- 未结束计划 ${data.planOpen} 条（逾期 ${data.planOverdue}，本周到期 ${data.planWeek}）`)
  lines.push(`- 本周期内完成 ${stats.doneCount} 项（上线工单 ${stats.doneOrders.length}、完成计划 ${stats.donePlans.length}）\n`)

  lines.push('## 二、本周完成\n')
  lines.push(bullet(stats.doneOrders, (order) => `${order.title}（${order.stage}）`))
  lines.push(bullet(stats.donePlans, (plan) => `${plan.title}（${plan.status}）`))

  lines.push('## 三、进行中的重点\n')
  const running = decorated
    .filter((project) => !['已完成', '待启动'].includes(project.status))
    .sort((left, right) => riskRank(left.risk) - riskRank(right.risk))
  lines.push(
    bullet(
      running,
      (project) => `**${project.name}**（${project.platform}｜${project.status}｜进度 ${project.progress}%｜负责人 ${project.owner}）${riskBadge(project.risk)}`,
      10
    )
  )
  lines.push('### 本周期内到期\n')
  if (!stats.dueOrders.length && !stats.duePlans.length) {
    lines.push('- 无\n')
  } else {
    lines.push(bullet(stats.dueOrders, (item) => `${item.title}（${KIND_LABEL.order}｜${item.stage}｜${formatDate(item.dueDate)}）${riskBadge(orderRisk(item, today))}`, 12))
    lines.push(bullet(stats.duePlans, (item) => `${item.title}（${KIND_LABEL.plan}｜${item.status}｜${formatDate(item.dueDate)}）${riskBadge(planRisk(item, today))}`, 12))
  }

  lines.push('## 四、风险与待跟进\n')
  if (!overdue.length && !attention.length) {
    lines.push('- 无逾期与高风险项\n')
  } else {
    lines.push(bullet(overdue, (item) => `**已逾期** ${KIND_LABEL[item.kind]}：${item.title}（${item.sourceName}｜${dueLabel(item.kind)} ${formatDate(item.dueDate)}）`, 10))
    lines.push(bullet(attention, (item) => `${riskBadge(item.risk)}${KIND_LABEL[item.kind]}：${item.title}（${item.sourceName}｜${dueLabel(item.kind)} ${formatDate(item.dueDate)}）`, 10))
    // riskItems 的条目已经带 title/sourceName（项目归项目，工单与计划归模块），直接展开即可
  }

  lines.push('## 五、下周计划\n')
  const nextFrom = addDays(to, 1)
  const weekEndNext = endOfWeek(nextFrom)
  const next = riskItems(projects, orders, plans, today).filter((item) => item.dueDate && item.dueDate >= nextFrom && item.dueDate <= weekEndNext).map((item) => ({ ...item }))
  lines.push(bullet(next, (item) => `${KIND_LABEL[item.kind]}：${item.title}（${item.sourceName}｜${dueLabel(item.kind)} ${formatDate(item.dueDate)}）`, 12))

  lines.push('## 六、需要支持\n')
  if (blocked.length) {
    lines.push(bullet(blocked, (project) => `${project.name}：${project.summary || '需要协调资源或决策'}`, 6))
  } else {
    lines.push('- 无阻塞项\n')
  }
  return lines.join('\n')
}

/** 季报：按季度区间聚合。 */
function quarterlyReport(projects, orders, plans, today = todayISO(), options = {}) {
  const key = options.quarter || quarterKey(today)
  const year = Number(key.slice(0, 4))
  const quarter = Number(String(key).replace(/^\d{4}-?Q?/i, '')) || 1
  const from = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`
  const months = [0, 1, 2].map((offset) => {
    const month = (quarter - 1) * 3 + offset + 1
    const last = new Date(year, month, 0).getDate()
    return { month: `${year}-${String(month).padStart(2, '0')}`, to: `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}` }
  })
  const to = months[2].to
  const stats = periodStats(projects, orders, plans, from, to, today)
  const data = kpis(projects, orders, plans, today)
  const workload = ownerWorkload(projects, orders, plans, today)
  const platforms = platformLoad(projects, orders, today)

  const lines = []
  lines.push(`# 季度工作汇报（${year} 年 Q${quarter}）\n`)
  lines.push(`区间：${from} ~ ${to}｜生成时间：${today}\n`)
  lines.push('## 一、总体情况\n')
  lines.push(`- 项目总数 ${data.projects}，在管 ${data.active}，已完成 ${Math.max(0, data.projects - data.active)}`)
  lines.push(`- 平均进度 ${data.avgProgress}%；需关注 ${data.attention} 个，其中逾期 ${data.overdue}、阻塞 ${data.blocked}`)
  lines.push(`- 工单累计 ${orders.length} 条，未结束 ${data.orderOpen} 条；计划累计 ${plans.length} 条，未完成 ${data.planOpen} 条`)
  lines.push(`- 本季度完成 ${stats.doneCount} 项（上线工单 ${stats.doneOrders.length}、完成计划 ${stats.donePlans.length}）\n`)

  lines.push('## 二、按月节奏\n')
  for (const item of months) {
    const monthStats = periodStats(projects, orders, plans, `${item.month}-01`, item.to, today)
    lines.push(`- ${item.month}：完成 ${monthStats.doneCount} 项，新增 ${monthStats.newOrders.length + monthStats.newPlans.length} 项`)
  }
  lines.push('')

  lines.push('## 三、多端进展\n')
  lines.push(
    bullet(
      platforms,
      (row) => `${row.platform}：项目 ${row.projects} 个，平均进度 ${row.avgProgress}%，未结束工单 ${row.open} 条（逾期 ${row.overdue}）`,
      8
    )
  )

  lines.push('## 四、主要交付\n')
  lines.push(bullet(stats.doneOrders, (order) => `${order.title}（${order.kind}｜${order.stage}）`, 15))
  lines.push(bullet(stats.donePlans, (plan) => `${plan.title}（${plan.status}）`, 15))

  lines.push('## 五、人效与负荷\n')
  lines.push(bullet(workload, (row) => `${row.owner}：项目 ${row.projects}｜工单 ${row.orders}｜计划 ${row.plans}｜逾期 ${row.overdue}`, 12))

  lines.push('## 六、遗留问题与下季度重点\n')
  const risks = riskItems(projects, orders, plans, today).slice(0, 12)
  lines.push(bullet(risks, (item) => `${riskBadge(item.risk)}${KIND_LABEL[item.kind]}：${item.title}（${item.sourceName}｜${dueLabel(item.kind)} ${formatDate(item.dueDate)}）`, 12))
  return lines.join('\n')
}

/**
 * 单项目状态汇报。
 *
 * 工单与计划都已改挂模块、不再归属项目，所以项目汇报只讲项目本身与它自己的进展记录。
 */
function projectReport(project, logs, today = todayISO()) {
  const relatedLogs = logs.filter((log) => log.refType === 'project' && log.refId === project.id)
  const risk = projectRisk(project, today)
  const lines = []
  lines.push(`# ${project.name} · 状态汇报\n`)
  lines.push(`汇报时间：${today}${project.code ? `｜项目编号：${project.code}` : ''}｜模块：${project.module || '未分类'}｜端：${project.platform}\n`)
  lines.push('## 基本信息\n')
  lines.push(`- 状态：${project.status}｜进度：${project.progress}%｜风险：${risk}`)
  lines.push(`- 负责人：${project.owner}｜开始：${formatDate(project.startedOn, '未填')}｜投产：${formatDate(project.dueDate, '未填')}`)
  if (project.link) lines.push(`- 链接：${project.link}`)
  if (project.summary) lines.push(`- 说明：${project.summary}`)
  lines.push('')
  lines.push('## 最近进展\n')
  lines.push(bullet([...relatedLogs].sort((left, right) => (left.at < right.at ? 1 : -1)), (log) => `${log.at.slice(0, 10)}【${log.kind}】${log.text}`, 15))
  return lines.join('\n')
}

/** 汇报类型清单，供客户端下拉使用。 */
const REPORT_KINDS = [
  { id: 'weekly', label: '工作周报' },
  { id: 'quarterly', label: '季度汇报' },
  { id: 'project', label: '项目状态汇报' }
]

function buildReport(kind, data, context = {}) {
  const today = context.today || todayISO()
  if (kind === 'quarterly') return quarterlyReport(data.projects, data.orders, data.plans, today, context)
  if (kind === 'project') {
    const project = data.projects.find((item) => item.id === context.projectId) || data.projects[0]
    if (!project) return '# 没有可汇报的项目\n'
    return projectReport(project, data.logs || [], today)
  }
  return weeklyReport(data.projects, data.orders, data.plans, today, context)
}



module.exports = { periodStats, weeklyReport, quarterlyReport, projectReport, REPORT_KINDS, buildReport, monthKey, formatDate }
  }
  __factories["shared/seed.js"] = function (exports, module, __require) {
const { DEFAULT_MODULES, DEFAULT_PLATFORMS, createId } = __require("shared/model.js")
const { addDays, todayISO } = __require("shared/date.js")
/**
 * 示例数据：第一次进入且数据为空时生成，方便立刻看到所有看板。
 * 所有条目都带「示例」标签，随时可以在「设置」里一键清空。
 */

const SEED = '示例'

function sampleState(today = todayISO()) {
  const project = (module, name, platform, status, owner, startOffset, dueOffset, progress, summary, tags, code) => {
    const startedOn = startOffset === null ? '' : addDays(today, startOffset)
    const dueDate = dueOffset === null ? '' : addDays(today, dueOffset)
    return {
      id: createId('prj'),
      code,
      name,
      module,
      platform,
      status,
      owner,
      startedOn,
      dueDate,
      progress,
      link: '',
      summary,
      tags: [SEED, ...tags],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  const projects = [
    project('移动端开发', '手机银行 6.2 版本迭代', '移动手机', '进行中', '我', -24, 9, 62,
      '本期含转账限额调整、消息中心改版和指纹登录优化，需与后端接口联调后统一提测。', ['版本迭代', '手机端'], 'PRJ-2601'),
    project('移动端开发', '移动展业 PAD 端客户建档重构', '移动 PAD', '阻塞', '我', -32, 5, 45,
      '表单引擎重写，等业务确认字段校验规则；未确认前测试用例写不下去。', ['PAD', '阻塞'], 'PRJ-2602'),
    project('移动端开发', '微信小程序开户流程优化', '小程序', '进行中', '我', -12, 16, 35,
      '开户转化率偏低，本期做三步合一并补充失败重试引导。', ['小程序', '转化率'], 'PRJ-2603'),
    project('移动端开发', '小程序端埋点补全与看板', '小程序', '待启动', '我', null, 30, 0,
      '补齐关键路径埋点，输出转化漏斗看板，为下季度运营提供数据。', ['数据', '待启动'], 'PRJ-2604'),
    project('公司项目', '信贷平台移动端需求池梳理', '移动手机', '进行中', '我', -8, 12, 50,
      '汇总各分行反馈，形成下一批迭代需求清单并完成优先级评审。', ['需求池'], 'PRJ-2605'),
    project('日常工作', '移动端周例会与风险同步', '其他', '进行中', '我', -40, 20, 70,
      '每周例会纪要、阻塞项升级与跨端联调协调。', ['例会', '日常'], 'PRJ-2606'),
    project('日常工作', '移动端测试环境巡检', '其他', '进行中', '我', -20, 2, 80,
      '每周巡检三端测试环境可用性与版本一致性。', ['环境', '日常'], 'PRJ-2607'),
    project('其他项目', '移动端组件库文档整理', '其他', '进行中', '我', -15, 25, 30,
      '把散落的组件说明收进一份可检索的文档，减少重复沟通。', ['文档', '组件库'], 'PRJ-2608'),
    project('其他项目', '上季度移动端质量复盘', '其他', '已完成', '我', -70, -6, 100,
      '缺陷分布、回归成本与改进项复盘，已归档。', ['复盘', '已完成'], 'PRJ-2609')
  ]

  const orders = []
  const plans = []
  const logs = []

  const order = (module, code, title, kind, priority, stage, owner, target, createdOffset, dueOffset, description) => {
    const id = createId('ord')
    orders.push({
      id,
      code,
      module,
      title,
      kind,
      priority,
      stage,
      owner,
      target,
      dueDate: dueOffset === null ? '' : addDays(today, dueOffset),
      createdOn: createdOffset === null ? '' : addDays(today, createdOffset),
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    return id
  }

  // 计划与工单一样直接挂模块，不再关联项目或工单。
  const plan = (module, title, owner, status, startOffset, dueOffset, note) => {
    const id = createId('pln')
    plans.push({
      id,
      module,
      title,
      owner,
      status,
      startedOn: startOffset === null ? '' : addDays(today, startOffset),
      dueDate: dueOffset === null ? '' : addDays(today, dueOffset),
      note,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    return id
  }

  const log = (refType, refId, kind, text, offset) => {
    logs.push({
      id: createId('log'),
      refType,
      refId,
      at: new Date(Date.now() + offset * 86400000).toISOString(),
      kind,
      text
    })
  }

  order('移动端开发', 'WO-2601', '转账限额调整（含人脸复核）', '迭代需求', '高', '开发中', '我', '移动手机', -18, 3,
    '限额规则由单笔 50 万调整为分级限额，超限走人脸复核。')
  order('移动端开发', 'WO-2602', '消息中心改版', '迭代需求', '中', '联调中', '我', '移动手机', -14, 4,
    '分类聚合、已读同步，与服务端推送协议对齐。')
  const o3 = order('移动端开发', 'WO-2603', '指纹登录偶发失败修复', '缺陷', '紧急', '测试中', '我', '移动手机', -9, -1,
    '部分安卓机型指纹回调丢失，需要在测试环境复现并加兜底。')
  const o4 = order('移动端开发', 'WO-2604', '建档字段校验规则变更', '变更需求', '高', '待评审', '我', '移动 PAD', -26, -2,
    '业务新增 12 个必填校验项，需确认是否影响存量客户补录。')
  order('移动端开发', 'WO-2605', '表单引擎性能优化', '技术任务', '中', '开发中', '我', '移动 PAD', -20, 6,
    '百字段表单渲染卡顿，改为分段渲染。')
  order('移动端开发', 'WO-2606', '开户三步合一改造', '迭代需求', '高', '开发中', '我', '小程序', -12, 14,
    '身份认证、绑卡、风险测评合并到一个引导流。')
  order('移动端开发', 'WO-2607', '失败重试引导文案', '迭代需求', '低', '待排期', '我', '小程序', -6, 18,
    '失败后给明确下一步，减少重复提交。')
  order('公司项目', 'WO-2608', '三季度需求池评审', '技术任务', '中', '待评审', '我', '', -10, 5,
    '汇总分行反馈，产出优先级清单。')

  const p1 = plan('移动端开发', '与后端确认限额分级口径', '我', '进行中', -3, 1, '输出接口字段对照表。')
  const p2 = plan('移动端开发', '安卓指纹失败机型复现', '我', '进行中', -1, 0, '覆盖 5 个主流机型。')
  const p3 = plan('移动端开发', '整理 6.2 提测清单', '我', '未开始', 1, 4, '含回归范围与冒烟用例。')
  const p4 = plan('移动端开发', '推动业务确认校验规则', '我', '进行中', -5, -2, '已发两轮确认邮件，等待回复。')
  const p5 = plan('移动端开发', '百字段表单性能基线测试', '我', '未开始', 3, 6, '先建立基线数据。')
  const p6 = plan('移动端开发', '联调开户主流程', '我', '进行中', -2, 3, '重点验证异常分支。')
  const p7 = plan('移动端开发', '整理小程序上线检查项', '我', '未开始', 8, 12, '版本号、灰度开关、回滚方案。')
  const p8 = plan('移动端开发', '梳理关键路径埋点清单', '我', '未开始', null, null, '未排期，等排期会确认。')
  const p9 = plan('日常工作', '本周移动端风险同步邮件', '我', '未开始', 0, 2, '把阻塞项升级给项目经理。')
  const p10 = plan('日常工作', '测试环境巡检（三端）', '我', '进行中', -1, 0, '记录版本一致性结果。')
  const p11 = plan('其他项目', '组件库文档目录搭建', '我', '进行中', -6, 9, '先定目录结构。')

  log('project', projects[0].id, '进展', '6.2 需求评审通过，进入开发阶段。', -20)
  log('project', projects[0].id, '进展', '限额规则初版接口联调完成。', -6)
  log('order', o3, '阻塞', '测试环境暂缺指定机型，阻塞复现。', -3)
  log('project', projects[1].id, '阻塞', '业务侧校验规则未确认，测试用例无法定稿。', -4)
  log('order', o4, '变更', '业务追加 12 个必填校验项。', -2)
  log('project', projects[2].id, '进展', '开户主流程联调完成 60%。', -1)
  log('project', projects[8].id, '决策', '复盘结论：回归阶段引入自动化冒烟。', -6)
  log('plan', p4, '阻塞', '等待业务回复规则确认。', -2)

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    seededAt: new Date().toISOString(),
    config: { modules: [...DEFAULT_MODULES], platforms: [...DEFAULT_PLATFORMS] },
    projects,
    orders,
    plans,
    logs
  }
}

/** 空数据判定：四个集合都为空才认为需要生成示例。 */
function isEmptyState(state) {
  if (!state || typeof state !== 'object') return true
  const size = (value) => (Array.isArray(value) ? value.length : 0)
  return size(state.projects) + size(state.orders) + size(state.plans) + size(state.logs) === 0
}


module.exports = { sampleState, isEmptyState }
  }
    return __require("client/index.js")
  }
})
