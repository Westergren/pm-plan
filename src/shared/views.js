/**
 * 视图层纯函数：可配置维度（模块、端）的取值、智能视图、搜索、分组与排序。
 *
 * 模块与端的**取值来自 state.config**，函数一律把配置当作参数传入，
 * 并且始终把数据里出现过的历史取值并进列表——用户改配置不会让旧数据消失。
 */

import { DEFAULT_MODULES, DEFAULT_PLATFORMS, DONE_PLAN_STATUS, DONE_STAGES } from './model.js'
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

export const SMART_VIEWS = [
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

export function smartViewLabel(id) {
  const found = SMART_VIEWS.find((item) => item.id === id)
  return found ? found.label : ''
}

export function moduleOf(project, modules = DEFAULT_MODULES) {
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
export function moduleOptions(modules, projects, orders = []) {
  return mergeNames(modules, [
    ...projects.map((project) => moduleOf(project, modules)),
    ...orders.map((order) => order.module)
  ])
}

/** 「端」筛选条的取值列表（按项目实际登记的端）。 */
export function platformOptions(platforms, projects) {
  return mergeNames(platforms, projects.map((project) => project.platform))
}

/** 工单「目标端」筛选条的取值列表。 */
export function targetOptions(platforms, orders) {
  return mergeNames(platforms, orders.map((order) => order.target))
}

export function inModule(project, moduleId) {
  return !moduleId || moduleOf(project) === moduleId
}

/** 工单按它自己的 `module` 直接归口，不再经由所属项目。 */
export function inModuleName(value, moduleId) {
  return !moduleId || String(value == null ? '' : value).trim() === moduleId
}

function matchesKeyword(text, keyword) {
  return String(text || '').toLowerCase().includes(keyword)
}

/**
 * 智能视图过滤。`moduleId`/`platform` 决定项目范围（工单按自己的 `module` 归口），
 * `view` 决定保留哪些条目（空串 = 不套用智能视图，项目/工单/计划全部保留），
 * `target` 只收窄工单，`search` 对项目、工单、计划各自生效。
 * 返回 `{ projects, orders, plans }`，三者口径一致。
 */
export function applyView(projects, orders, plans, { moduleId = '', view = '', platform = '', target = '', search = '' } = {}, today = todayISO()) {
  const weekEnd = endOfWeek(today)
  let scoped = projects.filter((project) => inModule(project, moduleId))
  if (platform) scoped = scoped.filter((project) => project.platform === platform)

  const keyword = String(search || '').trim().toLowerCase()
  let scopedOrders = orders.filter((order) => inModuleName(order.module, moduleId))
  if (target) scopedOrders = scopedOrders.filter((order) => order.target === target)

  let scopedPlans = []
  if (keyword) {
    scoped = scoped.filter((project) =>
      matchesKeyword([project.code, project.name, project.summary, project.owner, project.platform, ...(project.tags || [])].join(' '), keyword)
    )
    // 工单按自己的内容（含挂的模块名）匹配即可，不再看它是否属于某个命中项目。
    scopedOrders = scopedOrders.filter((order) =>
      matchesKeyword([order.code, order.title, order.description, order.owner, order.stage, order.kind, order.priority, order.module].join(' '), keyword)
    )
    const scopedIds = new Set(scoped.map((project) => project.id))
    scopedPlans = plans.filter((plan) => scopedIds.has(plan.projectId) || (!plan.projectId && matchesKeyword(plan.title, keyword)))
  } else {
    const scopedIds = new Set(scoped.map((project) => project.id))
    scopedPlans = plans.filter((plan) => !plan.projectId || scopedIds.has(plan.projectId))
  }

  if (view === 'attention') {
    scoped = scoped.filter((project) => needsAttention(projectRisk(project, plans, today)))
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
    // 工单已经不在项目下面了，所以项目只看自己的投产日期与自己的计划。
    scoped = scoped.filter((project) => inWeek(project.dueDate) || weekPlans.some((plan) => plan.projectId === project.id))
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
export function projectSmartCounts(projects, orders, plans, { moduleId = '', platform = '' } = {}, today = todayISO()) {
  return SMART_VIEWS.map((view) => ({
    ...view,
    count: applyView(projects, orders, plans, { moduleId, view: view.id, platform }, today).projects.length
  }))
}

export function orderSmartCounts(projects, orders, plans, { moduleId = '', target = '' } = {}, today = todayISO()) {
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
export function groupByModule(projects, orders, plans, today = todayISO(), modules = DEFAULT_MODULES) {
  const decorated = decorateProjects(projects, plans, today)
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
export function groupByPlatform(projects, orders, plans, today = todayISO(), platforms = DEFAULT_PLATFORMS) {
  const decorated = decorateProjects(projects, plans, today)
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

/** 给计划补上所属项目名（计划仍然挂在项目下）。 */
export function attachProjectName(items, projects) {
  const names = new Map(projects.map((project) => [project.id, project.name]))
  return items.map((item) => ({ ...item, projectName: names.get(item.projectId) || '未归项目' }))
}

/** 给工单补上它挂的模块名（工单不再有归属项目，界面上显示的就是模块）。 */
export function attachModuleName(items) {
  return items.map((item) => ({ ...item, moduleName: item.module || '未归模块' }))
}

export function sortOrders(orders, today = todayISO(), mode = 'risk') {
  const items = attachModuleName(orders.map((order) => ({ ...order, risk: orderRisk(order, today) })))
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

/** 本周视图：按天分桶（周一到周日）。`sourceName` 是归属名——工单看模块，计划看项目。 */
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
        sourceName: order.module || '未归模块', owner: order.owner, meta: `${order.stage} · ${order.priority}`
      })
    }
    for (const plan of plans) {
      if (isPlanDone(plan) || plan.dueDate !== date) continue
      items.push({
        kind: 'plan', id: plan.id, title: plan.title, risk: planRisk(plan, today),
        sourceName: names.get(plan.projectId) || '未归项目', owner: plan.owner, meta: `${plan.status} · ${plan.progress}%`
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
