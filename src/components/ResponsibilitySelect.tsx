/**
 * ENTREGA 3C1 — Seletor e referência compartilhados de Responsabilidade.
 * Mínimo compartilhado entre ProjectModal (Resultado) e ActionModal (Avanço):
 * - opções NOVAS: exclusivamente Responsabilidades ATIVAS do dono e do MESMO
 *   contexto do formulário, independente do recorte global (a lista vem de
 *   responsibilityService.list() — todos os estados — e é filtrada no cliente);
 * - "Nenhuma" é sempre visível e nunca é valor de banco (sentinel interno do
 *   Select; o valor salvo é o ID nativo ou string vazia);
 * - vínculo atual ARQUIVADO continua legível ("arquivada — vínculo atual") e
 *   pode ser mantido/removido, mas não vira opção nova;
 * - leitura por ID (getById) reaproveitada em cache de módulo escopado ao dono:
 *   uma leitura autenticada por referência/ID vigente, nunca por card/segundo.
 * Sem provider novo, sem localStorage, sem criação inline de Responsabilidade.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Responsibility, EntityContext } from '@/types/execution'
import { responsibilityService } from '@/services/responsibilityService'
import { currentOwnerSnapshot, isSameOwner } from '@/lib/ownerScope'

// ---------------------------------------------------------------------------
// Cache de leitura por ID (módulo, escopado ao dono da sessão)
// ---------------------------------------------------------------------------
let refCacheOwner: string | null = null
const refCache = new Map<string, Responsibility>()

function ensureRefCacheOwner(): void {
  const ownerId = currentOwnerSnapshot().ownerId
  if (!ownerId) return
  if (refCacheOwner !== ownerId) {
    refCache.clear()
    refCacheOwner = ownerId
  }
}

function seedRefCache(list: Responsibility[]): void {
  ensureRefCacheOwner()
  for (const item of list) refCache.set(item.id, item)
}

export interface ResponsibilityRefState {
  data: Responsibility | null
  loading: boolean
  error: boolean
}

/**
 * Leitura autenticada por ID, reaproveitada enquanto dono/ID não mudam.
 * Retornos tardios de outra sessão são descartados (isSameOwner).
 */
export function useResponsibilityRef(
  id: string | null | undefined,
  enabled = true,
): ResponsibilityRefState {
  const [state, setState] = useState<ResponsibilityRefState>({
    data: null,
    loading: false,
    error: false,
  })

  useEffect(() => {
    if (!id || !enabled) {
      setState({ data: null, loading: false, error: false })
      return
    }
    ensureRefCacheOwner()
    const cached = refCache.get(id)
    if (cached) {
      setState({ data: cached, loading: false, error: false })
      return
    }
    const ownerId = currentOwnerSnapshot().ownerId
    if (!ownerId) return
    let cancelled = false
    setState({ data: null, loading: true, error: false })
    responsibilityService
      .getById(id)
      .then((data) => {
        if (cancelled || !isSameOwner({ ownerId })) return
        refCache.set(id, data)
        setState({ data, loading: false, error: false })
      })
      .catch(() => {
        if (cancelled || !isSameOwner({ ownerId })) return
        setState({ data: null, loading: false, error: true })
      })
    return () => {
      cancelled = true
    }
  }, [id, enabled])

  return state
}

// ---------------------------------------------------------------------------
// Lista completa do dono (base das opções novas e dos rótulos de vínculo atual)
// ---------------------------------------------------------------------------
export interface ResponsibilityOptionsState {
  list: Responsibility[]
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Lista completa do dono (TODOS os estados/contextos — um único read por
 * abertura), semeando o cache de referências. As opções novas são derivadas
 * no cliente (ativas + contexto do formulário).
 */
export function useResponsibilityOptions(enabled: boolean): ResponsibilityOptionsState {
  const [list, setList] = useState<Responsibility[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const ownerId = currentOwnerSnapshot().ownerId
    if (!ownerId) return
    setLoading(true)
    setError(null)
    try {
      const result = await responsibilityService.list()
      if (!isSameOwner({ ownerId })) return
      seedRefCache(result)
      setList(result)
    } catch {
      if (!isSameOwner({ ownerId })) return
      setError('Não foi possível carregar as responsabilidades.')
    } finally {
      if (isSameOwner({ ownerId })) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled) void load()
  }, [enabled, load])

  return { list, loading, error, reload: load }
}

/** Opções NOVAS: ativas do dono e do contexto do formulário (nunca arquivadas). */
export function activeResponsibilityOptions(
  list: Responsibility[],
  context: EntityContext,
): Responsibility[] {
  return list.filter((r) => r.status === 'ativa' && r.context === context)
}

// ---------------------------------------------------------------------------
// Seletor (Resultado e Avanço solto)
// ---------------------------------------------------------------------------
interface ResponsibilitySelectProps {
  /** ID estável do rótulo (useId do modal). */
  id: string
  /** ID nativo escolhido; '' = Nenhuma. */
  value: string
  onChange: (nextId: string) => void
  /** Contexto do formulário — filtra as opções novas. */
  context: EntityContext
  options: ResponsibilityOptionsState
  disabled?: boolean
}

export const ResponsibilitySelect: React.FC<ResponsibilitySelectProps> = ({
  id,
  value,
  onChange,
  context,
  options,
  disabled,
}) => {
  const activeOptions = activeResponsibilityOptions(options.list, context)
  const listHasValue = options.list.some((r) => r.id === value)
  // Referência atual fora da lista carregada (lista em erro, ou ID ausente
  // dela): leitura escopada por ID — nunca exibir "Nenhuma" como se inexistisse.
  const ref = useResponsibilityRef(
    value || null,
    Boolean(value) && !options.loading && !listHasValue,
  )
  const known = value ? (options.list.find((r) => r.id === value) ?? ref.data ?? null) : null
  const pending = Boolean(value) && !known && (options.loading || ref.loading)
  const unavailable = Boolean(value) && !known && !pending
  const valueAmongActive = activeOptions.some((r) => r.id === value)
  const archivedCurrent = known?.status === 'arquivada'
  const contextMismatch = Boolean(known && known.context !== context)
  const contextLabel = (ctx: EntityContext) => (ctx === 'trabalho' ? 'Trabalho' : 'Vida')

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs uppercase tracking-wider text-muted-foreground">
        Responsabilidade (opcional)
      </Label>
      {/* "none" é sentinel INTERNO do Select — nunca vai ao banco ('' é o valor
         de ausência/remoção; ID nativo é o de vínculo). */}
      <Select
        value={value || 'none'}
        onValueChange={(v) => onChange(v === 'none' ? '' : v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="min-h-11 w-full">
          <SelectValue placeholder="Nenhuma" />
        </SelectTrigger>
        <SelectContent className="max-h-56 border-border bg-popover text-popover-foreground">
          <SelectItem value="none" className="min-h-11">
            Nenhuma
          </SelectItem>
          {activeOptions.map((r) => (
            <SelectItem key={r.id} value={r.id} className="min-h-11">
              {r.title}
            </SelectItem>
          ))}
          {/* Vínculo atual fora das opções novas (arquivada/fora do contexto):
             legível e mantível, mas não é opção nova para outros registros. */}
          {value && known && !valueAmongActive && (
            <SelectItem value={value} className="min-h-11">
              {archivedCurrent
                ? `${known.title} (arquivada — vínculo atual)`
                : contextMismatch
                  ? `${known.title} (vínculo atual — ${contextLabel(known.context as EntityContext)})`
                  : `${known.title} (vínculo atual)`}
            </SelectItem>
          )}
          {value && pending && (
            <SelectItem value={value} disabled className="min-h-11">
              Carregando vínculo atual…
            </SelectItem>
          )}
          {value && unavailable && (
            <SelectItem value={value} disabled className="min-h-11">
              Responsabilidade atual indisponível — vínculo preservado
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      <span className="text-[11px] text-muted-foreground block">
        Grupos são criados no módulo Responsabilidades (sem sair deste formulário).
      </span>
      {options.error && (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-ginga-danger-bg p-2 text-xs text-destructive"
        >
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{options.error}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={options.reload}
            className="min-h-11 shrink-0"
          >
            Tentar novamente
          </Button>
        </div>
      )}
      {/* Contexto incompatível NUNCA é apagado automaticamente: permanece
         identificado e o salvamento do vínculo incompatível é bloqueado. */}
      {contextMismatch && known?.status === 'ativa' && (
        <p role="alert" className="text-xs font-medium text-ginga-warning">
          A responsabilidade selecionada é de {contextLabel(known.context as EntityContext)}, mas o
          contexto aqui é {contextLabel(context)}. Escolha “Nenhuma” ou outra compatível antes de
          salvar.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Referência discreta da ficha do Resultado (ProjectDetail)
// ---------------------------------------------------------------------------
/**
 * "Responsabilidade: <título>" com link /responsabilidades?id=ID, estado
 * arquivado quando aplicável, "Nenhuma" quando a ausência é confirmada
 * (registro carregado sem vínculo) e erro que NUNCA vira "Nenhuma".
 * Uma leitura autenticada por ID vigente (cache do módulo).
 */
export const ResponsibilityReference: React.FC<{ id?: string | null }> = ({ id }) => {
  const ref = useResponsibilityRef(id || null, Boolean(id))

  if (!id) {
    return (
      <p className="text-xs text-muted-foreground">
        <span className="font-medium">Responsabilidade:</span>{' '}
        <span className="italic">Nenhuma</span>
      </p>
    )
  }
  if (ref.loading) {
    return <p className="text-xs text-muted-foreground">Responsabilidade: carregando…</p>
  }
  if (ref.error || !ref.data) {
    return (
      <p className="text-xs text-muted-foreground">
        Responsabilidade atual indisponível — vínculo preservado
      </p>
    )
  }
  return (
    <p className="text-xs text-muted-foreground">
      <span>Responsabilidade: </span>
      <Link
        to={`/responsabilidades?id=${encodeURIComponent(ref.data.id)}`}
        className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {ref.data.title}
      </Link>
      {ref.data.status === 'arquivada' && <span> · arquivada — vínculo atual</span>}
    </p>
  )
}
