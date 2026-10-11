import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DocsError,
  INDEX_FILENAME,
  createDocsStore,
  expandHome,
  folderOf,
  isEditableKind,
  kindOf,
  mediaTypeOf,
  normalizeIndex,
  normalizeRelative,
  relativeToRoot,
  safeName,
  uniqueRelative
} from '../dsh/docs.js'

const temporary = () => mkdtemp(join(tmpdir(), 'pm-plan-docs-'))

test('kindOf / isEditableKind 覆盖常见格式', () => {
  assert.equal(kindOf('需求说明书.md'), 'markdown')
  assert.equal(kindOf('A.MARKDOWN'), 'markdown')
  assert.equal(kindOf('note.txt'), 'text')
  assert.equal(kindOf('接口清单.xlsx'), 'excel')
  assert.equal(kindOf('prd.docx'), 'word')
  assert.equal(kindOf('原型.pdf'), 'pdf')
  assert.equal(kindOf('截图.png'), 'image')
  assert.equal(kindOf('未知.xyz'), 'other')
  assert.equal(isEditableKind('markdown'), true)
  assert.equal(isEditableKind('text'), true)
  assert.equal(isEditableKind('word'), false)
  assert.match(mediaTypeOf('a.md'), /markdown/)
  assert.match(mediaTypeOf('a.pdf'), /pdf/)
  assert.equal(mediaTypeOf('a.unknown'), 'application/octet-stream')
})

test('normalizeRelative 拒绝绝对路径与 .. 逃逸', () => {
  assert.equal(normalizeRelative('a/b/c.md'), 'a/b/c.md')
  assert.equal(normalizeRelative('./a//b/./c.md'), 'a/b/c.md')
  assert.equal(normalizeRelative('a\\b\\c.md'), 'a/b/c.md')
  assert.equal(normalizeRelative(''), '')
  assert.throws(() => normalizeRelative('../secret.txt'), (error) => error instanceof DocsError)
  assert.throws(() => normalizeRelative('a/../../x'), (error) => error instanceof DocsError)
  assert.throws(() => normalizeRelative('/etc/passwd'), (error) => error instanceof DocsError)
})

test('safeName / uniqueRelative / folderOf / expandHome', () => {
  assert.equal(safeName('需求 说明书.md'), '需求 说明书.md')
  assert.equal(safeName('../../evil.md'), '.._.._evil.md')
  assert.equal(safeName('   '), '')
  assert.equal(uniqueRelative('a.md', ['a.md']), 'a-2.md')
  assert.equal(uniqueRelative('a.md', ['a.md', 'A-2.md']), 'a-3.md')
  assert.equal(uniqueRelative('d/a.md', []), 'd/a.md')
  assert.equal(folderOf('d/e/a.md'), 'd/e')
  assert.equal(folderOf('a.md'), '')
  const home = expandHome('~/Documents/x')
  assert.ok(home.endsWith('/Documents/x'))
  assert.equal(expandHome(''), '')
})

test('normalizeIndex 去重、补默认值、丢弃非法项', () => {
  const index = normalizeIndex({
    documents: [
      { id: 'd1', path: 'a.md', tags: ['需求', '  '], projectId: 'p1' },
      { path: 'a.md' },
      { path: '../evil.md' },
      { path: 'b/c.docx' },
      null
    ]
  })
  assert.equal(index.version, 1)
  assert.equal(index.documents.length, 2)
  assert.deepEqual(index.documents[0].tags, ['需求'])
  assert.equal(index.documents[1].path, 'b/c.docx')
})

test('store：目录未确认前不创建，确认后才建立并写索引', async () => {
  const base = await temporary()
  try {
    const root = join(base, '需求文档库')
    const store = createDocsStore({ root })
    const before = await store.info()
    assert.equal(before.exists, false)
    assert.equal(store.getRoot(), root)

    const after = await store.ensureRoot(root)
    assert.equal(after.exists, true)
    const index = JSON.parse(await readFile(join(root, INDEX_FILENAME), 'utf8'))
    assert.equal(index.version, 1)
    assert.deepEqual(index.documents, [])
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('store：上传、列表、读取、保存、索引更新全链路', async () => {
  const base = await temporary()
  try {
    const store = createDocsStore({ root: join(base, '库') })
    await store.ensureRoot()

    const uploaded = await store.upload({
      name: '需求说明书.md',
      folder: '手机银行',
      base64: Buffer.from('# 需求\n第一版内容\n', 'utf8').toString('base64'),
      projectId: 'p1',
      version: 'V1.0',
      tags: ['需求']
    })
    assert.equal(uploaded.path, '手机银行/需求说明书.md')
    assert.equal(uploaded.kind, 'markdown')

    // 同名再传一次 -> 自动加后缀，不覆盖
    const second = await store.upload({ name: '需求说明书.md', folder: '手机银行', base64: Buffer.from('x').toString('base64') })
    assert.equal(second.path, '手机银行/需求说明书-2.md')

    const listed = await store.list()
    assert.equal(listed.count, 2)
    const md = listed.documents.find((doc) => doc.path === '手机银行/需求说明书.md')
    assert.equal(md.projectId, 'p1')
    assert.equal(md.version, 'V1.0')
    assert.equal(md.editable, true)
    assert.ok(md.size > 0)
    assert.equal(listed.missing, 0)

    const content = await store.readText('手机银行/需求说明书.md')
    assert.match(content.text, /第一版内容/)
    assert.equal(content.editable, true)

    await store.saveText('手机银行/需求说明书.md', '# 需求\n第二版内容\n')
    const reread = await store.readText('手机银行/需求说明书.md')
    assert.match(reread.text, /第二版内容/)

    // 不可编辑格式拒绝写入
    await store.upload({ name: '接口.xlsx', base64: Buffer.from('fake').toString('base64') })
    await assert.rejects(() => store.saveText('接口.xlsx', 'x'), (error) => error instanceof DocsError)

    // 元数据
    const meta = await store.updateMeta('接口.xlsx', { projectId: 'p2', title: '接口清单', tags: ['接口'] })
    assert.equal(meta.projectId, 'p2')
    assert.equal(meta.title, '接口清单')

    // 重命名
    const renamed = await store.renameDoc('接口.xlsx', '接口清单.xlsx')
    assert.equal(renamed.path, '接口清单.xlsx')
    const afterRename = await store.list()
    assert.ok(afterRename.documents.some((doc) => doc.path === '接口清单.xlsx'))

    // 只从索引移除：文件还在
    await store.remove('接口清单.xlsx', { deleteFile: false })
    const listedAfter = await store.list()
    assert.ok(listedAfter.documents.some((doc) => doc.path === '接口清单.xlsx'), '文件应仍在磁盘上')
    assert.equal(listedAfter.documents.find((doc) => doc.path === '接口清单.xlsx').projectId, '', '索引应已清掉元数据')

    // 同时删文件
    await store.remove('手机银行/需求说明书.md', { deleteFile: true })
    const docExists = await readFile(join(store.getRoot(), '手机银行', '需求说明书.md'), 'utf8').then(() => true, () => false)
    assert.equal(docExists, false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('store：磁盘上被删掉的文件会标记为找不到', async () => {
  const base = await temporary()
  try {
    const root = join(base, '库')
    const store = createDocsStore({ root })
    await store.ensureRoot()
    await store.upload({ name: 'a.md', base64: Buffer.from('x').toString('base64'), projectId: 'p1' })
    await rm(join(root, 'a.md'))
    const listed = await store.list()
    const doc = listed.documents.find((item) => item.path === 'a.md')
    assert.equal(doc.missing, true)
    assert.equal(doc.projectId, 'p1', '索引里的元数据要保留')
    assert.equal(listed.missing, 1)
    await assert.rejects(() => store.readText('a.md'), (error) => error instanceof DocsError && error.status === 404)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('store：越过文档库范围的操作被拒绝', async () => {
  const base = await temporary()
  try {
    const root = join(base, '库')
    const store = createDocsStore({ root })
    await store.ensureRoot()
    await assert.rejects(() => store.readText('../外面.md'), (error) => error instanceof DocsError)
    await assert.rejects(() => store.saveText('/tmp/x.md', 'x'), (error) => error instanceof DocsError)
    await assert.rejects(() => store.updateMeta('../../x', {}), (error) => error instanceof DocsError)
    assert.throws(() => store.absoluteOf('..'), (error) => error instanceof DocsError)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('store：目录里有别的文件时不会被当成索引写入覆盖', async () => {
  const base = await temporary()
  try {
    const root = join(base, '库')
    const store = createDocsStore({ root })
    await store.ensureRoot()
    await writeFile(join(root, '手写笔记.md'), '# 手写\n', 'utf8')
    const listed = await store.list()
    assert.equal(listed.count, 1)
    assert.equal(listed.documents[0].path, '手写笔记.md')
    assert.equal(listed.documents[0].projectId, '')
    await store.updateMeta('手写笔记.md', { projectId: 'p9' })
    const again = await store.list()
    assert.equal(again.documents[0].projectId, 'p9')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('relativeToRoot 给出可读位置', () => {
  assert.equal(relativeToRoot('/a/b', '/a/b/c/d.md'), 'c/d.md')
  assert.equal(relativeToRoot('/a/b', '/a/b'), '.')
  assert.equal(relativeToRoot('/a/b', '/x/y.md'), '/x/y.md')
})
