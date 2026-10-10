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

export { PREFIX }
