/**
 * 业务数据的原子存储。
 *
 * - 写在 `root/state.json`，临时文件 + rename，避免写坏源文件；
 * - 带 `revision` 做并发检测，另一个窗口改过就拒绝覆盖；
 * - 读取时统一走 normalizeState 收敛结构，旧数据不会导致崩溃；
 * - 文件损坏时明确报错，不静默覆盖用户数据。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { emptyState, normalizeState } from '../src/shared/model.js'

export const MAX_STATE_BYTES = 4 * 1024 * 1024

export class StateError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'StateError'
    this.status = status
  }
}

export function createStore(root) {
  const file = join(root, 'state.json')

  const read = async () => {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') return { revision: 0, state: emptyState() }
      throw new StateError(`读取数据文件失败：${error instanceof Error ? error.message : String(error)}`, 500)
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new StateError('数据文件不是合法 JSON，已保留原文件不做覆盖。请先备份或修复 state.json。', 500)
    }
    const revision = Number.isFinite(parsed?.revision) ? Math.max(0, Math.round(parsed.revision)) : 0
    return { revision, state: normalizeState(parsed?.state ?? parsed) }
  }

  const write = async (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new StateError('请求体必须是对象。')
    const current = await read()
    const expected = payload.revision
    if (!Number.isFinite(expected)) throw new StateError('缺少 revision 字段。')
    if (Math.round(expected) !== current.revision) {
      throw new StateError('数据已被其他窗口修改，请重新加载后再保存。', 409)
    }
    const state = normalizeState(payload.state)
    const next = { revision: current.revision + 1, state: { ...state, updatedAt: new Date().toISOString() } }
    const text = JSON.stringify(next, null, 2)
    if (Buffer.byteLength(text, 'utf8') > MAX_STATE_BYTES) {
      throw new StateError(`数据超过上限（${Math.round(MAX_STATE_BYTES / 1024)} KB），请精简后再保存。`, 413)
    }
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, file)
    return { revision: next.revision, state: next.state }
  }

  return { file, read, write }
}
