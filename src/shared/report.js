/**
 * 周报 / 季报 / 项目状态汇报的文档草稿：纯字符串生成，不依赖宿主。
 */

import {
  decorateProjects,
  isOrderDone,
  isPlanDone,
  kpis,
  orderRisk,
  ownerWorkload,
  planRisk,
  platformLoad,
  projectRisk,
  riskItems,
  riskRank
} from './metrics.js'
import { addDays, endOfWeek, formatDate, monthKey, quarterKey, startOfWeek, todayISO } from './date.js'

const KIND_LABEL = { project: '项目', order: '工单', plan: '计划' }

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
export function periodStats(projects, orders, plans, from, to, today = todayISO()) {
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
export function weeklyReport(projects, orders, plans, today = todayISO(), options = {}) {
  const from = options.from || startOfWeek(today)
  const to = options.to || endOfWeek(today)
  const stats = periodStats(projects, orders, plans, from, to, today)
  const data = kpis(projects, orders, plans, today)
  const decorated = decorateProjects(projects, orders, plans, today)
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
    lines.push(bullet(overdue, (item) => `**已逾期** ${KIND_LABEL[item.kind]}：${item.title}（${item.projectName}｜截止 ${formatDate(item.dueDate)}）`, 10))
    lines.push(bullet(attention, (item) => `${riskBadge(item.risk)}${KIND_LABEL[item.kind]}：${item.title}（${item.projectName}｜截止 ${formatDate(item.dueDate)}）`, 10))
    // riskItems 的条目已经带 title/projectName，直接展开即可
  }

  lines.push('## 五、下周计划\n')
  const nextFrom = addDays(to, 1)
  const weekEndNext = endOfWeek(nextFrom)
  const next = riskItems(projects, orders, plans, today).filter((item) => item.dueDate && item.dueDate >= nextFrom && item.dueDate <= weekEndNext).map((item) => ({ ...item }))
  lines.push(bullet(next, (item) => `${KIND_LABEL[item.kind]}：${item.title}（${item.projectName}｜截止 ${formatDate(item.dueDate)}）`, 12))

  lines.push('## 六、需要支持\n')
  if (blocked.length) {
    lines.push(bullet(blocked, (project) => `${project.name}：${project.summary || '需要协调资源或决策'}`, 6))
  } else {
    lines.push('- 无阻塞项\n')
  }
  return lines.join('\n')
}

/** 季报：按季度区间聚合。 */
export function quarterlyReport(projects, orders, plans, today = todayISO(), options = {}) {
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
  lines.push(bullet(risks, (item) => `${riskBadge(item.risk)}${KIND_LABEL[item.kind]}：${item.title}（${item.projectName}｜截止 ${formatDate(item.dueDate)}）`, 12))
  return lines.join('\n')
}

/** 单项目状态汇报。 */
export function projectReport(project, orders, plans, logs, today = todayISO()) {
  const relatedOrders = orders.filter((order) => order.projectId === project.id)
  const relatedPlans = plans.filter((plan) => plan.projectId === project.id)
  const relatedLogs = logs.filter((log) => (log.refType === 'project' && log.refId === project.id) || (log.refType === 'order' && relatedOrders.some((order) => order.id === log.refId)) || (log.refType === 'plan' && relatedPlans.some((plan) => plan.id === log.refId)))
  const risk = projectRisk(project, orders, plans, today)
  const lines = []
  lines.push(`# ${project.name} · 状态汇报\n`)
  lines.push(`汇报时间：${today}｜模块：${project.module || '未分类'}｜端：${project.platform}\n`)
  lines.push('## 基本信息\n')
  lines.push(`- 状态：${project.status}｜进度：${project.progress}%｜风险：${risk}`)
  lines.push(`- 负责人：${project.owner}｜起止：${formatDate(project.startedOn, '未填')} ~ ${formatDate(project.dueDate, '未填')}`)
  if (project.link) lines.push(`- 链接：${project.link}`)
  if (project.summary) lines.push(`- 说明：${project.summary}`)
  lines.push('')
  lines.push('## 需求与变更工单\n')
  lines.push(
    bullet(
      relatedOrders.sort((left, right) => riskRank(orderRisk(left, today)) - riskRank(orderRisk(right, today))),
      (order) => `${order.title}（${order.kind}｜${order.priority}｜${order.stage}｜截止 ${formatDate(order.dueDate)}）${riskBadge(orderRisk(order, today))}`,
      20
    )
  )
  lines.push('## 工作计划与跟进\n')
  lines.push(
    bullet(
      relatedPlans.sort((left, right) => riskRank(planRisk(left, today)) - riskRank(planRisk(right, today))),
      (plan) => `${plan.title}（${plan.status}｜${plan.progress}%｜截止 ${formatDate(plan.dueDate)}）${riskBadge(planRisk(plan, today))}`,
      20
    )
  )
  lines.push('## 最近进展\n')
  lines.push(bullet([...relatedLogs].sort((left, right) => (left.at < right.at ? 1 : -1)), (log) => `${log.at.slice(0, 10)}【${log.kind}】${log.text}`, 15))
  return lines.join('\n')
}

/** 汇报类型清单，供客户端下拉使用。 */
export const REPORT_KINDS = [
  { id: 'weekly', label: '工作周报' },
  { id: 'quarterly', label: '季度汇报' },
  { id: 'project', label: '项目状态汇报' }
]

export function buildReport(kind, data, context = {}) {
  const today = context.today || todayISO()
  if (kind === 'quarterly') return quarterlyReport(data.projects, data.orders, data.plans, today, context)
  if (kind === 'project') {
    const project = data.projects.find((item) => item.id === context.projectId) || data.projects[0]
    if (!project) return '# 没有可汇报的项目\n'
    return projectReport(project, data.orders, data.plans, data.logs || [], today)
  }
  return weeklyReport(data.projects, data.orders, data.plans, today, context)
}

export { monthKey, formatDate }
