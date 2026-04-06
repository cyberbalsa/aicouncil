import { ArrowUpRight, Download, Github, Star } from 'lucide-react'
import { MarketplaceItem } from '../types'

type PluginCardProps = {
  plugin: MarketplaceItem
}

export function PluginCard({ plugin }: PluginCardProps) {
  return (
    <article className="group relative overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-950/60 p-6 shadow-[0_24px_80px_rgba(2,6,23,0.45)] transition duration-300 hover:-translate-y-1 hover:border-cyan-500/40">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_42%)] opacity-0 transition duration-300 group-hover:opacity-100" />

      <div className="relative flex h-full flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10 text-3xl shadow-[0_0_30px_rgba(34,211,238,0.12)]">
              <span aria-hidden="true">{plugin.icon ?? '✨'}</span>
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-100">{plugin.name}</p>
              <p className="text-sm text-slate-400">by {plugin.author}</p>
            </div>
          </div>
          <span className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs uppercase tracking-[0.2em] text-cyan-300">
            {plugin.category}
          </span>
        </div>

        <p className="text-sm leading-6 text-slate-300">{plugin.description}</p>

        <div className="flex flex-wrap gap-2">
          {plugin.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1 text-xs text-slate-300"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-auto grid grid-cols-2 gap-3 rounded-2xl border border-slate-800/90 bg-slate-950/70 p-4 text-sm text-slate-300">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-300" fill="currentColor" />
            <span>{plugin.rating.toFixed(1)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-cyan-300" />
            <span>{plugin.downloads.toLocaleString()}</span>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Version</p>
            <p className="mt-1 text-slate-200">{plugin.version}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Updated</p>
            <p className="mt-1 text-slate-200">{plugin.updatedAt}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com/cyberbalsa/aicouncil"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 py-3 font-medium text-slate-950 transition hover:bg-cyan-300"
          >
            <Github className="h-4 w-4" />
            <span>View Repo</span>
          </a>
          <a
            href="https://github.com/cyberbalsa/aicouncil/tree/feat/ai-council-plugin/plugins/aicouncil"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-2xl border border-slate-700 px-4 py-3 text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300"
            aria-label={`Open ${plugin.name} plugin path`}
          >
            <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </article>
  )
}
