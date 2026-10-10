/**
 * 基础组件与样式注入。用 React.createElement，不依赖 JSX。
 */

import { styles } from './styles.js'

const React = require('react')

const h = React.createElement
const STYLE_ID = 'pm-plan-workbench-styles'

let styleInjected = false

/** 幂等注入样式；没有 document 的环境（Node 渲染自测）静默跳过。 */
export function injectStyles(doc) {
  if (styleInjected) return
  const target = doc || (typeof document !== 'undefined' ? document : null)
  if (!target || !target.head) return
  if (target.getElementById(STYLE_ID)) {
    styleInjected = true
    return
  }
  const element = target.createElement('style')
  element.id = STYLE_ID
  element.textContent = styles
  target.head.appendChild(element)
  styleInjected = true
}

export function cx(...values) {
  return values.filter(Boolean).join(' ')
}

export function Button({ variant, size, children, ...rest }) {
  return h('button', {
    type: 'button',
    className: 'pmplan-btn',
    'data-variant': variant || 'default',
    'data-size': size || '',
    ...rest
  }, children)
}

export function Badge({ tone = 'muted', children, title }) {
  return h('span', { className: 'pmplan-badge', 'data-tone': tone, title }, children)
}

export function Progress({ value = 0, tone = 'info', label }) {
  const width = Math.max(0, Math.min(100, Number(value) || 0))
  return h('div', {
    className: 'pmplan-progress',
    'data-tone': tone,
    role: 'progressbar',
    'aria-valuenow': width,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-label': label || `进度 ${width}%`
  }, h('span', { style: { width: `${width}%` } }))
}

export function TextField({ label, value, onChange, type = 'text', placeholder, min, max, className }) {
  return h('div', { className: cx('pmplan-field', className) },
    label ? h('label', null, label) : null,
    h('input', {
      className: 'pmplan-input',
      type,
      value: value ?? '',
      placeholder: placeholder || '',
      min,
      max,
      onChange: (event) => onChange?.(event.target.value)
    })
  )
}

export function TextArea({ label, value, onChange, placeholder, rows = 3 }) {
  return h('div', { className: 'pmplan-field' },
    label ? h('label', null, label) : null,
    h('textarea', {
      className: 'pmplan-textarea',
      value: value ?? '',
      rows,
      placeholder: placeholder || '',
      onChange: (event) => onChange?.(event.target.value)
    })
  )
}

export function Select({ label, value, onChange, options, allowEmpty, emptyLabel = '未指定', className }) {
  const items = allowEmpty ? [{ value: '', label: emptyLabel }, ...options] : options
  return h('div', { className: cx('pmplan-field', className) },
    label ? h('label', null, label) : null,
    h('select', {
      className: 'pmplan-select',
      value: value ?? '',
      onChange: (event) => onChange?.(event.target.value)
    }, items.map((item) => h('option', { key: String(item.value), value: item.value }, item.label)))
  )
}

export function FieldRow({ children }) {
  return h('div', { className: 'pmplan-field-row' }, children)
}

export function Card({ title, actions, children, className }) {
  const head = title || actions
    ? h('header', { className: 'pmplan-card-head' },
        title ? h('span', { className: 'pmplan-card-title' }, title) : null,
        h('span', { className: 'pmplan-spacer' }),
        actions || null
      )
    : null
  return h('section', { className: cx('pmplan-card', className) }, head, children)
}

export function Empty({ text, action }) {
  return h('div', { className: 'pmplan-empty' }, h('span', null, text), action || null)
}

/** 右侧抽屉式详情：覆盖在面板容器内，不越过宿主分配的主内容区。 */
export function Drawer({ title, subtitle, onClose, children, footer, closeLabel = '关闭' }) {
  return h('div', {
    className: 'pmplan-scrim',
    role: 'presentation',
    onClick: (event) => {
      if (event.target === event.currentTarget) onClose?.()
    }
  },
    h('aside', { className: 'pmplan-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', { className: 'pmplan-drawer-head' },
        h('div', { className: 'pmplan-col' },
          h('span', { className: 'pmplan-drawer-title' }, title),
          subtitle ? h('span', { className: 'pmplan-small pmplan-muted' }, subtitle) : null
        ),
        h('span', { className: 'pmplan-spacer' }),
        Button({ variant: 'ghost', size: 'small', onClick: onClose, 'aria-label': closeLabel }, '✕')
      ),
      h('div', { className: 'pmplan-drawer-body' }, children),
      footer ? h('footer', { className: 'pmplan-drawer-foot' }, footer) : null
    )
  )
}

export function Modal({ title, onClose, children, footer, width }) {
  return h('div', {
    className: 'pmplan-scrim',
    'data-center': 'true',
    role: 'presentation',
    onClick: (event) => {
      if (event.target === event.currentTarget) onClose?.()
    }
  },
    h('div', { className: 'pmplan-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: width ? { width } : undefined },
      h('header', { className: 'pmplan-drawer-head' },
        h('span', { className: 'pmplan-drawer-title' }, title),
        h('span', { className: 'pmplan-spacer' }),
        Button({ variant: 'ghost', size: 'small', onClick: onClose, 'aria-label': '关闭' }, '✕')
      ),
      h('div', { className: 'pmplan-modal-body' }, children),
      footer ? h('footer', { className: 'pmplan-drawer-foot' }, footer) : null
    )
  )
}

export function Toast({ text }) {
  if (!text) return null
  return h('div', { className: 'pmplan-toast', role: 'status' }, text)
}

export function Banner({ tone = 'warn', children, actions }) {
  return h('div', { className: 'pmplan-banner', 'data-tone': tone, role: 'alert' },
    h('span', null, children),
    actions ? h('span', { className: 'pmplan-spacer' }) : null,
    actions || null
  )
}

export function Kpi({ label, value, hint, tone }) {
  return h('div', { className: 'pmplan-kpi' },
    h('div', { className: 'pmplan-kpi-label' }, label),
    h('div', { className: 'pmplan-kpi-value', style: tone ? { color: `var(--pm-${tone})` } : undefined }, value),
    hint ? h('div', { className: 'pmplan-kpi-hint' }, hint) : null
  )
}

export function KeyValues({ rows }) {
  const children = []
  rows.filter(Boolean).forEach((row, index) => {
    children.push(h('dt', { key: `k${index}` }, row[0]))
    children.push(h('dd', { key: `v${index}` }, row[1]))
  })
  return h('dl', { className: 'pmplan-kv' }, children)
}

export { styles, h }
