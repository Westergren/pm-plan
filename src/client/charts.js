/**
 * 手写 SVG/CSS 图表：环形分布、条形排行、甘特时间线。
 * 不引入图表库，避免给客户端打包体积和宿主基线添麻烦。
 */

import { riskTone } from '../shared/metrics.js'
import { daysBetween, formatShortDate } from '../shared/date.js'

const h = require('react').createElement

const TONE_COLOR = {
  danger: 'var(--pm-danger)',
  warn: 'var(--pm-warn)',
  info: 'var(--pm-info)',
  ok: 'var(--pm-ok)',
  muted: 'var(--pm-border-strong)'
}

export function Donut({ slices, size = 132, thickness = 16, centerLabel, centerHint }) {
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

export function BarList({ rows, emptyText = '暂无数据' }) {
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
export function StackedBars({ rows, emptyText = '暂无数据' }) {
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

export function Timeline({ model, onOpen }) {
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
