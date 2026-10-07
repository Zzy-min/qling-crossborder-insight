import { describe, expect, it } from 'vitest'
import { escapeHtml, safeRasterDataUrl, safeSourceUrl } from './export-safety'

describe('export safety', () => {
  it('escapes text and attribute delimiters', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')"> &`)).toBe('&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp;')
  })

  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///C:/secret', 'https://user:password@example.com', 'not a link'])('rejects unsafe source URL: %s', (value) => {
    expect(safeSourceUrl(value)).toBeUndefined()
  })

  it('allows only credential-free HTTP source links', () => {
    expect(safeSourceUrl('https://example.com/policy')).toBe('https://example.com/policy')
  })

  it.each(['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,aaaa', 'data:image/png;base64,AAAA" onerror="alert(1)', 'https://example.com/a.png'])('rejects active or invalid image input: %s', (value) => {
    expect(safeRasterDataUrl(value)).toBeUndefined()
  })

  it('matches the declared type to the binary signature', () => {
    expect(safeRasterDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(safeRasterDataUrl('data:image/jpeg;base64,iVBORw0KGgo=')).toBeUndefined()
  })
})
