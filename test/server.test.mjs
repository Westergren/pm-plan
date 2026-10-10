import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Config, apply, inject, name } from '../dsh/index.js'
import { MAX_STATE_BYTES, StateError, createStore } from '../dsh/store.js'

const temporary = () => mkdtemp(join(tmpdir(), 'pm-plan-'))

test('服务端入口导出工作台插件必需的契约', () => {
  assert.equal(name, 'dsh-workbench-pm-plan')
  assert.deepEqual(inject, ['connection'])
  assert.equal(typeof apply, 'function')
  assert.equal(typeof Config, 'function')
})

test('store 首次读取返回空结构，写入后 revision 递增', async () => {
  const root = await temporary()
  try {
    const store = createStore(root)
    const initial = await store.read()
    assert.equal(initial.revision, 0)
    assert.deepEqual(initial.state.projects, [])

    const written = await store.write({
      revision: 0,
      state: { projects: [{ id: 'p1', name: '手机银行迭代' }], orders: [], plans: [], logs: [] }
    })
    assert.equal(written.revision, 1)
    assert.equal(written.state.projects[0].name, '手机银行迭代')

    const again = await store.read()
    assert.equal(again.revision, 1)
    assert.equal(again.state.projects[0].module, '公司项目')

    const onDisk = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'))
    assert.equal(onDisk.revision, 1)
    assert.equal(onDisk.state.projects.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store 拒绝过期 revision（并发检测）', async () => {
  const root = await temporary()
  try {
    const store = createStore(root)
    await store.write({ revision: 0, state: { projects: [], orders: [], plans: [], logs: [] } })
    await assert.rejects(
      () => store.write({ revision: 0, state: { projects: [{ id: 'p1', name: 'A' }], orders: [], plans: [], logs: [] } }),
      (error) => error instanceof StateError && error.status === 409
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store 在数据文件损坏时报错而不覆盖', async () => {
  const root = await temporary()
  try {
    const store = createStore(root)
    await writeFile(join(root, 'state.json'), '{ 这不是 JSON', 'utf8')
    await assert.rejects(() => store.read(), (error) => error instanceof StateError && error.status === 500)
    await assert.rejects(
      () => store.write({ revision: 0, state: { projects: [], orders: [], plans: [], logs: [] } }),
      (error) => error instanceof StateError
    )
    const stillBroken = await readFile(join(root, 'state.json'), 'utf8')
    assert.equal(stillBroken, '{ 这不是 JSON')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store 拒绝缺少 revision 与超大请求', async () => {
  const root = await temporary()
  try {
    const store = createStore(root)
    await assert.rejects(() => store.write({ state: {} }), (error) => error instanceof StateError)
    await assert.rejects(() => store.write(null), (error) => error instanceof StateError)
    const hugeProjects = Array.from({ length: 4000 }, (_, index) => ({ id: `p${index}`, name: `项目${index}`, summary: 'x'.repeat(900) }))
    await assert.rejects(
      () => store.write({ revision: 0, state: { projects: hugeProjects, orders: [], plans: [], logs: [] } }),
      (error) => error instanceof StateError && error.status === 413
    )
    assert.ok(MAX_STATE_BYTES > 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/**
 * 造一个最小的 connection.fetch 收集器，用来直接调用 apply 注册的路由。
 * 宿主按 pathname 唯一索引路由，重复注册同一路径会直接抛错，这里照同样的规则模拟。
 */
function createConnection() {
  const routes = new Map()
  const byPath = new Map()
  return {
    routes,
    connection: {
      fetch: {
        register(route) {
          if (byPath.has(route.path)) {
            throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`)
          }
          byPath.set(route.path, route)
          routes.set(`${route.methods.join(',')} ${route.path}`, route)
        }
      }
    }
  }
}

test('服务端路由：GET/POST state 与 health 可用，错误返回 JSON', async () => {
  const root = await temporary()
  try {
    const fake = createConnection()
    apply({ connection: fake.connection }, { root })

    // 同一路径只能有一条路由；GET 与 POST 共用 /state。
    const stateRoute = fake.routes.get('GET,POST /api/pm-plan/state')
    const healthRoute = fake.routes.get('GET /api/pm-plan/health')
    assert.ok(stateRoute, '缺少 /api/pm-plan/state 路由')
    assert.deepEqual(stateRoute.methods, ['GET', 'POST'])
    assert.ok(healthRoute, '缺少 GET /api/pm-plan/health')
    assert.equal(fake.routes.size, 2, '不应重复注册同一路径')

    const initial = await (await stateRoute.fetch({ method: 'GET' })).json()
    assert.equal(initial.revision, 0)

    const health = await (await healthRoute.fetch()).json()
    assert.equal(health.ok, true)
    assert.ok(health.file.endsWith('state.json'))

    const posted = await (await stateRoute.fetch(jsonRequest({ revision: 0, state: { projects: [{ id: 'p1', name: 'A' }], orders: [], plans: [], logs: [] } }, 'POST'))).json()
    assert.equal(posted.revision, 1)

    const conflict = await (await stateRoute.fetch(jsonRequest({ revision: 0, state: { projects: [], orders: [], plans: [], logs: [] } }, 'POST'))).json()
    assert.match(conflict.error, /重新加载/)

    const bad = await stateRoute.fetch(jsonRequest('不是对象', 'POST'))
    assert.equal(bad.status, 400)
    const badJson = await (await stateRoute.fetch(rawRequest('{oops', 'POST'))).json()
    assert.match(badJson.error, /JSON/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function jsonRequest(payload, method = 'POST') {
  return rawRequest(typeof payload === 'string' ? payload : JSON.stringify(payload), method)
}

function rawRequest(text, method = 'POST') {
  const bytes = new TextEncoder().encode(text)
  let sent = false
  return {
    method,
    headers: { get: (key) => (key === 'content-length' ? String(bytes.length) : null) },
    body: {
      getReader() {
        return {
          async read() {
            if (sent) return { done: true }
            sent = true
            return { done: false, value: bytes }
          },
          releaseLock() {}
        }
      }
    }
  }
}
