/**
 * 日期与时间：全部按本地日历日比较，纯函数，可在 Node 里直接测试。
 * 约定：日期一律用 `YYYY-MM-DD` 字符串，时间戳用 ISO 字符串。
 */

export function pad(value) {
  return String(value).padStart(2, '0')
}

export function toISODate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function todayISO(now = new Date()) {
  return toISODate(now)
}

/** 把 `YYYY-MM-DD` 解析成当天零点的本地 Date；非法输入返回 null。 */
export function parseISODate(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

export function isValidDate(value) {
  return parseISODate(value) !== null
}

export function addDays(value, days) {
  const date = parseISODate(value)
  if (!date) return ''
  date.setDate(date.getDate() + Number(days || 0))
  return toISODate(date)
}

/** `to - from` 的整天数；任一非法则返回 null。 */
export function daysBetween(from, to) {
  const a = parseISODate(from)
  const b = parseISODate(to)
  if (!a || !b) return null
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/** 相对今天的剩余天数：负数表示已逾期。 */
export function daysLeft(dueDate, today = todayISO()) {
  return daysBetween(today, dueDate)
}

export function startOfWeek(value) {
  const date = parseISODate(value)
  if (!date) return ''
  const weekday = (date.getDay() + 6) % 7 // 周一为一周起点
  date.setDate(date.getDate() - weekday)
  return toISODate(date)
}

export function endOfWeek(value) {
  const start = startOfWeek(value)
  return start ? addDays(start, 6) : ''
}

export function inSameWeek(left, right) {
  return Boolean(left) && startOfWeek(left) === startOfWeek(right)
}

export function monthKey(value) {
  const date = parseISODate(value)
  if (!date) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

export function quarterKey(value) {
  const date = parseISODate(value)
  if (!date) return ''
  return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`
}

export function shiftMonth(monthKeyValue, delta) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKeyValue || ''))
  const year = match ? Number(match[1]) : new Date().getFullYear()
  const month = match ? Number(match[2]) : new Date().getMonth() + 1
  const date = new Date(year, month - 1 + Number(delta || 0), 1)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

/** 一周的 7 天，从周一开始；返回 `YYYY-MM-DD` 数组。 */
export function weekDays(value) {
  const start = startOfWeek(value)
  if (!start) return []
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}

/**
 * 月历网格：按周一起始补齐整周，覆盖目标月。
 * 返回 `{ month, label, weeks }`，weeks 是二维数组，元素带 `{ date, day, inMonth }`。
 */
export function monthGrid(monthKeyValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKeyValue || ''))
  const fallback = monthKey(todayISO())
  const key = match ? `${match[1]}-${match[2]}` : fallback
  const year = Number(key.slice(0, 4))
  const month = Number(key.slice(5, 7))
  const first = new Date(year, month - 1, 1)
  const last = new Date(year, month, 0)
  const start = new Date(first)
  start.setDate(start.getDate() - ((first.getDay() + 6) % 7))
  const weeks = []
  const cursor = new Date(start)
  while (cursor <= last || weeks.length < 5) {
    const week = []
    for (let index = 0; index < 7; index += 1) {
      const date = toISODate(cursor)
      week.push({ date, day: cursor.getDate(), inMonth: cursor.getMonth() === month - 1 })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
    if (weeks.length >= 6) break
  }
  return { month: key, label: `${year} 年 ${month} 月`, weeks }
}

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export function formatDate(value, fallback = '未排期') {
  const date = parseISODate(value)
  if (!date) return fallback
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatShortDate(value, fallback = '—') {
  const date = parseISODate(value)
  if (!date) return fallback
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatDateTime(value, fallback = '') {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatDayLabel(value) {
  const date = parseISODate(value)
  if (!date) return '未排期'
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}
