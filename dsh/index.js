/**
 * 项目计划工作台的服务端入口。
 *
 * 只做一件事：把业务数据持久化到 DSH 数据目录下的 `pm-plan/state.json`。
 * 统计、风险判定、周报生成全部在客户端与服务端的纯函数里完成，
 * 因此这里不依赖任何宿主服务，也不占用其他插件的接口路径。
 */

import Schema from '@deepseek-ai/schemastery'
import { createStore, MAX_STATE_BYTES, StateError } from './store.js'

export const name = 'dsh-workbench-pm-plan'
export const inject = ['connection']
export const Config = Schema.object({
  root: Schema.string().required()
})

const PREFIX = '/api/pm-plan'

async function readJsonBody(request) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_STATE_BYTES) {
    throw new StateError('请求体过大。', 413)
  }
  const reader = request.body?.getReader()
  if (!reader) throw new StateError('请求需要一个 JSON 请求体。')
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > MAX_STATE_BYTES) {
        await reader.cancel()
        throw new StateError('请求体过大。', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) throw new StateError('请求体是空的。')
  try {
    return JSON.parse(text)
  } catch {
    throw new StateError('请求体不是合法 JSON。')
  }
}

export function apply(ctx, config) {
  const store = createStore(config.root)

  const failure = (error) => {
    const known = error instanceof StateError
    return Response.json(
      { error: known ? error.message : '项目计划工作台的数据操作失败。' },
      { status: known ? error.status : 500, headers: { 'cache-control': 'no-store' } }
    )
  }

  // 一个路径只能注册一条路由（宿主按 pathname 唯一索引），所以读写共用一条、按方法分发。
  ctx.connection.fetch.register({
    path: `${PREFIX}/state`,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        if (request?.method === 'POST') {
          return Response.json(await store.write(await readJsonBody(request)), { headers: { 'cache-control': 'no-store' } })
        }
        const { revision, state } = await store.read()
        return Response.json({ revision, state }, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return failure(error)
      }
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/health`,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      return Response.json({ ok: true, name, file: store.file }, { headers: { 'cache-control': 'no-store' } })
    }
  })
}
