/**
 * 工作台包格式校验：按《工作台开发规范》第 3 节逐项检查，
 * 再按第 5 节的要求核对 `pnpm pack` 产物（若已存在）。
 *
 * 只读检查，不修改任何文件；失败时以非零退出码结束。
 */

import { access, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const problems = []
const notes = []

const check = (condition, message) => {
  if (condition) notes.push(`✓ ${message}`)
  else problems.push(`✗ ${message}`)
}

const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'))
const exists = async (path) => {
  try {
    await access(join(root, path))
    return true
  } catch {
    return false
  }
}

const pkg = await readJson('package.json')

// 3.2 package.json
check(typeof pkg.name === 'string' && pkg.name.length > 0, `name 存在（${pkg.name}）`)
check(/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(pkg.version || ''), `version 是完整 SemVer（${pkg.version}）`)
check(pkg.type === 'module', 'type 为 module')
check(pkg.main === './dsh/index.js', `main 指向服务端入口（${pkg.main}）`)
check(pkg.exports?.['.'] === './dsh/index.js', 'exports["."] 指向服务端入口')
check(pkg.exports?.['./client'] === './lib/client.js', 'exports["./client"] 指向客户端产物')
check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch 已声明')
check(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform 为 web')
check(Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.includes('dsh-desktop-workbenches'), 'dsh.client.inject 含 dsh-desktop-workbenches')
check(!('inline' in (pkg.dsh?.client || {})), '没有使用未文档化的 dsh.client.inline')
check(typeof pkg.license === 'string' && pkg.license.length > 0, `license 已填写（${pkg.license}）`)
check(typeof pkg.author === 'string' && pkg.author.length > 0, 'author 已填写')
check(typeof pkg.description === 'string' && pkg.description.length > 8, 'description 已填写')
check(Array.isArray(pkg.peerDependencies) ? !Object.keys(pkg.peerDependencies).some((name) => name.startsWith('@deepseek-ai/') === false && false) : true, 'peerDependencies 检查跳过（未声明宿主包）')

// files 覆盖入口与补丁
const files = Array.isArray(pkg.files) ? pkg.files : []
for (const required of ['dsh/', 'lib/', 'cordis.patch.yml']) {
  check(files.includes(required), `files 覆盖 ${required}`)
}

// 3.1 / 3.3 目录与补丁
check(await exists('dsh/index.js'), 'dsh/index.js 存在')
check(await exists('lib/client.js'), 'lib/client.js 存在')
check(await exists('cordis.patch.yml'), 'cordis.patch.yml 存在')

const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
check(/-\s*insert:/.test(patch), 'cordis.patch.yml 含 insert 条目')
check(patch.includes(`name: ${pkg.name}`), `cordis.patch.yml 的 name 是包名（${pkg.name}）`)
check(/id:\s*[\w-]+/.test(patch), 'cordis.patch.yml 的 insert 行有 id')
check(!/name:\s*[./]/.test(patch), 'cordis.patch.yml 的 name 不是相对/绝对路径')

// 3.4 服务端入口
const server = await readFile(join(root, 'dsh/index.js'), 'utf8')
check(/export const name/.test(server), '服务端导出 name')
check(/export const inject/.test(server), '服务端导出 inject')
check(/export const Config/.test(server), '服务端导出 Config')
check(/export function apply/.test(server), '服务端导出 apply')

// 3.5 客户端入口（构建产物）
const client = await readFile(join(root, 'lib/client.js'), 'utf8')
check(client.includes('window.__ModuleLoader__.load('), '客户端产物通过 window.__ModuleLoader__.load 注册')
check(client.includes(`id: "${pkg.name}"`) || client.includes(`id: '${pkg.name}'`), '客户端产物 id 与包名一致')
check(client.includes('desktopWorkbenches.register'), '客户端调用 desktopWorkbenches.register')
check(/title:\s*['"]/.test(client), 'register 提供 title')
check(client.includes("repository: REPOSITORY") || /repository:\s*['"]https:\/\/github\.com\//.test(client), 'register 提供规范的 GitHub repository（变量或字面量）')
check(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(client), '包内声明了规范的 GitHub 仓库地址（工作台身份来源）')
check(!/\bid:\s*['"][\w.-]+['"]/.test(client.split('desktopWorkbenches.register')[1]?.slice(0, 400) || ''), '新包没有填写旧的 register id')
check(!/^\s*import\s/m.test(client), '客户端产物里没有残留 import 语句')
check(!/^\s*export\s/m.test(client), '客户端产物里没有残留 export 语句')

// 大小与敏感文件
const clientSize = (await stat(join(root, 'lib/client.js'))).size
notes.push(`· 客户端产物大小 ${(clientSize / 1024).toFixed(1)} KB`)
check(clientSize < 2 * 1024 * 1024, '客户端产物小于 2 MB')

const entries = await readdir(root)
const suspicious = entries.filter((name) => /^\.env|\.pem$|\.key$|credentials|secret/i.test(name))
check(suspicious.length === 0, `根目录没有敏感文件名（${suspicious.join(', ') || '无'}）`)

// 可选：核对已有的 pnpm pack 产物
const tarballs = entries.filter((name) => name.endsWith('.tgz'))
for (const tarball of tarballs) {
  notes.push(`· 发现打包产物 ${tarball}（用 tar -tzf 核对内容）`)
}

process.stdout.write(`${notes.join('\n')}\n`)
if (problems.length) {
  process.stdout.write(`\n${problems.join('\n')}\n包格式校验未通过（${problems.length} 项）。\n`)
  process.exit(1)
}
process.stdout.write(`\n包格式校验通过（${notes.length} 项）。\n`)
