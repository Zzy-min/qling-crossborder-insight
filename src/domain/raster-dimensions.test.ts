import { describe, expect, it } from 'vitest'
import { rasterDimensions } from './raster-dimensions'

const limits = { dimension: 4096, pixels: 4_194_304 }
function png(width: number, height: number) {
  const bytes = new Uint8Array(45)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13); bytes.set(new TextEncoder().encode('IHDR'), 12)
  view.setUint32(16, width); view.setUint32(20, height)
  bytes.set(new TextEncoder().encode('IEND'), 37)
  return bytes
}
function jpeg(width: number, height: number) {
  const bytes = new Uint8Array([255, 216, 255, 224, 0, 4, 0, 0, 255, 194, 0, 11, 8, 0, 0, 0, 0, 1, 1, 17, 0])
  const view = new DataView(bytes.buffer); view.setUint16(13, height); view.setUint16(15, width)
  return bytes
}
function webp(width: number, height: number, extended = false, lossless = false) {
  const chunks = extended ? 18 : 0
  const size = lossless ? 6 : 10
  const bytes = new Uint8Array(20 + chunks + size)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('RIFF'), 0); view.setUint32(4, bytes.length - 8, true); bytes.set(new TextEncoder().encode('WEBP'), 8)
  if (extended) {
    bytes.set(new TextEncoder().encode('VP8X'), 12); view.setUint32(16, 10, true)
    for (const [offset, value] of [[24, width - 1], [27, height - 1]]) for (let index = 0; index < 3; index += 1) bytes[offset + index] = (value >>> (index * 8)) & 255
  }
  const offset = 12 + chunks
  bytes.set(new TextEncoder().encode(lossless ? 'VP8L' : 'VP8 '), offset); view.setUint32(offset + 4, lossless ? 5 : 10, true)
  if (lossless) { bytes[offset + 8] = 47; view.setUint32(offset + 9, (width - 1) | ((height - 1) << 14), true) }
  else { bytes.set([0, 0, 0, 157, 1, 42], offset + 8); view.setUint16(offset + 14, width, true); view.setUint16(offset + 16, height, true) }
  return bytes
}

describe('raster pre-decode dimensions', () => {
  it('reads PNG, progressive JPEG and static lossy/lossless/extended WebP dimensions', () => {
    for (const [bytes, type] of [[png(3, 2), 'image/png'], [jpeg(3, 2), 'image/jpeg'], [webp(3, 2), 'image/webp'], [webp(3, 2, true), 'image/webp'], [webp(3, 2, false, true), 'image/webp']] as const) expect(rasterDimensions(bytes, type, limits)).toEqual({ width: 3, height: 2 })
  })
  it('rejects oversized dimensions, pixel bombs and zero dimensions before native decode', () => {
    for (const [width, height] of [[4097, 1], [4096, 4096], [0, 1]]) {
      for (const [bytes, type] of [[png(width, height), 'image/png'], [jpeg(width, height), 'image/jpeg'], [webp(width || 16384, height), 'image/webp']] as const) expect(() => rasterDimensions(bytes, type, limits)).toThrow('超过限制')
    }
  })
  it('rejects truncated, conflicting and animated headers without guessing dimensions', () => {
    const animatedPng = png(1, 1); animatedPng.set(new TextEncoder().encode('acTL'), 37)
    const animatedWebp = webp(1, 1, true); animatedWebp[20] = 2
    const conflicting = webp(1, 1, true); conflicting[24] = 1
    for (const [bytes, type] of [[animatedPng, 'image/png'], [animatedWebp, 'image/webp'], [conflicting, 'image/webp'], [png(1, 1).subarray(0, 32), 'image/png'], [jpeg(1, 1).subarray(0, 16), 'image/jpeg'], [webp(1, 1).subarray(0, 25), 'image/webp']] as const) expect(() => rasterDimensions(bytes, type, limits)).toThrow()
    const invalidSegment = jpeg(1, 1); invalidSegment[5] = 0
    expect(() => rasterDimensions(invalidSegment, 'image/jpeg', limits)).toThrow()
  })
  it('enforces the pixel boundary without rejecting permitted large static images', () => {
    expect(rasterDimensions(png(2048, 2048), 'image/png', limits)).toEqual({ width: 2048, height: 2048 })
    expect(rasterDimensions(webp(4096, 1024, true, true), 'image/webp', limits)).toEqual({ width: 4096, height: 1024 })
    expect(() => rasterDimensions(jpeg(2048, 2049), 'image/jpeg', limits)).toThrow('超过限制')
  })
})
