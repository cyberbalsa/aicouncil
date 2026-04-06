import { useState } from 'react'
import { MarketplaceItem } from './types'
import { marketplaceData, categories } from './data/plugins'
import { PluginCard } from './components/PluginCard'
import { Search, Sparkles, Github } from 'lucide-react'

function App() {
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredPlugins = marketplaceData.filter((plugin: MarketplaceItem) => {
    const matchesCategory = selectedCategory === 'all' || plugin.category === selectedCategory
    const matchesSearch = plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         plugin.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         plugin.tags.some((tag: string) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
    return matchesCategory && matchesSearch
  })

  return (
    <div className="min-h-screen text-slate-100">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-900/20 via-slate-900/0 to-transparent" />
        <div className="absolute top-20 left-10 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute top-40 right-20 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '2s' }} />
        
        <div className="relative max-w-7xl mx-auto px-6 py-20">
          <div className="text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-cyan-400 text-sm font-medium">
              <Sparkles className="w-4 h-4" />
              <span>AI Council Marketplace</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight">
              <span className="bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-400 bg-clip-text text-transparent">
                Discover & Install
              </span>
              <br />
              <span className="text-slate-100">AI Plugins</span>
            </h1>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
              A curated marketplace for AI Council plugins, agents, and skills.
              Enhance your workflow with powerful AI orchestration tools.
            </p>
          </div>

          {/* Search Bar */}
          <div className="mt-12 max-w-2xl mx-auto">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 to-indigo-500 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-1000" />
              <div className="relative glass rounded-2xl p-2 flex items-center">
                <Search className="w-6 h-6 text-slate-400 ml-4" />
                <input
                  type="text"
                  placeholder="Search plugins, agents, skills..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent border-none outline-none px-4 py-3 text-lg placeholder-slate-500 text-slate-100"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Category Filters */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-wrap justify-center gap-3">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-6 py-3 rounded-xl font-medium transition-all duration-300 ${
                selectedCategory === category.id
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 glow'
                  : 'glass text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <span className="mr-2">{category.icon}</span>
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {/* Plugin Grid */}
      <div className="max-w-7xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPlugins.map((plugin) => (
            <PluginCard key={plugin.id} plugin={plugin} />
          ))}
        </div>
        
        {filteredPlugins.length === 0 && (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-xl font-semibold text-slate-300">No plugins found</h3>
            <p className="text-slate-500 mt-2">Try adjusting your search or category filter</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800/50 mt-auto">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-slate-500 text-sm">
            © 2024 AI Council Marketplace. Open source on
          </p>
          <a
            href="https://github.com/cyberbalsa/aicouncil"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-slate-400 hover:text-cyan-400 transition-colors"
          >
            <Github className="w-5 h-5" />
            <span>GitHub</span>
          </a>
        </div>
      </footer>
    </div>
  )
}

export default App
