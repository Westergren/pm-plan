/**
 * 测试用的小型模块加载器：直接执行 `lib/client.js`，
 * 用假 `window.__ModuleLoader__` 拿到工厂函数与最终导出。
 *
 * 不启动 Desktop，也不依赖真实网络：`fetch` 由测试注入。
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export async function loadClient({ request } = {}) {
  const bundlePath = new URL('../../lib/client.js', import.meta.url)
  const code = await readFile(bundlePath, 'utf8')
  let registered = null
  const fakeWindow = {
    __ModuleLoader__: {
      load(definition) {
        registered = definition
      }
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    localStorage: {
      store: new Map(),
      getItem(key) { return this.store.has(key) ? this.store.get(key) : null },
      setItem(key, value) { this.store.set(key, String(value)) },
      removeItem(key) { this.store.delete(key) }
    }
  }
  const previousWindow = globalThis.window
  globalThis.window = fakeWindow
  const previousFetch = globalThis.fetch
  if (request) globalThis.fetch = request
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'require', code)(fakeWindow, undefined, require)
  } finally {
    globalThis.window = previousWindow
    if (request) globalThis.fetch = previousFetch
  }
  if (!registered) throw new Error('客户端包没有调用 window.__ModuleLoader__.load')
  const React = require('react')
  const desktopWorkbenches = {
    registrations: [],
    register(descriptor, Component) {
      this.registrations.push({ descriptor, Component })
      return () => {}
    }
  }
  const cordis = {
    effects: [],
    effect(callback) {
      const dispose = callback()
      this.effects.push(dispose)
      return dispose
    },
    desktopWorkbenches
  }
  const exported = registered.factory((id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/cordis') return { Service: class Service {} }
    throw new Error(`未知的共享模块：${id}`)
  })
  // hostWindow 就是打包代码闭包里的 `window`（不是 jsdom 的 window）。
  // 模拟宿主注入的桥（如 __DSH_HOST_PATHS__）时必须挂在它上面。
  return { id: registered.id, exported, ctx: cordis, React, desktopWorkbenches, hostWindow: fakeWindow }
}

/** 一个最小的 fetch 替身：按路径返回内存里的状态文档并记录写入。 */
export function createFakeServer(initial = { revision: 0, state: { version: 1, projects: [], orders: [], plans: [], logs: [] } }, options = {}) {
  const memory = { ...initial, state: { ...initial.state } }
  const docsPayload = options.docsPayload
    ? { ...options.docsPayload, documents: [...(options.docsPayload.documents || [])] }
    : {
        root: '/Users/x/Documents/项目计划工作台文档',
        indexFile: '/Users/x/Documents/项目计划工作台文档/index.json',
        documents: [],
        count: 0,
        missing: 0
      }
  const calls = []
  // 导入（移动/复制）与属性挂靠都记下来，测试断言用。
  const uploads = []
  const metas = []
  const request = async (url, options = {}) => {
    const path = String(url)
    calls.push({ url: path, method: options.method || 'GET' })
    if (path.endsWith('/api/pm-plan/docs/file') && options.method === 'POST') {
      const body = JSON.parse(options.body)
      const doc = {
        id: `doc-${uploads.length + 1}`,
        path: body.folder ? `${body.folder}/${body.name}` : body.name,
        name: body.name,
        folder: body.folder || '',
        kind: 'markdown',
        editable: true,
        size: 0,
        projectId: body.projectId || '',
        orderId: body.orderId || '',
        title: body.title || '',
        tags: [],
        note: '',
        version: '',
        addedAt: '',
        updatedAt: '',
        missing: false
      }
      uploads.push({ ...body, created: doc })
      docsPayload.documents.push(doc)
      docsPayload.count = docsPayload.documents.length
      return jsonResponse(200, doc)
    }
    if (path.endsWith('/api/pm-plan/docs/meta') && options.method === 'POST') {
      const body = JSON.parse(options.body)
      metas.push(body)
      const doc = docsPayload.documents.find((item) => item.path === body.path)
      if (doc) Object.assign(doc, body)
      return jsonResponse(200, { path: body.path })
    }
    if (path.includes('/api/pm-plan/docs/')) return jsonResponse(404, { error: 'not found' })
    if (path.endsWith('/api/pm-plan/docs')) return jsonResponse(200, docsPayload)
    if (path.endsWith('/api/pm-plan/state') && (!options.method || options.method === 'GET')) {
      return jsonResponse(200, memory)
    }
    if (path.endsWith('/api/pm-plan/state') && options.method === 'POST') {
      const body = JSON.parse(options.body)
      if (body.revision !== memory.revision) {
        return jsonResponse(409, { error: '数据已被其他窗口修改，请重新加载后再保存。' })
      }
      memory.revision += 1
      memory.state = body.state
      return jsonResponse(200, { revision: memory.revision, state: memory.state })
    }
    return jsonResponse(404, { error: 'not found' })
  }
  return { memory, calls, uploads, metas, request }
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload }
  }
}
