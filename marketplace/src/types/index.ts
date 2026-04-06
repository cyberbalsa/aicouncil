export interface MarketplaceItem {
  id: string
  name: string
  description: string
  author: string
  authorAvatar?: string
  rating: number
  downloads: number
  category: 'agent' | 'skill' | 'plugin'
  tags: string[]
  version: string
  updatedAt: string
  icon?: string
}
