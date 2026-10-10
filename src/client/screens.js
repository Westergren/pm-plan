/**
 * 七个业务页签的视图组件。
 *
 * 全部是纯展示：数据与回调都来自面板，组件自己不读写本机数据。
 */

import { useState } from 'react'
import { Badge, Button, Card, Empty, Kpi, Progress, Select, TextArea } from './ui.js'
import { BarList, Donut, StackedBars } from './charts.js'
import {
  RISK_TONE,
  headline,
  orderBoardColumns,
  orderRisk,
  ownerWorkload,
  planRisk,
  platformLoad,
  projectRisk,
  riskBreakdown,
  riskItems,
  statusColumns,
  todayBuckets
} from '../shared/metrics.js'
import { groupByModule, groupByPlatform, sortOrders, sortPlans, weekBoard } from '../shared/views.js'
import { REPORT_KINDS } from '../shared/report.js'
import { WEEKDAY_LABELS, formatDate, formatDayLabel, formatShortDate, monthGrid, shiftMonth } from '../shared/date.js'
import { PLAN_STATUS } from '../shared/model.js'

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

/* ---------------- 概览 ---------------- */

export function OverviewScreen(props) {
  const { projects, orders, plans, scoped, stats, summaryLine, today, onOpenProject, onOpenOrder, onOpenPlan, onSetView } = props
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const breakdown = riskBreakdown(scoped.projects, scoped.orders, scoped.plans, today)
  const modules = groupByModule(scoped.projects, scoped.orders, scoped.plans, today)
  const platforms = platformLoad(scoped.projects, scoped.orders, today)
  const owners = ownerWorkload(scoped.projects, scoped.orders, scoped.plans, today)
  const board = weekBoard(scoped.orders, scoped.plans, scoped.projects, today)
  const buckets = todayBuckets(scoped.projects, scoped.orders, scoped.plans, today)
  const handlers = { onOpenProject, onOpenOrder, onOpenPlan }
  const decorated = scoped.projects.map((project) => ({ ...project, risk: projectRisk(project, orders, plans, today) }))

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
      hits.push(overdue.length ? `逾期 ${overdue.length} 项：${overdue.map((item) => `${item.title}（${item.projectName}）`).join('；')}` : '当前没有逾期项。')
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
      meta: `${item.projectName} · ${item.owner || '未指派'}`,
      onClick: () => openItem(item, handlers)
    }))
  )

  return [
    h('div', { className: 'pmplan-kpis', key: 'kpis' },
      h(Kpi, { key: 'a', label: '在管项目', value: stats.active, hint: `共 ${stats.projects} 个` }),
      h(Kpi, { key: 'b', label: '需关注', value: stats.attention, hint: `逾期 ${stats.overdue}`, tone: stats.attention ? 'danger' : undefined }),
      h(Kpi, { key: 'c', label: '未结束工单', value: stats.orderOpen, hint: `逾期 ${stats.orderOverdue}` }),
      h(Kpi, { key: 'd', label: '未完成计划', value: stats.planOpen, hint: `本周到期 ${stats.planWeek}` }),
      h(Kpi, { key: 'e', label: '平均进度', value: `${stats.avgProgress}%` }),
      h(Kpi, { key: 'f', label: '未排期', value: stats.unscheduled, hint: '缺开始或截止' })
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
            total: group.items.length,
            segments: [{ label: '项目', value: group.items.length, tone: 'info' }],
            text: `${group.items.length} 个`
          })),
          emptyText: '还没有项目。'
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
                    `${item.projectName} · ${item.meta}`
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

export function ProjectsScreen(props) {
  const { scoped, orders, plans, today, onOpenProject, onOpenOrder, onOpenPlan, onEditProject, onDelete, smart } = props
  const [grouping, setGrouping] = useState('module')
  const [expanded, setExpanded] = useState('')
  const groups = grouping === 'platform'
    ? groupByPlatform(scoped.projects, scoped.orders, scoped.plans, today)
    : statusColumns(scoped.projects, scoped.orders, scoped.plans, today).length && grouping === 'status'
      ? statusColumns(scoped.projects, scoped.orders, scoped.plans, today).map((column) => ({ module: column.status, items: column.items, count: column.count }))
      : groupByModule(scoped.projects, scoped.orders, scoped.plans, today)

  const visible = groups.filter((group) => group.count)

  return [
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
          text: smart === 'all' ? '当前筛选下没有项目。' : '该视图下没有项目。',
          action: h(Button, { variant: 'primary', onClick: () => onEditProject(null) }, '新建项目')
        })
      : visible.map((group) => {
          const name = group.module || group.platform
          const isOpen = expanded === name
          return h('section', { className: 'pmplan-module-section', key: name },
            h('div', { className: 'pmplan-module-head' },
              h('span', { className: 'pmplan-module-name' }, name),
              h(Badge, { tone: 'muted', children: `${group.count} 个` }),
              h('span', { className: 'pmplan-spacer' }),
              h(Button, { size: 'small', variant: 'ghost', onClick: () => setExpanded(isOpen ? '' : name) }, isOpen ? '收起明细' : '展开明细')
            ),
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
                h('div', { className: 'pmplan-row pmplan-small pmplan-muted' },
                  `${project.platform} · ${project.status} · ${project.owner}`,
                  h('span', { className: 'pmplan-spacer' }),
                  project.dueDate ? `截止 ${formatDate(project.dueDate)}` : '未排期'
                ),
                h('div', { className: 'pmplan-row', style: { marginTop: 6 } },
                  h('span', { style: { flex: '1 1 auto' } }, h(Progress, { value: project.progress, tone: toneOf(project.risk) })),
                  h('span', { className: 'pmplan-small pmplan-nums' }, `${project.progress}%`)
                ),
                h('div', { className: 'pmplan-row pmplan-small pmplan-muted' },
                  `工单 ${project.orderOpen}/${project.orderTotal} 未结束`,
                  `计划 ${project.planOpen}/${project.planTotal} 未完成`
                ),
                isOpen
                  ? h('div', { className: 'pmplan-col', style: { marginTop: 6 } },
                      orders.filter((order) => order.projectId === project.id).map((order) => h('button', {
                        key: order.id,
                        type: 'button',
                        className: 'pmplan-item',
                        onClick: () => onOpenOrder(order.id)
                      },
                        h('span', { className: 'pmplan-item-title' }, order.title),
                        h('span', { className: 'pmplan-item-meta' },
                          h(Badge, { tone: toneOf(orderRisk(order, today)), children: orderRisk(order, today) }),
                          `${order.stage} · ${formatShortDate(order.dueDate)}`
                        )
                      )),
                      plans.filter((plan) => plan.projectId === project.id).map((plan) => h('button', {
                        key: plan.id,
                        type: 'button',
                        className: 'pmplan-item',
                        onClick: () => onOpenPlan(plan.id)
                      },
                        h('span', { className: 'pmplan-item-title' }, plan.title),
                        h('span', { className: 'pmplan-item-meta' },
                          h(Badge, { tone: toneOf(planRisk(plan, today)), children: planRisk(plan, today) }),
                          `${plan.status} · ${plan.progress}%`
                        )
                      ))
                    )
                  : null,
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

export function OrdersScreen(props) {
  const { scoped, projects, today, onOpenOrder, onEditOrder, onDelete } = props
  const [mode, setMode] = useState('table')
  const [sortMode, setSortMode] = useState('risk')
  const rows = sortOrders(scoped.orders, projects, today, sortMode)
  const columns = orderBoardColumns(scoped.orders, projects, today)

  return [
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
                h('th', null, '工单'),
                h('th', null, '项目'),
                h('th', null, '类型'),
                h('th', null, '优先级'),
                h('th', null, '阶段'),
                h('th', null, '负责人'),
                h('th', null, '截止'),
                h('th', null, '风险'),
                h('th', { className: 'pmplan-cell-actions' }, '操作')
              )),
              h('tbody', null, rows.map((order) => h('tr', { key: order.id },
                h('td', { className: 'pmplan-title-cell' },
                  h('button', { type: 'button', className: 'pmplan-btn', 'data-variant': 'ghost', style: { padding: 0 }, onClick: () => onOpenOrder(order.id) }, order.title)
                ),
                h('td', { className: 'pmplan-muted' }, order.projectName),
                h('td', null, order.kind),
                h('td', null, h(Badge, { tone: order.priority === '紧急' ? 'danger' : order.priority === '高' ? 'warn' : 'muted', children: order.priority })),
                h('td', null, h(Badge, { tone: 'info', children: order.stage })),
                h('td', { className: 'pmplan-muted' }, order.owner || '未指派'),
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
                      h('button', { type: 'button', className: 'pmplan-btn', 'data-variant': 'ghost', style: { padding: 0, textAlign: 'left' }, onClick: () => onOpenOrder(order.id) },
                        h('span', { className: 'pmplan-item-title' }, order.title)
                      ),
                      h('span', { className: 'pmplan-item-meta' },
                        h(Badge, { tone: toneOf(order.risk), children: order.risk }),
                        `${order.projectName} · ${order.priority}`
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

export function PlansScreen(props) {
  const { scoped, projects, today, onOpenPlan, onEditPlan, onDelete, onTogglePlan } = props
  const [mode, setMode] = useState('table')
  const [sortMode, setSortMode] = useState('risk')
  const rows = sortPlans(scoped.plans, projects, today, sortMode)
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
                h('th', null, '项目'),
                h('th', null, '状态'),
                h('th', null, '进度'),
                h('th', null, '负责人'),
                h('th', null, '截止'),
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
                h('td', { className: 'pmplan-muted' }, plan.projectName),
                h('td', null, h(Badge, { tone: plan.status === '已完成' ? 'ok' : plan.status === '进行中' ? 'info' : 'muted', children: plan.status })),
                h('td', { style: { width: 120 } },
                  h('div', { className: 'pmplan-row' },
                    h(Progress, { value: plan.progress, tone: toneOf(plan.risk) }),
                    h('span', { className: 'pmplan-small pmplan-nums' }, `${plan.progress}%`)
                  )
                ),
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
                      h('button', { type: 'button', className: 'pmplan-btn', 'data-variant': 'ghost', style: { padding: 0, textAlign: 'left' }, onClick: () => onOpenPlan(plan.id) },
                        h('span', { className: 'pmplan-item-title' }, plan.title)
                      ),
                      h('span', { className: 'pmplan-item-meta' },
                        h(Badge, { tone: toneOf(plan.risk), children: plan.risk }),
                        plan.projectName
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

export function CalendarScreen(props) {
  const { scoped, projects, orders, plans, today, onOpenProject, onOpenOrder, onOpenPlan, calendarMonth, setCalendarMonth } = props
  const grid = monthGrid(calendarMonth)
  const names = new Map(projects.map((project) => [project.id, project.name]))
  const items = new Map()
  const push = (date, item) => {
    if (!date) return
    if (!items.has(date)) items.set(date, [])
    items.get(date).push(item)
  }
  for (const plan of scoped.plans) {
    if (plan.status === '已完成' || plan.status === '已取消' || !plan.dueDate) continue
    push(plan.dueDate, { kind: 'plan', id: plan.id, title: plan.title, risk: planRisk(plan, today), projectName: names.get(plan.projectId) || '未归项目' })
  }
  for (const order of scoped.orders) {
    if (order.stage === '已上线' || order.stage === '已取消' || !order.dueDate) continue
    push(order.dueDate, { kind: 'order', id: order.id, title: order.title, risk: orderRisk(order, today), projectName: names.get(order.projectId) || '未归项目' })
  }
  for (const project of scoped.projects) {
    if (project.status === '已完成' || !project.dueDate) continue
    push(project.dueDate, { kind: 'project', id: project.id, title: `截止：${project.name}`, risk: projectRisk(project, orders, plans, today), projectName: project.name })
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
              title: `${item.title}｜${item.projectName}｜${item.risk}`,
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

export function RisksScreen(props) {
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
            meta: `${item.kind === 'project' ? '项目' : item.kind === 'order' ? '工单' : '计划'} · ${item.projectName} · ${formatDate(item.dueDate, '未排期')} · ${item.owner || '未指派'}`,
            onClick: () => openItem(item, handlers)
          })))
        : h('div', { className: 'pmplan-small pmplan-muted' }, '无')
    ))
  ]
}

/* ---------------- 汇报 ---------------- */

export function ReportsScreen(props) {
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

export { toneOf }
