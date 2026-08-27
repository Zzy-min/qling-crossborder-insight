import type { DatasetBundle } from '../domain/types'
import { sampleDataset as usbCChargersDataset } from './usbCChargers'
import { smartPetFeedersDataset } from './smartPetFeeders'
import { outdoorPowerStationsDataset } from './outdoorPowerStations'

export interface CategoryPreset {
  id: string
  name: string
  tagline: string
  icon: string
  dataset: DatasetBundle
  defaultPrice: number
  defaultLandedCost: number
}

export const CATEGORY_PRESETS: CategoryPreset[] = [
  {
    id: 'usb-c-chargers',
    name: '3C数码 · 氮化镓快充',
    tagline: 'GaN 65W–100W 充电器跨国市场与合规分析',
    icon: '⚡',
    dataset: usbCChargersDataset,
    defaultPrice: 39.99,
    defaultLandedCost: 14.50,
  },
  {
    id: 'smart-pet-feeders',
    name: '智能硬件 · 宠物智能喂食器',
    tagline: '5L 智能防卡粮喂食器 & 循环活水机出海分析',
    icon: '🐾',
    dataset: smartPetFeedersDataset,
    defaultPrice: 69.99,
    defaultLandedCost: 26.80,
  },
  {
    id: 'outdoor-power-stations',
    name: '新能源 · 户外便携储能',
    tagline: '1000W LiFePO4 户外移动电源多国准入与竞品分析',
    icon: '🔋',
    dataset: outdoorPowerStationsDataset,
    defaultPrice: 699.00,
    defaultLandedCost: 310.00,
  },
]

export function getCategoryPreset(id: string): CategoryPreset {
  return CATEGORY_PRESETS.find((item) => item.id === id) ?? CATEGORY_PRESETS[0]
}
