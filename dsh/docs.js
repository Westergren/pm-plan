/**
 * 需求文档库：本机目录 + 索引。
 *
 * 设计要点：
 * - 文档本体存在用户指定的本地目录（`root`），工作台不自己建目录、不猜位置；
 * - 目录元数据（项目/工单/标签/备注/版本）存在该目录下的 `index.json`，自包含、可随目录搬走；
 * - 路径安全：所有相对路径先 resolve 再用前缀校验，`..` 逃逸一律拒绝；
 * - 工作台只主动打开文件，删除必须是调用方显式传 `deleteFile: true`。
 */

import { copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024
export const MAX_TEXT_BYTES = 4 * 1024 * 1024
export const INDEX_FILENAME = 'index.json'
export const INDEX_VERSION = 1
export const INDEX_LIMIT = 2000

const SKIP_DIRS = new Set(['node_modules', '.git', '.DS_Store', '.Trash', 'Library'])

export class DocsError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'DocsError'
    this.status = status
  }
}

/** 扩展名 → 类型，用于界面分类与预览方式。 */
export function kindOf(name) {
  const ext = extname(String(name || '')).toLowerCase()
  if (ext === '.md' || ext === '.markdown') return 'markdown'
  if (['.txt', '.log', '.csv', '.json', '.yml', '.yaml'].includes(ext)) return 'text'
  if (['.doc', '.docx', '.rtf', '.odt'].includes(ext)) return 'word'
  if (['.xls', '.xlsx', '.ods'].includes(ext)) return 'excel'
  if (ext === '.pdf') return 'pdf'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.heic'].includes(ext)) return 'image'
  if (['.ppt', '.pptx'].includes(ext)) return 'slide'
  if (['.zip', '.rar', '.7z'].includes(ext)) return 'archive'
  return 'other'
}

export function isEditableKind(kind) {
  return kind === 'markdown' || kind === 'text'
}

export function mediaTypeOf(name) {
  const ext = extname(String(name || '')).toLowerCase()
  const table = {
    '.md': 'text/markdown; charset=utf-8',
    '.markdown': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.log': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.yml': 'text/yaml; charset=utf-8',
    '.yaml': 'text/yaml; charset=utf-8',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  return table[ext] || 'application/octet-stream'
}

/** 文件名安全化：去掉路径分隔与控制字符，保留中文。 */
export function safeName(name) {
  const base = String(name || '')
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
  if (!base || base === '.' || base === '..') return ''
  return base.slice(0, 180)
}

/** 相对路径规整：统一用 `/`，拒绝绝对路径与 `..` 逃逸。 */
export function normalizeRelative(value) {
  const raw = String(value || '').replace(/\\/g, '/').trim()
  if (!raw) return ''
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) throw new DocsError('只接受相对路径。')
  const segments = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') throw new DocsError('路径不能包含 ".."。')
    segments.push(part)
  }
  if (!segments.length) return ''
  return segments.join('/')
}

/** Windows 与 macOS 都按不区分大小写比较，避免同目录被判成逃逸。 */
function withinRoot(root, target) {
  const rootLower = root.toLowerCase().replace(/\/+$/, '')
  const targetLower = target.toLowerCase()
  return targetLower === rootLower || targetLower.startsWith(`${rootLower}${sep}`)
}

export function assertInside(root, absolute) {
  const target = normalize(resolve(absolute))
  if (!withinRoot(normalize(resolve(root)), target)) throw new DocsError('路径超出文档库范围。', 403)
  return target
}

export function expandHome(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return join(homedir(), text.slice(2))
  return text
}

/** 从绝对路径推出「相对文档库根目录」的显示位置；不在库内则返回原路径。 */
export function relativeToRoot(root, absolute) {
  const base = normalize(resolve(root))
  const target = normalize(resolve(absolute))
  if (!withinRoot(base, target)) return target
  const rest = target.slice(base.length).replace(/^[/\\]/, '')
  return rest || '.'
}

export function folderOf(relative) {
  const index = String(relative).lastIndexOf('/')
  return index < 0 ? '' : String(relative).slice(0, index)
}

/** 磁盘上是否已经有这个名字（索引之外、用户手工放进目录的文件也算）。 */
async function existsOnDisk(absolute) {
  try {
    await stat(absolute)
    return true
  } catch {
    return false
  }
}

/** 冲突时自动加 `-2`、`-3` 后缀。 */
export function uniqueRelative(relative, taken) {
  const set = new Set([...taken].map((item) => item.toLowerCase()))
  if (!set.has(relative.toLowerCase())) return relative
  const ext = extname(relative)
  const stem = relative.slice(0, relative.length - ext.length)
  for (let index = 2; index < 500; index += 1) {
    const candidate = `${stem}-${index}${ext}`
    if (!set.has(candidate.toLowerCase())) return candidate
  }
  throw new DocsError('同名文件过多，请换一个文件名。')
}

export function normalizeIndex(raw, now = new Date().toISOString()) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const documents = []
  const seen = new Set()
  for (const item of Array.isArray(source.documents) ? source.documents : []) {
    if (!item || typeof item !== 'object') continue
    const relative = (() => {
      try {
        return normalizeRelative(item.path)
      } catch {
        return ''
      }
    })()
    if (!relative || seen.has(relative.toLowerCase())) continue
    seen.add(relative.toLowerCase())
    documents.push({
      id: String(item.id || '').trim() || `doc-${documents.length + 1}`,
      path: relative,
      projectId: String(item.projectId || '').trim(),
      orderId: String(item.orderId || '').trim(),
      title: String(item.title || '').trim().slice(0, 200),
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12) : [],
      note: String(item.note || '').slice(0, 2000),
      version: String(item.version || '').trim().slice(0, 40),
      addedAt: String(item.addedAt || now),
      updatedAt: String(item.updatedAt || now)
    })
  }
  return { version: INDEX_VERSION, updatedAt: String(source.updatedAt || now), documents: documents.slice(0, INDEX_LIMIT) }
}

async function walkFiles(root, limit = 5000) {
  const found = []
  const queue = ['']
  while (queue.length && found.length < limit) {
    const relativeDir = queue.shift()
    const absoluteDir = relativeDir ? join(root, ...relativeDir.split('/')) : root
    let entries
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        queue.push(relativeDir ? `${relativeDir}/${entry.name}` : entry.name)
        continue
      }
      if (!entry.isFile()) continue
      found.push(relativeDir ? `${relativeDir}/${entry.name}` : entry.name)
      if (found.length >= limit) break
    }
  }
  return found
}

/** 文档库里的全部子目录（含没有文件的空目录），跳过隐藏目录与 SKIP_DIRS。 */
async function walkDirs(root, limit = 2000) {
  const found = []
  const queue = ['']
  while (queue.length && found.length < limit) {
    const relativeDir = queue.shift()
    const absoluteDir = relativeDir ? join(root, ...relativeDir.split('/')) : root
    let entries
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      if (SKIP_DIRS.has(entry.name)) continue
      const child = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      found.push(child)
      queue.push(child)
      if (found.length >= limit) break
    }
  }
  return found.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
}

/**
 * 创建文档库存储。`root` 由插件配置提供（默认 `~/Documents/项目计划工作台文档`），
 * 但**只有用户在界面确认后**才会被 mkdir（`ensureRoot`）。
 */
export function createDocsStore({ root }) {
  const configured = root && String(root).trim() ? String(root).trim() : join(homedir(), 'Documents', '项目计划工作台文档')
  let currentRoot = normalize(resolve(configured))

  const indexPath = () => join(currentRoot, INDEX_FILENAME)

  const info = async () => {
    let exists = false
    let fileCount = 0
    try {
      const entries = await readdir(currentRoot, { withFileTypes: true })
      exists = true
      fileCount = entries.filter((entry) => entry.isFile()).length
    } catch {
      exists = false
    }
    return { root: currentRoot, exists, fileCount, indexFile: indexPath() }
  }

  const readIndex = async () => {
    try {
      const text = await readFile(indexPath(), 'utf8')
      return normalizeIndex(JSON.parse(text))
    } catch (error) {
      if (error && error.code === 'ENOENT') return normalizeIndex(null)
      if (error instanceof SyntaxError) throw new DocsError('文档索引 index.json 不是合法 JSON，已保留原文件不做覆盖。', 500)
      throw new DocsError(`读取文档索引失败：${error instanceof Error ? error.message : String(error)}`, 500)
    }
  }

  const writeIndex = async (index) => {
    const next = normalizeIndex({ ...index, updatedAt: new Date().toISOString() })
    await mkdir(currentRoot, { recursive: true })
    const temporary = `${indexPath()}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, JSON.stringify(next, null, 2), 'utf8')
    await rename(temporary, indexPath())
    return next
  }

  const ensureRoot = async (value) => {
    const expanded = value === undefined || value === null || String(value).trim() === ''
      ? currentRoot
      : normalize(resolve(expandHome(value)))
    if (!expanded) throw new DocsError('请先指定文档库目录。')
    try {
      await mkdir(expanded, { recursive: true })
    } catch (error) {
      throw new DocsError(`无法创建或访问目录：${error instanceof Error ? error.message : String(error)}`, 500)
    }
    currentRoot = expanded
    await writeIndex(await readIndex())
    return info()
  }

  const absoluteOf = (relative) => {
    const clean = normalizeRelative(relative)
    if (!clean) throw new DocsError('缺少文件路径。')
    return assertInside(currentRoot, join(currentRoot, ...clean.split('/')))
  }

  const list = async () => {
    const index = await readIndex()
    const known = new Map(index.documents.map((doc) => [doc.path.toLowerCase(), doc]))
    const files = await walkFiles(currentRoot)
    const onDisk = new Set(files.map((item) => item.toLowerCase()))
    const documents = []
    for (const relative of files) {
      if (relative === INDEX_FILENAME) continue
      const meta = known.get(relative.toLowerCase()) || null
      const name = relative.slice(relative.lastIndexOf('/') + 1)
      const kind = kindOf(name)
      let size = 0
      try {
        const stat = await readFile(absoluteOf(relative))
        size = stat.length
      } catch {
        size = 0
      }
      documents.push({
        id: meta?.id || `auto:${relative}`,
        path: relative,
        name,
        folder: folderOf(relative),
        kind,
        editable: isEditableKind(kind),
        size,
        projectId: meta?.projectId || '',
        orderId: meta?.orderId || '',
        title: meta?.title || '',
        tags: meta?.tags || [],
        note: meta?.note || '',
        version: meta?.version || '',
        addedAt: meta?.addedAt || '',
        updatedAt: meta?.updatedAt || '',
        missing: false
      })
    }
    // 索引里有、磁盘上已不在的，标为「找不到」
    for (const doc of index.documents) {
      if (onDisk.has(doc.path.toLowerCase())) continue
      const name = doc.path.slice(doc.path.lastIndexOf('/') + 1)
      const kind = kindOf(name)
      documents.push({ ...doc, name, folder: folderOf(doc.path), kind, editable: isEditableKind(kind), size: 0, missing: true })
    }
    documents.sort((left, right) => left.path.localeCompare(right.path, 'zh-Hans-CN'))
    // 目录是一等条目：没有文件的空目录也要列出来，界面才能管理它们。
    const folders = (await walkDirs(currentRoot)).map((path) => ({
      path,
      name: path.slice(path.lastIndexOf('/') + 1)
    }))
    return {
      root: currentRoot,
      documents,
      folders,
      count: documents.length,
      missing: documents.filter((doc) => doc.missing).length
    }
  }

  const readText = async (relative) => {
    const absolute = absoluteOf(relative)
    let buffer
    try {
      buffer = await readFile(absolute)
    } catch (error) {
      if (error && error.code === 'ENOENT') throw new DocsError('文件不存在，可能已被移动或删除。', 404)
      throw new DocsError(`读取失败：${error instanceof Error ? error.message : String(error)}`, 500)
    }
    if (buffer.length > MAX_TEXT_BYTES) throw new DocsError('文件太大，界面内只预览 4 MB 以内的文本。', 413)
    const kind = kindOf(relative)
    return { path: normalizeRelative(relative), kind, editable: isEditableKind(kind), mediaType: mediaTypeOf(relative), text: buffer.toString('utf8') }
  }

  const saveText = async (relative, text) => {
    const absolute = absoluteOf(relative)
    const kind = kindOf(relative)
    if (!isEditableKind(kind)) throw new DocsError('这个格式不支持在界面内编辑，请用系统默认程序打开。')
    const value = String(text ?? '')
    if (Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES) throw new DocsError('内容超过 4 MB 上限。', 413)
    await mkdir(dirname(absolute), { recursive: true })
    const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, value, 'utf8')
    await rename(temporary, absolute)
    const index = await readIndex()
    const key = normalizeRelative(relative).toLowerCase()
    const existing = index.documents.find((doc) => doc.path.toLowerCase() === key)
    if (existing) {
      existing.updatedAt = new Date().toISOString()
      await writeIndex(index)
    }
    return { path: normalizeRelative(relative), bytes: Buffer.byteLength(value, 'utf8') }
  }

  /** 把一次导入登记进索引。 */
  const recordDoc = (index, target, meta) => {
    const now = new Date().toISOString()
    const doc = {
      id: `doc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      path: target,
      projectId: String(meta.projectId || '').trim(),
      orderId: String(meta.orderId || '').trim(),
      title: String(meta.title || meta.clean).trim().slice(0, 200),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      note: String(meta.note || '').slice(0, 2000),
      version: String(meta.version || '').trim().slice(0, 40),
      addedAt: now,
      updatedAt: now
    }
    index.documents.push(doc)
    return doc
  }

  /**
   * 在文档库里给 `clean` 找一个不会被覆盖的相对路径：
   * 索引里没有、但磁盘上已有的同名文件也会被 rename 悄悄盖掉，所以要一并让位。
   */
  const freeRelative = async (clean, folder, taken) => {
    const base = normalizeRelative([folder || '', clean].filter(Boolean).join('/'))
    const used = [...taken]
    let target = uniqueRelative(base, used)
    for (let guard = 0; guard < 500 && await existsOnDisk(absoluteOf(target)); guard += 1) {
      used.push(target)
      target = uniqueRelative(base, used)
    }
    return target
  }

  /**
   * **移动**导入：源文件有本机绝对路径时走这里——优先 rename（同盘瞬时完成、不留副本），
   * 跨设备（U 盘 / 外置盘）则先 copyFile 成功后再 unlink 源文件；复制失败时源文件原封不动。
   * 浏览器拿不到路径时退回下面 upload 的「复制内容」分支。
   */
  const moveInto = async (sourcePath, { clean, folder, projectId, orderId, title, tags, note, version }) => {
    const from = resolve(expandHome(sourcePath))
    let stats
    try {
      stats = await stat(from)
    } catch {
      throw new DocsError('找不到要导入的源文件。', 404)
    }
    if (!stats.isFile()) throw new DocsError('只能导入文件，不能导入目录。')
    if (stats.size > MAX_UPLOAD_BYTES) throw new DocsError('单个文件不能超过 32 MB。', 413)

    const index = await readIndex()
    const target = await freeRelative(clean, folder, index.documents.map((doc) => doc.path))
    const absolute = absoluteOf(target)
    if (absolute === from) throw new DocsError('源文件已经在文档库的这个位置。')

    await mkdir(dirname(absolute), { recursive: true })
    try {
      await rename(from, absolute)
    } catch (error) {
      if (error && error.code === 'EXDEV') {
        await copyFile(from, absolute)
        await unlink(from)
      } else {
        throw new DocsError(`移动到文档库失败：${error instanceof Error ? error.message : String(error)}`, 500)
      }
    }
    const doc = recordDoc(index, target, { clean, projectId, orderId, title, tags, note, version })
    await writeIndex(index)
    return { id: doc.id, path: target, bytes: stats.size, kind: kindOf(target), mode: 'moved' }
  }

  const upload = async ({ name, folder, base64, sourcePath, projectId, orderId, title, tags, note, version }) => {
    const clean = safeName(name)
    if (!clean) throw new DocsError('需要提供文件名。')
    const meta = { clean, projectId, orderId, title, tags, note, version }
    if (typeof sourcePath === 'string' && sourcePath.trim()) return moveInto(sourcePath.trim(), { ...meta, folder })
    if (typeof base64 !== 'string' || !base64) throw new DocsError('需要提供文件内容。')
    let buffer
    try {
      buffer = Buffer.from(base64, 'base64')
    } catch {
      throw new DocsError('文件内容不是合法的 base64。')
    }
    if (!buffer.length) throw new DocsError('文件内容为空。')
    if (buffer.length > MAX_UPLOAD_BYTES) throw new DocsError('单个文件不能超过 32 MB。', 413)
    const index = await readIndex()
    const target = uniqueRelative(normalizeRelative([folder || '', clean].filter(Boolean).join('/')), index.documents.map((doc) => doc.path))
    const absolute = absoluteOf(target)
    await mkdir(dirname(absolute), { recursive: true })
    const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, buffer)
    await rename(temporary, absolute)
    const doc = recordDoc(index, target, meta)
    await writeIndex(index)
    return { id: doc.id, path: target, bytes: buffer.length, kind: kindOf(target), mode: 'copied' }
  }

  const updateMeta = async (relative, patch) => {
    const clean = normalizeRelative(relative)
    const index = await readIndex()
    const key = clean.toLowerCase()
    const now = new Date().toISOString()
    let doc = index.documents.find((item) => item.path.toLowerCase() === key)
    if (!doc) {
      doc = { id: `doc-${Date.now().toString(36)}`, path: clean, projectId: '', orderId: '', title: '', tags: [], note: '', version: '', addedAt: now, updatedAt: now }
      index.documents.push(doc)
    }
    if ('projectId' in patch) doc.projectId = String(patch.projectId || '').trim()
    if ('orderId' in patch) doc.orderId = String(patch.orderId || '').trim()
    if ('title' in patch) doc.title = String(patch.title || '').trim().slice(0, 200)
    if ('note' in patch) doc.note = String(patch.note || '').slice(0, 2000)
    if ('version' in patch) doc.version = String(patch.version || '').trim().slice(0, 40)
    if ('tags' in patch) doc.tags = Array.isArray(patch.tags) ? patch.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12) : []
    doc.updatedAt = now
    await writeIndex(index)
    return doc
  }

  const remove = async (relative, { deleteFile = false } = {}) => {
    const clean = normalizeRelative(relative)
    const index = await readIndex()
    index.documents = index.documents.filter((doc) => doc.path.toLowerCase() !== clean.toLowerCase())
    await writeIndex(index)
    if (deleteFile) {
      await rm(absoluteOf(clean), { force: true })
      return { path: clean, fileDeleted: true }
    }
    return { path: clean, fileDeleted: false }
  }

  const renameDoc = async (relative, nextName) => {
    const clean = normalizeRelative(relative)
    const name = safeName(nextName)
    if (!name) throw new DocsError('需要提供新的文件名。')
    const folder = folderOf(clean)
    const index = await readIndex()
    const taken = index.documents.map((doc) => doc.path)
    const target = uniqueRelative(normalizeRelative([folder, name].filter(Boolean).join('/')), taken)
    if (target.toLowerCase() === clean.toLowerCase()) return { path: clean }
    const from = absoluteOf(clean)
    const to = absoluteOf(target)
    try {
      await rename(from, to)
    } catch (error) {
      throw new DocsError(`重命名失败：${error instanceof Error ? error.message : String(error)}`, 500)
    }
    const doc = index.documents.find((item) => item.path.toLowerCase() === clean.toLowerCase())
    if (doc) doc.path = target
    doc && (doc.updatedAt = new Date().toISOString())
    await writeIndex(index)
    return { path: target }
  }

  /** 目录动作只接受库内相对路径，且不允许指向根目录本身。 */
  const folderTarget = (relative) => {
    const clean = normalizeRelative(relative)
    if (!clean) throw new DocsError('需要提供目录路径。')
    return clean
  }

  const statOrNull = async (absolute) => {
    try {
      return await stat(absolute)
    } catch {
      return null
    }
  }

  const createFolder = async (relative) => {
    const clean = folderTarget(relative)
    const absolute = absoluteOf(clean)
    const existing = await statOrNull(absolute)
    if (existing && !existing.isDirectory()) throw new DocsError('同名文件已经存在。', 409)
    if (existing) return { path: clean, created: false }
    try {
      await mkdir(absolute, { recursive: true })
    } catch (error) {
      throw new DocsError(`新建目录失败：${error instanceof Error ? error.message : String(error)}`, 500)
    }
    return { path: clean, created: true }
  }

  const renameFolder = async (relative, nextName) => {
    const clean = folderTarget(relative)
    const name = safeName(nextName)
    if (!name) throw new DocsError('需要提供新的目录名。')
    const target = normalizeRelative([folderOf(clean), name].filter(Boolean).join('/'))
    if (!target) throw new DocsError('目录名不合法。')
    if (target.toLowerCase() === clean.toLowerCase()) return { path: clean, moved: 0 }
    const to = absoluteOf(target)
    if (await statOrNull(to)) throw new DocsError('同名目录已经存在。', 409)
    try {
      await rename(absoluteOf(clean), to)
    } catch (error) {
      throw new DocsError(`重命名目录失败：${error instanceof Error ? error.message : String(error)}`, 500)
    }
    // 索引里记的是每个文件的相对路径：目录一改名，整棵子树的 path 都要跟着改，
    // 否则它们会在下次 list() 时全部变成「找不到」。
    const index = await readIndex()
    const prefix = `${clean}/`
    const stamp = new Date().toISOString()
    let moved = 0
    for (const doc of index.documents) {
      if (!doc.path.toLowerCase().startsWith(prefix.toLowerCase())) continue
      doc.path = `${target}/${doc.path.slice(prefix.length)}`
      doc.updatedAt = stamp
      moved += 1
    }
    await writeIndex(index)
    return { path: target, moved }
  }

  const deleteFolder = async (relative, { deleteFiles = false } = {}) => {
    const clean = folderTarget(relative)
    const prefix = `${clean}/`
    const index = await readIndex()
    const inside = index.documents.filter((doc) => doc.path.toLowerCase().startsWith(prefix.toLowerCase()))
    index.documents = index.documents.filter((doc) => !doc.path.toLowerCase().startsWith(prefix.toLowerCase()))
    await writeIndex(index)
    if (!deleteFiles) return { path: clean, removed: inside.length, filesDeleted: false }
    try {
      await rm(absoluteOf(clean), { recursive: true, force: true })
    } catch (error) {
      throw new DocsError(`删除目录失败：${error instanceof Error ? error.message : String(error)}`, 500)
    }
    return { path: clean, removed: inside.length, filesDeleted: true }
  }

  return {
    info, ensureRoot, list, readText, saveText, upload, updateMeta, remove, renameDoc,
    createFolder, renameFolder, deleteFolder,
    absoluteOf, getRoot: () => currentRoot
  }
}
