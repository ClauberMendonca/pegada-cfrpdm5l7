import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { LayoutGrid, List } from 'lucide-react'
import { cn } from '@/lib/utils'

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
 */
export const ListRow: React.FC<{
  title: string
  open: boolean
  onToggle: () => void
  hint?: React.ReactNode
  children?: React.ReactNode
  titleClassName?: string
}> = ({ title, open, onToggle, hint, children, titleClassName }) => (
  <div className="rounded-lg border border-border bg-card">
    <div className="flex items-center gap-2 px-3 py-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          'flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          titleClassName,
        )}
      >
        <span className="min-w-0 flex-1 break-words line-clamp-2">{title}</span>
        <span
          aria-hidden="true"
          className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
        >
          ›
        </span>
      </button>
      {hint && <span className="shrink-0 text-[11px] text-muted-foreground">{hint}</span>}
    </div>
    {open && children && <div className="border-t border-border p-2">{children}</div>}
  </div>
)
