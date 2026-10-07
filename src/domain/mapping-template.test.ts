import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMappingTemplate, validateMappingTemplate, applyMappingTemplate, mappingTemplateBackup, readMappingTemplateBackup } from './mapping-template'
import { WorkspaceDatabase } from './workspace'
import { suggestMapping, productFields, reviewFields } from './dataset-import'
import { canonicalJson, sha256Hex } from './integrity'

const headers = { products: ['SKU', 'title', 'market', 'currency', 'price', 'capturedAt'], reviews: ['reviewId', 'SKU', 'locale', 'rating', 'body', 'reviewedAt'] }
const productMapping = suggestMapping(headers.products, productFields)
const reviewMapping = suggestMapping(headers.reviews, reviewFields)
const create = () => createMappingTemplate('用户映射', headers, productMapping, reviewMapping)
const databases: WorkspaceDatabase[] = []
const database = () => { const db = new WorkspaceDatabase(crypto.randomUUID()); databases.push(db); return db }
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete() })
function rehash(template: ReturnType<typeof create>) { const { contentDigest: _digest, ...content } = template; return { ...content, contentDigest: sha256Hex(canonicalJson(content)) } }

describe('local mapping templates without dataset values', () => {
  it('stores only explicitly mapped metadata and applies shuffled columns without assuming market/currency values', () => {
    const template = create()
    const applied = applyMappingTemplate(template, { products: [...headers.products].reverse(), reviews: [...headers.reviews].reverse() })
    expect(applied).toEqual({ productMapping, reviewMapping })
    expect(applied.productMapping.currency).toBe('currency')
    expect(template).not.toHaveProperty('dataset')
    applied.productMapping.productId = 'changed'
    expect(template.productMapping.productId).toBe('SKU')
  })
  it.each(['missing', 'renamed', 'additional'])('rejects %s headers without partially applying a template', change => {
    const changed = { products: [...headers.products], reviews: [...headers.reviews] }
    if (change === 'missing') changed.products.pop()
    if (change === 'renamed') changed.reviews[0] = 'otherId'
    if (change === 'additional') changed.products.push('notes')
    expect(() => applyMappingTemplate(create(), changed)).toThrow('表头集合不匹配')
  })
  it('rejects tampering, unknown keys, credential fields and private columns even after rehashing', () => {
    const template = create()
    expect(() => validateMappingTemplate({ ...template, name: 'changed' })).toThrow('指纹')
    expect(() => validateMappingTemplate({ ...template, apiKey: 'synthetic' })).toThrow()
    expect(() => validateMappingTemplate(rehash({ ...template, productMapping: { ...productMapping, apiKey: 'SKU' } }))).toThrow('未知字段')
    expect(() => createMappingTemplate('private', { ...headers, products: [...headers.products, 'Email'] }, productMapping, reviewMapping)).toThrow('个人信息')
  })
  it('rejects missing required fields, duplicate mapping and repeated normalized headers', () => {
    expect(() => createMappingTemplate('empty', headers, { ...productMapping, market: '' }, reviewMapping)).toThrow('字段缺失')
    expect(() => createMappingTemplate('duplicate', headers, { ...productMapping, brand: 'title' }, reviewMapping)).toThrow('重复')
    expect(() => createMappingTemplate('duplicate', { ...headers, products: [...headers.products, 'Market'] }, productMapping, reviewMapping)).toThrow('表头重复')
    expect(() => createMappingTemplate('', headers, productMapping, reviewMapping)).toThrow()
  })
  it('restores a new non-overwriting identity, traces the original digest and enforces backup size/version', () => {
    const original = create()
    const restored = readMappingTemplateBackup(mappingTemplateBackup(original))
    expect(restored.id).not.toBe(original.id)
    expect(restored.contentDigest).not.toBe(original.contentDigest)
    expect(restored.originDigest).toBe(original.contentDigest)
    expect(restored.productMapping).toEqual(original.productMapping)
    expect(() => readMappingTemplateBackup(' '.repeat(100_001))).toThrow('100 KB')
    expect(() => readMappingTemplateBackup(JSON.stringify({ ...original, schemaVersion: 'unknown' }))).toThrow()
  })
  it('persists across reopen and never overwrites an existing template ID', async () => {
    const db = database(); const template = create()
    await db.saveMappingTemplate(template)
    db.close(); await db.open()
    expect(await db.listMappingTemplates()).toEqual([template])
    await expect(db.saveMappingTemplate(template)).rejects.toThrow()
    expect(await db.mappingTemplates.count()).toBe(1)
  })
  it('rejects quota failures and the 51st template without deleting any original record', async () => {
    const db = database()
    const failure = vi.spyOn(db.mappingTemplates, 'add').mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
    await expect(db.saveMappingTemplate(create())).rejects.toThrow('full')
    expect(await db.mappingTemplates.count()).toBe(0)
    failure.mockRestore()
    for (let index = 0; index < 50; index += 1) await db.saveMappingTemplate(create())
    await expect(db.saveMappingTemplate(create())).rejects.toThrow('50')
    expect(await db.mappingTemplates.count()).toBe(50)
  })
  it('adds only an empty template table to version 5 and retains existing stored data', async () => {
    const name = crypto.randomUUID(); const old = new Dexie(name)
    old.version(5).stores({ workspaces: 'id,updatedAt', settings: 'key', analysisRuns: 'id,workspaceId,[workspaceId+createdAt]', humanReviews: 'id,workspaceId,runId,&[runId+revision]', validationTasks: 'id,workspaceId,runId,taskId,&[taskId+revision]', taskAttachments: 'id,workspaceId,taskId' })
    const stored = { id: 'preserved-record', workspaceId: 'workspace', opaque: 'existing bytes not interpreted by template migration' }
    await old.table('analysisRuns').add(stored)
    old.close()
    const db = new WorkspaceDatabase(name); databases.push(db); await db.open()
    expect(await db.analysisRuns.get(stored.id)).toEqual(stored)
    expect(await db.mappingTemplates.count()).toBe(0)
  })
})
