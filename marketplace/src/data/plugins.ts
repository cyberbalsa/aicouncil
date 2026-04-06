import { MarketplaceItem } from '../types'

export const marketplaceData: MarketplaceItem[] = [
  {
    id: 'aicouncil',
    name: 'AI Council',
    description: 'Orchestrate Claude, Codex, Gemini, MiniMax, and Kimi through their CLIs for consults, debates, and chained analysis.',
    author: 'cyberbalsa',
    rating: 4.9,
    downloads: 1247,
    category: 'plugin',
    tags: ['AI', 'Multi-Model', 'CLI', 'Orchestration'],
    version: '1.0.0',
    updatedAt: '2024-04-06',
    icon: '🏛️'
  }
]

export const categories = [
  { id: 'all', name: 'All', icon: '⊹' },
  { id: 'plugin', name: 'Plugins', icon: '🔌' },
  { id: 'agent', name: 'Agents', icon: '🤖' },
  { id: 'skill', name: 'Skills', icon: '⚡' }
]
