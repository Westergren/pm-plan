/**
 * 风险与统计：全部是纯函数。
 *
 * 风险等级从高到低，`RISK_ORDER` 用于排序与配色：
 * 已逾期 > 阻塞 > 紧急（距截止 ≤ 2 天）> 进度风险（时间过半而进度落后 ≥ 30%）> 临近（≤ 5 天）> 未排期 > 正常 > 已完成/已取消
 */

import {
  DEFAULT_PLATFORMS,
  DONE_PLAN_STATUS,
  DONE_STAGES,
  PRIORITIES,
  PROJECT_STATUS,
  ORDER_STAGES,
  PLAN_STATUS
} from './model.js'
import { addDays, daysBetween, endOfWeek, todayISO } from './date.js'

export const RISK_LEVELS = ['已逾期', '阻塞', '紧急', '进度风险', '临近', '未排期', '正常', '已完成']

export const RISK_ORDER = RISK_LEVELS.reduce((accumulator, level, index) => {
  accumulator[level] = index
  return accumulator
}, {})

export const RISK_TONE = {
  已逾期: 'danger',
  阻塞: 'danger',
  紧急: 'warn',
  进度风险: 'warn',
  临近: 'info',
  未排期: 'muted',
  正常: 'ok',
  已完成: 'ok'
}

export const PRIORITY_TONE = { 紧急: 'danger', 高: 'warn', 中: 'info', 低: 'muted' }

export const STAGE_TONE = {
  待评审: 'muted',
  待排期: 'muted',
  开发中: 'info',
  联调中: 'info',
  测试中: 'warn',
  待上线: 'warn',
  已上线: 'ok',
  已取消: 'muted'
}

export function riskRank(level) {
  return RISK_ORDER[level] ?? RISK_LEVELS.length
}

export function isDone(stage) {
  return DONE_STAGES.includes(stage)
}

export function isOrderDone(order) {
  return isDone(order.stage)
}

export function isPlanDone(plan) {
  return DONE_PLAN_STATUS.includes(plan.status)
}

export function isProjectDone(project) {
  return project.status === '已完成'
}

/** 时间消耗比例：0–100，未排期返回 null。 */
export function timeRatio(startedOn, dueDate, today = todayISO()) {
  const total = daysBetween(startedOn, dueDate)
  if (total === null || total <= 0) return null
  const elapsed = daysBetween(startedOn, today)
  if (elapsed === null) return null
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)))
}

export function dateRiskLevel(dueDate, today = todayISO()) {
  if (!dueDate) return '未排期'
  const left = daysBetween(today, dueDate)
  if (left === null) return '未排期'
  if (left < 0) return '已逾期'
  if (left <= 2) return '紧急'
  if (left <= 5) return '临近'
  return '正常'
}

/** 工单风险：完成态直接给「已完成」，否则取时间风险、优先级、进度落后中最高的一档。 */
export function orderRisk(order, today = todayISO()) {
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
export function stageProgress(stage) {
  const index = ['待评审', '待排期', '开发中', '联调中', '测试中', '待上线', '已上线'].indexOf(stage)
  if (index < 0) return 100
  return [0, 10, 40, 60, 75, 90, 100][index]
}

/** 计划风险。 */
export function planRisk(plan, today = todayISO()) {
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
  const ratio = timeRatio(plan.startedOn, plan.dueDate, today)
  if (ratio !== null && ratio - plan.progress >= 30) return '进度风险'
  if (byDate === '临近') return '临近'
  if (!plan.dueDate) return plan.status === '进行中' ? '未排期' : '未排期'
  return '正常'
}

/** 项目风险：项目自身截止 + 其下未结束工单/计划里最严重的一档。 */
export function projectRisk(project, orders = [], plans = [], today = todayISO()) {
  if (isProjectDone(project)) return '已完成'
  if (project.status === '阻塞') return '阻塞'
  const levels = []
  const byDate = dateRiskLevel(project.dueDate, today)
  levels.push(byDate)
  if (project.status !== '待启动' && project.status !== '暂停' && project.dueDate) {
    const ratio = timeRatio(project.startedOn, project.dueDate, today)
    if (ratio !== null && ratio - project.progress >= 30) levels.push('进度风险')
  }
  for (const order of orders) {
    if (order.projectId !== project.id || isOrderDone(order)) continue
    levels.push(orderRisk(order, today))
  }
  for (const plan of plans) {
    if (plan.projectId !== project.id || isPlanDone(plan)) continue
    levels.push(planRisk(plan, today))
  }
  let worst = '正常'
  for (const level of levels) {
    if (riskRank(level) < riskRank(worst)) worst = level
  }
  if (worst === '正常' && !project.dueDate && !project.startedOn) return '未排期'
  return worst
}

export function riskTone(level) {
  return RISK_TONE[level] || 'muted'
}

/** 把一组带「需关注」判定的项目拆开：需关注 = 风险低于「正常」。 */
export function needsAttention(level) {
  return ['已逾期', '阻塞', '紧急', '进度风险'].includes(level)
}

export function decorateProjects(projects, orders, plans, today = todayISO()) {
  return projects.map((project) => {
    const relatedOrders = orders.filter((order) => order.projectId === project.id)
    const relatedPlans = plans.filter((plan) => plan.projectId === project.id)
    const risk = projectRisk(project, orders, plans, today)
    return {
      ...project,
      risk,
      attention: needsAttention(risk),
      orderTotal: relatedOrders.length,
      orderOpen: relatedOrders.filter((order) => !isOrderDone(order)).length,
      orderOverdue: relatedOrders.filter((order) => orderRisk(order, today) === '已逾期').length,
      planTotal: relatedPlans.length,
      planOpen: relatedPlans.filter((plan) => !isPlanDone(plan)).length,
      planOverdue: relatedPlans.filter((plan) => planRisk(plan, today) === '已逾期').length,
      daysLeft: project.dueDate ? daysBetween(today, project.dueDate) : null
    }
  })
}

export function kpis(projects, orders, plans, today = todayISO()) {
  const decorated = decorateProjects(projects, orders, plans, today)
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

export function riskBreakdown(projects, orders, plans, today = todayISO()) {
  const counts = new Map(RISK_LEVELS.map((level) => [level, 0]))
  for (const project of decorateProjects(projects, orders, plans, today)) {
    counts.set(project.risk, (counts.get(project.risk) || 0) + 1)
  }
  return RISK_LEVELS.map((level) => ({ level, count: counts.get(level) || 0, tone: riskTone(level) }))
}

/** 平台负载：按端统计项目数与未结束工单数。端列表来自配置项 + 数据里出现过的历史取值。 */
export function platformLoad(projects, orders, today = todayISO(), platforms = DEFAULT_PLATFORMS) {
  const names = [...platforms]
  for (const project of projects) {
    const name = String(project.platform == null ? '' : project.platform).trim()
    if (name && !names.includes(name)) names.push(name)
  }
  const rows = names.map((platform) => {
    const items = projects.filter((project) => project.platform === platform)
    const ids = new Set(items.map((project) => project.id))
    const related = orders.filter((order) => ids.has(order.projectId) && !isOrderDone(order))
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

export function ownerWorkload(projects, orders, plans, today = todayISO()) {
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
export function statusColumns(projects, orders, plans, today = todayISO()) {
  const decorated = decorateProjects(projects, orders, plans, today)
  return PROJECT_STATUS.map((status) => {
    const items = decorated
      .filter((project) => project.status === status)
      .sort((left, right) => riskRank(left.risk) - riskRank(right.risk) || (left.dueDate || '9999') .localeCompare(right.dueDate || '9999'))
    return { status, items, count: items.length }
  })
}

export function orderBoardColumns(orders, projects, today = todayISO()) {
  const projectName = new Map(projects.map((project) => [project.id, project.name]))
  return ORDER_STAGES.map((stage) => {
    const items = orders
      .filter((order) => order.stage === stage)
      .map((order) => ({ ...order, risk: orderRisk(order, today), projectName: projectName.get(order.projectId) || '未归项目' }))
      .sort((left, right) => riskRank(left.risk) - riskRank(right.risk) || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
    return { stage, items, count: items.length }
  })
}

/** 全部需要盯的条目，统一成一条，便于「风险中心」与「今天做什么」。 */
export function riskItems(projects, orders, plans, today = todayISO()) {
  const projectName = new Map(projects.map((project) => [project.id, project.name]))
  const items = []
  for (const project of decorateProjects(projects, orders, plans, today)) {
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
      projectName: project.name
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
      projectId: order.projectId,
      projectName: projectName.get(order.projectId) || '未归项目'
    })
  }
  for (const plan of plans) {
    const risk = planRisk(plan, today)
    if (!needsAttention(risk) && risk !== '临近') continue
    items.push({
      kind: 'plan',
      id: plan.id,
      title: plan.title,
      subtitle: `${plan.status} · 进度 ${plan.progress}%`,
      owner: plan.owner,
      dueDate: plan.dueDate,
      risk,
      tone: riskTone(risk),
      projectId: plan.projectId,
      projectName: projectName.get(plan.projectId) || '未归项目'
    })
  }
  return items.sort((left, right) => riskRank(left.risk) - riskRank(right.risk) || (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
}

/** 日历：把工单与计划落进日期格。 */
export function calendarItems(projects, orders, plans, today = todayISO()) {
  const projectName = new Map(projects.map((project) => [project.id, project.name]))
  const bucket = new Map()
  const push = (date, item) => {
    if (!date) return
    if (!bucket.has(date)) bucket.set(date, [])
    bucket.get(date).push(item)
  }
  for (const project of projects) {
    if (isProjectDone(project) || !project.dueDate) continue
    const risk = projectRisk(project, orders, plans, today)
    push(project.dueDate, {
      kind: 'project', id: project.id, date: project.dueDate, title: `项目截止：${project.name}`,
      risk, tone: riskTone(risk), projectId: project.id, projectName: project.name, owner: project.owner
    })
  }
  for (const order of orders) {
    if (isOrderDone(order) || !order.dueDate) continue
    const risk = orderRisk(order, today)
    push(order.dueDate, {
      kind: 'order', id: order.id, date: order.dueDate, title: order.title,
      risk, tone: riskTone(risk), projectId: order.projectId, projectName: projectName.get(order.projectId) || '未归项目', owner: order.owner
    })
  }
  for (const plan of plans) {
    if (isPlanDone(plan) || !plan.dueDate) continue
    const risk = planRisk(plan, today)
    push(plan.dueDate, {
      kind: 'plan', id: plan.id, date: plan.dueDate, title: plan.title,
      risk, tone: riskTone(risk), projectId: plan.projectId, projectName: projectName.get(plan.projectId) || '未归项目', owner: plan.owner
    })
  }
  return bucket
}

/** 甘特：每个项目一行，工单/计划作为子条。 */
export function timelineModel(projects, orders, plans, today = todayISO()) {
  const projectName = new Map(projects.map((project) => [project.id, project.name]))
  const useOrders = orders
    .map((order) => ({
      kind: 'order',
      id: order.id,
      title: order.title,
      projectId: order.projectId,
      projectName: projectName.get(order.projectId) || '未归项目',
      startedOn: order.createdAt ? order.createdAt.slice(0, 10) : today,
      dueDate: order.dueDate || order.createdAt?.slice(0, 10) || '',
      risk: orderRisk(order, today)
    }))
    .filter((item) => item.dueDate)
  const usePlans = plans
    .map((plan) => ({
      kind: 'plan',
      id: plan.id,
      title: plan.title,
      projectId: plan.projectId,
      projectName: projectName.get(plan.projectId) || '未归项目',
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
      projectName: project.name,
      startedOn: project.startedOn || project.dueDate,
      dueDate: project.dueDate || project.startedOn,
      risk: projectRisk(project, orders, plans, today),
      children: [...useOrders, ...usePlans].filter((item) => item.projectId === project.id)
    })
  }
  const all = [...rows, ...useOrders, ...usePlans]
  const dates = all.flatMap((item) => [item.startedOn, item.dueDate]).filter(Boolean)
  const min = dates.length ? dates.reduce((left, right) => (left < right ? left : right)) : today
  const max = dates.length ? dates.reduce((left, right) => (left > right ? left : right)) : today
  return { rows, from: addDays(min, -2), to: addDays(max, 2), today }
}

/** 「今天该做什么」：逾期的 + 今天到期的 + 本周内优先级高的。 */
export function todayBuckets(projects, orders, plans, today = todayISO()) {
  const items = riskItems(projects, orders, plans, today)
  const weekEnd = endOfWeek(today)
  const overdue = items.filter((item) => item.risk === '已逾期')
  const dueToday = items.filter((item) => item.dueDate === today)
  const thisWeek = items.filter((item) => item.dueDate && item.dueDate > today && item.dueDate <= weekEnd)
  const later = items.filter((item) => !item.dueDate || item.dueDate > weekEnd)
  return { overdue, dueToday, thisWeek, later }
}

export function priorityRank(priority) {
  const index = PRIORITIES.indexOf(priority)
  return index < 0 ? PRIORITIES.length : index
}

export function stageRank(stage) {
  const index = ORDER_STAGES.indexOf(stage)
  return index < 0 ? ORDER_STAGES.length : index
}

export function planStatusRank(status) {
  const index = PLAN_STATUS.indexOf(status)
  return index < 0 ? PLAN_STATUS.length : index
}

export function headline(projects, orders, plans, today = todayISO()) {
  const data = kpis(projects, orders, plans, today)
  if (data.projects === 0) return '还没有登记项目，先建一个项目，再把需求工单和计划挂上去。'
  if (data.overdue > 0) return `${data.projects} 个项目里 ${data.overdue} 个已逾期、${data.attention} 个需要盯；未结束工单 ${data.orderOpen} 条，其中逾期 ${data.orderOverdue} 条。`
  if (data.attention > 0) return `${data.projects} 个项目在跑，${data.attention} 个需要关注；本周到期工单 ${data.orderWeek} 条、计划 ${data.planWeek} 条。`
  return `${data.projects} 个项目节奏正常，平均进度 ${data.avgProgress}%；未结束工单 ${data.orderOpen} 条、计划 ${data.planOpen} 条。`
}
