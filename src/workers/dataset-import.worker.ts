import { importLimits, readImportTable, previewDataset } from '../domain/dataset-import'
import type { FieldMapping } from '../domain/dataset-import'

self.onmessage = async (event: MessageEvent<{ products: File; reviews: File; productMapping?: FieldMapping; reviewMapping?: FieldMapping }>) => {
  try {
    const input = event.data
    if (input.products.size + input.reviews.size > importLimits.bytes) throw new Error('两个文件合计不得超过 20 MB，未截断或提交')
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const products = readImportTable(decoder.decode(await input.products.arrayBuffer()), 'products')
    const reviews = readImportTable(decoder.decode(await input.reviews.arrayBuffer()), 'reviews')
    if (input.productMapping && input.reviewMapping) {
      self.postMessage({ preview: previewDataset(products, reviews, input.productMapping, input.reviewMapping) })
    } else {
      self.postMessage({ products: { headers: products.headers }, reviews: { headers: reviews.headers } })
    }
  } catch (caught) {
    self.postMessage({ error: caught instanceof Error ? caught.message : '导入解析失败' })
  }
}
