/**
 * 项目计划工作台的服务端入口。
 *
 * 三件事：
 * 1. 业务数据（项目/工单/计划/进展）持久化到 `pm-plan/state.json`；
 * 2. 需求文档库：文档本体存在用户指定的本机目录，索引写在该目录的 `index.json`；
 * 3. 只读健康检查，便于确认服务端已加载。
 *
 * 统计、风险判定、周报生成全部在共享纯函数里完成，服务端不依赖其他宿主服务。
 */

import { spawn } from 'node:child_process'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import Schema from '@deepseek-ai/schemastery'
import { createStore, MAX_STATE_BYTES, StateError } from './store.js'
import { DocsError, MAX_UPLOAD_BYTES, createDocsStore, relativeToRoot } from './docs.js'

// 注意：本文件**不能**再有 `export default`。宿主的插件加载器会优先解析 default 导出，
// 那是一个不带元数据的裸函数，会导致下面声明的 inject 被忽略，报
// `cannot get property "connection" without inject`，进而所有接口 404。
export const name = 'dsh-workbench-pm-plan'
export const inject = ['connection']
export const Config = Schema.object({
  root: Schema.string().required(),
  docsRoot: Schema.string().default('')
})

const PREFIX = '/api/pm-plan'
/** base64 编码后体积约为原文件的 4/3，留出余量。 */
const MAX_DOC_BODY_BYTES = Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 1024 * 1024

async function readJsonBody(request, maximum = MAX_STATE_BYTES) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximum) {
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
      if (length > maximum) {
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

const json = (payload) => Response.json(payload, { headers: { 'cache-control': 'no-store' } })

/** 用系统默认程序打开本机文件；只允许打开库内路径。 */
function openWithSystem(absolute) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  const child = spawn(command, [absolute], { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

export function apply(ctx, config) {
  const options = config || {}
  // 这里显式校验一次：如果 inject 元数据丢失（例如误加了 default 导出），
  // 宿主不会把 connection 服务注入进来，此时给出能定位的报错而不是一句 undefined。
  if (!ctx || !ctx.connection || !ctx.connection.fetch) {
    throw new Error('缺少注入的 connection 服务：请确认服务端入口只导出具名 apply，且 inject = [\'connection\']。')
  }
  const store = createStore(options.root || join(homedir(), '.dsh-pm-plan'))
  // docsRoot 缺省时给一个「用户文档目录」下的默认值；仍然只有用户确认后才会创建。
  const docs = createDocsStore({ root: options.docsRoot || join(homedir(), 'Documents', '项目计划工作台文档') })

  const failure = (error) => {
    const known = error instanceof StateError || error instanceof DocsError
    return json({ error: known ? error.message : '项目计划工作台的数据操作失败。' })
  }

  const failureWithStatus = (error) => {
    const known = error instanceof StateError || error instanceof DocsError
    return Response.json(
      { error: known ? error.message : '项目计划工作台的数据操作失败。' },
      { status: known ? error.status : 500, headers: { 'cache-control': 'no-store' } }
    )
  }

  /* ---------------- 业务数据 ---------------- */

  // 一个路径只能注册一条路由（宿主按 pathname 唯一索引），所以读写共用一条、按方法分发。
  ctx.connection.fetch.register({
    path: `${PREFIX}/state`,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        if (request?.method === 'POST') {
          return json(await store.write(await readJsonBody(request)))
        }
        const { revision, state } = await store.read()
        return json({ revision, state })
      } catch (error) {
        return failureWithStatus(error)
      }
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/health`,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      const info = await docs.info()
      return json({ ok: true, name, file: store.file, docs: { root: info.root, exists: info.exists } })
    }
  })

  /* ---------------- 需求文档库 ---------------- */

  ctx.connection.fetch.register({
    path: `${PREFIX}/docs`,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        if (request?.method === 'POST') {
          const payload = await readJsonBody(request, 64 * 1024)
          if (payload?.action !== 'root') throw new DocsError('未知操作。')
          return json(await docs.ensureRoot(payload.root))
        }
        return json(await docs.list())
      } catch (error) {
        return failureWithStatus(error)
      }
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/docs/file`,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        if (request?.method === 'POST') {
          const payload = await readJsonBody(request, MAX_DOC_BODY_BYTES)
          const kind = payload?.kind === 'upload' ? 'upload' : 'write'
          if (kind === 'upload') {
            return json(await docs.upload({
              name: payload.name,
              folder: payload.folder,
              base64: payload.base64,
              sourcePath: payload.sourcePath,
              projectId: payload.projectId,
              orderId: payload.orderId,
              title: payload.title,
              tags: payload.tags,
              note: payload.note,
              version: payload.version
            }))
          }
          if (typeof payload?.path !== 'string') throw new DocsError('缺少文件路径。')
          return json(await docs.saveText(payload.path, payload.text))
        }
        const target = new URL(request.url).searchParams.get('path')
        if (!target) throw new DocsError('缺少 path 参数。')
        return json(await docs.readText(target))
      } catch (error) {
        return failureWithStatus(error)
      }
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/docs/meta`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        const payload = await readJsonBody(request, 64 * 1024)
        if (typeof payload?.path !== 'string') throw new DocsError('缺少文件路径。')
        return json(await docs.updateMeta(payload.path, payload))
      } catch (error) {
        return failureWithStatus(error)
      }
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/docs/action`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        const payload = await readJsonBody(request, 64 * 1024)
        if (typeof payload?.path !== 'string') throw new DocsError('缺少文件路径。')
        if (payload.action === 'open') {
          const absolute = docs.absoluteOf(payload.path)
          openWithSystem(absolute)
          return json({ opened: true, name: basename(absolute), location: relativeToRoot(docs.getRoot(), absolute) })
        }
        if (payload.action === 'delete') {
          return json(await docs.remove(payload.path, { deleteFile: payload.deleteFile === true }))
        }
        if (payload.action === 'rename') {
          return json(await docs.renameDoc(payload.path, payload.name))
        }
        throw new DocsError('未知操作。')
      } catch (error) {
        return failureWithStatus(error)
      }
    }
  })
}
