import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { TimezoneModal } from '@/components/TimezoneModal'
import { Button } from '@/components/ui/button'
import {
  SunMedium,
  Inbox,
  ListChecks,
  FolderKanban,
  Compass,
  LogOut,
  Briefcase,
  Heart,
  Layers,
  Clock,
} from 'lucide-react'
import { LifeWorkContext } from '@/types/execution'
import { cn } from '@/lib/utils'
import { GlobalTimerIndicator } from '@/components/TimeControl'
import { useTimer } from '@/contexts/TimeContext'

/** Símbolo temporário: monograma G + nome, até haver asset oficial no projeto. */
function GingaMark() {
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-lg font-bold text-primary ring-1 ring-primary/20"
    >
      G
    </span>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const { contextFilter, setContextFilter } = useGlobalFilter()
  const { running, error } = useTimer()

  // Ordem aprovada pelo dono: Hoje → Avanços → Resultados → Capturas → Revisão.
  // ENTREGA 1B — caminhos canônicos novos (/avancos, /resultados); /acoes e
  // /projetos permanecem no App.tsx como aliases legados. NavLink cobre os
  // dois caminhos por padrão (mesma página em rotas distintas), então o
  // estado ativo fica correto tanto no canônico quanto no alias.
  // Fonte única usada pela navegação desktop (sidebar) e móvel (bottom nav).
  const navItems = [
    { to: '/', label: 'Hoje', icon: SunMedium },
    { to: '/avancos', label: 'Avanços', icon: ListChecks },
    { to: '/resultados', label: 'Resultados', icon: FolderKanban },
    { to: '/capturas', label: 'Capturas', icon: Inbox },
    { to: '/revisao', label: 'Revisão', icon: Compass },
  ]

  const contextOptions: { id: LifeWorkContext; label: string; icon: typeof Layers }[] = [
    { id: 'todos', label: 'Todos', icon: Layers },
    { id: 'vida', label: 'Vida', icon: Heart },
    { id: 'trabalho', label: 'Trabalho', icon: Briefcase },
  ]

  const contextSwitcher = (
    <div
      role="group"
      aria-label="Contexto global"
      className="flex items-center gap-1 rounded-xl border border-border bg-card p-1 text-sm"
    >
      {contextOptions.map((opt) => {
        const Icon = opt.icon
        const isActive = contextFilter === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => setContextFilter(opt.id)}
            className={cn(
              'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-accent selection:text-accent-foreground lg:flex-row">
      {/* Desktop sidebar (>= 1024 px) */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-56 lg:flex-col lg:border-r lg:border-border lg:bg-card lg:px-4 lg:py-6">
        <div className="flex items-center gap-3 px-2">
          <GingaMark />
          <span className="text-xl font-semibold tracking-tight text-foreground">Ginga</span>
        </div>

        <nav aria-label="Principal" className="mt-8 flex flex-col gap-1">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 items-center gap-3 rounded-xl px-3 text-base font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
          {user?.timezone && (
            <div className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{user.timezone.replace('_', ' ')}</span>
            </div>
          )}
          <Button
            variant="ghost"
            onClick={logout}
            className="justify-start gap-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>Sair da sessão</span>
          </Button>
        </div>
      </aside>

      {/* Mobile / tablet header (< 1024 px) */}
      <header className="sticky top-0 z-40 w-full border-b border-border bg-card lg:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
            <GingaMark />
            <span className="text-lg font-semibold tracking-tight text-foreground">Ginga</span>
          </div>
          <div className="flex items-center gap-1">
            {user?.timezone && (
              <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
                <Clock className="h-4 w-4" aria-hidden="true" />
                <span className="max-w-[140px] truncate">{user.timezone.replace('_', ' ')}</span>
              </span>
            )}
            <Button
              variant="ghost"
              onClick={logout}
              aria-label="Sair da sessão"
              className="min-h-11 min-w-11 px-3 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="flex min-w-0 flex-1 flex-col lg:ml-56">
        {/* Contexto global sempre acessível, no topo do conteúdo */}
        <div className="border-b border-border bg-background px-4 py-3 lg:px-8">
          <div className="mx-auto w-full max-w-[1080px]">{contextSwitcher}</div>
        </div>

        <main
          className={cn(
            'mx-auto w-full max-w-[1080px] flex-1 px-4 py-6 lg:px-8 lg:py-8',
            running || error
              ? 'pb-[calc(env(safe-area-inset-bottom)+14rem)] lg:pb-32'
              : 'pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:pb-8',
          )}
        >
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation (< 1024 px) */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-5">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    // min-h-14 preserva a altura da barra; o recorte py-1 cabe
                    // a cápsula do ícone sem crescer a navegação.
                    'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                    isActive ? 'text-primary' : 'text-muted-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Cápsula de superfície: a seção ativa não depende só da cor. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-150',
                        isActive ? 'bg-accent text-accent-foreground' : 'bg-transparent',
                      )}
                    >
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className={cn(isActive && 'font-semibold')}>{item.label}</span>
                  </>
                )}
              </NavLink>
            )
          })}
        </div>
      </nav>

      {/* Modal for setting timezone if owner enters first time */}
      <TimezoneModal />

      {/* REGISTRO DE TEMPO V1: indicador global do cronômetro (compacto, acima da navegação) */}
      <GlobalTimerIndicator />
    </div>
  )
}
