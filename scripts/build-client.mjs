/**
 * 客户端打包：把 src/ 下的多文件源码内联成一个单文件客户端模块。
 *
 * 支持的语法子集：
 *   - 单行或多行的 `import ... from '...'`（含 `import X from`、`import {a, b as c} from`、`import * as ns from`）；
 *   - `export const/let/var/function/class`、`export { a, b as c }`、`export { ... } from '...'`、`export default`；
 *   - 其余内容（包括 CSS 模板字符串、可选链、JSX 之外的全部 JS）原样保留。
 *
 * 相对路径的 import 会被内联进模块表；裸包名（react 等）交给宿主模块加载器的 require。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const srcDir = join(root, 'src')
const outFile = join(root, 'lib', 'client.js')

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const moduleId = packageJson.name
const entry = 'client/index.js'
const BANNER = '// 本文件由 scripts/build-client.mjs 从 src/ 生成，请勿直接修改。\n'

/** 收集源码里的 import/export-from 声明（支持多行花括号），返回依赖与剩余代码。 */
function collectModuleSyntax(source, label) {
  const requires = []
  const exportNames = []
  const deps = []
  const output = []
  let index = 0
  let counter = 0

  while (index < source.length) {
    const isImport = source.startsWith('import', index) && /[\s{*'"]/.test(source[index + 6] || '')
    const isExportFrom = source.startsWith('export', index) && /^export\s*\{[^}]*\}\s*from\s/m.test(source.slice(index))
    if (!isImport && !isExportFrom) {
      const next = source.indexOf('\nimport', index + 1)
      const nextExport = source.indexOf('\nexport', index + 1)
      const candidates = [next, nextExport].filter((value) => value >= 0)
      const stop = candidates.length ? Math.min(...candidates) + 1 : source.length
      output.push(source.slice(index, stop))
      index = stop
      continue
    }
    const tail = source.slice(index)
    const match = isImport
      ? /^import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:\{([\s\S]*?)\}|\*\s+as\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))\s*from\s*['"]([^'"]+)['"]\s*;?/.exec(tail)
      : /^export\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]\s*;?/.exec(tail)
    if (!match) {
      if (isImport) throw new Error(`无法解析 import（${label}）：${tail.split('\n')[0]}`)
      // export 声明（不是 export ... from）：整行留下，交给后面统一改写。
      const stop = source.indexOf('\n', index)
      const line = stop < 0 ? source.slice(index) : source.slice(index, stop)
      const named = /^export\s+(?:async\s+)?(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/.exec(line)
      if (named) exportNames.push(named[2])
      output.push(line)
      index = stop < 0 ? source.length : stop
      continue
    }
    const consumed = match[0].length
    const specifier = isImport ? match[5] : match[2]
    const targetKey = specifier.startsWith('.') ? moduleKeyOf(resolve(srcDir, dirname(label), specifier)) : specifier
    if (specifier.startsWith('.')) deps.push(targetKey)
    if (isImport) {
      const call = `__require(${JSON.stringify(targetKey)})`
      const defaultName = match[1]
      const namedRaw = match[2]
      const starName = match[3]
      const bareName = match[4]
      if (namedRaw !== undefined) {
        const named = namedRaw
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
        const parts = []
        if (defaultName) parts.push(`${defaultName} = ${call}`)
        if (named.length) parts.push(`{ ${named.join(', ')} } = ${call}`)
        if (!parts.length) parts.push(`__sideEffect${counter} = ${call}`)
        requires.push(`const ${parts.join(', ')}`)
      } else if (starName) {
        requires.push(`const ${defaultName ? `${defaultName} = ${call}, ` : ''}${starName} = ${call}`)
      } else if (bareName) {
        requires.push(`const ${bareName} = ${call}`)
      } else {
        requires.push(`const __sideEffect${counter} = ${call}`)
      }
      counter += 1
    } else {
      const alias = `__reexport${counter}`
      counter += 1
      requires.push(`const ${alias} = __require(${JSON.stringify(targetKey)})`)
      for (const part of match[1].split(',')) {
        const text = part.trim()
        if (!text) continue
        const pieces = text.split(/\s+as\s+/)
        const exported = (pieces[1] || pieces[0]).trim()
        requires.push(`const ${exported} = ${alias}.${pieces[0].trim()}`)
        exportNames.push(exported)
      }
    }
    index += consumed
  }
  return { code: output.join(''), requires, exportNames, deps }
}

function moduleKeyOf(absolutePath) {
  return relative(srcDir, absolutePath).split(sep).join(posix.sep)
}

const factories = new Map()

async function transform(key) {
  if (factories.has(key)) return factories.get(key)
  const absolute = join(srcDir, key.split(posix.sep).join(sep))
  const source = await readFile(absolute, 'utf8')
  const collected = collectModuleSyntax(source, key)
  const exportNames = [...collected.exportNames]
  const bodyLines = []
  for (const line of collected.code.split('\n')) {
    const named = /^export\s+(?:async\s+)?(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (named) {
      exportNames.push(named[2])
      bodyLines.push(line.replace(/^export\s+(async\s+)?/, '$1'))
      continue
    }
    const list = /^export\s*\{([^}]*)\}\s*;?$/.exec(line)
    if (list) {
      for (const part of list[1].split(',')) {
        const text = part.trim()
        if (!text) continue
        const pieces = text.split(/\s+as\s+/)
        exportNames.push(pieces[1] ? `${pieces[0].trim()}: ${pieces[1].trim()}` : pieces[0].trim())
      }
      continue
    }
    if (/^export\s+default\s+/.test(line)) {
      bodyLines.push(line.replace(/^export\s+default\s+/, 'const __default = '))
      exportNames.push('default: __default')
      continue
    }
    bodyLines.push(line)
  }
  const prelude = collected.requires.length ? `${collected.requires.join('\n')}\n` : ''
  const exports = exportNames.length ? `\nmodule.exports = { ${exportNames.join(', ')} }\n` : ''
  // 源码里相对路径的 require（例如 require('./ui.js')）在工厂内部改写为模块表里的键。
  const moduleDir = dirname(key)
  const body = bodyLines
    .join('\n')
    .replace(/(?:__)?require\((['\"])(\.[^'\"]*)\1\)/g, (whole, quote, specifier) => {
      const normalized = posix.normalize(posix.join(moduleDir === '.' ? '' : moduleDir, specifier))
      return `__require(${JSON.stringify(normalized)})`
    })
  const factory = `  __factories[${JSON.stringify(key)}] = function (exports, module, __require) {\n${prelude}${body}\n${exports}  }\n`
  factories.set(key, factory)
  for (const dependency of collected.deps) await transform(dependency)
  return factory
}

await transform(entry)

const bundle = `${BANNER}window.__ModuleLoader__.load({\n  id: ${JSON.stringify(moduleId)},\n  factory: (require) => {\n    const __factories = Object.create(null)\n    const __cache = Object.create(null)\n    function __require(id) {\n      if (__factories[id] === undefined) return require(id)\n      if (__cache[id] !== undefined) return __cache[id].exports\n      const module = { exports: {} }\n      __cache[id] = module\n      __factories[id](module.exports, module, __require)\n      return module.exports\n    }\n${[...factories.entries()].map(([, code]) => code).join('')}    return __require(${JSON.stringify(entry)})\n  }\n})\n`

await mkdir(dirname(outFile), { recursive: true })
await writeFile(outFile, bundle, 'utf8')
process.stdout.write(`built ${outFile} (${Buffer.byteLength(bundle, 'utf8')} bytes, ${factories.size} modules)\n`)
