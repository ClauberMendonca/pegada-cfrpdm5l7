import React, { useCallback, useEffect, useState } from 'react'
import { op } from '@/lib/pegada/api'
import { usePegadaMudou } from '@/lib/pegada/useMudou'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  SunMedium,
  Map as MapIcon,
  ListChecks,
  Compass,
  Plus,
  Inbox,
  FolderKanban,
  Anchor,
  History,
  Settings,
  LogOut,
  ChevronDown,
  Check,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { useTimer } from '@/contexts/TimeContext'
import { LifeWorkContext } from '@/types/execution'
import { cn } from '@/lib/utils'
import { PegadaSimbolo } from '@/components/PegadaSimbolo'
import { GlobalTimerIndicator } from '@/components/TimeControl'
import { RastroPromptHost } from '@/components/RastroPromptHost'
import { GlobalCaptureHost, abrirCaptura } from '@/components/GlobalCaptureHost'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// PEGADA — navegação com quatro destinos e captura no centro.
// Celular: barra inferior (Hoje, Mapa, [Capturar], Avanços, Revisão).
// Computador: coluna lateral com os mesmos destinos e o botão Capturar.
// Contexto (Tudo/Vida/Trabalho) é um chip; conta e telas secundárias ficam no avatar.

type IconType = typeof SunMedium

const NAV: { to: string; label: string; icon: IconType }[] = [
  { to: '/', label: 'Hoje', icon: SunMedium },
  { to: '/mapa', label: 'Mapa', icon: MapIcon },
  { to: '/avancos', label: 'Avanços', icon: ListChecks },
  { to: '/revisao', label: 'Revisão', icon: Compass },
]

const CONTA: { to: string; label: string; icon: IconType }[] = [
  { to: '/capturas', label: 'Capturas', icon: Inbox },
  { to: '/resultados', label: 'Resultados', icon: FolderKanban },
  { to: '/responsabilidades', label: 'Responsabilidades', icon: Anchor },
  { to: '/atividade', label: 'Atividade', icon: History },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
]

const CONTEXTOS: { id: LifeWorkContext; label: string }[] = [
  { id: 'todos', label: 'Tudo' },
  { id: 'vida', label: 'Vida' },
  { id: 'trabalho', label: 'Trabalho' },
]

const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function ContextoChip({ className }: { className?: string }) {
  const { contextFilter, setContextFilter } = useGlobalFilter()
  const atual = CONTEXTOS.find((c) => c.id === contextFilter) ?? CONTEXTOS[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Contexto: ${atual.label}. Trocar contexto`}
          className={cn(
            'flex min-h-11 items-center gap-1.5 rounded-full border border-input bg-transparent px-4 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-secondary',
            FOCO,
            className,
          )}
        >
          <span>{atual.label}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Contexto</DropdownMenuLabel>
        {CONTEXTOS.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onSelect={() => setContextFilter(c.id)}
            className="min-h-11 justify-between"
          >
            {c.label}
            {c.id === contextFilter && <Check className="h-4 w-4" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ContaMenu({ comNome }: { comNome?: boolean }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const nome = (user?.name || user?.email || 'Conta') as string
  const inicial = nome.trim().charAt(0).toUpperCase() || 'C'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Conta e mais telas"
          className={cn(
            'flex min-h-11 items-center gap-3 rounded-full text-left transition-colors duration-200 hover:bg-secondary',
            comNome ? 'w-full pr-3' : '',
            FOCO,
          )}
        >
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold"
            style={{ background: 'var(--pegada-ink)', color: 'var(--pegada-on-ink)' }}
          >
            {inicial}
          </span>
          {comNome && (
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {nome}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {CONTA.map((item) => {
          const Icon = item.icon
          return (
            <DropdownMenuItem
              key={item.to}
              onSelect={() => navigate(item.to)}
              className="min-h-11 gap-3"
            >
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {item.label}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout()} className="min-h-11 gap-3">
          <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Computador: Capturas no menu, com o número do que falta decidir.
function CapturasLink() {
  const [pendentes, setPendentes] = useState(0)
  const carregar = useCallback(async () => {
    try {
      const res = await op<{ capturas_pendentes: number }>('ver_fio_de_hoje', {})
      setPendentes(res.resultado?.capturas_pendentes ?? 0)
    } catch {
      setPendentes(0)
    }
  }, [])
  useEffect(() => {
    void carregar()
  }, [carregar])
  usePegadaMudou(carregar)
  return (
    <NavLink
      to="/capturas"
      className={({ isActive }) =>
        cn(
          'mt-1 flex min-h-11 items-center gap-3 rounded-xl px-3 text-base font-medium transition-colors duration-200',
          FOCO,
          isActive
            ? 'bg-sidebar-primary text-sidebar-primary-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        )
      }
    >
      <Inbox className="h-5 w-5" aria-hidden="true" />
      <span>Capturas</span>
      {pendentes > 0 && (
        <span
          aria-label={`${pendentes} para decidir`}
          className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground"
        >
          {pendentes}
        </span>
      )}
    </NavLink>
  )
}

export default function Layout() {
  const { running, error } = useTimer()

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-secondary lg:flex-row">
      {/* Computador: coluna lateral */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-border lg:bg-card lg:px-4 lg:py-6">
        <div className="flex items-center gap-2.5 px-2">
          <PegadaSimbolo className="h-9 w-9 shrink-0 text-foreground" />
          <span className="text-xl font-semibold tracking-tight text-foreground">pegada</span>
        </div>

        <button
          type="button"
          onClick={abrirCaptura}
          className={cn(
            'mt-6 flex min-h-12 items-center justify-between gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground transition-colors duration-200 hover:bg-[var(--pegada-primary-hover)]',
            FOCO,
          )}
        >
          <span className="flex items-center gap-2">
            <Plus className="h-5 w-5" aria-hidden="true" />
            Capturar
          </span>
          <kbd className="rounded-md border border-primary-foreground/30 px-1.5 text-xs font-medium">
            C
          </kbd>
        </button>

        <nav aria-label="Principal" className="mt-6 flex flex-col gap-1">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 items-center gap-3 rounded-xl px-3 text-base font-medium transition-colors duration-200',
                    FOCO,
                    isActive
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )
                }
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        <CapturasLink />

        <div className="mt-auto border-t border-border pt-4">
          <ContaMenu comNome />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:ml-60">
        <div className="sticky top-0 z-40 bg-background">
          {/* Celular: cabeçalho */}
          <header className="flex h-14 items-center justify-between gap-3 px-5 lg:hidden">
            <div className="flex items-center gap-2">
              <PegadaSimbolo className="h-8 w-8 shrink-0 text-foreground" />
              <span className="text-lg font-semibold tracking-tight text-foreground">pegada</span>
            </div>
            <div className="flex items-center gap-2">
              <ContextoChip />
              <ContaMenu />
            </div>
          </header>
          {/* Computador: chip de contexto no topo do conteúdo */}
          <div className="hidden items-center justify-end px-10 pt-4 lg:flex">
            <ContextoChip />
          </div>
        </div>

        <main
          className={cn(
            'mx-auto w-full max-w-[1080px] flex-1 px-5 py-6 lg:px-10 lg:py-8',
            running || error
              ? 'pb-[calc(env(safe-area-inset-bottom)+15rem)] lg:pb-32'
              : 'pb-[calc(env(safe-area-inset-bottom)+7rem)] lg:pb-8',
          )}
        >
          <Outlet />
          <RastroPromptHost />
        </main>
      </div>

      {/* Celular: barra inferior com a captura no centro */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-5 items-center">
          {NAV.slice(0, 2).map((item) => (
            <ItemInferior key={item.to} {...item} />
          ))}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={abrirCaptura}
              aria-label="Capturar"
              className={cn(
                '-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-card transition-colors duration-200 hover:bg-[var(--pegada-primary-hover)]',
                FOCO,
              )}
            >
              <Plus className="h-7 w-7" aria-hidden="true" />
            </button>
          </div>
          {NAV.slice(2).map((item) => (
            <ItemInferior key={item.to} {...item} />
          ))}
        </div>
      </nav>

      <GlobalCaptureHost />
      <GlobalTimerIndicator />
    </div>
  )
}

const ItemInferior: React.FC<{ to: string; label: string; icon: IconType }> = ({
  to,
  label,
  icon: Icon,
}) => (
  <NavLink
    to={to}
    end={to === '/'}
    className={({ isActive }) =>
      cn(
        'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1 text-xs transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        isActive ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
      )
    }
  >
    {({ isActive }) => (
      <>
        <span
          aria-hidden="true"
          className={cn(
            'flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-200',
            isActive ? 'bg-secondary' : 'bg-transparent',
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span>{label}</span>
      </>
    )}
  </NavLink>
)
