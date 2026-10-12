/**
 * 视图层纯函数：模块轴（左侧导航）、智能视图、搜索、分组与排序。
 */

import { DONE_PLAN_STATUS, DONE_STAGES, PLATFORMS } from './model.js'
import {
  decorateProjects,
  isOrderDone,
  isPlanDone,
  isProjectDone,
  needsAttention,
  orderRisk,
  planRisk,
  priorityRank,
  projectRisk,
  riskRank
} from './metrics.js'
import { endOfWeek, startOfWeek, todayISO } from './date.js'

/** 固定模块轴：项目按 `module` 字段归入其中之一，缺省归「公司项目」。 */
export const MODULES = ['公司项目', '移动端开发', '日常工作', '其他项目']

export const SMART_VIEWS = [
  // 'all' 是「在管」口径：与 kpis.active 一致，默认排除已完成的项目/工单/计划。
  // 想看已完成请用 'done'；左侧「模块」轴的「全部」才是不分状态的全量口径。
  { id: 'all', label: '在管' },
  { id: 'attention', label: '需关注' },
  { id: 'overdue', label: '已逾期' },
  { id: 'week', label: '本周到期' },
  { id: 'unscheduled', label: '未排期' },
  { id: 'done', label: '已完成' }
]

export function moduleOf(project) {
  const value = project && project.module ? String(project.module).trim() : ''
  return value || MODULES[0]
}

/** 左侧「模块」轴：全部 + 固定模块 + 数据里出现过的自定义模块，带项目数与风险点。 */
export function moduleAxis(projects, orders, plans, today = todayISO()) {
  const decorated = decorateProjects(projects, orders, plans, today)
  const names = [...MODULES]
  for (const project of decorated) {
    const name = moduleOf(project)
    if (!names.includes(name)) names.push(name)
  }
  const rows = names.map((name) => {
    const items = decorated.filter((project) => moduleOf(project) === name)
    const ids = new Set(items.map((project) => project.id))
    return {
      id: name,
      label: name,
      count: items.length,
      attention: items.filter((project) => project.attention).length,
      openOrders: orders.filter((order) => !isOrderDone(order) && ids.has(order.projectId)).length,
      openPlans: plans.filter((plan) => !isPlanDone(plan) && ids.has(plan.projectId)).length
    }
  })
  return [
    {
      id: '',
      label: '全部',
      count: decorated.length,
      attention: decorated.filter((project) => project.attention).length,
      openOrders: orders.filter((order) => !isOrderDone(order)).length,
      openPlans: plans.filter((plan) => !isPlanDone(plan)).length
    },
    ...rows
  ]
}

export function inModule(project, moduleId) {
  return !moduleId || moduleOf(project) === moduleId
}

function matchesKeyword(text, keyword) {
  return String(text || '').toLowerCase().includes(keyword)
}

/**
 * 智能视图过滤。`moduleId`/`platform` 决定项目范围，`view` 决定保留哪些条目，
 * `search` 对项目、工单、计划同时生效（命中项目则保留其下条目）。
 * 返回 `{ projects, orders, plans }`，三者口径一致。
 */
export function applyView(projects, orders, plans, { moduleId = '', view = 'all', platform = '', search = '' } = {}, today = todayISO()) {
  const weekEnd = endOfWeek(today)
  let scoped = projects.filter((project) => inModule(project, moduleId))
  if (platform) scoped = scoped.filter((project) => project.platform === platform)

  const keyword = String(search || '').trim().toLowerCase()
  let scopedOrders = []
  let scopedPlans = []
  if (keyword) {
    scoped = scoped.filter((project) =>
      matchesKeyword([project.name, project.summary, project.owner, project.platform, ...(project.tags || [])].join(' '), keyword)
    )
    const hitIds = new Set(scoped.map((project) => project.id))
    for (const order of orders) {
      if (matchesKeyword([order.title, order.description, order.owner, order.stage, order.kind, order.priority].join(' '), keyword)) hitIds.add(order.projectId)
    }
    for (const plan of plans) {
      if (matchesKeyword([plan.title, plan.note, plan.owner, plan.status].join(' '), keyword)) hitIds.add(plan.projectId)
    }
    scoped = projects.filter((project) => inModule(project, moduleId) && (!platform || project.platform === platform) && (hitIds.has(project.id) || scoped.some((item) => item.id === project.id)))
    if (!scoped.length) {
      scoped = projects.filter((project) => inModule(project, moduleId) && (!platform || project.platform === platform) && hitIds.has(project.id))
    }
    const scopedIds = new Set(scoped.map((project) => project.id))
    scopedOrders = orders.filter((order) => scopedIds.has(order.projectId) || (!order.projectId && matchesKeyword(order.title, keyword)))
    scopedPlans = plans.filter((plan) => scopedIds.has(plan.projectId) || (!plan.projectId && matchesKeyword(plan.title, keyword)))
  } else {
    const scopedIds = new Set(scoped.map((project) => project.id))
    scopedOrders = orders.filter((order) => !order.projectId || scopedIds.has(order.projectId))
    scopedPlans = plans.filter((plan) => !plan.projectId || scopedIds.has(plan.projectId))
  }

  if (view === 'attention') {
    scoped = scoped.filter((project) => needsAttention(projectRisk(project, orders, plans, today)))
    scopedOrders = scopedOrders.filter((order) => needsAttention(orderRisk(order, today)))
    scopedPlans = scopedPlans.filter((plan) => needsAttention(planRisk(plan, today)))
  } else if (view === 'overdue') {
    // 「已逾期」按自身截止日期判断：项目不会因为挂了逾期工单而被列进来。
    scoped = scoped.filter((project) => Boolean(project.dueDate) && project.dueDate < today)
    scopedOrders = scopedOrders.filter((order) => orderRisk(order, today) === '已逾期')
    scopedPlans = scopedPlans.filter((plan) => planRisk(plan, today) === '已逾期')
  } else if (view === 'week') {
    const inWeek = (date) => Boolean(date) && date >= today && date <= weekEnd
    const weekOrders = scopedOrders.filter((order) => inWeek(order.dueDate))
    const weekPlans = scopedPlans.filter((plan) => inWeek(plan.dueDate))
    scoped = scoped.filter((project) =>
      inWeek(project.dueDate) ||
      weekOrders.some((order) => order.projectId === project.id) ||
      weekPlans.some((plan) => plan.projectId === project.id)
    )
    scopedOrders = weekOrders
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
  } else {
    scoped = scoped.filter((project) => !isProjectDone(project))
    scopedOrders = scopedOrders.filter((order) => !isOrderDone(order))
    scopedPlans = scopedPlans.filter((plan) => !isPlanDone(plan))
  }

  return { projects: scoped, orders: scopedOrders, plans: scopedPlans }
}

/** 智能视图计数（跟随模块与平台筛选）。 */
export function smartCounts(projects, orders, plans, { moduleId = '', platform = '' } = {}, today = todayISO()) {
  return SMART_VIEWS.map((view) => {
    const scoped = applyView(projects, orders, plans, { moduleId, view: view.id, platform }, today)
    return {
      ...view,
      count: view.id === 'all' ? scoped.projects.length : scoped.projects.length + scoped.orders.length + scoped.plans.length
    }
  })
}

/** 按模块分区（模块看板）。 */
export function groupByModule(projects, orders, plans, today = todayISO()) {
  const decorated = decorateProjects(projects, orders, plans, today)
  const names = [...MODULES]
  for (const project of decorated) {
    const name = moduleOf(project)
    if (!names.includes(name)) names.push(name)
  }
  const groups = []
  for (const name of names) {
    const items = decorated
      .filter((project) => moduleOf(project) === name)
      .sort((left, right) => riskRank(left.risk) - riskRank(right.risk) || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
    if (!items.length) continue
    groups.push({ module: name, items, count: items.length })
  }
  return groups
}

/** 按平台分区（多端视角）。 */
export function groupByPlatform(projects, orders, plans, today = todayISO()) {
  const decorated = decorateProjects(projects, orders, plans, today)
  const groups = []
  for (const name of PLATFORMS) {
    const items = decorated
      .filter((project) => project.platform === name)
      .sort((left, right) => riskRank(left.risk) - riskRank(right.risk) || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
    if (!items.length) continue
    groups.push({ platform: name, items, count: items.length })
  }
  return groups
}

export function attachProjectName(items, projects) {
  const names = new Map(projects.map((project) => [project.id, project.name]))
  return items.map((item) => ({ ...item, projectName: names.get(item.projectId) || '未归项目' }))
}

export function sortOrders(orders, projects, today = todayISO(), mode = 'risk') {
  const items = attachProjectName(orders.map((order) => ({ ...order, risk: orderRisk(order, today) })), projects)
  if (mode === 'due') return items.sort((left, right) => (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
  if (mode === 'priority') return items.sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority) || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
  if (mode === 'stage') return items.sort((left, right) => left.stage.localeCompare(right.stage, 'zh-Hans-CN') || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
  return items.sort((left, right) => riskRank(left.risk) - riskRank(right.risk) || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
}

export function sortPlans(plans, projects, today = todayISO(), mode = 'risk') {
  const items = attachProjectName(plans.map((plan) => ({ ...plan, risk: planRisk(plan, today) })), projects)
  if (mode === 'due') return items.sort((left, right) => (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
  if (mode === 'status') return items.sort((left, right) => left.status.localeCompare(right.status, 'zh-Hans-CN') || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
  return items.sort((left, right) => riskRank(left.risk) - riskRank(right.risk) || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
}

/** 本周视图：按天分桶（周一到周日）。 */
export function weekBoard(orders, plans, projects, today = todayISO()) {
  const names = new Map(projects.map((project) => [project.id, project.name]))
  const start = startOfWeek(today)
  const days = []
  for (let index = 0; index < 7; index += 1) {
    const date = addDaysLocal(start, index)
    const items = []
    for (const order of orders) {
      if (isOrderDone(order) || order.dueDate !== date) continue
      items.push({
        kind: 'order', id: order.id, title: order.title, risk: orderRisk(order, today),
        projectName: names.get(order.projectId) || '未归项目', owner: order.owner, meta: `${order.stage} · ${order.priority}`
      })
    }
    for (const plan of plans) {
      if (isPlanDone(plan) || plan.dueDate !== date) continue
      items.push({
        kind: 'plan', id: plan.id, title: plan.title, risk: planRisk(plan, today),
        projectName: names.get(plan.projectId) || '未归项目', owner: plan.owner, meta: `${plan.status} · ${plan.progress}%`
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

export { DONE_PLAN_STATUS, DONE_STAGES }
