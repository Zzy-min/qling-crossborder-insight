import { describe, expect, it } from 'vitest'
import { currencyForMarket, marketLabel, severityLabel, currencySymbol } from './labels'

describe('display labels', () => {
  it('maps internal market enums to Chinese names', () => {
    expect(marketLabel('US')).toBe('美国')
    expect(marketLabel('EU')).toBe('欧盟')
    expect(marketLabel('JP')).toBe('日本')
    expect(marketLabel('UK')).toBe('英国')
    expect(marketLabel('ALL')).toBe('全部市场')
    expect(marketLabel('BOTH')).toBe('美国 + 欧盟')
  })

  it('maps internal severity enums to Chinese labels', () => {
    expect(severityLabel('low')).toBe('低风险')
    expect(severityLabel('medium')).toBe('中风险')
    expect(severityLabel('high')).toBe('高风险')
  })

  it('maps currencies to symbols', () => {
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('EUR')).toBe('€')
    expect(currencySymbol('JPY')).toBe('¥')
    expect(currencySymbol('GBP')).toBe('£')
    expect(currencySymbol('CAD')).toBe('$')
  })

  it('passes through unknown values untouched', () => {
    expect(marketLabel('XYZ')).toBe('XYZ')
    expect(severityLabel('critical')).toBe('critical')
  })

  it('maps a single target market to its pricing currency', () => {
    expect(currencyForMarket('US')).toBe('USD')
    expect(currencyForMarket('EU')).toBe('EUR')
    expect(currencyForMarket('JP')).toBe('JPY')
    expect(currencyForMarket('UK')).toBe('GBP')
    expect(currencyForMarket('ALL')).toBe('USD')
  })
})
