import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { TimezoneModal } from '@/components/TimezoneModal'
import { Button } from '@/components/ui/button'
import {
  SunMedium,
  Inbox,
  FolderKanban,
  Compass,
  LogOut,
  Briefcase,
  Heart,
  Layers,
  Clock,
} from 'lucide-react'
import { LifeWorkContext } from '@/types/execution'

export default function Layout() {
  const { user, logout } = useAuth()
  const { contextFilter, setContextFilter } = useGlobalFilter()

  const navItems = [
    { to: '/', label: 'Hoje', icon: SunMedium },
    { to: '/capturas', label: 'Capturas', icon: Inbox },
    { to: '/projetos', label: 'Projetos', icon: FolderKanban },
    { to: '/revisao', label: 'Revisão', icon: Compass },
  ]

  const contextOptions: { id: LifeWorkContext; label: string; icon: typeof Layers }[] = [
    { id: 'todos', label: 'Todos', icon: Layers },
    { id: 'vida', label: 'Vida', icon: Heart },
    { id: 'trabalho', label: 'Trabalho', icon: Briefcase },
  ]

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-white">
      {/* Top Header */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
                EP
              </div>
              <div className="leading-none">
                <span className="font-semibold text-sm tracking-tight text-white block">
                  Execução Pragmática
                </span>
                <span className="text-[10px] text-slate-400 font-mono">Uso Exclusivo</span>
              </div>
            </div>

            {/* Global Context Switcher (Vida / Trabalho) */}
            <div className="hidden sm:flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs">
              {contextOptions.map((opt) => {
                const Icon = opt.icon
                const isActive = contextFilter === opt.id
                return (
                  <button
                    key={opt.id}
                    onClick={() => setContextFilter(opt.id)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all font-medium ${
                      isActive
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-400' : ''}`} />
                    <span>{opt.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Timezone badge */}
            {user?.timezone && (
              <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-400 bg-slate-900/60 border border-slate-800/80 px-2.5 py-1 rounded-md">
                <Clock className="w-3 h-3 text-emerald-400" />
                <span className="truncate max-w-[140px]">{user.timezone.replace('_', ' ')}</span>
              </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              title="Sair da sessão"
              className="text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 text-xs gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </div>

        {/* Mobile filter bar */}
        <div className="sm:hidden px-4 py-2 border-t border-slate-900 bg-slate-925 flex justify-center">
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs w-full max-w-xs">
            {contextOptions.map((opt) => {
              const Icon = opt.icon
              const isActive = contextFilter === opt.id
              return (
                <button
                  key={opt.id}
                  onClick={() => setContextFilter(opt.id)}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md transition-all font-medium ${
                    isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className={`w-3 h-3 ${isActive ? 'text-emerald-400' : ''}`} />
                  <span>{opt.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="border-t border-slate-850 bg-slate-950">
          <div className="max-w-6xl mx-auto px-4 flex gap-1 sm:gap-2 overflow-x-auto scrollbar-none">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      isActive
                        ? 'border-emerald-500 text-white bg-slate-900/40'
                        : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-800'
                    }`
                  }
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </div>
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6">
        <Outlet />
      </main>

      {/* Modal for setting timezone if owner enters first time */}
      <TimezoneModal />
    </div>
  )
}
