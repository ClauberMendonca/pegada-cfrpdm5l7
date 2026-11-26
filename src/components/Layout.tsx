import React, { useCallback, useEffect, useState } from 'react'
import { op } from '@/lib/pegada/api'
import { usePegadaMudou } from '@/lib/pegada/useMudou'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  SunMedium,
  Map as MapIcon,
  Compass,
  Plus,
  Inbox,
  Search,
  History,
  Settings,
  LogOut,
  Trash2,
  Users,
  ChevronDown,
  Check,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { useTimer } from '@/contexts/TimeContext'
import { LifeWorkContext } from '@/types/execution'
import { cn } from '@/lib/utils'
import { PegadaNome, PegadaSimbolo } from '@/components/PegadaSimbolo'
import { GlobalTimerIndicator } from '@/components/TimeControl'
import { AvisoIAHost } from '@/components/AvisoIAHost'
import { RastroPromptHost } from '@/components/RastroPromptHost'
import { GlobalCaptureHost, abrirCaptura } from '@/components/GlobalCaptureHost'
import { BuscaGlobal, abrirBusca } from '@/components/BuscaGlobal'
import { Sino } from '@/components/juntos/Sino'
import { PropositoNoTopo } from '@/components/PropositoNoTopo'
import { Destino, digitandoEmCampo, lugarDe } from '@/lib/pegada/lugar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// PEGADA — navegação com quatro destinos e captura no centro.
// Celular: barra inferior (Hoje, Mapa, [Capturar], Caixa, Revisão).
// Computador: coluna lateral com os mesmos destinos e o botão Capturar.
// Toda tela pertence a um destino (lib/pegada/lugar), então o menu fica sempre
// aceso. O avatar guarda só o que é da conta. Contexto (Tudo/Vida/Trabalho) é
// um chip que muda de cor quando filtra.

type IconType = typeof SunMedium

interface ItemNav {
  to: string
  label: string
  icon: IconType
  destino: Destino
}

const NAV: ItemNav[] = [
  { to: '/', label: 'Hoje', icon: SunMedium, destino: 'hoje' },
  { to: '/mapa', label: 'Mapa', icon: MapIcon, destino: 'mapa' },
  { to: '/caixa', label: 'Caixa', icon: Inbox, destino: 'caixa' },
  { to: '/revisao', label: 'Revisão', icon: Compass, destino: 'revisao' },
]

const CONTA: { to: string; label: string; icon: IconType }[] = [
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
  { to: '/historico', label: 'Histórico', icon: History },
  { to: '/lixeira', label: 'Lixeira', icon: Trash2 },
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
            'flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors duration-200',
            contextFilter === 'todos'
              ? 'border-input bg-transparent text-foreground hover:bg-secondary'
              : 'border-foreground bg-foreground text-background',
            FOCO,
            className,
          )}
        >
          <span>{contextFilter === 'todos' ? atual.label : `Só ${atual.label}`}</span>
          <ChevronDown className="h-4 w-4 opacity-70" aria-hidden="true" />
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
  const { user, logout, avatarUrl } = useAuth()
  const navigate = useNavigate()
  const nome = (user?.name || user?.email || 'Conta') as string
  const inicial = nome.trim().charAt(0).toUpperCase() || 'C'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Conta"
          className={cn(
            'flex min-h-11 items-center gap-3 rounded-full text-left transition-colors duration-200 hover:bg-secondary',
            comNome ? 'w-full pr-3' : '',
            FOCO,
          )}
        >
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-base font-semibold"
            style={{ background: 'var(--pegada-ink)', color: 'var(--pegada-on-ink)' }}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
            ) : (
              inicial
            )}
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
        {user?.role === 'admin' && (
          <DropdownMenuItem onSelect={() => navigate('/pessoas')} className="min-h-11 gap-3">
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Pessoas
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout()} className="min-h-11 gap-3">
          <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Quantos itens esperam decisão na Caixa: capturas e propostas de agentes.
function usePendentesDaCaixa(): number {
  const [pendentes, setPendentes] = useState(0)
  const carregar = useCallback(async () => {
    try {
      const res = await op<{ capturas_pendentes: number; propostas_pendentes: number }>(
        'ver_fio_de_hoje',
        {},
      )
      setPendentes((res.resultado?.capturas_pendentes ?? 0) + (res.resultado?.propostas_pendentes ?? 0))
    } catch {
      setPendentes(0)
    }
  }, [])
  useEffect(() => {
    void carregar()
  }, [carregar])
  usePegadaMudou(carregar)
  return pendentes
}

function BotaoBusca({ comTexto }: { comTexto?: boolean }) {
  return (
    <button
      type="button"
      onClick={abrirBusca}
      aria-label="Buscar em tudo"
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-full border border-input text-sm text-muted-foreground transition-colors duration-200 hover:bg-secondary hover:text-foreground',
        comTexto ? 'w-72 px-4' : 'w-11 justify-center',
        FOCO,
      )}
    >
      <Search className="h-5 w-5 shrink-0" aria-hidden="true" />
      {comTexto && (
        <>
          <span className="flex-1 text-left">Buscar em tudo</span>
          <kbd className="rounded-md border border-input px-1.5 text-xs font-medium">/</kbd>
        </>
      )}
    </button>
  )
}

export default function Layout() {
  const { running, error } = useTimer()
  const location = useLocation()
  const navigate = useNavigate()
  const lugar = lugarDe(location.pathname)
  const pendentes = usePendentesDaCaixa()

  // O título da aba diz onde a pessoa está.
  useEffect(() => {
    document.title = lugar.titulo === 'Pegada' ? 'Pegada' : `${lugar.titulo} · Pegada`
  }, [lugar.titulo])

  // Teclas 1 a 4 trocam de destino, fora de campos de texto e de diálogos.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const i = ['1', '2', '3', '4'].indexOf(e.key)
      if (i < 0) return
      if (digitandoEmCampo(e.target) || document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      navigate(NAV[i].to)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [navigate])

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-secondary lg:flex-row">
      {/* Computador: coluna lateral */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-border lg:bg-card lg:px-4 lg:py-6">
        <div className="flex items-center gap-2.5 px-2">
          <PegadaSimbolo className="h-9 w-9 shrink-0 text-foreground" />
          <PegadaNome className="h-7 w-auto text-foreground" />
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
            const aqui = lugar.destino === item.destino
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={aqui ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-xl px-3 text-base font-medium transition-colors duration-200',
                  FOCO,
                  aqui
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span>{item.label}</span>
                {item.destino === 'caixa' && pendentes > 0 && (
                  <span
                    aria-label={`${pendentes} para decidir`}
                    className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground"
                  >
                    {pendentes}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

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
              {/* Com o relógio ligado, ele toma o lugar do nome: cabe no celular sem cobrir nada. */}
              {running || error ? <GlobalTimerIndicator /> : <PegadaNome className="h-6 w-auto text-foreground" />}
            </div>
            <div className="flex items-center gap-2">
              <BotaoBusca />
              <Sino />
              <ContextoChip />
              <ContaMenu />
            </div>
          </header>
          {/* Computador: chip de contexto no topo do conteúdo */}
          <div className="hidden items-center justify-end gap-3 px-10 pt-4 lg:flex">
            <GlobalTimerIndicator />
            <BotaoBusca comTexto />
            <Sino />
            <ContextoChip />
          </div>
        </div>

        <main
          className={cn(
            'mx-auto w-full max-w-[1080px] flex-1 px-5 py-6 lg:px-10 lg:py-8',
            'pb-[calc(env(safe-area-inset-bottom)+7rem)] lg:pb-8',
          )}
        >
          <PropositoNoTopo />
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
            <ItemInferior key={item.to} {...item} aqui={lugar.destino === item.destino} />
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
            <ItemInferior
              key={item.to}
              {...item}
              aqui={lugar.destino === item.destino}
              aviso={item.destino === 'caixa' ? pendentes : 0}
            />
          ))}
        </div>
      </nav>

      <GlobalCaptureHost />
      <BuscaGlobal />
      <AvisoIAHost />
    </div>
  )
}

const ItemInferior: React.FC<ItemNav & { aqui: boolean; aviso?: number }> = ({
  to,
  label,
  icon: Icon,
  aqui,
  aviso = 0,
}) => (
  <Link
    to={to}
    aria-current={aqui ? 'page' : undefined}
    className={cn(
      'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1 text-xs transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
      aqui ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
    )}
  >
    <span
      aria-hidden="true"
      className={cn(
        'relative flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-200',
        aqui ? 'bg-secondary' : 'bg-transparent',
      )}
    >
      <Icon className="h-5 w-5" />
      {aviso > 0 && <span className="absolute right-2 top-0.5 h-2 w-2 rounded-full bg-primary" />}
    </span>
    <span>
      {label}
      {aviso > 0 && <span className="sr-only">, {aviso} para decidir</span>}
    </span>
  </Link>
)
