import { describe, expect, it } from 'vitest'
import { marketLabel, severityLabel } from './labels'

describe('display labels', () => {
  it('maps internal market enums to Chinese names', () => {
    expect(marketLabel('US')).toBe('美国')
    expect(marketLabel('EU')).toBe('欧盟')
  })

  it('maps internal severity enums to Chinese labels', () => {
    expect(severityLabel('low')).toBe('低风险')
    expect(severityLabel('medium')).toBe('中风险')
    expect(severityLabel('high')).toBe('高风险')
  })

  it('passes through unknown values untouched', () => {
    expect(marketLabel('UK')).toBe('UK')
    expect(severityLabel('critical')).toBe('critical')
  })
})
