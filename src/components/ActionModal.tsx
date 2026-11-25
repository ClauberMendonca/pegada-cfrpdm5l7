import { AiSuggest } from '@/components/AiSuggest'
import { fioCurto } from '@/lib/pegada/fioCurto'
import { formatCalendarDay, ownerTimezone, todayInZone } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'
import React, { useState, useEffect, useId } from 'react'
import {
  ActionItem,
  ActionKind,
  ACTION_KIND_LABEL,
  EntityContext,
  ActionStatus,
  Project,
} from '@/types/execution'
import { actionService, CreateActionInput } from '@/services/actionService'
import { projectService } from '@/services/projectService'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { calendarDayOrNull } from '@/lib/datetime'
import { StrategySelect } from '@/components/StrategySelect'
import { StrategyModal } from '@/components/StrategyModal'
import { Strategy } from '@/types/execution'
import { useProjectStrategies } from '@/hooks/use-project-strategies'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import {
  ResponsibilitySelect,
  ResponsibilityOptionsState,
  useResponsibilityOptions,
} from '@/components/ResponsibilitySelect'
import {
  useResponsibilityReference,
  ResponsibilityRefState,
} from '@/hooks/use-responsibility-reference'
import { checkEligibility, isSelectableForFocus } from '@/lib/eligibility'
import { EntityNumberBadge } from '@/components/EntityNumberBadge'
import { formatEntityTitle } from '@/lib/entityNumber'
import { useAuth } from '@/contexts/AuthContext'
import { PlannedExecutionFields } from '@/components/PlannedExecutionFields'
import {
  EMPTY_PLANNED,
  isValidPlannedDate,
  isValidPlannedTime,
  isValidTimezoneLiteral,
  plannedChanged,
  plannedOf,
  plannedTimezoneOrFallback,
  type PlannedExecution,
} from '@/lib/plannedExecution'

interface ActionModalProps {
  isOpen: boolean
  onClose: () => void
  actionToEdit?: ActionItem | null
  defaultContext?: EntityContext
  defaultProjectId?: string
  onSaved?: () => void
  /** 4B2 — FICHA: recarrega os grupos do Resultado após criação inline confirmada. */
  onStrategyCreated?: (saved: Strategy) => void
}

const CHIP = 'h-11 rounded-full px-3.5 text-sm font-medium transition-colors disabled:opacity-70'
const CHIP_ON = 'bg-foreground text-background'
const CHIP_OFF = 'border border-input bg-card text-foreground hover:bg-secondary'

export const ActionModal: React.FC<ActionModalProps> = ({
  isOpen,
  onClose,
  actionToEdit,
  defaultContext = 'trabalho',
  defaultProjectId,
  onSaved,
  onStrategyCreated,
}) => {
  const { toast } = useToast()
  // FATIA 5B1 — fonte ÚNICA do fuso de um plano NOVO: user.timezone do useAuth
  // atual (sem consulta/provedor novos e sem seletor/enumerador de fuso).
  const { user } = useAuth()
  // BLOCO 4B — IDs estáveis e únicos por instância (useId no topo, antes de
  // qualquer retorno condicional): rótulos apontam para o controle efetivo
  // mesmo com dois modais de ação montados ao mesmo tempo.
  const uid = useId()
  const ids = React.useMemo(
    () => ({
      title: `${uid}-action-title`,
      description: `${uid}-action-description`,
      descriptionHelp: `${uid}-action-description-help`,
      context: `${uid}-action-context`,
      status: `${uid}-action-status`,
      waitingFor: `${uid}-action-waiting-for`,
      project: `${uid}-action-project`,
      deadline: `${uid}-action-deadline`,
      todaySelected: `${uid}-action-today-selected`,
      todayHelp: `${uid}-action-today-help`,
      nextStep: `${uid}-action-next-step`,
      nextHelp: `${uid}-action-next-help`,
      responsibility: `${uid}-action-responsibility`,
      inheritedResponsibility: `${uid}-action-inherited-responsibility`,
      strategy: `${uid}-action-strategy`,
    }),
    [uid],
  )
  const [title, setTitle] = useState('')
  const [context, setContext] = useState<EntityContext>(defaultContext)
  const [projectId, setProjectId] = useState<string>(defaultProjectId || '')
  const [status, setStatus] = useState<ActionStatus>('pronta')
  const [deadline, setDeadline] = useState('')
  const [isNextStep, setIsNextStep] = useState(false)
  const [isTodaySelected, setIsTodaySelected] = useState(false)
  const [waitingFor, setWaitingFor] = useState('')
  // PEGADA — tipo do avanço (os seis tipos do método).
  const [kind, setKind] = useState<ActionKind>('acao')
  // DESCRIÇÃO OPCIONAL: texto livre de notas/orientações. Carrega no editar,
  // inicia vazio na criação, aceita multilinha/colagem e envia string vazia
  // explícita ao limpar — nunca herda o valor anterior.
  const [description, setDescription] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [isSaving, setIsSaving] = useState(false)
  // B1 — aviso inline quando a nova seleção de foco é inelegível (não grava flags novas).
  const [focusNotice, setFocusNotice] = useState<string | null>(null)
  // FATIA 3C1 — vínculo DIRETO do avanço SOLTO: ID nativo; '' = Nenhuma/remoção.
  // Um único estado em memória: na edição, a escolha anterior do usuário não é
  // reaproveitada entre aberturas; o valor inicial do modo é fixado no efeito
  // de abertura abaixo. Na criação inicia '' (Nenhuma).
  const [directResponsibilityId, setDirectResponsibilityId] = useState('')
  // FATIA 3C1 — modo PERSISTIDO da abertura ('none' = originalmente subordinado,
  // sem memória própria de vínculo direto). Aviso/comparação nunca usam escolha
  // provisória: só pai e vínculo gravados quando o modal abriu.
  const [persistedProjectId, setPersistedProjectId] = useState('')
  const [persistedResponsibilityId, setPersistedResponsibilityId] = useState('')
  const responsibilityOptions: ResponsibilityOptionsState = useResponsibilityOptions(isOpen)
  // FATIA 4B2 — Estratégia: escolha em memória; modo PERSISTIDO da abertura
  // (comparação/avisos nunca usam escolha provisória). '' = Nenhuma.
  const [strategyId, setStrategyId] = useState('')
  const [persistedStrategyId, setPersistedStrategyId] = useState('')
  // Criação inline: reusa o StrategyModal REAL 4B1 (Dialog padrão) sobre este
  // modal, SEM outro editor; abrir/fechar não altera o rascunho do Avanço.
  const [strategyModalOpen, setStrategyModalOpen] = useState(false)
  // Aviso da ESTRATÉGIA por transição de pai (distinto do foco/3C1).
  const [strategyNotice, setStrategyNotice] = useState<string | null>(null)
  // FATIA 5B1 — planejamento (intenção LOCAL: dia/hora literais + fuso salvo,
  // nunca instante). Tupla válida separada de entrada pendente/inválida; erro
  // ligado ao campo. Recolher/trocar pai/Estratégia não mexe aqui.
  const [planned, setPlanned] = useState<PlannedExecution>(EMPTY_PLANNED)
  const [plannedOriginal, setPlannedOriginal] = useState<PlannedExecution>(EMPTY_PLANNED)
  const [plannedUtcFallback, setPlannedUtcFallback] = useState(false)
  const [plannedPendingInvalid, setPlannedPendingInvalid] = useState(false)
  const [plannedError, setPlannedError] = useState<string | null>(null)
  const projectStrategies = useProjectStrategies(isOpen ? projectId : '')

  useEffect(() => {
    if (isOpen) {
      setFocusNotice(null)
      setStrategyNotice(null)
      setStrategyModalOpen(false)
      projectService
        .list()
        .then((list) => {
          // B5 — lista completa: o vínculo atual permanece legível mesmo em
          // projeto pausado/concluído/arquivado. Novos vínculos continuam
          // restritos aos projetos permitidos (recorte feito no render).
          setProjects(list)
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Falha ao carregar resultados.'
          toast({ variant: 'destructive', title: 'Erro', description: msg })
        })

      if (actionToEdit) {
        setTitle(actionToEdit.title)
        setContext(actionToEdit.context)
        setProjectId(actionToEdit.project_id || '')
        setStatus(actionToEdit.status)
        setDeadline(actionToEdit.deadline || '')
        setIsNextStep(Boolean(actionToEdit.is_next_step))
        setIsTodaySelected(Boolean(actionToEdit.is_today_selected))
        setWaitingFor(actionToEdit.waiting_for || '')
        setKind((actionToEdit.kind || 'acao') as ActionKind)
        setDescription(typeof actionToEdit.description === 'string' ? actionToEdit.description : '')
        // FATIA 3C1 — modo PERSISTIDO na abertura: vínculo DIRETO persistido
        // (avanço solto) inicializa a escolha; subordinado NÃO copia herança
        // (escolha direta começa Nenhuma). Subordinado: modo herdado em leitura.
        setPersistedProjectId(actionToEdit.project_id || '')
        setPersistedResponsibilityId(actionToEdit.responsibility_id || '')
        setDirectResponsibilityId(actionToEdit.responsibility_id || '')
        // FATIA 4B2 — edição começa no vínculo PERSISTIDO (nunca inferido).
        setStrategyId(actionToEdit.strategy_id || '')
        setPersistedStrategyId(actionToEdit.strategy_id || '')
        // FATIA 5B1 — carrega o planejamento PERSISTIDO (ausentes → ''), sem
        // canonicalizar/recalcular fuso; o original da abertura decide a
        // comparação (retorno tardio de consulta não reinicializa a edição).
        const loadedPlanned = plannedOf(actionToEdit)
        setPlanned(loadedPlanned)
        setPlannedOriginal(loadedPlanned)
        setPlannedUtcFallback(false)
        setPlannedPendingInvalid(false)
        setPlannedError(null)
      } else {
        // FATIA 3C1/4B2 — criação: solto, escolha direta e Estratégia em Nenhuma.
        setStrategyId('')
        setPersistedStrategyId('')
        setPersistedProjectId('')
        setPersistedResponsibilityId('')
        setDirectResponsibilityId('')
        setTitle('')
        setContext(defaultContext)
        setProjectId(defaultProjectId || '')
        setStatus('pronta')
        setDeadline('')
        setIsNextStep(false)
        setIsTodaySelected(true)
        setWaitingFor('')
        setKind('acao')
        setDescription('')
        // FATIA 5B1 — Novo SEM plano: data/hora/fuso vazios (nunca Hoje/prazo/
        // 00:00/hora atual/data inferida); fuso é capturado só na 1ª escolha.
        setPlanned(EMPTY_PLANNED)
        setPlannedOriginal(EMPTY_PLANNED)
        setPlannedUtcFallback(false)
        setPlannedPendingInvalid(false)
        setPlannedError(null)
      }
    }
  }, [isOpen, actionToEdit, defaultContext, defaultProjectId])

  // BLOCO 5 — criação (vs edição): edições de ações existentes NÃO são
  // bloqueadas por projeto encerrado (vínculo antigo permanece preservado).
  const isCreate = !actionToEdit

  // B1 — valida a escolha de foco com o estado ATUAL do formulário (status e
  // vínculo), pela MESMA regra compartilhada de Hoje/Ações. Retorna false (com
  // aviso legível) quando a ação, como está no formulário, é inelegível.
  const validateFocusChoice = (): boolean => {
    const draftProject: Project | null | undefined = projectId
      ? (projects.find((p) => p.id === projectId) ?? undefined)
      : null
    const eligibility = checkEligibility({ status } as unknown as ActionItem, draftProject)
    if (eligibility.ok && isSelectableForFocus({ status } as unknown as ActionItem, draftProject)) {
      return true
    }
    setFocusNotice(
      `Seleção não permitida: ${
        eligibility.label ?? 'somente avanços "prontos" recebem nova seleção de foco'
      }. Ajuste o status ou o vínculo antes de selecionar.`,
    )
    return false
  }

  // FATIA 5B1 — validação do planejamento ANTES de persistência/qualquer fluxo
  // de foco: dia real AAAA-MM-DD (bissexto/mês curto), hora real HH:mm se
  // houver, fuso explícito com dia. Vazio é válido; parcial/inválido bloqueia
  // Salvar e conserva TODOS os campos (sem normalização silenciosa). Fuso
  // salvo NÃO é reinterpretado localmente numa edição intocada — o backend 5A
  // é a autoridade final.
  const validatePlannedDraft = (): boolean => {
    if (plannedPendingInvalid) {
      setPlannedError(
        'Há data ou hora incompleta no planejamento. Conclua o valor ou limpe o campo antes de salvar.',
      )
      return false
    }
    if (planned.date === '') {
      if (planned.time !== '' || planned.timezone !== '') {
        setPlannedError('Planejamento incompleto: informe a data ou remova o planejamento.')
        return false
      }
      setPlannedError(null)
      return true
    }
    if (!isValidPlannedDate(planned.date)) {
      setPlannedError('Informe uma data planejada real (AAAA-MM-DD, incluindo anos bissextos).')
      return false
    }
    if (planned.timezone === '') {
      setPlannedError('O planejamento precisa do fuso. Remova o planejamento para salvar sem ele.')
      return false
    }
    if (!isValidPlannedTime(planned.time)) {
      setPlannedError('Informe uma hora planejada real (HH:mm) ou limpe o campo.')
      return false
    }
    setPlannedError(null)
    return true
  }

  // FATIA 5B1 — data planejada: '' vindo do controle pode ser limpeza válida
  // por escolha explícita OU entrada parcial/inválida (validity/badInput
  // nativo). Parcial mantém a tupla e bloqueia Salvar; limpeza remove o GRUPO
  // inteiro em memória (dia/hora/fuso) — só Salvar grava.
  const handlePlannedDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget
    const raw = el.value
    if (raw === '' && el.validity.badInput) {
      setPlannedPendingInvalid(true)
      return
    }
    setPlannedPendingInvalid(false)
    setPlannedError(null)
    if (raw === '') {
      setPlanned(EMPTY_PLANNED)
      setPlannedUtcFallback(false)
      return
    }
    if (planned.timezone === '') {
      // Primeiro dia de um plano novo: captura o fuso do perfil (ou UTC
      // explícito com aviso mantido em memória), sem substituir alias/literal
      // por resolvedOptions nem usar Local/offset do dispositivo.
      const tz = plannedTimezoneOrFallback(user?.timezone ?? '')
      setPlanned({ date: raw, time: '', timezone: tz.timezone })
      setPlannedUtcFallback(tz.usedFallback)
      return
    }
    // Plano existente: mantém EXATAMENTE o fuso salvo (mesmo alterando dia).
    setPlanned({ ...planned, date: raw })
  }

  // FATIA 5B1 — hora planejada: limpar só a hora conserva dia/fuso; entrada
  // parcial mantém a tupla e bloqueia Salvar (nunca converte inválido em '').
  const handlePlannedTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget
    const raw = el.value
    if (raw === '' && el.validity.badInput) {
      setPlannedPendingInvalid(true)
      return
    }
    setPlannedPendingInvalid(false)
    setPlannedError(null)
    setPlanned((prev) => ({ ...prev, time: raw }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    // FATIA 5B1 — planejamento inválido/parcial bloqueia o envio ANTES de
    // persistência e de qualquer fluxo de foco; todos os campos conservados.
    if (!validatePlannedDraft()) return

    setIsSaving(true)
    try {
      // BLOCO 5.1 — guarda na CRIAÇÃO com vínculo encerrado: revalida o projeto
      // selecionado pela leitura autenticada existente (projectService.getById)
      // — o formulário pode ter ficado aberto enquanto o estado mudou. Falha de
      // leitura mantém o formulário/texto e NÃO grava. Guarda de interface;
      // sem garantia transacional de concorrência.
      if (isCreate && projectId) {
        // FATIA 3C1 — guarda de status na criação (encerrado/pausado) já cobre
        // o mesmo caminho da revalidação de contexto abaixo.
        try {
          const freshProject = await projectService.getById(projectId)
          setProjects((prev) =>
            prev.some((p) => p.id === freshProject.id)
              ? prev.map((p) => (p.id === freshProject.id ? freshProject : p))
              : [...prev, freshProject],
          )
          if (freshProject.status === 'concluido' || freshProject.status === 'arquivado') {
            toast({
              variant: 'destructive',
              title: 'Avanço não criado',
              description: `O resultado “${freshProject.title}” está ${freshProject.status === 'concluido' ? 'concluído' : 'arquivado'}. Reabra o resultado pelo comando existente antes de planejar novos avanços vinculados.`,
            })
            return
          }
          // FATIA 3C1 — coerência de CONTEXTO entre pai e filho na CRIAÇÃO.
          if (freshProject.context !== context) {
            toast({
              variant: 'destructive',
              title: 'Avanço não criado',
              description: `O resultado escolhido é de contexto ${
                freshProject.context === 'trabalho' ? 'Trabalho' : 'Vida'
              }, mas o avanço é de ${context === 'trabalho' ? 'Trabalho' : 'Vida'}. Ajuste antes de salvar.`,
            })
            return
          }
        } catch (readErr: unknown) {
          const readMsg =
            readErr instanceof Error ? readErr.message : 'Falha ao revalidar o resultado vinculado.'
          toast({
            variant: 'destructive',
            title: 'Avanço não criado',
            description: readMsg,
          })
          return
        }
      }

      // B1 — escolha inelegível NÃO grava flags novas e NÃO desmarca flags
      // anteriores: edições de registros antigos seguem permitidas.
      const draftProject: Project | null | undefined = projectId
        ? (projects.find((p) => p.id === projectId) ?? undefined)
        : null
      const eligibility = checkEligibility({ status } as unknown as ActionItem, draftProject)
      const selectable =
        eligibility.ok && isSelectableForFocus({ status } as unknown as ActionItem, draftProject)
      const prevToday = Boolean(actionToEdit?.is_today_selected)
      const prevNext = Boolean(actionToEdit?.is_next_step)
      let effToday = isTodaySelected || isNextStep
      let effNext = isNextStep
      // B1 — inelegibilidade bloqueia apenas ADIÇÃO de seleção nova. Retirada
      // explícita (desmarcar) é permitida mesmo quando a ação ficou inelegível:
      // não impedimos a edição de registros antigos por flags antigas.
      if (!selectable) {
        if (effNext && !prevNext) {
          effNext = false
          setFocusNotice(
            `Próximo avanço não gravado: ${
              eligibility.label ?? 'somente avanços "prontos" recebem nova seleção'
            }. As demais alterações serão salvas.`,
          )
        } else if (effToday && !prevToday && !prevNext) {
          effToday = false
          setFocusNotice(
            `Seleção para Hoje não gravada: ${
              eligibility.label ?? 'somente avanços "prontos" recebem nova seleção'
            }. As demais alterações serão salvas.`,
          )
        } else {
          setFocusNotice(null)
        }
      } else {
        setFocusNotice(null)
      }

      // FATIA 3C1 — EDITAR: não reenviar flags de Hoje/avanço único INALTERADOS
      // só por mudar grupo/pai (omitir em vez de enviar false — enviar false
      // dispararia clearAllNextSteps no serviço). Escolhas explícitas seguem
      // pelo fluxo/eligibilidade existentes, intocados neste bloco.
      const omitUnchangedFocusFlags = Boolean(actionToEdit)

      // FATIA 3C1 — transição na EDIÇÃO (novo pai diferente do persistido):
      // revalidar o pai pela leitura getById existente antes de gravar. Falha
      // de leitura ou pai/contexto incoerente mantém rascunho e NÃO grava.
      if (actionToEdit && projectId && projectId !== persistedProjectId) {
        try {
          const freshProject = await projectService.getById(projectId)
          setProjects((prev) =>
            prev.some((p) => p.id === freshProject.id)
              ? prev.map((p) => (p.id === freshProject.id ? freshProject : p))
              : [...prev, freshProject],
          )
          if (freshProject.context !== context) {
            toast({
              variant: 'destructive',
              title: 'Avanço não salvo',
              description: `O resultado escolhido é de contexto ${
                freshProject.context === 'trabalho' ? 'Trabalho' : 'Vida'
              }, mas o avanço é de ${context === 'trabalho' ? 'Trabalho' : 'Vida'}. Ajuste antes de salvar.`,
            })
            return
          }
          if (freshProject.status === 'concluido' || freshProject.status === 'arquivado') {
            toast({
              variant: 'destructive',
              title: 'Avanço não salvo',
              description: `O resultado “${freshProject.title}” está ${
                freshProject.status === 'concluido' ? 'concluído' : 'arquivado'
              } e não recebe novo vínculo. Escolha outro resultado ou cancele.`,
            })
            return
          }
        } catch (readErr: unknown) {
          const readMsg =
            readErr instanceof Error ? readErr.message : 'Falha ao revalidar o resultado vinculado.'
          toast({ variant: 'destructive', title: 'Avanço não salvo', description: readMsg })
          return
        }
      }

      // FATIA 3C1 — checagem de coerência do vínculo DIRETO NOVO antes de
      // persistir (contexto incompatível ou opção não ativa bloqueiam o envio;
      // falha não apaga escolhas). Vínculo ORIGINAL mantido como está (mesmo ID
      // persistido, inclusive arquivado) NÃO é rechecado — editar outros campos
      // permanece possível; remoção explícita segue possível. Vínculo escolhido
      // que não está na lista (lista em erro) não é revalidado no cliente —
      // backend 3A é autoridade final. Sem compensação automática.
      if (directResponsibilityId && knownDirect) {
        if (knownDirect.context !== context) {
          toast({
            variant: 'destructive',
            title: 'Avanço não salvo',
            description: `A responsabilidade escolhida é de contexto ${
              knownDirect.context === 'trabalho' ? 'Trabalho' : 'Vida'
            }, mas o avanço é de ${context === 'trabalho' ? 'Trabalho' : 'Vida'}. Ajuste o contexto ou escolha “Nenhuma” antes de salvar.`,
          })
          return
        }
        if (
          knownDirect.status !== 'ativa' &&
          directResponsibilityId !== persistedResponsibilityId
        ) {
          toast({
            variant: 'destructive',
            title: 'Avanço não salvo',
            description:
              'A responsabilidade escolhida não está ativa. Escolha “Nenhuma” ou outra ativa antes de salvar um vínculo novo.',
          })
          return
        }
      }

      // FATIA 4B2 — ESTRATÉGIA antes de persistir: escolha incompatível com o
      // pai (grupo de outro Resultado ou vínculo pendente de decisão ao sair
      // do pai) NÃO envia — exige Nenhuma ou ativa do Resultado do formulário
      // (ou confirmação de remoção ao ficar solto). Falha mantém o rascunho.
      if (strategyIncompatibleWithDraft) {
        toast({
          variant: 'destructive',
          title: 'Avanço não salvo',
          description:
            strategyNotice ??
            'A estratégia selecionada pertence a outro resultado. Escolha “Nenhuma” ou uma estratégia ativa do resultado atual antes de salvar.',
        })
        return
      }

      const payload: CreateActionInput = {
        title: title.trim(),
        kind,
        context,
        // FATIA 3C1 — UM PATCH: project_id e responsibility_id juntos.
        // - Solto: project_id=undefined e vínculo direto escolhido (ID ou '' de
        //   remoção). '' explícito remove; nunca sentinel 'none'.
        // - Com Resultado: herança é sempre do pai e JAMAIS copiada — envia ''
        //   explícito; project_id='' explícito RETIRA o pai na edição (nunca
        //   undefined, que omitiria a relação).
        project_id: projectId ? projectId : actionToEdit && persistedProjectId ? '' : undefined,
        responsibility_id: projectId
          ? '' // subordinado: herança em leitura, vínculo direto vazio
          : actionToEdit && directResponsibilityId === persistedResponsibilityId
            ? undefined // edição solto sem mudança de vínculo: OMITIR (mantém)
            : directResponsibilityId, // ID novo ou '' explícito de remoção
        status,
        // FATIA P1C — dia-calendário puro: aceita só 'YYYY-MM-DD'; vazio/parcial
        // NÃO cria prazo (sem parse de fuso que desloque o dia).
        deadline: calendarDayOrNull(deadline),
        // FATIA 3C1 — omitir flags INALTERADOS na edição (não reenviar false que
        // dispararia clearAllNextSteps); na criação mantém defaults existentes.
        ...(omitUnchangedFocusFlags
          ? {
              ...(effNext !== prevNext ? { is_next_step: effNext } : {}),
              ...(effToday !== prevToday ? { is_today_selected: effToday } : {}),
            }
          : { is_next_step: effNext, is_today_selected: effToday }),
        // FATIA 4B2 — strategy_id: ID nativo, ou '' explícito de Nenhuma/remoção;
        // sem pai, sempre '' (nunca leva vínculo ao sair do Resultado).
        strategy_id: projectId ? strategyId : '',
        // FATIA 5B1 — planejamento no MESMO patch de Salvar (um envio normal):
        // - Novo sem plano: OMITIR os 3 campos (vazio nativo 5A);
        // - Novo com plano / edição ALTERADA: os 3 valores finais coerentes
        //   (retirar hora envia '' conservando dia/fuso; remover envia '' x3);
        // - Edição INALTERADA: OMITIR os 3 — o original da abertura decide a
        //   comparação, não retorno tardio de consulta.
        // Nunca null/sentinel, segundo update ou default de Hoje/UTC/fuso.
        ...(actionToEdit
          ? plannedChanged(planned, plannedOriginal)
            ? {
                planned_date: planned.date,
                planned_time: planned.time,
                planned_timezone: planned.timezone,
              }
            : {}
          : planned.date !== ''
            ? {
                planned_date: planned.date,
                planned_time: planned.time,
                planned_timezone: planned.timezone,
              }
            : {}),
        waiting_for: waitingFor.trim() || undefined,
        // DESCRIÇÃO OPCIONAL: preserva quebras de linha e acentos; vazio segue
        // explícito (string ''), nunca undefined — limpar o campo apaga no banco.
        // Sem truncamento silencioso; PocketBase rejeita acima de 20000 e o
        // erro aparece visível com o texto preservado no formulário.
        description: description,
      }

      if (actionToEdit) {
        await actionService.update(actionToEdit.id, payload)
        toast({ title: 'Avanço atualizado' })
      } else {
        await actionService.create(payload)
        toast({ title: 'Avanço criado com sucesso' })
      }

      onSaved?.()
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar avanço'
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: msg,
      })
    } finally {
      setIsSaving(false)
    }
  }

  // FATIA 4B2 — criação INLINE de Estratégia: o StrategyModal REAL 4B1 é
  // renderizado sobre este modal com o Resultado confirmado. Salvar chama
  // strategyService.create UMA vez (dentro do StrategyModal); incluir o grupo
  // confirmado nas opções é local ao hook82 (upsert); callback da FICHA
  // recarrega os grupos do Resultado mesmo se o Avanço for cancelado depois.
  // Cancelar/Escape do editor não gravam nada e voltam ao rascunho atual.
  const handleInlineStrategySaved = (saved: Strategy, created: boolean) => {
    if (!created) return
    // Dono/Resultado/sessão/abertura do Avanço devem corresponder ao snapshot
    // que iniciou a criação — retorno tardio não seleciona nem feedback alheio.
    if (!isOpen || !projectId || saved.project_id !== projectId) return
    projectStrategies.upsert(saved)
    setStrategyId(saved.id)
    setStrategyNotice(null)
    onStrategyCreated?.(saved)
  }

  // B5 — projetos permitidos para novos vínculos; vínculo atual sempre legível.
  const selectableProjects = projects.filter((p) => p.status === 'ativo' || p.status === 'rascunho')
  const linkedOutsideSelectable =
    Boolean(projectId) && !selectableProjects.some((p) => p.id === projectId)

  // BLOCO 5 — estado REAL do projeto selecionado (enum existente, sem inventar).
  const selectedProject = projectId ? (projects.find((p) => p.id === projectId) ?? null) : null
  const selectedClosed =
    Boolean(selectedProject) &&
    (selectedProject!.status === 'concluido' || selectedProject!.status === 'arquivado')
  const selectedPaused = selectedProject?.status === 'pausado'
  const blockedByClosedProject = isCreate && selectedClosed
  // BLOCO 5.2 — vínculo contextual em projeto pausado fica identificado como
  // planejamento condicionado (nunca exibido como projeto ativo).
  const contextualPausedNotice =
    isCreate && selectedPaused && Boolean(defaultProjectId) && projectId === defaultProjectId

  // FATIA 3C1 — referência do vínculo DIRETO escolhido (rascunho em memória).
  const knownDirect = directResponsibilityId
    ? (responsibilityOptions.list.find((r) => r.id === directResponsibilityId) ?? null)
    : null

  // FATIA 3C1 — transição solto -> Resultado: aviso só quando o avanço era
  // ORIGINALMENTE solto com vínculo direto PERSISTIDO na abertura (não escolha
  // provisória em memória — experimentar pai e voltar não dispara aviso).
  // Nunca fabrica "Nenhuma": sem nome disponível, aviso é genérico honesto.
  const losingDirectLink = Boolean(projectId) && Boolean(persistedResponsibilityId)

  // FATIA 3C1 — nome/referência original persistido se disponível (novo uso de
  // dados JÁ lidos — sem nova leitura e sem nova fonte).
  const persistedDirectName = persistedResponsibilityId
    ? (responsibilityOptions.list.find((r) => r.id === persistedResponsibilityId)?.title ?? null)
    : null

  // FATIA 4B2 — ESTRATÉGIA por transição de pai (experimentar pai não persiste):
  // - solto -> Resultado: Nenhuma (nunca herda);
  // - Resultado A -> B com Estratégia de A: mantém o ID em memória IDENTIFICADO
  //   como incompatível (aviso antes de Salvar exige Nenhuma ou ativa de B);
  // - Resultado -> solto: mantém o ID em memória com aviso "Remover vínculo";
  //   enquanto incompatível, NÃO envia;
  // - mesmo Resultado: mantém a escolha atual.
  // Cancelar/fechar/remoção explicitamente escolhida não é desfeita por
  // retorno tardio de consulta; o original da abertura segue intocado aqui.
  const handleProjectChange = (nextProjectId: string) => {
    setProjectId(nextProjectId)
    if (!nextProjectId) {
      if (strategyId) {
        setStrategyNotice(
          'Remover vínculo de Estratégia: ao salvar, o vínculo com a estratégia será removido. Escolha “Nenhuma” para confirmar a remoção, ou volte ao Resultado para mantê-la.',
        )
      }
      return
    }
    if (!strategyId) return
    const chosen = projectStrategies.items.find((s) => s.id === strategyId)
    if (chosen && chosen.project_id === nextProjectId) {
      setStrategyNotice(null)
      return
    }
    setStrategyNotice(
      'A estratégia selecionada pertence a outro resultado. Escolha “Nenhuma” ou uma estratégia ativa do novo resultado antes de salvar.',
    )
  }

  // FATIA 4B2 — coerência da ESTRATÉGIA com o pai do formulário (rascunho):
  // escolha incompatível em memória é identificada, nunca tratada como opção
  // válida nem persistida. Comparação usa o modo PERSISTIDO da abertura.
  const selectedStrategy = strategyId
    ? (projectStrategies.items.find((s) => s.id === strategyId) ?? null)
    : null
  const strategyIncompatibleWithDraft =
    Boolean(strategyId) &&
    Boolean(projectId) &&
    selectedStrategy !== null &&
    selectedStrategy.project_id !== projectId
  // FATIA 4B2 — vínculo ORIGINAL (persistido na abertura) ARQUIVADO: legível,
  // mantível/removível, sem bloquear outras edições e sem virar opção nova.
  const originalStrategyArchived = (() => {
    if (!persistedStrategyId) return false
    const original = projectStrategies.items.find((s) => s.id === persistedStrategyId)
    return original?.status === 'arquivada'
  })()

  // FATIA 5B1 — derivados do planejamento (rascunho vs original da abertura).
  const hasPlannedDraft = planned.date !== ''
  const plannedPristine = !plannedChanged(planned, plannedOriginal)
  const profileTz = plannedTimezoneOrFallback(user?.timezone ?? '')
  const keepsSavedTimezone =
    hasPlannedDraft && planned.timezone !== '' && planned.timezone !== profileTz.timezone
  // Fuso antigo que este navegador não reconhece: preservar o literal e avisar
  // (nunca inventar UTC); backend 5A continua a autoridade final.
  const savedTimezoneUnrecognized =
    hasPlannedDraft && planned.timezone !== '' && !isValidTimezoneLiteral(planned.timezone)
  // Hora só fica habilitada com data válida presente (nunca hora isolada).
  const plannedTimeDisabled = hasPlannedDraft && !isValidPlannedDate(planned.date)

  // FATIA 3C1 — HERANÇA EM LEITURA: hook no topo, incondicional (antes de
  // qualquer retorno condicional), ÚNICO no modal — sem duplicar consulta/
  // cache/provider. Usa o Resultado realmente selecionado (lista/getById
  // existentes) e o responsibility_id dele. Pai ainda não carregado (null) =
  // 'unknown' — NUNCA 'Nenhuma'; '' confirma ausência ('none'); erro
  // preserva o estado 'error' (não vira Nenhuma). A herança JAMAIS é copiada
  // para actions.responsibility_id (segue '' no envio do modo subordinado).
  const currentParent = projectId ? (projects.find((p) => p.id === projectId) ?? null) : null
  const inheritedRef: ResponsibilityRefState = useResponsibilityReference(
    currentParent ? (currentParent.responsibility_id ?? null) : null,
  )

  // BLOCO 5.2 — no vínculo contextual pelo próprio detalhe pausado, o planejamento
  // continua disponível com aviso identificado (não disfarça o projeto de ativo).
  useEffect(() => {
    if (
      isOpen &&
      !actionToEdit &&
      selectedPaused &&
      defaultProjectId &&
      projectId === defaultProjectId
    ) {
      setFocusNotice(
        'Resultado pausado — você pode planejar avanços; execução e seleção de foco continuam sujeitas às regras existentes.',
      )
    }
  }, [isOpen, actionToEdit, selectedPaused, defaultProjectId, projectId])

  // Desenho do Novo avanço: quatro decisões à vista e o resto em "Mais detalhes".
  const [maisDetalhes, setMaisDetalhes] = useState(false)
  useEffect(() => {
    if (isOpen) setMaisDetalhes(Boolean(actionToEdit))
  }, [isOpen, actionToEdit])
  // Espera pede "de quem ou do quê": esse campo mora nos detalhes, então eles abrem.
  useEffect(() => {
    if (kind === 'espera') setMaisDetalhes(true)
  }, [kind])
  const hojeLocal = todayInZone(ownerTimezone(user?.timezone))
  const somaDias = (dia: string, n: number) => {
    const d = new Date(`${dia}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }
  const diaAmanha = somaDias(hojeLocal, 1)
  // Domingo desta semana; se hoje já é sábado ou domingo, o da semana seguinte.
  const diaDaSemana = new Date(`${hojeLocal}T12:00:00Z`).getUTCDay()
  const fimDaSemana = somaDias(hojeLocal, diaDaSemana === 0 ? 7 : diaDaSemana === 6 ? 8 : 7 - diaDaSemana)
  const planejarPara = (dia: string) => {
    setPlannedPendingInvalid(false)
    setPlannedError(null)
    if (!dia) {
      setPlanned(EMPTY_PLANNED)
      setPlannedUtcFallback(false)
      return
    }
    if (planned.timezone === '') {
      const tz = plannedTimezoneOrFallback(user?.timezone ?? '')
      setPlanned({ date: dia, time: '', timezone: tz.timezone })
      setPlannedUtcFallback(tz.usedFallback)
    } else {
      setPlanned({ ...planned, date: dia })
    }
  }
  const fioAoVivo = fioCurto(
    selectedProject ? { resultado: { titulo: selectedProject.title } } : null,
    user?.life_purpose,
  )

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(680px,calc(100vw-16px))] rounded-[20px] bg-card text-foreground">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground">
            {actionToEdit ? 'Editar avanço' : 'Novo avanço'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {actionToEdit
              ? 'Ajuste os dados deste avanço. As alterações são gravadas somente ao confirmar.'
              : 'Preencha os dados do avanço. Ele é gravado somente ao confirmar.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor={ids.title} className="text-sm font-medium text-foreground">
              O que você vai fazer?
            </Label>
            <Input
              id={ids.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Ligar para fornecedor X e alinhar especificação"
              className="border-input bg-card text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-ring sm:text-sm"
              required
            />
            {!actionToEdit && (
              <AiSuggest
                tipo="avanco"
                texto={title}
                descrever={(s) =>
                  `${s.tipo in ACTION_KIND_LABEL ? ACTION_KIND_LABEL[s.tipo as ActionKind] : 'Avanço'}: ${s.titulo}`
                }
                onUsar={(s) => {
                  if (s.titulo) setTitle(s.titulo)
                  if (s.tipo in ACTION_KIND_LABEL && s.tipo !== 'espera') setKind(s.tipo as ActionKind)
                }}
              />
            )}
            {/* NUMERAÇÃO PERMANENTE — número da ação FORA do input: selo de
               leitura na edição; na criação, nota discreta (nunca P-0/A-0 ou
               número previsto). O título digitado continua puro. */}
            {actionToEdit ? (
              <span className="flex items-center gap-1.5">
                <EntityNumberBadge
                  kind="action"
                  n={actionToEdit.sequence_number}
                  entityId={actionToEdit.id}
                />
                <span className="text-sm text-foreground">{actionToEdit.title}</span>
              </span>
            ) : null}
          </div>


          <div className="space-y-1.5">
            <Label htmlFor={ids.project} className="text-sm font-medium text-foreground">
              Para alcançar o quê?
            </Label>
            {/* FATIA 4B2 — transições de pai + ESTRATÉGIA (nunca persiste provisório) */}
            <Select
              value={projectId}
              onValueChange={(v) => handleProjectChange(v === 'none' ? '' : v)}
            >
              <SelectTrigger
                id={ids.project}
                className="truncate border-input bg-card text-base text-foreground sm:text-sm"
              >
                <SelectValue placeholder="Avanço solto (sem resultado)" />
              </SelectTrigger>
              <SelectContent className="max-h-56 border-border bg-popover text-popover-foreground">
                <SelectItem value="none">Avanço solto (sem resultado)</SelectItem>
                {/* Novos vínculos: apenas projetos permitidos pela regra atual.
                   NUMERAÇÃO PERMANENTE: P-N real vem do sequence_number do
                   banco; o value segue sendo o ID do projeto. */}
                {selectableProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    [{p.context}] {formatEntityTitle('project', p.sequence_number, p.title)}
                  </SelectItem>
                ))}
                {/* B5 — vínculo atual fora da lista continua legível, com status. */}
                {linkedOutsideSelectable && (
                  <SelectItem value={projectId} disabled>
                    {(() => {
                      const linked = projects.find((p) => p.id === projectId)
                      return linked
                        ? `[${linked.context}] ${formatEntityTitle('project', linked.sequence_number, linked.title)} (${linked.status})`
                        : 'Resultado vinculado (indisponível)'
                    })()}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* A frase do fio, ao vivo: o porquê deste avanço enquanto se escolhe. */}
          <p
            className="rounded-2xl px-3.5 py-3 text-sm leading-snug"
            style={{ background: 'var(--pegada-ink)', color: 'var(--pegada-on-ink-muted)' }}
            data-fio
          >
            {fioAoVivo ? (
              <>
                Faço isto <span style={{ color: 'var(--pegada-on-ink)' }}>{fioAoVivo}</span>
              </>
            ) : (
              'Avanço livre: ainda sem porquê. Escolha um resultado para dar um fio a ele.'
            )}
          </p>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Quando?</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Quando">
              <button
                type="button"
                aria-pressed={isTodaySelected || isNextStep}
                disabled={isNextStep}
                onClick={() => {
                  const marcar = !isTodaySelected
                  if (marcar && !validateFocusChoice()) return
                  setFocusNotice(null)
                  setIsTodaySelected(marcar)
                }}
                className={cn(CHIP, isTodaySelected || isNextStep ? CHIP_ON : CHIP_OFF)}
              >
                Hoje
              </button>
              {(
                [
                  ['Amanhã', diaAmanha],
                  ['Esta semana', fimDaSemana],
                ] as const
              ).map(([nome, dia]) => (
                <button
                  key={nome}
                  type="button"
                  aria-pressed={planned.date === dia}
                  onClick={() => planejarPara(planned.date === dia ? '' : dia)}
                  className={cn(CHIP, planned.date === dia ? CHIP_ON : CHIP_OFF)}
                >
                  {nome}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={Boolean(planned.date) && planned.date !== diaAmanha && planned.date !== fimDaSemana}
                onClick={() => setMaisDetalhes(true)}
                className={cn(
                  CHIP,
                  planned.date && planned.date !== diaAmanha && planned.date !== fimDaSemana
                    ? CHIP_ON
                    : CHIP_OFF,
                )}
              >
                {planned.date && planned.date !== diaAmanha && planned.date !== fimDaSemana
                  ? formatCalendarDay(planned.date)
                  : 'Data'}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Que tipo de avanço é?</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de avanço">
              {(Object.keys(ACTION_KIND_LABEL) as ActionKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(CHIP, kind === k ? CHIP_ON : CHIP_OFF)}
                >
                  {ACTION_KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {
                {
                  acao: 'Algo a fazer. Conclui quando foi feito.',
                  compromisso: 'Tem data, hora ou outra pessoa. Conclui quando aconteceu.',
                  estudo: 'Aprender ou analisar. Conclui com a conclusão anotada.',
                  reflexao: 'Uma pergunta ou decisão. Conclui com a decisão registrada.',
                  ideia: 'Possibilidade não decidida. Conclui quando vira avanço ou é descartada.',
                  espera: 'Depende de outra pessoa. Conclui quando você recebe o que aguardava.',
                }[kind]
              }
            </p>
          </div>

          <button
            type="button"
            aria-expanded={maisDetalhes}
            onClick={() => setMaisDetalhes((v) => !v)}
            className="flex min-h-12 w-full items-center justify-between gap-2 border-t border-border px-1 text-left text-[15px] font-medium text-foreground"
          >
            <span>
              Mais detalhes{' '}
              <span className="font-normal text-muted-foreground">
                · descrição, contexto, prazo, estratégia
              </span>
            </span>
            <ChevronDown
              className={cn('h-5 w-5 shrink-0 transition-transform', maisDetalhes && 'rotate-180')}
              aria-hidden="true"
            />
          </button>

          <div className={cn('space-y-4', !maisDetalhes && 'hidden')}>
          <div className="space-y-2">
            <Label htmlFor={ids.description} className="text-sm font-medium text-foreground">
              Descrição e notas (opcional)
            </Label>
            <Textarea
              id={ids.description}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes, orientações e informações úteis para executar este avanço."
              aria-describedby={ids.descriptionHelp}
              maxLength={20000}
              rows={4}
              className="min-h-24 border-input bg-card text-base text-foreground placeholder:text-muted-foreground sm:text-sm"
            />
            <p id={ids.descriptionHelp} className="text-sm text-muted-foreground">
              O que você precisa saber antes de agir?
              {description.length > 18000 && (
                <span className="ml-1 font-medium text-pegada-warning">
                  {description.length}/20000 caracteres (limite)
                </span>
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={ids.context} className="text-sm font-medium text-foreground">
                Contexto
              </Label>
              <Select value={context} onValueChange={(val) => setContext(val as EntityContext)}>
                <SelectTrigger
                  id={ids.context}
                  className="border-input bg-card text-base text-foreground sm:text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-popover text-popover-foreground">
                  <SelectItem value="trabalho">Trabalho</SelectItem>
                  <SelectItem value="vida">Vida</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={ids.status} className="text-sm font-medium text-foreground">
                Status
              </Label>
              <Select value={status} onValueChange={(val) => setStatus(val as ActionStatus)}>
                <SelectTrigger
                  id={ids.status}
                  className="border-input bg-card text-base text-foreground sm:text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-popover text-popover-foreground">
                  <SelectItem value="pronta">Pronto</SelectItem>
                  <SelectItem value="em_andamento">Em andamento</SelectItem>
                  <SelectItem value="aguardando">Aguardando</SelectItem>
                  <SelectItem value="bloqueada">Bloqueado</SelectItem>
                  <SelectItem value="feita">Feito</SelectItem>
                  <SelectItem value="cancelada">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {(status === 'aguardando' || status === 'bloqueada' || kind === 'espera') && (
            <div className="space-y-1.5">
              <Label htmlFor={ids.waitingFor} className="text-sm font-medium text-foreground">
                Motivo / bloqueio
              </Label>
              <Input
                id={ids.waitingFor}
                value={waitingFor}
                onChange={(e) => setWaitingFor(e.target.value)}
                placeholder={
                  kind === 'espera'
                    ? 'De quem ou do quê você está aguardando?'
                    : 'Pelo que está aguardando?'
                }
                className="border-input bg-card text-base text-foreground placeholder:text-muted-foreground sm:text-sm"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={ids.deadline} className="text-sm font-medium text-foreground">
              Prazo factual (opcional)
            </Label>
            <Input
              id={ids.deadline}
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="border-input bg-card text-base text-foreground tabular-nums sm:text-sm"
            />
          </div>

          {/* FATIA 5B1 — Planejamento (opcional): intenção local (dia/hora no
             fuso salvo, nunca instante; 00:00 explícita é válida; passado/
             futuro permitidos). Rascunho em memória; recolher não muda
             valores; Salvar é o único commit (patch único). A key reinicia a
             apresentação a cada abertura/alvo, sem apagar o rascunho em uso. */}
          <PlannedExecutionFields
            key={`${isOpen ? 'open' : 'closed'}-${actionToEdit?.id ?? 'new'}`}
            draft={planned}
            profileTimezone={profileTz.timezone}
            usingUtcFallback={plannedUtcFallback}
            keepsSavedTimezone={keepsSavedTimezone}
            savedTimezoneUnrecognized={savedTimezoneUnrecognized}
            pristine={plannedPristine}
            error={plannedError}
            disableTime={plannedTimeDisabled}
            disabled={isSaving}
            onChangeDate={handlePlannedDateChange}
            onChangeTime={handlePlannedTimeChange}
            onRemove={() => {
              // Em memória: limpa o grupo; só Salvar grava a remoção ('' x3).
              setPlanned(EMPTY_PLANNED)
              setPlannedUtcFallback(false)
              setPlannedPendingInvalid(false)
              setPlannedError(null)
            }}
          />

          {/* FATIA 4B2 — ESTRATÉGIA (opcional), local ao Resultado do formulário.
             Sem Resultado: sem seletor, escolha limpa (nunca herda/inferir).
             Estratégia pertence ao Resultado — não recebe responsibility_id. */}
          {projectId && selectedProject && (
            <StrategySelect
              id={ids.strategy}
              value={strategyId}
              onChange={(nextId) => {
                setStrategyId(nextId)
                setStrategyNotice(null)
              }}
              options={projectStrategies}
              projectLabel={
                selectedProject
                  ? `[${selectedProject.context}] ${formatEntityTitle('project', selectedProject.sequence_number, selectedProject.title)}`
                  : ''
              }
              onOpenCreate={() => setStrategyModalOpen(true)}
              incompatible={strategyIncompatibleWithDraft}
              originalArchived={originalStrategyArchived}
              disabled={isSaving}
            />
          )}
          {projectId && !selectedProject && (
            <p className="text-xs text-muted-foreground">
              Estratégias ficam disponíveis quando o resultado selecionado é carregado.
            </p>
          )}
          {strategyNotice && (
            <p role="alert" className="text-xs font-medium text-pegada-warning">
              {strategyNotice}
            </p>
          )}

          {/* BLOCO 5.1 — motivo legível de bloqueio ao criar com vínculo encerrado. */}
          {blockedByClosedProject && (
            <p role="alert" className="text-xs font-medium text-pegada-warning">
              Resultado {selectedProject!.status === 'concluido' ? 'concluído' : 'arquivado'} — não
              recebe novos avanços. Reabra o resultado pelo comando existente antes de planejar
              avanços vinculados a ele.
            </p>
          )}

          {/* BLOCO 5.2 — planejamento em projeto pausado: permitido com aviso. */}
          {contextualPausedNotice && (
            <p role="note" className="text-xs font-medium text-pegada-warning">
              Resultado pausado — você pode planejar avanços; execução e seleção de foco continuam
              sujeitas às regras existentes.
            </p>
          )}

          {/* FATIA 3C1 — solto: escolha DIRETA de Responsabilidade (seletor).
             Subordinado: herança em LEITURA do Resultado corrente (nunca
             copiada para actions.responsibility_id, que segue ''). */}
          {!projectId && (
            <ResponsibilitySelect
              id={ids.responsibility}
              value={directResponsibilityId}
              onChange={setDirectResponsibilityId}
              context={context}
              options={responsibilityOptions}
              disabled={isSaving}
            />
          )}
          {projectId && (
            <p id={ids.inheritedResponsibility} className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Responsabilidade herdada do resultado:
              </span>{' '}
              {inheritedRef.status === 'none' ? (
                <span className="italic">Nenhuma</span>
              ) : inheritedRef.status === 'ready' ? (
                <>
                  {inheritedRef.data.title}
                  {inheritedRef.data.status === 'arquivada' && ' (arquivada — vínculo atual)'}
                </>
              ) : inheritedRef.status === 'error' ? (
                <span className="font-medium text-pegada-warning">
                  Responsabilidade atual indisponível — vínculo preservado
                </span>
              ) : (
                <span className="italic">carregando…</span>
              )}
            </p>
          )}

          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label
                  htmlFor={ids.todaySelected}
                  className="block text-base font-medium text-foreground"
                >
                  Selecionar para Hoje
                </Label>
                <span id={ids.todayHelp} className="text-sm text-muted-foreground">
                  Coloca este avanço entre os poucos de Hoje
                </span>
              </div>
              <Switch
                id={ids.todaySelected}
                aria-describedby={ids.todayHelp}
                checked={isTodaySelected || isNextStep}
                disabled={isNextStep}
                onCheckedChange={(checked) => {
                  // Retirada explícita (desmarcar) continua permitida; nova
                  // seleção passa pela validação de elegibilidade.
                  if (checked && !validateFocusChoice()) return
                  setFocusNotice(null)
                  setIsTodaySelected(checked)
                }}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label
                  htmlFor={ids.nextStep}
                  className="block text-base font-medium text-foreground"
                >
                  Próximo avanço único
                </Label>
                <span id={ids.nextHelp} className="text-sm text-muted-foreground">
                  Destaque central de Hoje (escolha explícita por você)
                </span>
              </div>
              <Switch
                id={ids.nextStep}
                aria-describedby={ids.nextHelp}
                checked={isNextStep}
                onCheckedChange={(checked) => {
                  if (checked && !validateFocusChoice()) return
                  setFocusNotice(null)
                  setIsNextStep(checked)
                  if (checked) setIsTodaySelected(true)
                }}
              />
            </div>

            {/* FATIA 3C1 — transição solto -> Resultado com vínculo DIRETO original: aviso
               antes de salvar; Salvar é a confirmação, cancelar nada grava (nunca dois
               saves, nunca remoção silenciosa). */}
            {losingDirectLink && (
              <p role="alert" className="text-xs font-medium text-pegada-warning">
                Ao salvar, o vínculo direto com{' '}
                {persistedDirectName
                  ? `“${persistedDirectName}”`
                  : 'a responsabilidade atual (indisponível)'}{' '}
                será removido. Este avanço seguirá a Responsabilidade do resultado escolhido.
              </p>
            )}

            {focusNotice && (
              <p role="alert" className="text-xs font-medium text-pegada-warning">
                {focusNotice}
              </p>
            )}
          </div>

          </div>

          <DialogFooter className="flex-col gap-2 pt-2 sm:flex-col sm:space-x-0">
            {/* BLOCO 5.1 — guarda na UI: nova ação com vínculo encerrado não sai
               do formulário; edição preserva o vínculo antigo (não bloqueada). */}
            <Button
              type="submit"
              disabled={isSaving || !title.trim() || blockedByClosedProject}
              className="h-14 w-full rounded-full text-lg font-semibold"
            >
              {isSaving ? 'Salvando...' : actionToEdit ? 'Salvar alterações' : 'Salvar avanço'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} className="min-h-11 w-full rounded-full">
              Cancelar
            </Button>
          </DialogFooter>
        </form>

        {/* FATIA 4B2 — editor de Estratégia REUSADO (4B1) sobre o modal, para o
           Resultado CONFIRMADO do formulário. Duas decisões separadas: salvar
           aqui cria o grupo (não o Avanço); Salvar do Avanço é outro clique.
           Ajuda curta de escopo do grupo criado (não há transação grupo↔Avanço). */}
        {strategyModalOpen && selectedProject && (
          <>
            <p className="sr-only">
              Salvar cria a estratégia neste resultado. Cancelar o avanço depois não apaga a
              estratégia.
            </p>
            <StrategyModal
              open
              strategy={null}
              projectId={selectedProject.id}
              projectLabel={
                selectedProject
                  ? `[${selectedProject.context}] ${formatEntityTitle('project', selectedProject.sequence_number, selectedProject.title)}`
                  : ''
              }
              onOpenChange={(next) => {
                if (!next) setStrategyModalOpen(false)
              }}
              onSaved={handleInlineStrategySaved}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
