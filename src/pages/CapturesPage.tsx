import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ProcessCaptureMenu } from '@/components/ProcessCaptureMenu'
import { Link } from 'react-router-dom'
import { CaptureItem, CaptureStatus } from '@/types/execution'
import { captureService } from '@/services/captureService'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Inbox, Plus, FolderKanban, CheckSquare, Trash2, Lightbulb } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { toast as aviso } from 'sonner'
import { op } from '@/lib/pegada/api'
import { notificarMudanca } from '@/services/actionService'
import { ACTION_KIND_LABEL, type ActionKind } from '@/types/execution'
import { AiSuggest } from '@/components/AiSuggest'
import { useAuth } from '@/contexts/AuthContext'
import {
  ListRow,
  SummaryToggle,
  useSummaryPreference,
  useViewPreference,
  ViewToggle,
} from '@/components/ViewToggle'
import { dayInZone, formatCalendarDay, ownerTimezone } from '@/lib/datetime'
import { useCaptureDraft } from '@/hooks/use-capture-draft'
import { EntityNumberKind, entityNumberCode, formatEntityTitle } from '@/lib/entityNumber'
import {
  collectTargetIds,
  emptyTargetMaps,
  fetchTargetMaps,
  TargetMaps,
} from '@/lib/captureTargets'
import { currentOwnerSnapshot, isSameOwner } from '@/lib/ownerScope'
import { usePegadaMudou } from '@/lib/pegada/useMudou'
import {
  EMPTY_PLANNED,
  isValidPlannedDate,
  isValidPlannedTime,
  PlannedExecution,
  plannedTimezoneOrFallback,
} from '@/lib/plannedExecution'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Project } from '@/types/execution'
import { projectService } from '@/services/projectService'
import { ResponsibilitySelect } from '@/components/ResponsibilitySelect'
import {
  ResponsibilityRefState,
  useResponsibilityReference,
} from '@/hooks/use-responsibility-reference'
import { StrategySelect } from '@/components/StrategySelect'
import { StrategyModal } from '@/components/StrategyModal'
import { Strategy } from '@/types/execution'

type ConversionType = 'project' | 'action' | null

interface ConversionFeedback {
  captureId: string
  targetType: 'project' | 'action'
  targetId: string
  duplicate: boolean
  targetSequenceNumber: number | null
  targetTitle: string
}

const TIPOS_SUGERIVEIS: ActionKind[] = ['acao', 'compromisso', 'estudo', 'reflexao', 'ideia']
const DESTINO_ROTULO: Record<string, string> = {
  avanco: 'Avanço',
  resultado: 'Resultado (rascunho)',
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
  const [filterStatus, setFilterStatus] = useState<CaptureStatus | 'todas'>('pendente')
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

  // CAPTURA RÁPIDA — apresentação Cards/Lista (preferência por dono nesta área).
  const [view, setView] = useViewPreference('captures', user?.id)
  const [showSummary, setShowSummary] = useSummaryPreference('captures', user?.id)
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})
  const toggleRow = useCallback((id: string) => {
    setOpenRows((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

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
      const list = await captureService.list(filterStatus === 'todas' ? undefined : filterStatus)
      setCaptures(list)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao listar capturas'
      toast({ variant: 'destructive', title: 'Erro', description: msg })
    } finally {
      setIsLoading(false)
    }
  }, [filterStatus, toast])
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
      toast({ title: 'Captura descartada logicamente' })
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
      ? `/resultados?id=${encodeURIComponent(targetId)}`
      : `/avancos?id=${encodeURIComponent(targetId)}`
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

  const renderCaptureCard = (item: CaptureItem) => (
    <div
      key={item.id}
      className="p-4 rounded-xl border border-border bg-card hover:bg-accent/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
    >
      <div className="space-y-1.5 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {getStatusBadge(item.status)}
          <span className="text-xs font-mono text-muted-foreground">
            {formatCreatedDay(item.created)}
          </span>
        </div>
        <p className="text-sm text-foreground whitespace-pre-wrap break-words">{item.raw_text}</p>
        {item.status === 'pendente' && (
          <AiSuggest
            tipo="captura"
            texto={item.raw_text}
            descrever={descreverSugestaoCaptura}
            impedimento={(s) =>
              s.destino === 'avanco' || s.destino === 'resultado'
                ? null
                : 'Para este destino, escolha no botão Processar.'
            }
            onUsar={(s) => aplicarSugestaoCaptura(item.id, s)}
          />
        )}
      </div>

      {/* Destino de captura já convertida (BLOCO 2C) */}
      {(item.status === 'convertida_projeto' || item.status === 'convertida_acao') && (
        <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
          {renderConvertedDest(item)}
        </div>
      )}

      {/* Ações de processamento: SOMENTE o menu de processamento e a lixeira. */}
      {item.status === 'pendente' && (
        <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
          <ProcessCaptureMenu capture={item} onDone={loadCaptures} />

          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleDiscard(item.id)}
            className="text-muted-foreground hover:text-destructive hover:bg-pegada-danger-bg text-xs"
            title="Descartar logicamente"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  )

  // BLOCO 4C — rótulo textual do estado, mesma semântica do badge (dados já
  // carregados; formatação de data é a existente — correção de fuso é bloco 6).
  const captureStatusLabel = (st: CaptureStatus): string => {
    switch (st) {
      case 'pendente':
        return 'Pendente'
      case 'convertida_projeto':
        return 'Convertida em resultado'
      case 'convertida_acao':
        return 'Convertida em avanço'
      case 'descartada':
        return 'Descartada'
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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Inbox className="w-6 h-6 text-primary" />
            Capturas
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Caixa de entrada rápida para descarregar a mente sem fricção. Converta em Resultado ou
            Avanço, ou descarte.
          </p>
        </div>

        {/* Filter by status + modo de apresentação Cards/Lista */}
        <div className="flex flex-wrap items-center gap-2">
          <ViewToggle view={view} onChange={setView} />
          {view === 'list' && <SummaryToggle checked={showSummary} onChange={setShowSummary} />}
          <div className="flex flex-wrap items-center gap-1.5 bg-muted border border-border p-1 rounded-lg text-xs">
            {(
              ['pendente', 'todas', 'convertida_projeto', 'convertida_acao', 'descartada'] as const
            ).map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  filterStatus === st
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {st === 'todas'
                  ? 'Todas'
                  : st === 'pendente'
                    ? 'Pendentes'
                    : st === 'convertida_projeto'
                      ? 'Resultados'
                      : st === 'convertida_acao'
                        ? 'Avanços'
                        : 'Descartadas'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Input de Captura Rápida */}
      <Card className="bg-card border-border shadow-md">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <Lightbulb className="w-3.5 h-3.5" />
            <span>Anotação Rápida em Texto Livre</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={draftEnabled}
            onClick={toggleDraft}
            disabled={!user?.id || isSubmitting}
            className="min-h-[44px] text-xs"
          >
            Manter rascunho neste dispositivo
          </Button>
          {draftEnabled && (
            <p className="text-xs text-muted-foreground">
              O texto não enviado fica neste navegador; só vira captura quando você confirmar com
              Enter ou pelo botão.
            </p>
          )}
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
          <Textarea
            ref={quickAddRef}
            value={newCaptureText}
            onChange={(e) => setNewCaptureText(e.target.value)}
            onKeyDown={handleQuickAddKeyDown}
            placeholder="O que está na sua cabeça? Ideia, insight, pendência que surgiu, oportunidade..."
            rows={3}
            disabled={isSubmitting}
          />
          <div className="flex justify-between items-center pt-1 gap-3">
            <span className="text-xs text-muted-foreground">
              Enter para capturar · Shift+Enter para nova linha
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {draftEnabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearDraft}
                  disabled={isSubmitting || !newCaptureText}
                  className="min-h-[44px] text-xs"
                >
                  Limpar rascunho
                </Button>
              )}
              <Button
                type="button"
                onClick={() => void submitCapture()}
                disabled={isSubmitting || !newCaptureText.trim()}
                className="gap-1.5 min-h-[44px]"
              >
                {isSubmitting ? (
                  'Gravando…'
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Capturar Ideia
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Capturas */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground font-medium px-1">
          <span>Itens na Caixa de Entrada ({captures.length})</span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando capturas...</div>
        ) : captures.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted p-8 text-center">
            <Inbox className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-foreground font-medium">Nenhuma captura encontrada.</p>
            <p className="text-xs text-muted-foreground mt-1">
              {filterStatus === 'pendente'
                ? 'Sua caixa de entrada está limpa! Todas as ideias foram processadas.'
                : 'Nenhum registro para este filtro.'}
            </p>
          </div>
        ) : view === 'cards' ? (
          <div className="grid gap-3 [&>*]:min-w-0">{captures.map(renderCaptureCard)}</div>
        ) : (
          <div className="grid gap-2">
            {captures.map((item) => (
              <ListRow
                key={item.id}
                title={captureDisplayTitle(item.raw_text)}
                open={Boolean(openRows[item.id])}
                onToggle={() => toggleRow(item.id)}
                hint={formatCreatedDay(item.created)}
                summary={
                  showSummary
                    ? `${captureStatusLabel(item.status)} · ${formatCreatedDay(item.created)}`
                    : undefined
                }
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2">{getStatusBadge(item.status)}</div>
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                    {item.raw_text}
                  </p>
                  {/* Destino de captura já convertida (BLOCO 2C) */}
                  {(item.status === 'convertida_projeto' || item.status === 'convertida_acao') && (
                    <div className="flex flex-wrap items-center gap-2">
                      {renderConvertedDest(item)}
                    </div>
                  )}
                  {item.status === 'pendente' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <ProcessCaptureMenu capture={item} onDone={loadCaptures} />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDiscard(item.id)}
                        className="text-muted-foreground hover:text-destructive hover:bg-pegada-danger-bg text-xs"
                        title="Descartar logicamente"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Descartar
                      </Button>
                    </div>
                  )}
                </div>
              </ListRow>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
