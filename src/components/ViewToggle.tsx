import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlignLeft, LayoutGrid, List } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ActionItem, Project } from '@/types/execution'
import { formatCalendarDay } from '@/lib/datetime'
import { EntityNumberKind, entityNumberCode } from '@/lib/entityNumber'
import { EntityNumberBadge } from '@/components/EntityNumberBadge'

export type CollectionView = 'cards' | 'list'

/**
 * Preferência Cards/Lista, por área (e por dono logado), guardada somente no
 * armazenamento local do dispositivo. Nunca guarda texto de registros, notas
 * ou credenciais — apenas a string 'cards' | 'list'. Se o armazenamento
 * estiver indisponível (try/catch), funciona em memória com fallback 'cards'.
 */
const memory = new Map<string, CollectionView>()

function storageKey(area: string, userId: string): string {
  return `ginga.view.${userId}.${area}`
}

function readStored(area: string, userId: string): CollectionView | null {
  try {
    const raw = window.localStorage.getItem(storageKey(area, userId))
    return raw === 'cards' || raw === 'list' ? raw : null
  } catch {
    return memory.get(storageKey(area, userId)) ?? null
  }
}

function writeStored(area: string, userId: string, value: CollectionView): void {
  const key = storageKey(area, userId)
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Armazenamento indisponível: mantém a preferência só em memória.
  }
  memory.set(key, value)
}

export function useViewPreference(
  area: string,
  userId: string | undefined,
): [CollectionView, (v: CollectionView) => void] {
  const [view, setView] = useState<CollectionView>('cards')

  useEffect(() => {
    if (!userId) return
    setView(readStored(area, userId) ?? 'cards')
  }, [area, userId])

  const setPreference = useCallback(
    (value: CollectionView) => {
      setView(value)
      if (userId) writeStored(area, userId, value)
    },
    [area, userId],
  )

  return [view, setPreference]
}

/**
 * BLOCO 4C — preferência opcional "Mostrar resumo" (por área e dono), em chave
 * PRÓPRIA, separada da chave Cards/Lista. Guarda somente o booleano — nunca
 * texto, IDs, notas ou dados de registros. Padrão false; armazenamento
 * indisponível → fallback em memória. Sem identidade resolvida, não lê nem
 * grava (estado local apenas).
 */
const summaryMemory = new Map<string, boolean>()

function summaryKey(area: string, userId: string): string {
  return `ginga.summary.${userId}.${area}`
}

export function useSummaryPreference(
  area: string,
  userId: string | undefined,
): [boolean, (v: boolean) => void] {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!userId) return
    const key = summaryKey(area, userId)
    try {
      setShow(window.localStorage.getItem(key) === '1')
    } catch {
      setShow(summaryMemory.get(key) === true)
    }
  }, [area, userId])

  const setShowPreference = useCallback(
    (value: boolean) => {
      setShow(value)
      if (!userId) return
      const key = summaryKey(area, userId)
      try {
        window.localStorage.setItem(key, value ? '1' : '0')
      } catch {
        // Armazenamento indisponível: mantém a preferência só em memória.
      }
      summaryMemory.set(key, value)
    },
    [area, userId],
  )

  return [show, setShowPreference]
}

/**
 * BLOCO 4C — controle discreto "Mostrar resumo". Cada área decide renderizá-lo
 * só em Lista; área de toque e foco visíveis consistentes com o seletor.
 */
export const SummaryToggle: React.FC<{
  checked: boolean
  onChange: (v: boolean) => void
  className?: string
}> = ({ checked, onChange, className }) => (
  <button
    type="button"
    aria-pressed={checked}
    onClick={() => onChange(!checked)}
    className={cn(
      'inline-flex h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      checked
        ? 'bg-accent text-accent-foreground'
        : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
      className,
    )}
  >
    <AlignLeft className="h-3.5 w-3.5" aria-hidden="true" />
    <span>Mostrar resumo</span>
  </button>
)

/** Rótulos de status de ação já usados nas áreas (sem nova fonte de verdade). */
const ACTION_STATUS_LABELS: Record<string, string> = {
  pronta: 'Pronta',
  em_andamento: 'Em andamento',
  aguardando: 'Aguardando',
  bloqueada: 'Bloqueada',
  feita: 'Feita',
  cancelada: 'Cancelada',
}

/**
 * BLOCO 4C — UMA linha de contexto da ação, só com dados já carregados.
 * projectTitle: string = vínculo carregado; null = sem projeto (factual);
 * undefined = relação não consultada (nada é afirmado). Prazo vira marcador
 * "hoje" quando coincide com o dia de referência.
 */
export function actionSummaryLine(
  action: Pick<ActionItem, 'status' | 'deadline'>,
  options: { projectTitle?: string | null; today?: string } = {},
): string {
  const parts: string[] = [ACTION_STATUS_LABELS[action.status] ?? action.status]
  if (options.projectTitle === null) parts.push('Sem projeto')
  else if (options.projectTitle) parts.push(`Projeto: ${options.projectTitle}`)
  if (action.deadline) {
    parts.push(
      options.today && action.deadline === options.today
        ? 'Prazo: hoje'
        : `Prazo: ${formatCalendarDay(action.deadline)}`,
    )
  }
  return parts.join(' · ')
}

/**
 * BLOCO 4C — UMA linha de contexto do projeto: entrega controlável e prazo,
 * SOMENTE quando presentes nos dados já carregados (nunca "Nenhum definido").
 */
export function projectSummaryLine(
  project: Pick<Project, 'controllable_delivery' | 'deadline'>,
): string {
  const parts: string[] = []
  const delivery = (project.controllable_delivery || '').trim()
  if (delivery !== '') parts.push(delivery)
  if (project.deadline) parts.push(`Prazo: ${formatCalendarDay(project.deadline)}`)
  return parts.join(' · ')
}

/** Seletor Cards/Lista com rótulos, aria-pressed, foco visível e toque adequado. */
export const ViewToggle: React.FC<{
  view: CollectionView
  onChange: (v: CollectionView) => void
  disabled?: boolean
  className?: string
}> = ({ view, onChange, disabled, className }) => {
  const options = useMemo(
    () =>
      [
        { value: 'cards' as const, label: 'Cards', icon: LayoutGrid },
        { value: 'list' as const, label: 'Lista', icon: List },
      ] as const,
    [],
  )
  return (
    <div
      role="group"
      aria-label="Modo de apresentação"
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 text-xs',
        className,
      )}
    >
      {options.map((opt) => {
        const Icon = opt.icon
        const active = view === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              // Referência de 44 px de toque no celular: ícones continuam
              // pequenos, quem cresce é a área interativa.
              'flex h-11 items-center gap-1.5 rounded-md px-3 font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Linha compacta de Lista: apenas o título como conteúdo principal, indicador
 * de abertura permitido. O título é um botão (área de toque adequada) que
 * expande a apresentação completa inline — nunca grava nem alterna status.
 * `summary` (BLOCO 4C) é UMA linha opcional de contexto abaixo do título,
 * renderizada só quando a preferência "Mostrar resumo" está ligada.
 */
export const ListRow: React.FC<{
  title: string
  open: boolean
  onToggle: () => void
  hint?: React.ReactNode
  summary?: string
  children?: React.ReactNode
  titleClassName?: string
  /** NUMERAÇÃO PERMANENTE — código "P-3"/"A-12" do banco, antes do título. */
  numberKind?: EntityNumberKind
  numberValue?: number | null
  numberEntityId?: string
}> = ({
  title,
  open,
  onToggle,
  hint,
  summary,
  children,
  titleClassName,
  numberKind,
  numberValue,
  numberEntityId,
}) => (
  <div className="rounded-lg border border-border bg-card">
    <div className="flex items-center gap-2 px-3 py-1.5">
      <div className="min-w-0 flex-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={cn(
            'flex min-h-11 w-full items-center gap-2 rounded-md py-1 text-left text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            titleClassName,
          )}
        >
          {numberKind && (
            <EntityNumberBadge kind={numberKind} n={numberValue} entityId={numberEntityId} />
          )}
          <span className="min-w-0 flex-1 break-words line-clamp-2">{title}</span>
          <span
            aria-hidden="true"
            className={cn(
              'shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          >
            ›
          </span>
        </button>
        {summary && (
          <p className="px-3 pb-2 -mt-0.5 text-[11px] leading-snug text-muted-foreground line-clamp-1 break-words">
            {summary}
          </p>
        )}
      </div>
      {hint && (
        <span className="shrink-0 self-start pt-3 text-[11px] text-muted-foreground">{hint}</span>
      )}
    </div>
    {open && children && <div className="border-t border-border p-2">{children}</div>}
  </div>
)
