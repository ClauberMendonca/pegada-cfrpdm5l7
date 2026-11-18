import React, { useState, useEffect, useId } from 'react'
import { ActionItem, EntityContext, ActionStatus, Project } from '@/types/execution'
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
        setDescription('')
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(680px,calc(100vw-16px))] rounded-[20px] bg-card text-foreground">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground">
            {actionToEdit ? 'Editar avanço' : 'Novo avanço'}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {actionToEdit
              ? 'Ajuste os dados deste avanço. As alterações são gravadas somente ao confirmar.'
              : 'Preencha os dados do avanço. Ele é gravado somente ao confirmar.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor={ids.title} className="text-sm font-medium text-foreground">
              Título do avanço
            </Label>
            <Input
              id={ids.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Ligar para fornecedor X e alinhar especificação"
              className="border-input bg-card text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-ring sm:text-sm"
              required
            />
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
            ) : (
              <span className="text-[11px] text-muted-foreground">Número atribuído ao salvar</span>
            )}
          </div>

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
                <span className="ml-1 font-medium text-ginga-warning">
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

          {(status === 'aguardando' || status === 'bloqueada') && (
            <div className="space-y-1.5">
              <Label htmlFor={ids.waitingFor} className="text-sm font-medium text-foreground">
                Motivo / bloqueio
              </Label>
              <Input
                id={ids.waitingFor}
                value={waitingFor}
                onChange={(e) => setWaitingFor(e.target.value)}
                placeholder="Pelo que está aguardando?"
                className="border-input bg-card text-base text-foreground placeholder:text-muted-foreground sm:text-sm"
              />
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={ids.project} className="text-sm font-medium text-foreground">
                Resultado vinculado (opcional)
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
          </div>

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
            <p role="alert" className="text-xs font-medium text-ginga-warning">
              {strategyNotice}
            </p>
          )}

          {/* BLOCO 5.1 — motivo legível de bloqueio ao criar com vínculo encerrado. */}
          {blockedByClosedProject && (
            <p role="alert" className="text-xs font-medium text-ginga-warning">
              Resultado {selectedProject!.status === 'concluido' ? 'concluído' : 'arquivado'} — não
              recebe novos avanços. Reabra o resultado pelo comando existente antes de planejar
              avanços vinculados a ele.
            </p>
          )}

          {/* BLOCO 5.2 — planejamento em projeto pausado: permitido com aviso. */}
          {contextualPausedNotice && (
            <p role="note" className="text-xs font-medium text-ginga-warning">
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
                <span className="font-medium text-ginga-warning">
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
              <p role="alert" className="text-xs font-medium text-ginga-warning">
                Ao salvar, o vínculo direto com{' '}
                {persistedDirectName
                  ? `“${persistedDirectName}”`
                  : 'a responsabilidade atual (indisponível)'}{' '}
                será removido. Este avanço seguirá a Responsabilidade do resultado escolhido.
              </p>
            )}

            {focusNotice && (
              <p role="alert" className="text-xs font-medium text-ginga-warning">
                {focusNotice}
              </p>
            )}
          </div>

          <DialogFooter className="flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="min-h-11 rounded-xl"
            >
              Cancelar
            </Button>
            {/* BLOCO 5.1 — guarda na UI: nova ação com vínculo encerrado não sai
               do formulário; edição preserva o vínculo antigo (não bloqueada). */}
            <Button
              type="submit"
              disabled={isSaving || !title.trim() || blockedByClosedProject}
              className="min-h-11 rounded-xl"
            >
              {isSaving ? 'Salvando...' : actionToEdit ? 'Atualizar' : 'Criar avanço'}
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
