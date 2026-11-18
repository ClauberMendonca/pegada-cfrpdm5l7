/**
 * 4B2 — Seletor de Estratégia do Avanço, LOCAL AO RESULTADO escolhido no
 * formulário (ActionModal). Reusa o cadastro 4B1 (strategyService/hook82)
 * pelas assinaturas REAIS — nenhum serviço/editor/provider novo.
 * - Opções NOVAS: Estratégias ATIVAS do MESMO dono/Resultado; ID nativo como
 *   value (nunca título/número/posição); sentinel "none" nunca vai ao banco —
 *   Nenhuma envia ''.
 * - Nova criação começa Nenhuma; edição começa no strategy_id persistido —
 *   este componente nunca inicializa nem infere escolha.
 * - Vínculo ORIGINAL arquivado: legível "(arquivada — vínculo atual)",
 *   mantível/removível, sem virar opção nova para outros Avanços.
 * - Loading/erro+retry/vazio reais distintos; escolha NUNCA é apagada enquanto
 *   a lista está incompleta; falha/referência ausente preserva o ID
 *   ("Estratégia atual indisponível — vínculo preservado"), sem fingir Nenhuma
 *   nem exibir título velho.
 * A criação inline usa o StrategyModal REAL 4B1, montado pelo ActionModal —
 * aqui vai só o comando de abrir (duas decisões explícitas separadas).
 */
import React from 'react'
import { AlertCircle, Plus } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Strategy } from '@/types/execution'
import { ProjectStrategiesState } from '@/hooks/use-project-strategies'

const NONE = 'none' // sentinel interno do Select — nunca vai ao banco

export interface StrategySelectProps {
  /** ID estável do rótulo (useId do modal). */
  id: string
  /** ID nativo escolhido; '' = Nenhuma. */
  value: string
  onChange: (nextId: string) => void
  /** Lista do hook82 reutilizado (escopo dono/Resultado efetivo). */
  options: ProjectStrategiesState
  /** Identificação do Resultado confirmado (R-N + título), só leitura. */
  projectLabel: string
  /** Abre o StrategyModal REAL (o ActionModal mantém o rascunho do Avanço). */
  onOpenCreate: () => void
  /** Escolha provisória incompatível com o pai atual (troca de pai/pai solto). */
  incompatible?: boolean
  /** Vínculo ORIGINAL (persistido na abertura) está arquivado: item legível
     "(arquivada — vínculo atual)", mantível/removível, não opção nova. */
  originalArchived?: boolean
  disabled?: boolean
}

export const StrategySelect: React.FC<StrategySelectProps> = ({
  id,
  value,
  onChange,
  options,
  projectLabel,
  onOpenCreate,
  incompatible,
  originalArchived,
  disabled,
}) => {
  const known = value ? (options.items.find((s) => s.id === value) ?? null) : null
  // Referência ausente = não achada com lista CONCLUÍDA e sem falha de leitura.
  const unavailable = Boolean(value) && !known && !options.loading && !options.error
  const pendingRef = Boolean(value) && !known && options.loading
  const archivedCurrent = originalArchived && !incompatible
  // Nova criação pode ser oferecida quando o pai está confirmado (lista em
  // erro não vira convite a criar de novo).
  const canCreateInline = Boolean(projectLabel) && !options.loading && !options.error

  const currentLabel = incompatible
    ? 'Estratégia do resultado anterior — vínculo atual'
    : unavailable
      ? 'Estratégia atual indisponível — vínculo preservado'
      : pendingRef
        ? 'Carregando vínculo atual…'
        : archivedCurrent
          ? `${known?.title ?? 'Estratégia'} (arquivada — vínculo atual)`
          : (known?.title ?? 'Estratégia atual')

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id} className="text-sm font-medium text-foreground">
          Estratégia (opcional)
        </Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || !canCreateInline}
          onClick={onOpenCreate}
          aria-label="Nova estratégia neste resultado"
          className="min-h-11 gap-1 text-xs sm:min-h-9"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Nova estratégia
        </Button>
      </div>
      {/* "none" é sentinel INTERNO do Select — o banco recebe ID nativo ou ''. */}
      <Select
        value={value || NONE}
        onValueChange={(v) => onChange(v === NONE ? '' : v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="min-h-11 w-full">
          <SelectValue placeholder="Nenhuma" />
        </SelectTrigger>
        <SelectContent className="max-h-56 border-border bg-popover text-popover-foreground">
          <SelectItem value={NONE} className="min-h-11">
            Nenhuma
          </SelectItem>
          {options.items
            .filter((s) => s.status === 'ativa')
            .map((s) => (
              <SelectItem key={s.id} value={s.id} className="min-h-11">
                {s.title}
              </SelectItem>
            ))}
          {/* Item do VÍNCULO ATUAL (persistido/incompatível) — sempre que o
             valor não está entre as opções novas: legível, mantível e removível
             (voltar a "Nenhuma" remove), nunca opção nova de outros Avanços. */}
          {value && !options.items.some((s) => s.id === value && s.status === 'ativa') && (
            <SelectItem value={value} disabled={incompatible || pendingRef} className="min-h-11">
              {currentLabel}
            </SelectItem>
          )}
          {/* Ajuda curta da criação inline: duas decisões separadas, sem transação. */}
          {canCreateInline && (
            <div className="px-2 pb-2 pt-1 text-[11px] text-muted-foreground">
              Salvar cria a estratégia neste resultado. Cancelar o avanço depois não apaga a
              estratégia.
            </div>
          )}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        Escolha um caminho deste resultado ou deixe sem estratégia.
      </p>
      {options.loading && (
        <p role="status" className="text-[11px] text-muted-foreground">
          Carregando estratégias…
        </p>
      )}
      {options.error && (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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
    </div>
  )
}
