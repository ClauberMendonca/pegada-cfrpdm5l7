import React, { useState, useEffect, useCallback, useRef, useId } from 'react'
import { ProcessCaptureMenu } from '@/components/ProcessCaptureMenu'
import { Link } from 'react-router-dom'
import { CaptureItem, CaptureStatus, Project, Strategy } from '@/types/execution'
import { captureService } from '@/services/captureService'
import { projectService } from '@/services/projectService'
import { StrategySelect } from '@/components/StrategySelect'
import { StrategyModal } from '@/components/StrategyModal'
import { useProjectStrategies } from '@/hooks/use-project-strategies'
import {
  ResponsibilityOptionsState,
  ResponsibilitySelect,
  useResponsibilityOptions,
} from '@/components/ResponsibilitySelect'
import {
  ResponsibilityRefState,
  useResponsibilityReference,
} from '@/hooks/use-responsibility-reference'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Inbox, Plus, FolderKanban, CheckSquare, Trash2, Lightbulb, Bot } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { CopilotPanel } from '@/components/CopilotPanel'
import { prepareProposalConversion } from '@/lib/skipAi/proposalService'
import type { AiRequestRecord } from '@/lib/skipAi/types'
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
import { PlannedExecutionFields } from '@/components/PlannedExecutionFields'
import {
  EMPTY_PLANNED,
  isValidPlannedDate,
  isValidPlannedTime,
  plannedTimezoneOrFallback,
  type PlannedExecution,
} from '@/lib/plannedExecution'
import { usePegadaMudou } from '@/lib/pegada/useMudou'

export const CapturesPage: React.FC = () => {
  const { toast } = useToast()
  const { contextFilter } = useGlobalFilter()
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

  // Conversion Modals
  const [selectedCapture, setSelectedCapture] = useState<CaptureItem | null>(null)
  const [conversionType, setConversionType] = useState<'project' | 'action' | null>(null)
  // FATIA 3C2B — trava SÍNCRONA dedicada à conversão (não reutiliza a trava da
  // entrada rápida): uma confirmação chama captureService.convert UMA vez.
  const convertingRef = useRef(false)

  // FATIA M1B1 — Painel do Copiloto (estado SEPARADO da conversão manual)
  const [copilotCapture, setCopilotCapture] = useState<CaptureItem | null>(null)
  const [copilotOpen, setCopilotOpen] = useState(false)
  const copilotSession = useRef(0)
  const pageActive = useRef(true)
  const [conversionFromCopilot, setConversionFromCopilot] = useState(false)

  // BLOCO 2C — feedback local pós-conversão: link para o destino REAL retornado
  // pela conversão (ou já existente em duplicate:true). Estado só de UI —
  // nenhum registro é gravado no banco; disponível mesmo depois de a captura
  // sair da lista Pendentes. Limpo ao trocar de captura/desmontar a página.
  const [conversionFeedback, setConversionFeedback] = useState<{
    captureId: string
    targetType: 'project' | 'action'
    targetId: string
    duplicate: boolean
    // NUMERAÇÃO PERMANENTE 2C — código real do destino retornado pela conversão
    // (target.sequence_number do hook transacional). duplicate:true traz o
    // MESMO destino/código já existentes, sem nova alocação.
    targetSequenceNumber: number | null
    targetTitle: string
  } | null>(null)

  useEffect(() => {
    pageActive.current = true
    return () => {
      pageActive.current = false
      ++copilotSession.current
      setConversionFeedback(null)
    }
  }, [])

  // Convert to Project form state
  const [projectTitle, setProjectTitle] = useState('')
  const [projectContext, setProjectContext] = useState<'vida' | 'trabalho'>('trabalho')
  const [projectAspiration, setProjectAspiration] = useState('')
  const [projectControllable, setProjectControllable] = useState('')
  const [projectCompletion, setProjectCompletion] = useState('')

  // Convert to Action form state
  const [actionTitle, setActionTitle] = useState('')
  const [actionContext, setActionContext] = useState<'vida' | 'trabalho'>('trabalho')
  const [actionProjectId, setActionProjectId] = useState<string>('')
  const [availableProjects, setAvailableProjects] = useState<Project[]>([])

  // FATIA 4C2 — Estratégia (opcional) na conversão em Avanço: escolha SÓ em
  // memória do formulário; '' = Nenhuma. Toda abertura NOVA (manual ou proposta
  // local do Copiloto) começa Nenhuma — nunca inferida da captura, propósito,
  // filtro ou proposta. A captura pendente não tem vínculo original persistido:
  // nunca há Estratégia arquivada a liberar nesta conversão. Lista = hook82
  // reusado (uma leitura completa do Resultado EFETIVAMENTE escolhido; sem IN
  // SQL, sem consulta por opção, sem listagem global, sem polling).
  const [actionStrategyId, setActionStrategyId] = useState('')
  // Registro da escolha provisória (para identificar incompatibilidade ao
  // trocar de pai sem nova consulta — dados já lidos, sem fonte nova).
  const [actionStrategyChoice, setActionStrategyChoice] = useState<Strategy | null>(null)
  const [actionStrategyNotice, setActionStrategyNotice] = useState<string | null>(null)
  // Criação inline: reusa o StrategyModal REAL 4B1 sobre este diálogo.
  const [actionStrategyModalOpen, setActionStrategyModalOpen] = useState(false)
  const actionStrategies = useProjectStrategies(
    conversionType === 'action' && actionProjectId ? actionProjectId : '',
  )

  // FATIA 5C2 — Planejamento (opcional) do NOVO Avanço no diálogo Converter em
  // Avanço: MESMA tupla/rascunho do formulário 89 (PlannedExecutionFields +
  // validação literal), montada APÓS vínculos e ANTES da confirmação. Intenção
  // LOCAL ao diálogo: toda abertura NOVA (manual ou proposta local) inicia
  // recolhida e VAZIA — nunca inferida de captura/raw_text/created, prazo,
  // Resultado, Responsabilidade, Estratégia, filtro ou última conversão; a
  // captura pendente NUNCA é lida como Avanço já salvo e duplicata não é
  // consultada. Sem localStorage (o rascunho da entrada rápida é outra coisa).
  const [actionPlanned, setActionPlanned] = useState<PlannedExecution>(EMPTY_PLANNED)
  const [actionPlannedUtcFallback, setActionPlannedUtcFallback] = useState(false)
  const [actionPlannedPendingInvalid, setActionPlannedPendingInvalid] = useState(false)
  const [actionPlannedError, setActionPlannedError] = useState<string | null>(null)

  // FATIA 3C2B — Responsabilidade nos dois diálogos de conversão.
  // IDs estáveis por instância (useId no topo, antes de qualquer retorno).
  const uid = useId()
  const convertIds = React.useMemo(
    () => ({
      projectResponsibility: `${uid}-convert-project-responsibility`,
      actionResponsibility: `${uid}-convert-action-responsibility`,
      actionInheritedResponsibility: `${uid}-convert-action-inherited-responsibility`,
      actionStrategy: `${uid}-convert-action-strategy`,
    }),
    [uid],
  )
  // Vínculo NOVO escolhido em cada formulário; '' = Nenhuma. Toda nova
  // abertura (manual e proposta local) começa Nenhuma — nunca inferida de
  // propósito, filtro, texto, captura anterior ou proposta Manus. A escolha
  // direta do Avanço permanece SÓ em memória enquanto um Resultado está
  // selecionado (não é copiada da herança); nova abertura zera a conversão
  // anterior.
  const [projectResponsibilityId, setProjectResponsibilityId] = useState('')
  const [actionDirectResponsibilityId, setActionDirectResponsibilityId] = useState('')
  // Um único read por abertura (qualquer dos dois diálogos) — lista completa do
  // dono, com loading/erro/retry reais do seletor.
  const convertResponsibilityOptions: ResponsibilityOptionsState = useResponsibilityOptions(
    conversionType !== null,
  )
  // HERANÇA EM LEITURA do Resultado realmente escolhido: hook existente no
  // topo, incondicional. Pai ainda não carregado (null) NUNCA é 'Nenhuma';
  // '' do pai confirma ausência ('none'); erro preserva 'error'. A herança
  // JAMAIS é copiada para o payload do Avanço (envia responsibility_id='').
  const selectedActionProject = actionProjectId
    ? (availableProjects.find((p) => p.id === actionProjectId) ?? null)
    : null
  const inheritedActionRef: ResponsibilityRefState = useResponsibilityReference(
    selectedActionProject ? (selectedActionProject.responsibility_id ?? null) : null,
  )

  // FATIA 4C2 — incompatibilidade da escolha provisória com o pai ATUAL do
  // formulário (troca de Resultado): identificada pelos dados já lidos; nunca
  // tratada como opção válida nem enviada ao backend.
  const actionStrategyIncompatible =
    Boolean(actionStrategyId) &&
    Boolean(actionProjectId) &&
    actionStrategyChoice !== null &&
    actionStrategyChoice.project_id !== actionProjectId

  // FATIA 4C2 — troca de pai no diálogo de Avanço: a escolha de Estratégia é só
  // memória; transições identificam (aviso) e nunca enviam grupo do pai
  // anterior nem limpam silenciosamente. Sem escolha anterior, troca simples.
  const handleActionProjectChange = (nextProjectId: string) => {
    setActionProjectId(nextProjectId)
    if (!nextProjectId) {
      if (actionStrategyId) {
        setActionStrategyNotice(
          'Este avanço será criado solto, sem estratégia. Use “Remover escolha de Estratégia” para confirmar, ou volte ao resultado para mantê-la.',
        )
      }
      return
    }
    if (!actionStrategyId) return
    const chosen = actionStrategyChoice
    if (chosen && chosen.project_id === nextProjectId) {
      setActionStrategyNotice(null)
      return
    }
    setActionStrategyNotice(
      'A estratégia escolhida pertence a outro resultado. Escolha “Nenhuma” ou uma estratégia ativa do novo resultado antes de converter.',
    )
  }

  // FATIA 4C2 — seleção direta no seletor: ID nativo ('' = Nenhuma); escolha
  // registrada com o registro já lido; aviso de transição limpo.
  const handleActionStrategyChange = (nextId: string) => {
    setActionStrategyId(nextId)
    setActionStrategyChoice(
      nextId ? (actionStrategies.items.find((s) => s.id === nextId) ?? actionStrategyChoice) : null,
    )
    setActionStrategyNotice(null)
  }

  // FATIA 4C2 — criação INLINE de Estratégia: o StrategyModal REAL 4B1 salva
  // via strategyService.create UMA vez (dentro dele); incluir o grupo confirmado
  // nas opções é local ao hook82 (upsert). NÃO converte a captura, não fecha o
  // diálogo-pai, não promove Hoje: são duas decisões independentes. Dono/pai/
  // abertura do snapshot que iniciou a criação devem corresponder — retorno
  // tardio não seleciona. Nunca apaga grupo como compensação.
  const handleInlineStrategySaved = (saved: Strategy, created: boolean) => {
    if (!created) return
    if (conversionType !== 'action' || !actionProjectId) return
    if (saved.project_id !== actionProjectId) return
    if (!isSameOwner(currentOwnerSnapshot())) return
    actionStrategies.upsert(saved)
    setActionStrategyId(saved.id)
    setActionStrategyChoice(saved)
    setActionStrategyNotice(null)
  }

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

  useEffect(() => {
    projectService
      .list()
      .then((list) => {
        setAvailableProjects(list.filter((p) => p.status === 'ativo' || p.status === 'rascunho'))
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Falha ao carregar projetos para vínculo.'
        toast({ variant: 'destructive', title: 'Erro', description: msg })
      })
  }, [toast])

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
  }, [beginSend, isCurrent, settleSuccess, isSubmitting, loadCaptures, toast])

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

  const openConvertToProject = (capture: CaptureItem) => {
    setConversionFromCopilot(false)
    setConversionFeedback(null)
    setSelectedCapture(capture)
    setProjectTitle(capture.raw_text.split('\n')[0].slice(0, 80))
    setProjectContext(contextFilter === 'vida' ? 'vida' : 'trabalho')
    setProjectAspiration('')
    setProjectControllable('')
    setProjectCompletion('')
    setProjectResponsibilityId('')
    setConversionType('project')
  }

  const openConvertToAction = (capture: CaptureItem) => {
    setConversionFromCopilot(false)
    setConversionFeedback(null)
    setSelectedCapture(capture)
    setActionTitle(capture.raw_text.slice(0, 100))
    setActionContext(contextFilter === 'vida' ? 'vida' : 'trabalho')
    setActionProjectId('')
    setActionDirectResponsibilityId('')
    // FATIA 4C2 — toda abertura nova começa Nenhuma; sem editor filho aberto.
    setActionStrategyId('')
    setActionStrategyChoice(null)
    setActionStrategyNotice(null)
    setActionStrategyModalOpen(false)
    // FATIA 5C2 — abertura NOVA inicia recolhida e sem plano (dia/hora/fuso
    // vazios); sem herdar valores da abertura anterior.
    setActionPlanned(EMPTY_PLANNED)
    setActionPlannedUtcFallback(false)
    setActionPlannedPendingInvalid(false)
    setActionPlannedError(null)
    setConversionType('action')
  }

  const useCopilotProposal = async (request: AiRequestRecord) => {
    if (!copilotOpen || !copilotCapture) throw new Error('Abra a captura para revisar a proposta.')
    const session = copilotSession.current
    const prepared = await prepareProposalConversion(request, copilotCapture)
    if (!pageActive.current || session !== copilotSession.current) {
      throw new Error('O painel mudou; a proposta não foi levada ao formulário.')
    }
    const { capture, proposal } = prepared
    ++copilotSession.current
    setCopilotOpen(false)
    setCopilotCapture(null)
    setConversionFeedback(null)
    setSelectedCapture(capture)
    setConversionFromCopilot(true)
    setCaptures((list) => list.map((item) => (item.id === capture.id ? capture : item)))
    if (proposal.kind === 'projeto') {
      setProjectTitle(proposal.title)
      setProjectContext(proposal.context)
      setProjectAspiration(proposal.aspiration ?? '')
      setProjectControllable(proposal.controllable_delivery ?? '')
      setProjectCompletion(proposal.completion_condition ?? '')
      // Proposta local NÃO inventa Responsabilidade: vínculo começa Nenhuma.
      setProjectResponsibilityId('')
      setConversionType('project')
    } else {
      setActionTitle(proposal.title)
      setActionContext(proposal.context)
      setActionProjectId('')
      setActionDirectResponsibilityId('')
      // FATIA 4C2 — proposta local NÃO inventa Estratégia: começa Nenhuma.
      setActionStrategyId('')
      setActionStrategyChoice(null)
      setActionStrategyNotice(null)
      setActionStrategyModalOpen(false)
      // FATIA 5C2 — proposta LOCAL não inventa planejamento: recolhida e vazia.
      setActionPlanned(EMPTY_PLANNED)
      setActionPlannedUtcFallback(false)
      setActionPlannedPendingInvalid(false)
      setActionPlannedError(null)
      setConversionType('action')
    }
  }

  const [isConverting, setIsConverting] = useState(false)

  // FATIA 3C2B — validação do vínculo NOVO antes do envio único, pelos dados já
  // carregados do seletor. Na conversão TODO vínculo explícito é novo: não há
  // vínculo persistido a liberar grupo arquivado. Valor fora da lista (raro)
  // segue para o backend, autoridade final.
  const directLinkProblem = (chosenId: string, ctx: 'vida' | 'trabalho'): string | null => {
    if (!chosenId) return null
    const known = convertResponsibilityOptions.list.find((r) => r.id === chosenId) ?? null
    if (!known) return null
    if (known.context !== ctx) {
      return `A responsabilidade escolhida é de contexto ${
        known.context === 'trabalho' ? 'Trabalho' : 'Vida'
      }, mas o formulário é de ${ctx === 'trabalho' ? 'Trabalho' : 'Vida'}. Escolha “Nenhuma” ou outra compatível antes de converter.`
    }
    if (known.status !== 'ativa') {
      return 'A responsabilidade escolhida não está ativa. Escolha “Nenhuma” ou outra ativa antes de converter um vínculo novo.'
    }
    return null
  }

  const handleConfirmConvert = async (target: 'project' | 'action') => {
    if (!selectedCapture) return
    if (target === 'project' && !projectTitle.trim()) return
    if (target === 'action' && !actionTitle.trim()) return
    // FATIA 5C2 — validação 89 do planejamento (dia real, hora HH:mm real,
    // fuso explícito; parcial/badInput NÃO vira vazio válido) ANTES de chamar
    // convert: bloqueia o serviço com o erro associado ao campo, mantendo o
    // texto e as escolhas no formulário aberto. Só o ramo 'action' valida e
    // envia; Resultado NUNCA lê este rascunho nem recebe os 3 campos.
    let plannedPayload: {
      planned_date?: string
      planned_time?: string
      planned_timezone?: string
    } = {}
    if (target === 'action') {
      if (actionPlannedPendingInvalid) {
        setActionPlannedError(
          'Há data ou hora incompleta no planejamento. Conclua o valor ou limpe o campo antes de converter.',
        )
        return
      }
      if (actionPlanned.date === '') {
        if (actionPlanned.time !== '' || actionPlanned.timezone !== '') {
          setActionPlannedError('Planejamento incompleto: informe a data ou remova o planejamento.')
          return
        }
      } else if (!isValidPlannedDate(actionPlanned.date)) {
        setActionPlannedError(
          'Informe uma data planejada real (AAAA-MM-DD, incluindo anos bissextos).',
        )
        return
      } else if (actionPlanned.timezone === '') {
        setActionPlannedError(
          'O planejamento precisa do fuso. Remova o planejamento para converter sem ele.',
        )
        return
      } else if (!isValidPlannedTime(actionPlanned.time)) {
        setActionPlannedError('Informe uma hora planejada real (HH:mm) ou limpe o campo.')
        return
      } else {
        setActionPlannedError(null)
      }
      // Payload único do plano: os 3 campos EXATOS escolhidos (dia/hora/fuso
      // literais; hora '' = dia inteiro) no MESMO data do convert — sem fuso
      // informativo sozinho, sem planned_at/offset/DST e sem segunda gravação.
      if (actionPlanned.date !== '') {
        plannedPayload = {
          planned_date: actionPlanned.date,
          planned_time: actionPlanned.time,
          planned_timezone: actionPlanned.timezone,
        }
      }
    }
    // Validação do vínculo novo ANTES de chamar convert (nada é gravado antes).
    const linkProblem =
      target === 'project'
        ? directLinkProblem(projectResponsibilityId, projectContext)
        : directLinkProblem(actionDirectResponsibilityId, actionContext)
    if (linkProblem) {
      toast({ variant: 'destructive', title: 'Conversão não realizada', description: linkProblem })
      return
    }
    // FATIA 4C2 — coerência da escolha de Estratégia ANTES do envio único
    // (dados já lidos; backend 84 é autoridade final sobre dono/pai/ativa).
    // Solto nunca envia estratégia; com pai, escolha precisa pertencer a ele.
    if (target === 'action') {
      if (!actionProjectId && actionStrategyId) {
        toast({
          variant: 'destructive',
          title: 'Conversão não realizada',
          description:
            'Remova a escolha de Estratégia antes de converter: este avanço será criado solto, sem estratégia.',
        })
        return
      }
      if (actionProjectId && actionStrategyId && actionStrategyIncompatible) {
        toast({
          variant: 'destructive',
          title: 'Conversão não realizada',
          description:
            'A estratégia escolhida pertence a outro resultado. Escolha “Nenhuma” ou uma estratégia ativa deste resultado antes de converter.',
        })
        return
      }
      if (actionProjectId && actionStrategyId && !actionStrategyChoice) {
        toast({
          variant: 'destructive',
          title: 'Conversão não realizada',
          description:
            'Não foi possível confirmar a estratégia escolhida neste resultado. Escolha “Nenhuma” ou outra estratégia ativa antes de converter.',
        })
        return
      }
    }

    // Trava síncrona dedicada: Enter duplo/clique repetido não chamam convert
    // duas vezes. Retorno tardio só se aplica à mesma intenção/dono/captura.
    if (convertingRef.current || isConverting) return
    convertingRef.current = true
    setIsConverting(true)
    const snap = currentOwnerSnapshot()
    try {
      // Avanço subordinado: revalidação pontual do pai vigente no confirmar
      // (dados existentes primeiro). Se contexto/Responsabilidade do pai
      // mudaram, atualiza SÓ a referência informativa, preserva os campos e
      // pede revisão antes de enviar — falha de leitura não autoriza novo pai
      // (segue os dados existentes; backend é autoridade final).
      if (target === 'action' && actionProjectId) {
        const presented = availableProjects.find((p) => p.id === actionProjectId)
        if (presented) {
          try {
            const fresh = await projectService.getById(actionProjectId)
            if (
              (fresh.responsibility_id || '') !== (presented.responsibility_id || '') ||
              fresh.context !== presented.context
            ) {
              setAvailableProjects((prev) => prev.map((p) => (p.id === fresh.id ? fresh : p)))
              toast({
                variant: 'destructive',
                title: 'Conversão não realizada',
                description:
                  'O resultado escolhido mudou de contexto ou de Responsabilidade desde a abertura. Revise a herança exibida e confirme novamente.',
              })
              return
            }
          } catch {
            // Revalidação indisponível: não bloqueia nem inventa pai — o
            // backend valida dono/contexto/ativa na transação única.
          }
        }
      }

      const result = await captureService.convert(
        selectedCapture.id,
        target,
        target === 'project'
          ? {
              title: projectTitle.trim(),
              context: projectContext,
              aspiration: projectAspiration.trim() || undefined,
              controllable_delivery: projectControllable.trim() || undefined,
              completion_condition: projectCompletion.trim() || undefined,
              // FATIA 3C2B — vínculo NOVO escolhido ou '' (Nenhuma) no MESMO
              // commit único do backend; nunca update depois da conversão.
              responsibility_id: projectResponsibilityId,
            }
          : {
              title: actionTitle.trim(),
              context: actionContext,
              project_id: actionProjectId ? actionProjectId : undefined,
              // Subordinado: project_id do pai e responsibility_id='' (herança
              // é SEMPRE do Resultado, nunca copiada, nunca dois vínculos).
              // Solto: escolha direta ou '' (Nenhuma).
              responsibility_id: actionProjectId ? '' : actionDirectResponsibilityId,
              // FATIA 4C2 — strategy_id no MESMO data do envio único (contrato
              // 84): com pai, ID nativo escolhido (coerência já validada acima)
              // ou '' (Nenhuma); solto, sempre ''. Nunca vínculo do pai anterior
              // e nunca update de actionService/projectService depois. Resposta
              // do backend traz o vínculo PERSISTIDO; duplicate:true não afirma
              // a aplicação da escolha desta tentativa.
              strategy_id: actionProjectId ? actionStrategyId : '',
              // FATIA 5C2 — planejamento no MESMO data do envio único 91:
              // sem plano (inclusive remoção explícita) = omitir os 3 campos
              // (default vazio nativo); com plano = os 3 valores locais exatos.
              ...plannedPayload,
            },
      )

      if (!isSameOwner(snap) || !pageActive.current) return

      // Idempotente: quando a captura já estava convertida (retry após perder
      // a resposta, duplo clique, chamada concorrente), o backend retorna o
      // destino REAL que já existia — nunca cria um segundo destino.
      // BLOCO 2C — o mesmo destino retornado vira link local (sem nova leitura
      // ao backend, sem inferir ID pelo título). Resposta inconclusiva (sem
      // target.id) mantém o texto atual, sem inventar destino.
      const targetType = result.target_type === 'action' ? 'action' : 'project'
      const targetId = typeof result.target?.id === 'string' ? result.target.id : ''
      // Código real vem do destino persistido retornado pelo serviço atual —
      // nunca calculado no frontend; resposta sem número mantém o texto atual.
      const targetSequenceNumber =
        result.target && typeof result.target.sequence_number === 'number'
          ? result.target.sequence_number
          : null
      const targetTitle = typeof result.target?.title === 'string' ? result.target.title : ''
      if (targetId) {
        setConversionFeedback({
          captureId: selectedCapture.id,
          targetType,
          targetId,
          duplicate: result.duplicate,
          targetSequenceNumber,
          targetTitle,
        })
      }
      if (result.duplicate) {
        toast({
          title: 'Captura já estava convertida',
          description: targetId
            ? 'Nenhum destino duplicado foi criado. Use o link abaixo para abrir o destino existente.'
            : 'Nenhum destino duplicado foi criado. O destino não foi confirmado nesta resposta.',
        })
      } else {
        toast({
          title:
            target === 'project'
              ? 'Captura convertida em Resultado com sucesso!'
              : 'Captura convertida em Avanço pronto!',
          description: targetId
            ? undefined
            : 'O destino não foi retornado pela conversão; confira nas capturas convertidas.',
        })
      }
      setConversionType(null)
      setSelectedCapture(null)
      loadCaptures()
    } catch (err: unknown) {
      // Falha: erro visível e dados digitados/escolhas preservados (o modal
      // permanece aberto com o formulário intacto — nada é apagado, nenhum
      // falso sucesso). Retorno tardio de outra sessão não exibe toast.
      if (!isSameOwner(snap) || !pageActive.current) return
      const msg = err instanceof Error ? err.message : 'Erro na conversão'
      toast({ variant: 'destructive', title: 'Erro na conversão', description: msg })
    } finally {
      convertingRef.current = false
      setIsConverting(false)
    }
  }

  // FATIA 5C2 — fuso que um plano novo capturaria: perfil válido ou UTC
  // explícito (mesma função 89; sem resolvedOptions, sem offset do dispositivo,
  // sem nova leitura do perfil). Só memória; UTC verdadeiro do perfil não é fallback.
  const convertProfileTz = plannedTimezoneOrFallback(user?.timezone ?? '')

  const handleActionPlannedDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget
    const raw = el.value
    // Entrada parcial/inválida (badInput nativo): mantém a intenção e bloqueia
    // a confirmação — nunca interpreta '' de badInput como remoção.
    if (raw === '' && el.validity.badInput) {
      setActionPlannedPendingInvalid(true)
      return
    }
    setActionPlannedPendingInvalid(false)
    setActionPlannedError(null)
    if (raw === '') {
      // Limpeza EXPLÍCITA da data: remove o GRUPO inteiro em memória.
      setActionPlanned(EMPTY_PLANNED)
      setActionPlannedUtcFallback(false)
      return
    }
    if (actionPlanned.timezone === '') {
      // Primeiro dia válido de um rascunho sem plano: captura o literal do
      // perfil (ou UTC explícito com aviso) e o mantém até remoção/reinício.
      const tz = convertProfileTz
      setActionPlanned({ date: raw, time: '', timezone: tz.timezone })
      setActionPlannedUtcFallback(tz.usedFallback)
      return
    }
    // Plano em curso: mantém EXATAMENTE o fuso já escolhido; troca posterior
    // do perfil/contexto/Resultado/etc. não reescreve nem reinterpreta.
    setActionPlanned((prev) => ({ ...prev, date: raw }))
  }

  const handleActionPlannedTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget
    const raw = el.value
    if (raw === '' && el.validity.badInput) {
      setActionPlannedPendingInvalid(true)
      return
    }
    setActionPlannedPendingInvalid(false)
    setActionPlannedError(null)
    // Limpar só a hora conserva dia/fuso; '' não ganha meia-noite nem horário atual.
    setActionPlanned((prev) => ({ ...prev, time: raw }))
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
      </div>

      {/* Destino de captura já convertida (BLOCO 2C) */}
      {(item.status === 'convertida_projeto' || item.status === 'convertida_acao') && (
        <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
          {renderConvertedDest(item)}
        </div>
      )}

      {/* Ações de processamento */}
      {item.status === 'pendente' && (
        <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
          <ProcessCaptureMenu capture={item} onDone={loadCaptures} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => openConvertToAction(item)}
            className="text-xs gap-1.5"
          >
            <CheckSquare className="w-3.5 h-3.5 text-primary" />
            Virar Avanço
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => openConvertToProject(item)}
            className="text-xs gap-1.5"
          >
            <FolderKanban className="w-3.5 h-3.5 text-primary" />
            Virar Resultado
          </Button>

          {/* BLOCO 9 — Copiloto é opcional: ênfase secundária/neutra; a conversão
              manual (Virar Avanço/Resultado) continua o caminho principal. Abrir o
              painel não envia nada ao Manus. Rótulo pode quebrar no celular
              sem reduzir a área de toque (whitespace-normal + min-h). */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              ++copilotSession.current
              setCopilotCapture(item)
              setCopilotOpen(true)
            }}
            className="min-h-[36px] gap-1.5 whitespace-normal px-2.5 text-xs text-muted-foreground hover:text-foreground"
            title="Ver pedidos e comandos explícitos do copiloto (opcional)"
          >
            <Bot className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="text-left leading-tight">Copiloto · Opcional</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleDiscard(item.id)}
            className="text-muted-foreground hover:text-destructive hover:bg-ginga-danger-bg text-xs"
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

  // NUMERAÇÃO PERMANENTE 2C — identificação do destino no feedback pós-conversão:
  // código real antes do título (formatter textual; sem título conhecido, só o
  // código). Sem número confirmado na resposta, nada é afirmado.
  const feedbackTargetLabel =
    conversionFeedback && conversionFeedback.targetSequenceNumber !== null
      ? conversionFeedback.targetTitle !== ''
        ? formatEntityTitle(
            conversionFeedback.targetType,
            conversionFeedback.targetSequenceNumber,
            conversionFeedback.targetTitle,
          )
        : entityNumberCode(conversionFeedback.targetType, conversionFeedback.targetSequenceNumber)
      : null

  const getStatusBadge = (st: CaptureStatus) => {
    switch (st) {
      case 'pendente':
        return (
          <Badge className="bg-ginga-warning-bg text-ginga-warning border-ginga-warning/30">
            Pendente
          </Badge>
        )
      case 'convertida_projeto':
        return (
          <Badge className="bg-ginga-info-bg text-ginga-info border-ginga-info/30">Resultado</Badge>
        )
      case 'convertida_acao':
        return (
          <Badge className="bg-ginga-success-bg text-ginga-success border-ginga-success/30">
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
          <div className="flex items-center gap-1.5 bg-muted border border-border p-1 rounded-lg text-xs">
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

      {/* BLOCO 2C — feedback pós-conversão com link para o destino real */}
      {conversionFeedback && (
        <div
          role="status"
          className="rounded-xl border border-ginga-success/30 bg-ginga-success-bg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {conversionFeedback.duplicate
                ? 'Captura já convertida'
                : conversionFeedback.targetType === 'project'
                  ? 'Captura convertida em Resultado'
                  : 'Captura convertida em Avanço'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {conversionFeedback.duplicate
                ? 'Abrir leva ao destino que já existia — nenhum destino duplicado foi criado.'
                : 'Abra o destino criado ou continue processando as demais capturas.'}
            </p>
            {feedbackTargetLabel && (
              <p className="mt-1 break-words text-xs text-foreground">{feedbackTargetLabel}</p>
            )}
          </div>
          {conversionFeedback.targetType === 'project' ? (
            <Button asChild size="sm" className="gap-1.5 shrink-0">
              <Link to={`/resultados?id=${encodeURIComponent(conversionFeedback.targetId)}`}>
                Abrir resultado
              </Link>
            </Button>
          ) : (
            <Button asChild size="sm" className="gap-1.5 shrink-0">
              <Link to={`/avancos?id=${encodeURIComponent(conversionFeedback.targetId)}`}>
                Abrir avanço
              </Link>
            </Button>
          )}
        </div>
      )}

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
            <p role="status" className="text-xs text-ginga-warning">
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
          <div className="grid gap-3">{captures.map(renderCaptureCard)}</div>
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
                        variant="outline"
                        onClick={() => openConvertToAction(item)}
                        className="text-xs gap-1.5"
                      >
                        <CheckSquare className="w-3.5 h-3.5 text-primary" />
                        Virar Avanço
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openConvertToProject(item)}
                        className="text-xs gap-1.5"
                      >
                        <FolderKanban className="w-3.5 h-3.5 text-primary" />
                        Virar Resultado
                      </Button>

                      {/* BLOCO 9 — rótulo opcional com ênfase neutra (ver Cards) */}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          ++copilotSession.current
                          setCopilotCapture(item)
                          setCopilotOpen(true)
                        }}
                        className="min-h-[36px] gap-1.5 whitespace-normal px-2.5 text-xs text-muted-foreground hover:text-foreground"
                        title="Ver pedidos e comandos explícitos do copiloto (opcional)"
                      >
                        <Bot className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span className="text-left leading-tight">Copiloto · Opcional</span>
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDiscard(item.id)}
                        className="text-muted-foreground hover:text-destructive hover:bg-ginga-danger-bg text-xs"
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

      {/* Modal: Converter em Projeto */}
      <Dialog
        open={conversionType === 'project'}
        onOpenChange={(open) => {
          // Durante o envio, fechar/Escape não descarta o formulário.
          if (!open && !isConverting) setConversionType(null)
        }}
      >
        <DialogContent className="bg-card text-card-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <FolderKanban className="w-5 h-5 text-primary" />
              Converter Captura em Resultado
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Crie o resultado como rascunho com título e contexto. Você pode preencher o resto
              depois.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 overflow-y-auto max-h-[60vh]">
            {conversionFromCopilot && selectedCapture && (
              <div className="rounded-md border border-border bg-accent p-3 text-xs space-y-2">
                <p className="text-foreground">
                  Proposta sugerida pelo Manus. Revise os campos; nada será criado antes de
                  confirmar.
                </p>
                <p className="whitespace-pre-wrap break-words text-muted-foreground">
                  {selectedCapture.raw_text}
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Título do Resultado
              </Label>
              <Input
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                required
                disabled={isConverting}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Contexto
              </Label>
              <Select
                value={projectContext}
                onValueChange={(v) => setProjectContext(v as 'vida' | 'trabalho')}
                disabled={isConverting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trabalho">Trabalho</SelectItem>
                  <SelectItem value="vida">Vida</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* FATIA 3C2B — Responsabilidade (opcional) perto do Contexto: toda
               nova abertura começa Nenhuma; opções ativas do dono no contexto
               do formulário; sentinel 'none' nunca vai ao banco ('' = Nenhuma). */}
            <ResponsibilitySelect
              id={convertIds.projectResponsibility}
              value={projectResponsibilityId}
              onChange={setProjectResponsibilityId}
              context={projectContext}
              options={convertResponsibilityOptions}
              disabled={isConverting}
            />

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Aspiração (O que quero alcançar? Opcional)
              </Label>
              <Textarea
                rows={2}
                value={projectAspiration}
                onChange={(e) => setProjectAspiration(e.target.value)}
                placeholder="Ex: Ampliar minha influência estratégica na empresa"
                className="text-xs"
                disabled={isConverting}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Entrega Controlável (O que vou entregar? Opcional)
              </Label>
              <Textarea
                rows={2}
                value={projectControllable}
                onChange={(e) => setProjectControllable(e.target.value)}
                placeholder="Ex: Entregar proposta escrita de revisão de processos com 3 reuniões de validação"
                className="text-xs"
                disabled={isConverting}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Condição de término (opcional)
              </Label>
              <Textarea
                rows={2}
                value={projectCompletion}
                onChange={(e) => setProjectCompletion(e.target.value)}
                placeholder="Como reconhecerei que a entrega foi concluída?"
                className="text-xs"
                disabled={isConverting}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConversionType(null)} disabled={isConverting}>
              Cancelar
            </Button>
            <Button
              onClick={() => handleConfirmConvert('project')}
              disabled={isConverting || !projectTitle.trim()}
            >
              {isConverting ? 'Gravando…' : 'Criar Resultado Rascunho'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Converter em Ação */}
      <Dialog
        open={conversionType === 'action'}
        onOpenChange={(open) => {
          if (!open && !isConverting) setConversionType(null)
        }}
      >
        <DialogContent className="bg-card text-card-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-primary" />
              Converter Captura em Avanço
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Crie um avanço executável vinculado ou solto, pronto para a execução.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {conversionFromCopilot && selectedCapture && (
              <div className="rounded-md border border-border bg-accent p-3 text-xs space-y-2">
                <p className="text-foreground">
                  Proposta sugerida pelo Manus. Revise o título e contexto; confirmar cria somente
                  esta ação.
                </p>
                <p className="whitespace-pre-wrap break-words text-muted-foreground">
                  {selectedCapture.raw_text}
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Título do Avanço
              </Label>
              <Input
                value={actionTitle}
                onChange={(e) => setActionTitle(e.target.value)}
                required
                disabled={isConverting}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Contexto
                </Label>
                <Select
                  value={actionContext}
                  onValueChange={(v) => setActionContext(v as 'vida' | 'trabalho')}
                  disabled={isConverting}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trabalho">Trabalho</SelectItem>
                    <SelectItem value="vida">Vida</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Resultado (Opcional)
                </Label>
                <Select
                  value={actionProjectId}
                  onValueChange={(v) => handleActionProjectChange(v === 'none' ? '' : v)}
                  disabled={isConverting}
                >
                  <SelectTrigger className="truncate text-xs">
                    <SelectValue placeholder="Avanço solto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Avanço solto</SelectItem>
                    {availableProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {`${formatEntityTitle('project', p.sequence_number, p.title)} [${p.context}]`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* FATIA 3C2B — solto: escolha DIRETA de Responsabilidade (Nenhuma
               por abertura; opções ativas do dono/contexto do formulário).
               Subordinado: herança SOMENTE LEITURA, resolvida pelo
               responsibility_id do Resultado realmente escolhido (arquivada
               indicada; "Nenhuma" só com ausência confirmada; erro/carregando
               NUNCA viram Nenhuma) — texto puro e secundário, nunca seletor
               desabilitado parecendo editável. */}
            {actionProjectId ? (
              <p
                id={convertIds.actionInheritedResponsibility}
                className="text-sm text-muted-foreground"
              >
                <span className="font-medium text-foreground">
                  Responsabilidade herdada do resultado:
                </span>{' '}
                {inheritedActionRef.status === 'none' ? (
                  <span className="italic">Nenhuma</span>
                ) : inheritedActionRef.status === 'ready' ? (
                  <>
                    {inheritedActionRef.data.title}
                    {inheritedActionRef.data.status === 'arquivada' &&
                      ' (arquivada — vínculo do resultado)'}
                  </>
                ) : inheritedActionRef.status === 'error' ? (
                  <span className="font-medium text-ginga-warning">
                    Responsabilidade atual indisponível — vínculo do resultado preservado
                  </span>
                ) : (
                  <span className="italic">carregando…</span>
                )}
              </p>
            ) : (
              <ResponsibilitySelect
                id={convertIds.actionResponsibility}
                value={actionDirectResponsibilityId}
                onChange={setActionDirectResponsibilityId}
                context={actionContext}
                options={convertResponsibilityOptions}
                disabled={isConverting}
              />
            )}
            {/* Transição solto → Resultado com escolha direta provisória: a
               escolha fica SÓ em memória (voltar a solto a mantém; voltar não
               copia herança); nada persistido a apagar nesta captura pendente. */}
            {actionProjectId && actionDirectResponsibilityId && (
              <p role="alert" className="text-xs font-medium text-ginga-warning">
                Ao confirmar, este avanço seguirá a Responsabilidade do resultado escolhido; a
                escolha direta não será usada.
              </p>
            )}

            {/* FATIA 4C2 — Estratégia (opcional), LOCAL ao Resultado escolhido.
               Sem Resultado: sem seletor e sem grupos de outros pais, com
               orientação discreta (Avanço solto segue utilizável, inclusive com
               Responsabilidade direta). Escolha nova nunca herda/inferir;
               sentinel 'none' interno nunca vai à API — vai ID nativo ou ''. */}
            {actionProjectId && selectedActionProject && (
              <StrategySelect
                id={convertIds.actionStrategy}
                value={actionStrategyId}
                onChange={handleActionStrategyChange}
                options={actionStrategies}
                projectLabel={`[${selectedActionProject.context}] ${formatEntityTitle('project', selectedActionProject.sequence_number, selectedActionProject.title)}`}
                onOpenCreate={() => {
                  if (!isConverting) setActionStrategyModalOpen(true)
                }}
                incompatible={actionStrategyIncompatible}
                disabled={isConverting}
              />
            )}
            {actionProjectId && !selectedActionProject && (
              <p className="text-xs text-muted-foreground">
                Estratégias ficam disponíveis quando o resultado selecionado é carregado.
              </p>
            )}
            {!actionProjectId && (
              <p className="text-xs text-muted-foreground">
                Vincule este avanço a um resultado para escolher uma estratégia.
              </p>
            )}
            {/* Volta a solto com escolha provisória: identificada, nunca enviada
               nem apagada em silêncio — ajuste explícito antes de confirmar. */}
            {!actionProjectId && actionStrategyId && (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ginga-warning/30 bg-ginga-warning-bg p-2 text-xs"
              >
                <span className="font-medium text-ginga-warning">
                  Avanço solto não leva estratégia. Remova a escolha antes de converter, ou volte ao
                  resultado para mantê-la.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isConverting}
                  onClick={() => {
                    setActionStrategyId('')
                    setActionStrategyChoice(null)
                    setActionStrategyNotice(null)
                  }}
                  className="min-h-11 shrink-0"
                >
                  Remover escolha de Estratégia
                </Button>
              </div>
            )}
            {actionStrategyNotice && (
              <p role="alert" className="text-xs font-medium text-ginga-warning">
                {actionStrategyNotice}
              </p>
            )}

            {/* FATIA 5C2 — Planejamento (opcional): o MESMO componente 89, com
               a MESMA fórmula de rascunho/fuso/validação do ActionModal.
               Recolher/expandir não muda valores; converter é o único commit;
               cancelar não grava nem aciona IA. Key reinicia a apresentação a
               cada abertura/dono/captura/tipo, sem tocar o rascunho em uso. */}
            <PlannedExecutionFields
              key={`${conversionType ?? 'closed'}-${selectedCapture?.id ?? 'none'}-${conversionFromCopilot ? 'copilot' : 'manual'}`}
              draft={actionPlanned}
              profileTimezone={convertProfileTz.timezone}
              usingUtcFallback={actionPlannedUtcFallback}
              keepsSavedTimezone={false}
              savedTimezoneUnrecognized={false}
              pristine={false}
              error={actionPlannedError}
              disableTime={actionPlanned.date !== '' && !isValidPlannedDate(actionPlanned.date)}
              disabled={isConverting}
              onChangeDate={handleActionPlannedDateChange}
              onChangeTime={handleActionPlannedTimeChange}
              onRemove={() => {
                setActionPlanned(EMPTY_PLANNED)
                setActionPlannedUtcFallback(false)
                setActionPlannedPendingInvalid(false)
                setActionPlannedError(null)
              }}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConversionType(null)} disabled={isConverting}>
              Cancelar
            </Button>
            <Button
              onClick={() => handleConfirmConvert('action')}
              disabled={isConverting || !actionTitle.trim()}
            >
              {isConverting ? 'Gravando…' : 'Criar Avanço Pronto'}
            </Button>
          </DialogFooter>

          {/* FATIA 4C2 — editor de Estratégia REUSADO (4B1) sobre este diálogo,
             para o Resultado CONFIRMADO do formulário. Duas decisões separadas:
             Salvar aqui cria SOMENTE o grupo (a conversão é outro clique, pelo
             contrato 84 — não há transação grupo↔Avanço). Cancelar o editor não
             grava grupo nem converte a captura; volta ao mesmo rascunho. Durante
             a conversão, o editor filho fica bloqueado (não abre). */}
          {actionStrategyModalOpen && selectedActionProject && (
            <>
              <p className="sr-only">
                Salvar cria a estratégia neste resultado. Cancelar a conversão depois não apaga a
                estratégia.
              </p>
              <StrategyModal
                open
                strategy={null}
                projectId={selectedActionProject.id}
                projectLabel={`[${selectedActionProject.context}] ${formatEntityTitle('project', selectedActionProject.sequence_number, selectedActionProject.title)}`}
                onOpenChange={(next) => {
                  if (!next) setActionStrategyModalOpen(false)
                }}
                onSaved={handleInlineStrategySaved}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* FATIA M1B1 — Painel do Copiloto (somente leitura, integração desligada) */}
      <CopilotPanel
        capture={copilotCapture}
        open={copilotOpen}
        onUseProposal={useCopilotProposal}
        onOpenChange={(o) => {
          if (!o) ++copilotSession.current
          setCopilotOpen(o)
          if (!o) setCopilotCapture(null)
        }}
      />
    </div>
  )
}
