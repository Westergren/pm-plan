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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  docAction,
  readDoc,
  readDocs,
  readState,
  setDocsRoot,
  updateDocMeta,
  uploadDoc,
  writeDoc,
  writeState
} from './api.js'
import {
  Badge,
  Banner,
  Button,
  Card,
  Drawer,
  Empty,
  FieldRow,
  KeyValues,
  Modal,
  Progress,
  Select,
  TextArea,
  TextField,
  Toast,
  injectStyles
} from './ui.js'
import { OverviewScreen, ProjectsScreen, OrdersScreen, PlansScreen, CalendarScreen, RisksScreen, ReportsScreen, DocsScreen } from './screens.js'
import {
  DEFAULT_MODULES,
  DEFAULT_PLATFORMS,
  LOG_KINDS,
  MAX_DIMENSION_ITEMS,
  MAX_DIMENSION_LENGTH,
  ORDER_KINDS,
  ORDER_STAGES,
  PLAN_STATUS,
  PRIORITIES,
  PROJECT_STATUS,
  createId,
  normalizeState
} from '../shared/model.js'
import {
  RISK_TONE,
  decorateProjects,
  headline,
  kpis,
  orderRisk,
  planRisk,
  projectRisk,
  riskTone
} from '../shared/metrics.js'
import { applyView, moduleOptions, platformOptions, projectSmartCounts, smartViewLabel, targetOptions } from '../shared/views.js'
import { buildReport } from '../shared/report.js'
import { addDays, formatDate, formatDateTime, todayISO } from '../shared/date.js'
import { isEmptyState, sampleState } from '../shared/seed.js'

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

export function PlanWorkbench({ service, entry, conversation }) {
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
        ['开始 / 完成', `${formatDate(item.startedOn, '未填')} ~ ${formatDate(item.dueDate, '未填')}`],
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
      h(TextField, { label: '完成日期', type: 'date', value: draft.dueDate, onChange: (value) => set({ dueDate: value }) })
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

export { TABS, EMPTY_PROJECT, EMPTY_ORDER, EMPTY_PLAN }
