// FATIA M1B2a — cartão INLINE de confirmação do pedido de esclarecimento.
// Apenas visual: recebe a intenção já preparada e os retornos do serviço.
// Não executa POST por conta própria (quem envia é clarifyService via painel).
import React from 'react'
import { ExternalLink, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { EntityContext } from '@/types/execution'
import type { ClarifyIntent, ClarifyOutcome } from '@/lib/skipAi/clarifyService'
import { safeManusTaskUrl } from '@/lib/skipAi/types'
import { stateInfo } from '@/lib/skipAi/stateLabels'

export interface ClarifyConfirmCardProps {
  intent: ClarifyIntent
  context: EntityContext
  submitting: boolean
  /** Envio bloqueado (ex.: incerteza retornada) — sem destravar/trocar ID. */
  sendBlocked: boolean
  prepError: string | null
  outcome: ClarifyOutcome | null
  onConfirm: () => void
  onBack: () => void
}

function contextLabel(c: EntityContext): string {
  return c === 'vida' ? 'Vida' : 'Trabalho'
}

/**
 * Cartão inline no MESMO diálogo do painel (sem modal sobre modal).
 * Mostra rawText e Vida/Trabalho exatos em somente leitura, os textos fixos
 * desta fatia e o resultado real do serviço — nada simulado.
 */
export const ClarifyConfirmCard: React.FC<ClarifyConfirmCardProps> = ({
  intent,
  context,
  submitting,
  sendBlocked,
  prepError,
  outcome,
  onConfirm,
  onBack,
}) => {
  const taskUrl =
    outcome && 'request' in outcome && outcome.request
      ? safeManusTaskUrl(outcome.request.task_url)
      : null
  const stateLabel =
    outcome && 'request' in outcome && outcome.request ? stateInfo(outcome.request).label : null

  const tone = !outcome
    ? 'border-violet-500/30 bg-violet-500/5'
    : outcome.kind === 'confirmed' || outcome.kind === 'existing'
      ? 'border-emerald-500/30 bg-emerald-500/5'
      : outcome.kind === 'blocked'
        ? 'border-rose-500/30 bg-rose-500/5'
        : 'border-amber-500/30 bg-amber-500/5'

  return (
    <div className={`rounded-lg border p-3 space-y-3 ${tone}`} data-testid="clarify-confirm-card">
      <p className="text-sm font-semibold text-slate-100">Revisar pedido de esclarecimento</p>

      {/* Prévia EXATA da intenção — somente leitura */}
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-slate-400">
          Texto que será enviado (somente leitura)
        </Label>
        <p className="text-sm text-slate-200 whitespace-pre-wrap break-words rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2">
          {intent.rawText}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-slate-400">
          Contexto enviado (somente leitura)
        </Label>
        <p className="text-sm text-slate-200">
          {contextLabel(intent.context)}
          {context !== intent.context && (
            <span className="text-amber-300">
              {' '}
              (contexto atual divergente — preparação inválida)
            </span>
          )}
        </p>
      </div>

      {/* Textos fixos desta fatia */}
      <p className="text-xs text-slate-300">
        O Manus ajudará a esclarecer esta captura e propor um próximo avanço. Isso não cria ação ou
        projeto no gerenciador.
      </p>
      <p className="text-xs text-slate-300">
        O envio transmitirá apenas esta captura e este contexto, com instruções metodológicas do
        projeto — não o banco inteiro nem o histórico.
      </p>
      <p className="text-xs text-slate-400">
        O perfil usado é o standard definido no servidor; após a ativação da integração, o uso pode
        consumir créditos da conta. Nenhuma chave é pedida ou exibida aqui.
      </p>

      {prepError && (
        <p className="text-xs text-rose-200 inline-flex items-start gap-1">
          <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {prepError}
        </p>
      )}

      {/* Resultado REAL do serviço — exibido em texto, nada simulado */}
      {outcome && (
        <div className="space-y-1.5 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
          <p className="text-sm text-slate-200 break-words">{outcome.message}</p>
          {stateLabel && (
            <Badge variant="outline" className="text-slate-300 border-slate-700">
              Estado local do pedido: {stateLabel}
            </Badge>
          )}
          {taskUrl && (
            <a
              href={taskUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-violet-300 hover:text-violet-200 inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              Abrir no Manus
            </a>
          )}
          {outcome.kind === 'uncertain' && (
            <p className="text-xs text-amber-200">
              Conferir os registros locais antes de qualquer nova tentativa.
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          disabled={submitting}
          className="text-slate-400"
        >
          Voltar
        </Button>
        {!outcome && (
          <Button
            type="button"
            size="sm"
            onClick={onConfirm}
            disabled={submitting || sendBlocked || !!prepError}
            className="bg-violet-600 hover:bg-violet-500 text-white"
          >
            {submitting ? 'Enviando…' : 'Confirmar envio'}
          </Button>
        )}
      </div>
    </div>
  )
}
