/**
 * 针对本工作台接口的薄封装。
 */

const PREFIX = '/api/pm-plan'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function parse(response) {
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) {
    throw new ApiError((payload && payload.error) || `请求失败（HTTP ${response.status}）`, response.status)
  }
  return payload
}

export async function readState() {
  const response = await fetch(`${PREFIX}/state`, { credentials: 'same-origin', cache: 'no-store' })
  const payload = await parse(response)
  if (!payload || typeof payload !== 'object' || !payload.state) {
    throw new ApiError('服务端返回了无法识别的数据。', 500)
  }
  return { revision: Number(payload.revision) || 0, state: payload.state }
}

/** 整体保存；revision 不一致会抛 409，由界面提示「重新加载」。 */
export async function writeState(revision, state) {
  const response = await fetch(`${PREFIX}/state`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, state })
  })
  return parse(response)
}

/* ---------------- 需求文档库 ---------------- */

export async function readDocs() {
  return parse(await fetch(`${PREFIX}/docs`, { credentials: 'same-origin', cache: 'no-store' }))
}

/** 指定/确认文档库根目录（服务端此时才创建目录）。 */
export async function setDocsRoot(root) {
  const response = await fetch(`${PREFIX}/docs`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'root', root })
  })
  return parse(response)
}

export async function readDoc(path) {
  const url = `${PREFIX}/docs/file?path=${encodeURIComponent(path)}`
  return parse(await fetch(url, { credentials: 'same-origin', cache: 'no-store' }))
}

export async function writeDoc(path, text) {
  const response = await fetch(`${PREFIX}/docs/file`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'write', path, text })
  })
  return parse(response)
}

export async function uploadDoc(payload) {
  const response = await fetch(`${PREFIX}/docs/file`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'upload', ...payload })
  })
  return parse(response)
}

export async function updateDocMeta(path, patch) {
  const response = await fetch(`${PREFIX}/docs/meta`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, ...patch })
  })
  return parse(response)
}

export async function docAction(path, action, extra = {}) {
  const response = await fetch(`${PREFIX}/docs/action`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, action, ...extra })
  })
  return parse(response)
}

export { PREFIX }
