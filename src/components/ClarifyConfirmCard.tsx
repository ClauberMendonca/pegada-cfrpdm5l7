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
    ? 'border-primary/25 bg-accent/60'
    : outcome.kind === 'confirmed' || outcome.kind === 'existing'
      ? 'border-primary/25 bg-accent/60'
      : outcome.kind === 'blocked'
        ? 'border-destructive/30 bg-[#FFF0F2]'
        : 'border-[#8A4B0F]/30 bg-[#FFF3E4]'

  return (
    <div className={`space-y-3 rounded-2xl border p-4 ${tone}`} data-testid="clarify-confirm-card">
      <p className="text-base font-semibold text-foreground">Revisar pedido de esclarecimento</p>

      {/* Prévia EXATA da intenção — somente leitura */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-muted-foreground">
          Texto que será enviado (somente leitura)
        </Label>
        <p className="whitespace-pre-wrap break-words rounded-xl border border-border bg-card px-3 py-2 text-base text-foreground sm:text-sm">
          {intent.rawText}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-muted-foreground">
          Contexto enviado (somente leitura)
        </Label>
        <p className="text-base text-foreground sm:text-sm">
          {contextLabel(intent.context)}
          {context !== intent.context && (
            <span className="font-medium text-[#8A4B0F]">
              {' '}
              (contexto atual divergente — preparação inválida)
            </span>
          )}
        </p>
      </div>

      {/* Textos fixos desta fatia */}
      <p className="text-sm text-muted-foreground">
        O Manus ajudará a esclarecer esta captura e propor um próximo avanço. Isso não cria ação ou
        projeto no gerenciador.
      </p>
      <p className="text-sm text-muted-foreground">
        O envio transmitirá apenas esta captura e este contexto, com instruções metodológicas do
        projeto — não o banco inteiro nem o histórico.
      </p>
      <p className="text-sm text-muted-foreground">
        O perfil usado é o standard definido no servidor; após a ativação da integração, o uso pode
        consumir créditos da conta. Nenhuma chave é pedida ou exibida aqui.
      </p>

      {prepError && (
        <p className="inline-flex items-start gap-1 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {prepError}
        </p>
      )}

      {/* Resultado REAL do serviço — exibido em texto, nada simulado */}
      {outcome && (
        <div className="space-y-1.5 rounded-xl border border-border bg-card px-3 py-2">
          <p className="break-words text-base text-foreground sm:text-sm">{outcome.message}</p>
          {stateLabel && (
            <Badge variant="outline" className="border-border text-foreground">
              Estado local do pedido: {stateLabel}
            </Badge>
          )}
          {taskUrl && (
            <a
              href={taskUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Abrir no Manus
            </a>
          )}
          {outcome.kind === 'uncertain' && (
            <p className="text-sm text-[#8A4B0F]">
              Conferir os registros locais antes de qualquer nova tentativa.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={submitting}
          className="min-h-11 rounded-xl"
        >
          Voltar
        </Button>
        {!outcome && (
          <Button
            type="button"
            onClick={onConfirm}
            disabled={submitting || sendBlocked || !!prepError}
            className="min-h-11 rounded-xl"
          >
            {submitting ? 'Enviando…' : 'Confirmar envio'}
          </Button>
        )}
      </div>
    </div>
  )
}
