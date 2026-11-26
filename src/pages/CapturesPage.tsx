// PEGADA — a Caixa: o que foi capturado e ainda não foi decidido, um item por
// vez, junto com as propostas de agentes. O que já foi decidido fica guardado.
import { Dica } from '@/components/Dica'
import { PropostasParaDecidir } from '@/components/PropostasParaDecidir'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ProcessCaptureMenu } from '@/components/ProcessCaptureMenu'
import { Link } from 'react-router-dom'
import { CaptureItem, CaptureStatus } from '@/types/execution'
import { captureService } from '@/services/captureService'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, Plus, FolderKanban, CheckSquare, Trash2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { toast as aviso } from 'sonner'
import { op } from '@/lib/pegada/api'
import { notificarMudanca } from '@/services/actionService'
import { ACTION_KIND_LABEL, type ActionKind } from '@/types/execution'
import { AiSuggest } from '@/components/AiSuggest'
import { useAuth } from '@/contexts/AuthContext'
import { dayInZone, formatCalendarDay, ownerTimezone } from '@/lib/datetime'
import { useCaptureDraft } from '@/hooks/use-capture-draft'
import { EntityNumberKind, formatEntityTitle } from '@/lib/entityNumber'
import { collectTargetIds, emptyTargetMaps, fetchTargetMaps, TargetMaps } from '@/lib/captureTargets'
import { currentOwnerSnapshot, isSameOwner } from '@/lib/ownerScope'
import { usePegadaMudou } from '@/lib/pegada/useMudou'

const TIPOS_SUGERIVEIS: ActionKind[] = ['acao', 'compromisso', 'estudo', 'reflexao', 'ideia']
const DESTINO_ROTULO: Record<string, string> = {
  avanco: 'Avanço',
  resultado: 'Resultado (rascunho)',
  vontade: 'Vontade',
  responsabilidade: 'Responsabilidade',
  estrategia: 'Estratégia',
}
function descreverSugestaoCaptura(s: Record<string, string>): string {
  const destino = DESTINO_ROTULO[s.destino] || s.destino
  const tipo =
    s.destino === 'avanco' && s.tipo in ACTION_KIND_LABEL
      ? ` · ${ACTION_KIND_LABEL[s.tipo as ActionKind]}`
      : ''
  return `Virar ${destino}${tipo}${s.titulo ? `: ${s.titulo}` : ''}`
}

export const CapturesPage: React.FC = () => {
  const { toast } = useToast()
  const { user } = useAuth()

  const [captures, setCaptures] = useState<CaptureItem[]>([])
  // Caixa: um item por vez. `naVez` é a captura trazida para a frente; sem
  // ela, vale a primeira da fila.
  const [naVez, setNaVez] = useState<string | null>(null)
  const [verDecididas, setVerDecididas] = useState(false)
  const [filaInteira, setFilaInteira] = useState(false)
  const [filterStatus, setFilterStatus] = useState<CaptureStatus | 'todas'>('todas')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // BLOCO 8B — rascunho local opcional (off por padrão, por dono, sem envio).
  const {
    text: newCaptureText,
    onTextChange: setNewCaptureText,
    enabled: draftEnabled,
    restored: draftRestored,
    notice: draftNotice,
    toggleEnabled: toggleDraft,
    clearDraft,
    beginSend,
    isCurrent,
    settleSuccess,
  } = useCaptureDraft(user?.id)

  // Captura com Enter: trava síncrona além do estado visual — Enter repetido,
  // tecla segurada ou Enter seguido de clique não gravam duas vezes.
  const savingRef = useRef(false)

  // Título de exibição: primeira linha não vazia do raw_text (somente leitura,
  // sem criar título no banco e sem IA).
  const captureDisplayTitle = useCallback((raw: string): string => {
    const first = raw
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '')
    if (!first) return '(captura vazia)'
    const clipped = first.length > 80 ? `${first.slice(0, 80)}…` : first
    return clipped
  }, [])

  // BLOCO 6A — data de criação da captura no FUSO DO DONO: o dia é derivado do
  // instante UTC (created) via dayInZone; nunca do fuso do dispositivo e nunca
  // com slice(0,10) sobre o timestamp. Mesmo caminho para Cards, Lista (hint) e
  // resumo opcional — sem lógica de fuso duplicada por modo. Valor ausente/
  // inválido → "Data indisponível" (nunca Invalid Date); fuso vazio/inválido →
  // fallback UTC do helper.
  const ownerTz = ownerTimezone(user?.timezone)
  const formatCreatedDay = useCallback(
    (created: string | undefined | null): string => {
      const day = dayInZone(created, ownerTz)
      return day === '' ? 'Data indisponível' : formatCalendarDay(day)
    },
    [ownerTz],
  )

  const loadCaptures = useCallback(async () => {
    setIsLoading(true)
    try {
      setCaptures(await captureService.list(undefined))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao listar capturas'
      toast({ variant: 'destructive', title: 'Erro', description: msg })
    } finally {
      setIsLoading(false)
    }
  }, [toast])
  usePegadaMudou(loadCaptures)

  useEffect(() => {
    loadCaptures()
  }, [loadCaptures])

  // NUMERAÇÃO PERMANENTE 2C — mapa dos destinos das capturas já convertidas,
  // resolvido EM BATELADA (uma leitura por tipo, IDs únicos) para a lista já
  // carregada — nunca getById por card, por modo de visão ou por item aberto.
  // Falha/carregamento do lookup NÃO bloqueia captura, conversão, descarte,
  // entrada rápida ou cronômetro: sem código resolvido o selo simplesmente não
  // aparece e o acesso segue pelo link por ID. Resposta tardia após troca de
  // sessão/desmontagem é ignorada (snapshot do dono + cancelled); o mapa nunca
  // é associado a outra identidade.
  const [targetMaps, setTargetMaps] = useState<TargetMaps>(emptyTargetMaps)
  useEffect(() => {
    const { projectIds, actionIds } = collectTargetIds(captures)
    if (projectIds.length === 0 && actionIds.length === 0) {
      setTargetMaps(emptyTargetMaps())
      return
    }
    const snap = currentOwnerSnapshot()
    let cancelled = false
    fetchTargetMaps(projectIds, actionIds)
      .then((maps) => {
        if (!cancelled && isSameOwner(snap)) setTargetMaps(maps)
      })
      .catch(() => {
        // Falha de leitura ≠ prova de exclusão: mapa vazio, sem código
        // inventado (nunca P-0/A-0) e sem bloquear qualquer fluxo.
        if (!cancelled && isSameOwner(snap)) setTargetMaps(emptyTargetMaps())
      })
    return () => {
      cancelled = true
    }
  }, [captures, user?.id])

  // Envio único compartilhado por teclado e botão (captureService.create).
  const submitCapture = useCallback(async () => {
    // Trava síncrona: Enter repetido, tecla segurada ou clique durante o envio
    // não disparam uma segunda gravação.
    if (savingRef.current || isSubmitting) return
    const text = newCaptureText
    if (!text.trim()) return

    savingRef.current = true
    setIsSubmitting(true)
    // BLOCO 8B — snapshot do envio: dono, escopo, versão do texto e rascunho.
    const snap = beginSend()
    let current = true
    try {
      await captureService.create(text.trim())
      // Texto limpo SOMENTE após confirmação do backend, e só se ainda for o
      // mesmo rascunho/versão enviados (edição nova ou troca de dono preservam).
      current = isCurrent(snap)
      settleSuccess(snap)
      if (current) {
        toast({
          title: 'Ideia capturada',
          description: 'Armazenada com segurança para processar depois.',
        })
      }
      loadCaptures()
    } catch (err: unknown) {
      // Em erro, mantém o texto e o rascunho para nova tentativa manual.
      current = isCurrent(snap)
      const msg = err instanceof Error ? err.message : 'Erro ao capturar'
      if (current) toast({ variant: 'destructive', title: 'Erro', description: msg })
    } finally {
      savingRef.current = false
      setIsSubmitting(false)
      // Devolve o foco ao campo somente se a sessão ainda for a mesma
      // (retorno tardio não move foco).
      const field = quickAddRef.current
      if (field && current) field.focus()
    }
  }, [newCaptureText, beginSend, isCurrent, settleSuccess, isSubmitting, loadCaptures, toast])

  const quickAddRef = useRef<HTMLTextAreaElement>(null)

  // Enter (sem modificadores, sem repetição e fora de composição IME) captura;
  // Shift+Enter insere quebra de linha; Ctrl/Alt/Meta+Enter não ganham atalho.
  const handleQuickAddKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return
    // Confirmação de palavra no teclado de composição (IME) não salva.
    if (e.nativeEvent.isComposing) return
    e.preventDefault()
    if (e.repeat) return
    void submitCapture()
  }

  const handleDiscard = async (id: string) => {
    try {
      await captureService.discard(id)
            loadCaptures()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Não foi possível descartar a captura.'
      toast({ variant: 'destructive', title: 'Erro', description: msg })
    }
  }

  // BLOCO 2C — destino de captura já convertida: usa o ID gravado
  // (converted_project_id/converted_action_id) sem consultar cada destino.
  // Vínculo ausente/inválido → "Destino não disponível", sem URL vazia e sem
  // habilitar reconversão por isso.
  const renderConvertedDest = (item: CaptureItem) => {
    if (item.status !== 'convertida_projeto' && item.status !== 'convertida_acao') return null
    const isProject = item.status === 'convertida_projeto'
    const targetId = isProject ? item.converted_project_id : item.converted_action_id
    if (!targetId) {
      return <span className="text-xs text-muted-foreground">Destino não disponível</span>
    }
    // Destino REAL pelo ID gravado, resolvido pelo mapa em batelada (nunca
    // getById por item). Título só aparece COM o código real antes; se o
    // lookup não resolveu (falha ou vínculo fora do escopo da sessão), o
    // comando genérico permanece — sem código inventado — e o acesso segue
    // válido pelo link por ID. Destino arquivado/concluído/fora do recorte
    // global é numerado normalmente: a leitura não usa o filtro visual.
    const kind: EntityNumberKind = isProject ? 'project' : 'action'
    const target = isProject ? targetMaps.projects.get(targetId) : targetMaps.actions.get(targetId)
    const label = target ? formatEntityTitle(kind, target.sequence_number, target.title) : null
    const to = isProject
      ? `/mapa/resultado/${encodeURIComponent(targetId)}`
      : `/mapa/avanco/${encodeURIComponent(targetId)}`
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {label && (
          <span className="min-w-0 text-xs text-muted-foreground break-words" title={label}>
            {label}
          </span>
        )}
        <Button asChild size="sm" variant="outline" className="text-xs gap-1.5">
          <Link to={to}>
            {isProject ? (
              <FolderKanban className="w-3.5 h-3.5 text-primary" />
            ) : (
              <CheckSquare className="w-3.5 h-3.5 text-primary" />
            )}
            {isProject ? 'Abrir resultado' : 'Abrir avanço'}
          </Link>
        </Button>
      </div>
    )
  }

  // PEGADA — Nível 1: aplica a sugestão da IA pela mesma operação do método,
  // marcada como sugestão da IA no histórico, e com Desfazer.
  const aplicarSugestaoCaptura = async (capturaId: string, s: Record<string, string>) => {
    const tipo = (TIPOS_SUGERIVEIS as string[]).includes(s.tipo) ? s.tipo : 'acao'
    const dados: Record<string, unknown> =
      s.destino === 'resultado' ? { situacao: 'rascunho' } : { tipo }
    if (s.titulo) dados.titulo = s.titulo
    try {
      await op(
        'processar_captura',
        { captura_id: capturaId, destino: s.destino, dados },
        {
          origem: 'sugestao_ia',
          desfazer: true,
          onDesfeito: () => {
            void loadCaptures()
            notificarMudanca()
          },
        },
      )
      void loadCaptures()
      notificarMudanca()
    } catch (e) {
      aviso.error(e instanceof Error ? e.message : 'Não foi possível aplicar a sugestão.')
    }
  }

  const getStatusBadge = (st: CaptureStatus) => {
    switch (st) {
      case 'pendente':
        return (
          <Badge className="bg-pegada-warning-bg text-pegada-warning border-pegada-warning/30">
            Pendente
          </Badge>
        )
      case 'convertida_projeto':
        return (
          <Badge className="bg-pegada-info-bg text-pegada-info border-pegada-info/30">Resultado</Badge>
        )
      case 'convertida_acao':
        return (
          <Badge className="bg-pegada-success-bg text-pegada-success border-pegada-success/30">
            Avanço
          </Badge>
        )
      case 'descartada':
        return (
          <Badge variant="outline" className="text-muted-foreground border-border line-through">
            Descartada
          </Badge>
        )
    }
  }

  const pendentes = captures.filter((c) => c.status === 'pendente')
  const atual = pendentes.find((c) => c.id === naVez) ?? pendentes[0] ?? null
  const fila = pendentes.filter((c) => c.id !== atual?.id)
  // Já decididas: só o que ainda está em andamento. O que virou avanço feito
  // ou cancelado, resultado concluído ou arquivado, e o que foi descartado
  // sai da vista (continua guardado no Mapa, em Encerrados, e no Histórico).
  const emAndamento = (c: CaptureItem) => {
    if (c.status === 'convertida_acao') {
      const a = c.converted_action_id ? targetMaps.actions.get(c.converted_action_id) : undefined
      return Boolean(a) && a!.status !== 'feita' && a!.status !== 'cancelada'
    }
    if (c.status === 'convertida_projeto') {
      const p = c.converted_project_id ? targetMaps.projects.get(c.converted_project_id) : undefined
      return Boolean(p) && p!.status !== 'concluido' && p!.status !== 'arquivado'
    }
    return false
  }
  const decididas = captures.filter(
    (c) => emAndamento(c) && (filterStatus === 'todas' || c.status === filterStatus),
  )
  const pular = () => {
    if (fila.length > 0) setNaVez(fila[0].id)
  }

  return (
    <div className="space-y-8" data-caixa>
      <div>
        <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-foreground">Caixa</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isLoading
            ? 'Carregando…'
            : pendentes.length === 0
              ? 'Nada para decidir. A cabeça está livre.'
              : pendentes.length === 1
                ? '1 captura para decidir.'
                : `${pendentes.length} capturas para decidir, uma por vez.`}
        </p>
      </div>

      <PropostasParaDecidir />
      <Dica id="capturas">
        Capture do jeito que pensa, sem classificar na hora. Depois você decide o que cada captura vira.
      </Dica>

      {/* A captura da vez: o texto, a sugestão do Pegada e a decisão. */}
      {atual && (
        <section aria-label="Captura da vez" className="space-y-3" data-captura-da-vez>
          <div className="space-y-4 rounded-[20px] border border-border bg-card p-5">
            <div>
              <p className="text-[13px] text-muted-foreground">Capturado em {formatCreatedDay(atual.created)}</p>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-lg font-medium leading-snug text-foreground">
                {atual.raw_text}
              </p>
            </div>
            <AiSuggest
              key={atual.id}
              tipo="captura"
              texto={atual.raw_text}
              descrever={descreverSugestaoCaptura}
              impedimento={(s) =>
                s.destino === 'avanco' || s.destino === 'resultado'
                  ? null
                  : 'Para este destino, escolha no botão Decidir.'
              }
              onUsar={(s) => aplicarSugestaoCaptura(atual.id, s)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <ProcessCaptureMenu key={atual.id} capture={atual} onDone={loadCaptures} rotulo="Decidir" />
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleDiscard(atual.id)}
                className="min-h-11 gap-1.5 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Descartar
              </Button>
              {fila.length > 0 && (
                <Button type="button" variant="ghost" onClick={pular} className="ml-auto min-h-11">
                  Pular
                </Button>
              )}
            </div>
          </div>
          {fila.length > 0 && (
            <div data-fila-da-caixa>
              <p className="px-2 pb-1 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                Depois ({fila.length})
              </p>
              <ul>
                {(filaInteira ? fila : fila.slice(0, 5)).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setNaVez(c.id)}
                      className="flex min-h-11 w-full items-center rounded-xl px-2 py-1.5 text-left text-[15px] text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 truncate">{captureDisplayTitle(c.raw_text)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {fila.length > 5 && !filaInteira && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setFilaInteira(true)}
                  className="min-h-11 px-2 text-sm text-muted-foreground"
                >
                  Mostrar todas
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {/* Capturar aqui mesmo */}
      <section aria-label="Capturar" className="space-y-2">
        <Textarea
          ref={quickAddRef}
          value={newCaptureText}
          onChange={(e) => setNewCaptureText(e.target.value)}
          onKeyDown={handleQuickAddKeyDown}
          aria-label="Nova captura"
          placeholder="O que está na sua cabeça? Uma linha basta."
          rows={2}
          disabled={isSubmitting}
        />
        {draftEnabled && draftRestored && (
          <p role="status" className="text-xs text-foreground">
            Rascunho restaurado deste dispositivo
          </p>
        )}
        {draftNotice && (
          <p role="status" className="text-xs text-pegada-warning">
            {draftNotice}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              aria-pressed={draftEnabled}
              onClick={toggleDraft}
              disabled={!user?.id || isSubmitting}
              className="min-h-11 px-2 text-xs text-muted-foreground"
              title="O texto não enviado fica neste navegador até você capturar."
            >
              {draftEnabled ? 'Rascunho guardado neste dispositivo' : 'Manter rascunho neste dispositivo'}
            </Button>
            {draftEnabled && (
              <Button
                type="button"
                variant="ghost"
                onClick={clearDraft}
                disabled={isSubmitting || !newCaptureText}
                className="min-h-11 px-2 text-xs"
              >
                Limpar rascunho
              </Button>
            )}
          </div>
          <Button
            type="button"
            onClick={() => void submitCapture()}
            disabled={isSubmitting || !newCaptureText.trim()}
            className="min-h-11 gap-1.5"
          >
            {isSubmitting ? (
              'Gravando…'
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Capturar
              </>
            )}
          </Button>
        </div>
      </section>

      {/* O que já foi decidido fica guardado, fora da vista. */}
      <section aria-label="Já decididas" data-ja-decididas>
        <Button
          type="button"
          variant="ghost"
          aria-expanded={verDecididas}
          onClick={() => setVerDecididas((v) => !v)}
          className="min-h-11 gap-1.5 px-2 text-sm text-muted-foreground"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${verDecididas ? 'rotate-180' : ''}`} aria-hidden="true" />
          Já decididas, em andamento
        </Button>
        {verDecididas && (
          <div className="mt-2 space-y-3">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {(['todas', 'convertida_projeto', 'convertida_acao'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  aria-pressed={filterStatus === st}
                  onClick={() => setFilterStatus(st)}
                  className={`min-h-9 rounded-full px-3 font-medium transition-colors ${
                    filterStatus === st ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {st === 'todas'
                    ? 'Todas'
                    : st === 'convertida_projeto'
                      ? 'Resultados'
                      : 'Avanços'}
                </button>
              ))}
            </div>
            {decididas.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Nada em andamento por aqui. O que já foi concluído fica no Mapa, em Encerrados.
              </p>
            ) : (
              <ul className="rounded-2xl border border-border bg-card p-2">
                {decididas.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl px-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-[15px] text-foreground">{captureDisplayTitle(item.raw_text)}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                        {getStatusBadge(item.status)}
                        {formatCreatedDay(item.created)}
                      </p>
                    </div>
                    {renderConvertedDest(item)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
