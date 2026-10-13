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

export const STATE_VERSION = 1

export const PROJECT_STATUS = ['进行中', '待启动', '阻塞', '暂停', '已完成']

/**
 * 模块轴的出厂默认值。模块与端都是**用户可配置项**：真实取值随状态一起落盘在
 * `config` 里，这两个常量只在首次生成状态、以及状态里缺字段时兜底。
 */
export const DEFAULT_MODULES = ['公司项目', '移动端开发', '日常工作', '其他项目']

/** 端的出厂默认值。 */
export const DEFAULT_PLATFORMS = ['移动手机', '移动 PAD', '小程序', 'PC Web', '其他']

/** 单个名称的长度上限、一个维度的条目数上限，防止状态文件被撑坏。 */
export const MAX_DIMENSION_LENGTH = 40
export const MAX_DIMENSION_ITEMS = 24

/** 项目编号 / 工单编号的长度上限。 */
export const MAX_CODE_LENGTH = 40

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
export function normalizeState(raw, { now = new Date().toISOString() } = {}) {
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

export function byId(list, id) {
  return list.find((item) => item.id === id) || null
}

export function nextStage(stage) {
  const index = STAGE_FLOW.indexOf(stage)
  if (index < 0 || index >= STAGE_FLOW.length - 1) return ''
  return STAGE_FLOW[index + 1]
}
