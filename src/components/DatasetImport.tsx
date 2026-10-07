import { useEffect, useRef, useState } from 'react'
import { productFields, reviewFields, suggestMapping, importLimits } from '../domain/dataset-import'
import type { ImportPreview, FieldMapping } from '../domain/dataset-import'
import { MappingTemplateLibrary } from './MappingTemplateLibrary'

export interface DatasetImportResult extends ImportPreview {
  name: string
  productMapping: FieldMapping
  reviewMapping: FieldMapping
}

export function DatasetImport({ onImport, disabled = false }: { onImport: (result: DatasetImportResult) => void; disabled?: boolean }) {
  const [files, setFiles] = useState<{ products?: File; reviews?: File }>({})
  const [headers, setHeaders] = useState<{ products: string[]; reviews: string[] } | null>(null)
  const [productMapping, setProductMapping] = useState<FieldMapping>({})
  const [reviewMapping, setReviewMapping] = useState<FieldMapping>({})
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const worker = useRef<Worker | null>(null)
  useEffect(() => () => worker.current?.terminate(), [])

  function stop() {
    worker.current?.terminate()
    worker.current = null
    setBusy(false)
    setPreview(null)
    setConfirmed(false)
    setError('')
  }

  function run(validate: boolean) {
    stop()
    if (!files.products || !files.reviews) return
    if (files.products.size + files.reviews.size > importLimits.bytes) { setError('文件合计超过 20 MB，未提交'); return }
    const current = new Worker(new URL('../workers/dataset-import.worker.ts', import.meta.url), { type: 'module' })
    worker.current = current
    setBusy(true)
    current.onmessage = (event) => {
      if (worker.current !== current) return
      setBusy(false)
      if (event.data.error) setError(event.data.error)
      else if (event.data.preview) setPreview(event.data.preview)
      else {
        setHeaders({ products: event.data.products.headers, reviews: event.data.reviews.headers })
        setProductMapping(suggestMapping(event.data.products.headers, productFields))
        setReviewMapping(suggestMapping(event.data.reviews.headers, reviewFields))
      }
      current.terminate()
      worker.current = null
    }
    current.onerror = () => {
      if (worker.current !== current) return
      setError('后台解析失败，当前工作区没有被修改。请检查 UTF-8 CSV 格式后重试。')
      setBusy(false)
      current.terminate()
      worker.current = null
    }
    current.postMessage({ ...files, ...(validate ? { productMapping, reviewMapping } : {}) })
  }

  function choose(kind: 'products' | 'reviews', file?: File) {
    stop()
    setHeaders(null)
    setFiles((current) => ({ ...current, [kind]: file }))
  }

  const mappingForm = (kind: 'products' | 'reviews', fields: readonly string[], mapping: FieldMapping, setMapping: (value: FieldMapping) => void) => (
    <fieldset className="import-mapping">
      <legend>{kind === 'products' ? '商品字段映射' : '评论字段映射'}</legend>
      {fields.map((field) => <label key={field}>{field}<select aria-label={`${kind}-${field}`} value={mapping[field] ?? ''} onChange={(event) => { stop(); setMapping({ ...mapping, [field]: event.target.value }) }}>
        <option value="">未提供</option>
        {headers?.[kind].map((header) => <option key={header} value={header}>{header}</option>)}
      </select></label>)}
    </fieldset>
  )

  return <section className="quality-section real-import" aria-label="真实商品与评论导入">
    <div className="section-title"><div><span>SELLER DATA</span><h2>导入自己的商品与评论</h2></div><small>本地处理 · 预览确认后才替换当前数据</small></div>
    <p>UTF-8 / BOM CSV 或制表符分隔；最多 100 款商品、10,000 条评论、合计 20 MB。ASIN / SKU 可映射到 productId；同一标识跨市场请先区分，评论市场由明确的商品市场关联。</p>
    <div className="import-files">
      <label>商品 CSV<input aria-label="商品 CSV" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={disabled} onChange={(event) => choose('products', event.target.files?.[0])} /></label>
      <label>评论 CSV<input aria-label="评论 CSV" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={disabled} onChange={(event) => choose('reviews', event.target.files?.[0])} /></label>
    </div>
    <div className="source-actions"><a href="./samples/products-seller-template.csv" download>商品字段模板</a><a href="./samples/reviews-seller-template.csv" download>评论字段模板</a>
      <button type="button" disabled={disabled || busy || !files.products || !files.reviews} onClick={() => run(false)}>读取字段</button>
    </div>
    <details className="advanced-section"><summary>字段映射模板（高级）</summary><MappingTemplateLibrary headers={headers} productMapping={productMapping} reviewMapping={reviewMapping} previewValid={!!preview} disabled={disabled || busy} onApply={mapping => { stop(); setProductMapping(mapping.productMapping); setReviewMapping(mapping.reviewMapping) }} /></details>
    {headers && <><div className="import-mappings">{mappingForm('products', productFields, productMapping, setProductMapping)}{mappingForm('reviews', reviewFields, reviewMapping, setReviewMapping)}</div>
      <button type="button" disabled={disabled || busy} onClick={() => run(true)}>校验并预览</button></>}
    {busy && <p role="status">后台解析中，当前数据未修改。<button type="button" onClick={stop}>取消解析</button></p>}
    {error && <p className="validation-error" role="alert">导入未生效：{error}</p>}
    {preview && <div className="import-preview">
      <strong>预览：{preview.dataset.products.length} 款商品 / {preview.dataset.reviews.length} 条评论 / 去重 {preview.deduplicatedCount} 条</strong>
      {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
      {preview.dataset.products.slice(0, 3).map((product) => <p key={product.productId}>{product.productId} · {product.title} · {product.market} / {product.currency} · {product.price} · 平台评论总数 {product.reviewCount ?? '未知'}</p>)}
      {preview.dataset.reviews.slice(0, 3).map((review) => <p key={review.reviewId}>{review.reviewId} · {review.body.slice(0, 150)}{review.body.length > 150 ? '（预览仅展示前 150 字，导入保留全文）' : ''}</p>)}
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我有权使用这些数据，已检查来源和疑似个人信息，明白其未经平台独立验证</label>
      <button type="button" disabled={!confirmed || disabled} onClick={() => { onImport({ ...preview, name: files.products?.name ?? '用户工作区', productMapping, reviewMapping }); setPreview(null); setConfirmed(false) }}>确认导入工作区</button>
    </div>}
  </section>
}
