import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceDatabase, readWorkspaceBackup, workspaceBackup } from './workspace'
import type { WorkspaceSnapshot } from './workspace'
import { initialCostSet } from './cost-scenario'
import { productScenarioKey } from './product-pricing'

const databases: WorkspaceDatabase[] = []
const create = () => { const database = new WorkspaceDatabase(crypto.randomUUID()); databases.push(database); return database }
function snapshot(id = 'workspace-1'): WorkspaceSnapshot {
  return { version: 2, pricingProductId: 'SKU', productScenarios: {}, id, name: 'Seller data', updatedAt: new Date().toISOString(),
    dataset: { products: [{ productId: 'SKU', title: 'Charger', brand: '', market: 'US', currency: 'USD', price: 30, rating: null, reviewCount: null, capturedAt: '2026-10-01', sourceUrl: null }],
      reviews: [{ reviewId: 'R1', productId: 'SKU', locale: 'en-US', rating: 2, title: '', body: 'gets hot', reviewedAt: '2026-10-02', verifiedPurchase: null, sourceUrl: null }],
      policies: [], provenance: { products: 'user-provided', reviews: 'user-provided', policies: 'unknown' } },
    deduplicatedCount: 0, productMapping: {}, reviewMapping: {}, marketScope: 'ALL',
    pricing: { currency: 'USD', price: 30, landedCost: null, platformRate: null, adRate: null, fixedLaunchCost: null }, scenarios: {} }
}
afterEach(async () => { for (const database of databases.splice(0)) await database.delete() })

describe('transactional local workspace', () => {
  it('restores optional versioned detailed costs and preserves old backups unchanged', async () => {
    const database = create()
    const original = snapshot()
    const key = productScenarioKey(original.dataset.products[0])
    const costSet = initialCostSet({ productId: 'SKU', market: 'US', currency: 'USD' })
    costSet.scenarios[0].price = { value: 50, status: 'included', currency: 'USD', identity: 'user-assumption', source: '报价假设', updatedAt: '2026-10-06' }
    costSet.sensitivity = { schemaVersion: 'qling-cost-sensitivity/1', ranges: { price: { min: 10, max: 60 }, adRate: { min: 0, max: 0.2 }, returnRate: { min: 0, max: 0.2 }, improvement: { min: 0, max: 5 } } }
    const updated = { ...original, costSets: { [key]: costSet } }
    await database.save(updated)
    database.close()
    await database.open()
    expect((await database.restore())?.costSets).toEqual(updated.costSets)
    expect(readWorkspaceBackup(workspaceBackup(updated))).toEqual(updated)
    expect(readWorkspaceBackup(workspaceBackup(original))).not.toHaveProperty('costSets')
  })
  it('rejects foreign targets and invalid detailed costs before changing storage', async () => {
    const database = create()
    const original = snapshot()
    await database.save(original)
    const key = productScenarioKey(original.dataset.products[0])
    const set = initialCostSet({ productId: 'OTHER', market: 'US', currency: 'USD' })
    await expect(database.save({ ...original, costSets: { [key]: set } })).rejects.toThrow()
    expect(await database.restore()).toEqual(original)
  })
  it('restores after closing and reopening the database, preserving nulls', async () => {
    const database = create()
    const expected = snapshot()
    await database.save(expected)
    database.close()
    await database.open()
    expect(await database.restore()).toEqual(expected)
  })
  it('does not overwrite the first workspace when saving another', async () => {
    const database = create()
    await database.save(snapshot('first'))
    await database.save({ ...snapshot('second'), pricing: { ...snapshot().pricing, landedCost: 12 } })
    expect((await database.workspaces.get('first'))?.pricing.landedCost).toBeNull()
    expect((await database.restore())?.id).toBe('second')
  })
  it('rolls back workspace and active setting together on write failure', async () => {
    const database = create()
    await database.save(snapshot('first'))
    const failure = vi.spyOn(database.settings, 'put').mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
    await expect(database.save(snapshot('second'))).rejects.toThrow('full')
    failure.mockRestore()
    expect(await database.workspaces.get('second')).toBeUndefined()
    expect((await database.restore())?.id).toBe('first')
  })
  it('demo mode does not delete real workspaces', async () => {
    const database = create()
    await database.save(snapshot())
    await database.useDemo()
    expect(await database.restore()).toBeNull()
    expect(await database.workspaces.count()).toBe(1)
  })
  it('round-trips a strict allowlisted backup and rejects secret or future fields', () => {
    const original = snapshot()
    expect(readWorkspaceBackup(workspaceBackup(original))).toEqual(original)
    expect(() => workspaceBackup({ ...snapshot(), apiKey: 'must-not-serialize' } as WorkspaceSnapshot)).toThrow()
    expect(() => readWorkspaceBackup(JSON.stringify({ ...snapshot(), version: 99 }))).toThrow()
  })
  it('rejects invalid and orphan backups before any writes', async () => {
    const database = create()
    const invalid = snapshot()
    invalid.dataset.reviews[0].productId = 'missing'
    await expect(database.save(invalid)).rejects.toThrow('无法关联')
    expect(await database.workspaces.count()).toBe(0)
  })
  it('explicitly migrates v1 backup without assigning aggregate costs to any product', () => {
    const { pricingProductId: _product, productScenarios: _scenarios, ...original } = snapshot()
    const old = { ...original, version: 1, pricing: { ...original.pricing, landedCost: 18 } }
    const migrated = readWorkspaceBackup(JSON.stringify(old))
    expect(migrated.version).toBe(2)
    expect(migrated.pricing.landedCost).toBeNull()
    expect(migrated.productScenarios).toEqual({})
    expect(migrated.legacyDraft?.pricing.landedCost).toBe(18)
  })
  it('migrates existing IndexedDB v1 records transactionally', async () => {
    const name = crypto.randomUUID()
    const legacy = new Dexie(name)
    legacy.version(1).stores({ workspaces: 'id,updatedAt', settings: 'key' })
    const { pricingProductId: _product, productScenarios: _scenarios, ...data } = snapshot()
    await legacy.table('workspaces').put({ ...data, version: 1 })
    await legacy.table('settings').put({ key: 'activeWorkspace', value: data.id })
    legacy.close()
    const next = new WorkspaceDatabase(name)
    databases.push(next)
    expect((await next.restore())?.version).toBe(2)
    expect((await next.restore())?.legacyDraft?.pricing).toEqual(data.pricing)
  })
  it('keeps old database and all records if any migration record is invalid', async () => {
    const name = crypto.randomUUID()
    const legacy = new Dexie(name)
    legacy.version(1).stores({ workspaces: 'id,updatedAt', settings: 'key' })
    const { pricingProductId: _product, productScenarios: _scenarios, ...data } = snapshot()
    const old = { ...data, version: 1 }
    await legacy.table('workspaces').put(old)
    await legacy.table('workspaces').put({ ...old, id: 'broken', version: 99 })
    legacy.close()
    const next = new WorkspaceDatabase(name)
    databases.push(next)
    await expect(next.open()).rejects.toThrow()
    const inspect = new Dexie(name)
    inspect.version(1).stores({ workspaces: 'id,updatedAt', settings: 'key' })
    try {
      expect(await inspect.table('workspaces').get(data.id)).toEqual(old)
      expect((await inspect.table('workspaces').get('broken')).version).toBe(99)
    } finally { inspect.close() }
  })
  it('rejects product costs with mismatched currency, product or market', () => {
    expect(() => workspaceBackup({ ...snapshot(), pricingProductId: 'missing' })).toThrow('不存在')
    expect(() => workspaceBackup({ ...snapshot(), marketScope: 'EU' })).toThrow('选定市场')
    expect(() => workspaceBackup({ ...snapshot(), productScenarios: { '["SKU","US","USD"]': { ...snapshot().pricing, currency: 'EUR' } } })).toThrow('币种无效')
  })
})
