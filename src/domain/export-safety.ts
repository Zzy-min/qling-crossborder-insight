export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]!))
}

export function safeSourceUrl(value: string | null): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}

export function safeRasterDataUrl(value: string | undefined): string | undefined {
  if (!value || value.length > 5_400_000) return undefined
  const matched = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!matched) return undefined
  try {
    const bytes = atob(matched[2])
    if (bytes.length === 0 || bytes.length > 4_000_000) return undefined
    const type = matched[1]
    const png = bytes.startsWith('\x89PNG\r\n\x1a\n')
    const jpeg = bytes.startsWith('\xff\xd8\xff')
    const webp = bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP'
    return (type === 'png' && png) || (type === 'jpeg' && jpeg) || (type === 'webp' && webp) ? value : undefined
  } catch {
    return undefined
  }
}
