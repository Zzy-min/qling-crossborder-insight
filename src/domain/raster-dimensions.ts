export function rasterDimensions(bytes: Uint8Array, mediaType: string, limits: { dimension: number; pixels: number }) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const label = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  const invalid = () => new Error('图片尺寸头损坏、截断或格式不支持')
  const checked = (width: number, height: number) => {
    if (!width || !height || width > limits.dimension || height > limits.dimension || width * height > limits.pixels) throw new Error('图片尺寸或像素超过限制（解码前拒绝）')
    return { width, height }
  }
  if (mediaType === 'image/png') {
    if (bytes.length < 33 || label(12) !== 'IHDR' || view.getUint32(8) !== 13) throw invalid()
    const dimensions = checked(view.getUint32(16), view.getUint32(20))
    let offset = 8
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset)
      const type = label(offset + 4)
      if (size > bytes.length - offset - 12) throw invalid()
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new Error('概念参考图不接受动画')
      if (offset !== 8 && type === 'IHDR') throw invalid()
      offset += size + 12
      if (type === 'IEND') {
        if (size !== 0) throw invalid()
        return dimensions
      }
    }
    throw invalid()
  }
  if (mediaType === 'image/jpeg') {
    let offset = 2
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) throw invalid()
      while (bytes[offset] === 255) offset += 1
      const marker = bytes[offset++]
      if (marker === undefined || marker === 0 || marker === 0xda || marker === 0xd9) throw invalid()
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) throw invalid()
      const size = view.getUint16(offset)
      if (size < 2 || size > bytes.length - offset) throw invalid()
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (![0xc0, 0xc1, 0xc2].includes(marker) || size < 8) throw invalid()
        return checked(view.getUint16(offset + 5), view.getUint16(offset + 3))
      }
      offset += size
    }
    throw invalid()
  }
  if (mediaType === 'image/webp') {
    if (bytes.length < 20 || view.getUint32(4, true) !== bytes.length - 8) throw invalid()
    let canvas: { width: number; height: number } | undefined
    let frame: { width: number; height: number } | undefined
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const type = label(offset)
      const size = view.getUint32(offset + 4, true)
      const start = offset + 8
      const end = start + size + (size % 2)
      if (end > bytes.length) throw invalid()
      if (type === 'ANIM' || type === 'ANMF') throw new Error('概念参考图不接受动画')
      if (type === 'VP8X') {
        if (offset !== 12 || size !== 10 || canvas) throw invalid()
        if (bytes[start] & 2) throw new Error('概念参考图不接受动画')
        const uint24 = (position: number) => bytes[position] + bytes[position + 1] * 256 + bytes[position + 2] * 65536
        canvas = checked(uint24(start + 4) + 1, uint24(start + 7) + 1)
      }
      if (type === 'VP8 ' || type === 'VP8L') {
        if (frame) throw invalid()
        if (type === 'VP8 ') {
          if (size < 10 || (bytes[start] & 1) || bytes[start + 3] !== 157 || bytes[start + 4] !== 1 || bytes[start + 5] !== 42) throw invalid()
          frame = checked(view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff)
        } else {
          if (size < 5 || bytes[start] !== 47 || bytes[start + 4] >> 5) throw invalid()
          const packed = view.getUint32(start + 1, true)
          frame = checked((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1)
        }
      }
      offset = end
    }
    if (offset !== bytes.length || !frame || (canvas && (canvas.width !== frame.width || canvas.height !== frame.height))) throw invalid()
    return frame
  }
  throw invalid()
}
