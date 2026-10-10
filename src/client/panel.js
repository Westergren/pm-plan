/**
 * 项目计划工作台面板。
 *
 * 顶栏（品牌 / 搜索 / 刷新 / 新建 / 保存状态 / AI 会话）＋ 左侧筛选（模块轴 + 智能视图 + 端）
 * ＋ 业务页签（概览 · 项目 · 工单 · 计划 · 日历 · 风险 · 汇报）＋ 主内容区 ＋ 详情抽屉/编辑弹窗。
 *
 * 依赖会话的动作只有「AI 会话」按钮：它把宿主提供的 `conversation` 节点放进右侧抽屉，
 * 面板自己不创建会话、不改写会话归属、不碰工作区；其余业务在没有会话时也能完整使用。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, readState, writeState } from './api.js'
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
import { OverviewScreen, ProjectsScreen, OrdersScreen, PlansScreen, CalendarScreen, RisksScreen, ReportsScreen } from './screens.js'
import {
  LOG_KINDS,
  MODULES,
  ORDER_KINDS,
  ORDER_STAGES,
  PLATFORMS,
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
import { applyView, moduleAxis, smartCounts } from '../shared/views.js'
import { buildReport } from '../shared/report.js'
import { addDays, formatDate, formatDateTime, todayISO } from '../shared/date.js'
import { isEmptyState, sampleState } from '../shared/seed.js'

const h = require('react').createElement

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'projects', label: '项目' },
  { id: 'orders', label: '工单' },
  { id: 'plans', label: '计划' },
  { id: 'calendar', label: '日历' },
  { id: 'risks', label: '风险' },
  { id: 'reports', label: '汇报' }
]

const toOptions = (values) => values.map((value) => ({ value, label: value }))

const EMPTY_PROJECT = () => ({
  name: '',
  module: MODULES[0],
  platform: '移动手机',
  status: '进行中',
  owner: '我',
  startedOn: todayISO(),
  dueDate: addDays(todayISO(), 14),
  progress: 0,
  link: '',
  summary: ''
})

const EMPTY_ORDER = (projectId) => ({
  projectId: projectId || '',
  title: '',
  kind: '迭代需求',
  priority: '中',
  stage: '待评审',
  owner: '我',
  target: '',
  estDays: 3,
  dueDate: addDays(todayISO(), 7),
  description: ''
})

const EMPTY_PLAN = (projectId) => ({
  projectId: projectId || '',
  orderId: '',
  title: '',
  owner: '我',
  status: '未开始',
  startedOn: todayISO(),
  dueDate: addDays(todayISO(), 3),
  progress: 0,
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
  const [moduleId, setModuleId] = useState('')
  const [smart, setSmart] = useState('all')
  const [platform, setPlatform] = useState('')
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

  const axis = useMemo(() => moduleAxis(projects, orders, plans, today), [projects, orders, plans, today])
  const counts = useMemo(() => smartCounts(projects, orders, plans, { moduleId, platform }, today), [projects, orders, plans, moduleId, platform, today])
  const scoped = useMemo(() => applyView(projects, orders, plans, { moduleId, view: smart, platform, search }, today), [projects, orders, plans, moduleId, smart, platform, search, today])
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

  const removeItem = useCallback((type, id) => {
    mutate((state) => {
      if (type === 'project') {
        const orderIds = new Set(state.orders.filter((order) => order.projectId === id).map((order) => order.id))
        const planIds = new Set(state.plans.filter((plan) => plan.projectId === id).map((plan) => plan.id))
        return {
          ...state,
          projects: dropById(state.projects, id),
          orders: state.orders.filter((order) => order.projectId !== id),
          plans: state.plans.filter((plan) => plan.projectId !== id),
          logs: state.logs.filter((log) => !(log.refType === 'project' && log.refId === id) && !(log.refType === 'order' && orderIds.has(log.refId)) && !(log.refType === 'plan' && planIds.has(log.refId)))
        }
      }
      const refType = type === 'order' ? 'order' : 'plan'
      const patch = type === 'order'
        ? { orders: dropById(state.orders, id), plans: state.plans.map((plan) => (plan.orderId === id ? { ...plan, orderId: '' } : plan)) }
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
        progress: done ? Math.min(plan.progress, 90) : 100,
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

  const generateReport = useCallback(() => {
    setReportText(buildReport(reportKind, { projects, orders, plans, logs }, { today, projectId: reportProjectId || projects[0]?.id }))
  }, [reportKind, projects, orders, plans, logs, today, reportProjectId])

  useEffect(() => {
    if (view === 'reports' && !reportText) generateReport()
  }, [view, reportText, generateReport])

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

  const screenProps = {
    today,
    projects,
    orders,
    plans,
    logs,
    scoped,
    decorated,
    stats,
    summaryLine,
    moduleId,
    smart,
    platform,
    search,
    axis,
    counts,
    onOpenProject: openProject,
    onOpenOrder: openOrder,
    onOpenPlan: openPlan,
    onEditProject: (project) => setEditor({ type: 'project', form: project || EMPTY_PROJECT() }),
    onEditOrder: (order) => setEditor({ type: 'order', form: order || EMPTY_ORDER(scoped.projects[0]?.id) }),
    onEditPlan: (plan) => setEditor({ type: 'plan', form: plan || EMPTY_PLAN(scoped.projects[0]?.id) }),
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

  const rendered = () => {
    if (status === 'loading') return h(Empty, { text: '正在读取本机数据…' })
    if (status === 'error') {
      return h(Empty, {
        text: error || '读取数据失败。',
        action: h(Button, { variant: 'primary', onClick: load }, '重试')
      })
    }
    if (view === 'overview') return h(OverviewScreen, screenProps)
    if (view === 'projects') return h(ProjectsScreen, screenProps)
    if (view === 'orders') return h(OrdersScreen, screenProps)
    if (view === 'plans') return h(PlansScreen, screenProps)
    if (view === 'calendar') return h(CalendarScreen, screenProps)
    if (view === 'risks') return h(RisksScreen, screenProps)
    return h(ReportsScreen, screenProps)
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
      h(Button, { variant: 'primary', onClick: () => setEditor({ type: 'project', form: EMPTY_PROJECT() }) }, '新建项目'),
      h(Button, { onClick: () => setEditor({ type: 'order', form: EMPTY_ORDER(scoped.projects[0]?.id) }) }, '新建工单'),
      h(Button, { onClick: () => setEditor({ type: 'plan', form: EMPTY_PLAN(scoped.projects[0]?.id) }) }, '新建计划'),
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
      h('nav', { className: 'pmplan-side', 'aria-label': '筛选' },
        h('div', { className: 'pmplan-side-group' },
          h('div', { className: 'pmplan-side-title' }, '模块'),
          axis.map((row) => h('button', {
            key: `m-${row.id || 'all'}`,
            type: 'button',
            className: 'pmplan-side-item',
            'aria-current': moduleId === row.id ? 'true' : 'false',
            onClick: () => setModuleId(row.id)
          },
            h('span', { className: 'pmplan-side-item-label', title: row.label }, row.label),
            row.attention ? h('span', { className: 'pmplan-side-risk', title: `${row.attention} 个需关注` }, `!${row.attention}`) : null,
            h('span', { className: 'pmplan-side-count' }, String(row.count))
          ))
        ),
        h('div', { className: 'pmplan-side-group' },
          h('div', { className: 'pmplan-side-title' }, '智能视图'),
          counts.map((row) => h('button', {
            key: `s-${row.id}`,
            type: 'button',
            className: 'pmplan-side-item',
            'aria-current': smart === row.id ? 'true' : 'false',
            onClick: () => setSmart(row.id)
          },
            h('span', { className: 'pmplan-side-item-label' }, row.label),
            h('span', { className: 'pmplan-side-count' }, String(row.count))
          ))
        ),
        h('div', { className: 'pmplan-side-group' },
          h('div', { className: 'pmplan-side-title' }, '端'),
          h('button', {
            type: 'button',
            className: 'pmplan-side-item',
            'aria-current': platform === '' ? 'true' : 'false',
            onClick: () => setPlatform('')
          }, h('span', { className: 'pmplan-side-item-label' }, '全部端')),
          PLATFORMS.map((name) => h('button', {
            key: `p-${name}`,
            type: 'button',
            className: 'pmplan-side-item',
            'aria-current': platform === name ? 'true' : 'false',
            onClick: () => setPlatform(platform === name ? '' : name)
          }, h('span', { className: 'pmplan-side-item-label' }, name)))
        ),
        h('div', { className: 'pmplan-side-foot' },
          h(Button, { size: 'small', onClick: () => setEditor({ type: 'project', form: EMPTY_PROJECT() }) }, '新建项目'),
          h(Button, { size: 'small', onClick: () => mutate(() => sampleState(today), '已重新生成示例数据') }, '示例数据'),
          h(Button, { size: 'small', variant: 'danger', onClick: () => setConfirm({ type: 'clear' }) }, '清空')
        )
      ),
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
    editor
      ? h(EditorModal, {
          type: editor.type,
          form: editor.form,
          projects,
          orders,
          onClose: () => setEditor(null),
          onSubmit: editor.type === 'project' ? saveProject : editor.type === 'order' ? saveOrder : savePlan
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

function DetailDrawer({ type, item, projects, orders, plans, logs, today, logDraft, setLogDraft, onClose, onEdit, onDelete, onAddLog, onSetOrderStage, onOpenProject, onOpenOrder, onOpenPlan, onSelectView }) {
  if (!item) return null

  if (type === 'project') {
    const relatedOrders = orders.filter((order) => order.projectId === item.id)
    const relatedPlans = plans.filter((plan) => plan.projectId === item.id)
    const relatedLogs = logs.filter((log) => log.refType === 'project' && log.refId === item.id)
    const risk = projectRisk(item, orders, plans, today)
    return h(Drawer, {
      title: item.name,
      subtitle: `${item.module} · ${item.platform} · ${item.status}`,
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
        h(Badge, { tone: 'muted', children: item.dueDate ? `截止 ${formatDate(item.dueDate)}` : '未排期' })
      ),
      h(Progress, { value: item.progress, tone: RISK_TONE[risk] }),
      h(KeyValues, {
        rows: [
          ['负责人', item.owner || '未指派'],
          ['起止', `${formatDate(item.startedOn, '未填')} ~ ${formatDate(item.dueDate, '未填')}`],
          ['链接', item.link ? h('a', { href: item.link, target: '_blank', rel: 'noreferrer' }, item.link) : '—'],
          ['标签', item.tags?.length ? item.tags.join('、') : '—'],
          ['更新于', formatDateTime(item.updatedAt, '—')]
        ]
      }),
      item.summary ? h(Card, { title: '说明' }, h('div', { className: 'pmplan-soft' }, item.summary)) : null,
      h(Card, {
        title: `需求 / 变更工单（${relatedOrders.length}）`,
        actions: h(Button, { size: 'small', onClick: () => onSelectView('orders') }, '去工单页')
      },
        relatedOrders.length
          ? h('div', { className: 'pmplan-col' }, relatedOrders.map((order) => h('button', {
              key: order.id,
              type: 'button',
              className: 'pmplan-item',
              onClick: () => onOpenOrder(order.id)
            },
              h('span', { className: 'pmplan-item-title' }, order.title),
              h('span', { className: 'pmplan-item-meta' },
                h(Badge, { tone: RISK_TONE[orderRisk(order, today)], children: orderRisk(order, today) }),
                `${order.kind} · ${order.stage} · ${formatDate(order.dueDate)}`
              )
            )))
          : h('div', { className: 'pmplan-small pmplan-muted' }, '该项目还没有工单。')
      ),
      h(Card, { title: `计划与跟进（${relatedPlans.length}）` },
        relatedPlans.length
          ? h('div', { className: 'pmplan-col' }, relatedPlans.map((plan) => h('button', {
              key: plan.id,
              type: 'button',
              className: 'pmplan-item',
              onClick: () => onOpenPlan(plan.id)
            },
              h('span', { className: 'pmplan-item-title' }, plan.title),
              h('span', { className: 'pmplan-item-meta' },
                h(Badge, { tone: RISK_TONE[planRisk(plan, today)], children: planRisk(plan, today) }),
                `${plan.status} · ${plan.progress}% · ${formatDate(plan.dueDate)}`
              )
            )))
          : h('div', { className: 'pmplan-small pmplan-muted' }, '该项目还没有计划。')
      ),
      h(Card, { title: '进展记录' },
        h(LogList, { logs: relatedLogs }),
        h(LogComposer, { draft: logDraft, setDraft: setLogDraft, onSubmit: () => onAddLog('project', item.id) })
      )
    )
  }

  if (type === 'order') {
    const project = projects.find((entryItem) => entryItem.id === item.projectId)
    const relatedPlans = plans.filter((plan) => plan.orderId === item.id)
    const relatedLogs = logs.filter((log) => log.refType === 'order' && log.refId === item.id)
    const risk = orderRisk(item, today)
    return h(Drawer, {
      title: item.title,
      subtitle: `${item.kind} · ${item.priority}优先级 · ${item.stage}`,
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
        project
          ? h(Button, { size: 'small', variant: 'ghost', onClick: () => onOpenProject(project.id) }, `项目：${project.name}`)
          : h(Badge, { tone: 'muted', children: '未归项目' })
      ),
      h(KeyValues, {
        rows: [
          ['负责人', item.owner || '未指派'],
          ['目标端', item.target || '未填'],
          ['截止', formatDate(item.dueDate, '未排期')],
          ['预估', item.estDays ? `${item.estDays} 人日` : '—'],
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
      h(Card, { title: '关联计划' },
        relatedPlans.length
          ? h('div', { className: 'pmplan-col' }, relatedPlans.map((plan) => h('button', {
              key: plan.id,
              type: 'button',
              className: 'pmplan-item',
              onClick: () => onOpenPlan(plan.id)
            },
              h('span', { className: 'pmplan-item-title' }, plan.title),
              h('span', { className: 'pmplan-item-meta' }, `${plan.status} · ${plan.progress}%`)
            )))
          : h('div', { className: 'pmplan-small pmplan-muted' }, '还没有关联计划。')
      ),
      h(Card, { title: '进展记录' },
        h(LogList, { logs: relatedLogs }),
        h(LogComposer, { draft: logDraft, setDraft: setLogDraft, onSubmit: () => onAddLog('order', item.id) })
      )
    )
  }

  const project = projects.find((entryItem) => entryItem.id === item.projectId)
  const order = orders.find((entryItem) => entryItem.id === item.orderId)
  const relatedLogs = logs.filter((log) => log.refType === 'plan' && log.refId === item.id)
  const risk = planRisk(item, today)
  return h(Drawer, {
    title: item.title,
    subtitle: `${item.status} · 进度 ${item.progress}%`,
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
      project ? h(Button, { size: 'small', variant: 'ghost', onClick: () => onOpenProject(project.id) }, `项目：${project.name}`) : h(Badge, { tone: 'muted', children: '未归项目' }),
      order ? h(Button, { size: 'small', variant: 'ghost', onClick: () => onOpenOrder(order.id) }, `工单：${order.title}`) : null
    ),
    h(Progress, { value: item.progress, tone: RISK_TONE[risk] }),
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

function EditorModal({ type, form, projects, orders, onClose, onSubmit }) {
  const [draft, setDraft] = useState(form)
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }))
  const title = type === 'project'
    ? (draft.id ? '编辑项目' : '新建项目')
    : type === 'order'
      ? (draft.id ? '编辑工单' : '新建工单')
      : (draft.id ? '编辑计划' : '新建计划')
  const valid = type === 'project' ? draft.name.trim().length > 0 : draft.title.trim().length > 0
  const relatedOrders = orders.filter((order) => order.projectId === draft.projectId)

  const projectFields = [
    h(TextField, { key: 'name', label: '项目名称', value: draft.name, onChange: (value) => set({ name: value }), placeholder: '例如：手机银行 6.2 版本迭代' }),
    h(FieldRow, { key: 'row1' },
      h(Select, { label: '模块', value: draft.module, onChange: (value) => set({ module: value }), options: toOptions(MODULES) }),
      h(Select, { label: '端', value: draft.platform, onChange: (value) => set({ platform: value }), options: toOptions(PLATFORMS) }),
      h(Select, { label: '状态', value: draft.status, onChange: (value) => set({ status: value }), options: toOptions(PROJECT_STATUS) })
    ),
    h(FieldRow, { key: 'row2' },
      h(TextField, { label: '负责人', value: draft.owner, onChange: (value) => set({ owner: value }) }),
      h(TextField, { label: '开始日期', type: 'date', value: draft.startedOn, onChange: (value) => set({ startedOn: value }) }),
      h(TextField, { label: '截止日期', type: 'date', value: draft.dueDate, onChange: (value) => set({ dueDate: value }) })
    ),
    h(FieldRow, { key: 'row3' },
      h(TextField, { label: '进度 %', type: 'number', min: 0, max: 100, value: draft.progress, onChange: (value) => set({ progress: value }) }),
      h(TextField, { label: '链接', value: draft.link, onChange: (value) => set({ link: value }), placeholder: '需求文档 / 看板地址' })
    ),
    h(TextArea, { key: 'summary', label: '说明', value: draft.summary, onChange: (value) => set({ summary: value }), placeholder: '这个项目要解决什么、边界是什么' })
  ]

  const orderFields = [
    h(TextField, { key: 'title', label: '工单标题', value: draft.title, onChange: (value) => set({ title: value }), placeholder: '例如：转账限额调整（含人脸复核）' }),
    h(FieldRow, { key: 'row1' },
      h(Select, { label: '所属项目', value: draft.projectId, onChange: (value) => set({ projectId: value }), options: projects.map((project) => ({ value: project.id, label: project.name })), allowEmpty: true, emptyLabel: '未归项目' }),
      h(Select, { label: '类型', value: draft.kind, onChange: (value) => set({ kind: value }), options: toOptions(ORDER_KINDS) }),
      h(Select, { label: '优先级', value: draft.priority, onChange: (value) => set({ priority: value }), options: toOptions(PRIORITIES) })
    ),
    h(FieldRow, { key: 'row2' },
      h(Select, { label: '阶段', value: draft.stage, onChange: (value) => set({ stage: value }), options: toOptions(ORDER_STAGES) }),
      h(Select, { label: '目标端', value: draft.target, onChange: (value) => set({ target: value }), options: toOptions(PLATFORMS), allowEmpty: true, emptyLabel: '未指定' }),
      h(TextField, { label: '负责人', value: draft.owner, onChange: (value) => set({ owner: value }) })
    ),
    h(FieldRow, { key: 'row3' },
      h(TextField, { label: '预估人日', type: 'number', min: 0, value: draft.estDays, onChange: (value) => set({ estDays: value }) }),
      h(TextField, { label: '期望截止', type: 'date', value: draft.dueDate, onChange: (value) => set({ dueDate: value }) })
    ),
    h(TextArea, { key: 'description', label: '描述', value: draft.description, onChange: (value) => set({ description: value }), placeholder: '变更点、验收口径、影响范围' })
  ]

  const planFields = [
    h(TextField, { key: 'title', label: '计划标题', value: draft.title, onChange: (value) => set({ title: value }), placeholder: '例如：与后端确认限额分级口径' }),
    h(FieldRow, { key: 'row1' },
      h(Select, { label: '所属项目', value: draft.projectId, onChange: (value) => set({ projectId: value, orderId: '' }), options: projects.map((project) => ({ value: project.id, label: project.name })), allowEmpty: true, emptyLabel: '未归项目' }),
      h(Select, { label: '关联工单', value: draft.orderId, onChange: (value) => set({ orderId: value }), options: relatedOrders.map((order) => ({ value: order.id, label: order.title })), allowEmpty: true, emptyLabel: '不关联' }),
      h(Select, { label: '状态', value: draft.status, onChange: (value) => set({ status: value }), options: toOptions(PLAN_STATUS) })
    ),
    h(FieldRow, { key: 'row2' },
      h(TextField, { label: '负责人', value: draft.owner, onChange: (value) => set({ owner: value }) }),
      h(TextField, { label: '开始日期', type: 'date', value: draft.startedOn, onChange: (value) => set({ startedOn: value }) }),
      h(TextField, { label: '截止日期', type: 'date', value: draft.dueDate, onChange: (value) => set({ dueDate: value }) })
    ),
    h(TextField, { key: 'progress', label: '进度 %', type: 'number', min: 0, max: 100, value: draft.progress, onChange: (value) => set({ progress: value }) }),
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

function ConfirmModal({ payload, onClose, onConfirm }) {
  const label = payload.type === 'clear'
    ? '清空所有数据（项目、工单、计划、进展记录）'
    : payload.type === 'project'
      ? '删除该项目及其下的工单、计划与进展记录'
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
