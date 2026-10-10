/**
 * 业务数据模型：常量、ID 生成、结构收敛（normalize）。
 *
 * 数据落盘在 DSH 数据目录的 `pm-plan/state.json`，结构为：
 * {
 *   version, updatedAt,
 *   projects: [{ id, name, platform, status, owner, startedOn, dueDate, progress, link, summary, tags, createdAt, updatedAt }],
 *   orders:   [{ id, projectId, title, kind, priority, stage, owner, target, estDays, dueDate, description, createdAt, updatedAt }],
 *   plans:    [{ id, projectId, orderId, title, owner, status, startedOn, dueDate, progress, note, createdAt, updatedAt }],
 *   logs:     [{ id, refType, refId, at, kind, text }]
 * }
 */

export const STATE_VERSION = 1

export const PROJECT_STATUS = ['进行中', '待启动', '阻塞', '暂停', '已完成']

/** 模块轴：项目归入哪个业务模块，用于左侧导航与模块看板。 */
export const MODULES = ['公司项目', '移动端开发', '日常工作', '其他项目']

/** 多端项目：PC 与移动端分开登记，便于按端筛选。 */
export const PLATFORMS = ['移动手机', '移动 PAD', '小程序', 'PC Web', '其他']

export const ORDER_KINDS = ['迭代需求', '变更需求', '缺陷', '技术任务']

export const ORDER_STAGES = ['待评审', '待排期', '开发中', '联调中', '测试中', '待上线', '已上线', '已取消']

export const PRIORITIES = ['紧急', '高', '中', '低']

export const PLAN_STATUS = ['未开始', '进行中', '已完成', '已取消']

export const LOG_KINDS = ['进展', '阻塞', '决策', '变更', '上线']

/** 阶段顺序用于看板列与「推进到下一阶段」按钮；已取消不参与推进。 */
export const STAGE_FLOW = ['待评审', '待排期', '开发中', '联调中', '测试中', '待上线', '已上线']

export const DONE_STAGES = ['已上线', '已取消']

export const DONE_PLAN_STATUS = ['已完成', '已取消']

let idSeed = 0

/** 生成短 ID：前缀 + 时间戳 36 进制 + 进程内自增，够本地单人使用。 */
export function createId(prefix = 'id') {
  idSeed += 1
  const stamp = Date.now().toString(36)
  const seq = idSeed.toString(36)
  const rand = Math.random().toString(36).slice(2, 6)
  return `${prefix}-${stamp}${seq}${rand}`
}

export function emptyState(now = new Date().toISOString()) {
  return { version: STATE_VERSION, updatedAt: now, seededAt: '', projects: [], orders: [], plans: [], logs: [] }
}

function asText(value, fallback = '') {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function asEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

function asDate(value) {
  const text = asText(value).trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
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
export function normalizeState(raw, { now = new Date().toISOString() } = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const base = emptyState(now)
  const projects = []
  const orders = []
  const plans = []
  const logs = []

  const projectIds = new Set()
  for (const item of Array.isArray(source.projects) ? source.projects : []) {
    if (!item || typeof item !== 'object') continue
    const name = asText(item.name).trim().slice(0, 120)
    if (!name) continue
    const id = asText(item.id).trim() || createId('prj')
    if (projectIds.has(id)) continue
    projectIds.add(id)
    const moduleValue = asText(item.module).trim().slice(0, 40)
    projects.push({
      id,
      name,
      module: moduleValue || MODULES[0],
      platform: asEnum(item.platform, PLATFORMS, '其他'),
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
    orders.push({
      id,
      projectId: projectIds.has(projectId) ? projectId : '',
      title,
      kind: asEnum(item.kind, ORDER_KINDS, '迭代需求'),
      priority: asEnum(item.priority, PRIORITIES, '中'),
      stage: asEnum(item.stage, ORDER_STAGES, '待评审'),
      owner: asText(item.owner).trim().slice(0, 40),
      target: asEnum(item.target, [...PLATFORMS, ''], '') || '',
      estDays: Math.max(0, Math.min(365, Math.round(Number(item.estDays) || 0))),
      dueDate: asDate(item.dueDate),
      description: asText(item.description).slice(0, 2000),
      createdAt: asStamp(item.createdAt, now),
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
    const orderId = asText(item.orderId).trim()
    plans.push({
      id,
      projectId: projectIds.has(projectId) ? projectId : '',
      orderId: orderIds.has(orderId) ? orderId : '',
      title,
      owner: asText(item.owner).trim().slice(0, 40) || '我',
      status: asEnum(item.status, PLAN_STATUS, '未开始'),
      startedOn: asDate(item.startedOn),
      dueDate: asDate(item.dueDate),
      progress: asProgress(item.progress, 0),
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
    projects,
    orders,
    plans,
    logs
  }
}

/** 某个项目下未结束的工单数。 */
export function openOrdersOf(orders, projectId) {
  return orders.filter((order) => order.projectId === projectId && !DONE_STAGES.includes(order.stage))
}

/** 某个项目下未完成的计划数。 */
export function openPlansOf(plans, projectId) {
  return plans.filter((plan) => plan.projectId === projectId && !DONE_PLAN_STATUS.includes(plan.status))
}

export function byId(list, id) {
  return list.find((item) => item.id === id) || null
}

export function nextStage(stage) {
  const index = STAGE_FLOW.indexOf(stage)
  if (index < 0 || index >= STAGE_FLOW.length - 1) return ''
  return STAGE_FLOW[index + 1]
}

/** 由「已上线/已取消」工单占比推导项目进度建议值（用于一键同步）。 */
export function suggestedProgress(project, orders, plans) {
  const related = orders.filter((order) => order.projectId === project.id)
  const doneOrders = related.filter((order) => order.stage === '已上线').length
  const relatedPlans = plans.filter((plan) => plan.projectId === project.id)
  const donePlans = relatedPlans.filter((plan) => plan.status === '已完成').length
  const total = related.length + relatedPlans.length
  if (total === 0) return project.progress
  return Math.round(((doneOrders + donePlans) / total) * 100)
}
