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
import { checkEligibility, isSelectableForFocus } from '@/lib/eligibility'

interface ActionModalProps {
  isOpen: boolean
  onClose: () => void
  actionToEdit?: ActionItem | null
  defaultContext?: EntityContext
  defaultProjectId?: string
  onSaved?: () => void
}

export const ActionModal: React.FC<ActionModalProps> = ({
  isOpen,
  onClose,
  actionToEdit,
  defaultContext = 'trabalho',
  defaultProjectId,
  onSaved,
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

  useEffect(() => {
    if (isOpen) {
      setFocusNotice(null)
      projectService
        .list()
        .then((list) => {
          // B5 — lista completa: o vínculo atual permanece legível mesmo em
          // projeto pausado/concluído/arquivado. Novos vínculos continuam
          // restritos aos projetos permitidos (recorte feito no render).
          setProjects(list)
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Falha ao carregar projetos.'
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
      } else {
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
        eligibility.label ?? 'somente ações "pronta" recebem nova seleção de foco'
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
              title: 'Ação não criada',
              description: `O projeto “${freshProject.title}” está ${freshProject.status === 'concluido' ? 'concluído' : 'arquivado'}. Reabra o projeto pelo comando existente antes de planejar novas ações vinculadas.`,
            })
            return
          }
        } catch (readErr: unknown) {
          const readMsg =
            readErr instanceof Error ? readErr.message : 'Falha ao revalidar o projeto vinculado.'
          toast({
            variant: 'destructive',
            title: 'Ação não criada',
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
              eligibility.label ?? 'somente ações "pronta" recebem nova seleção'
            }. As demais alterações serão salvas.`,
          )
        } else if (effToday && !prevToday && !prevNext) {
          effToday = false
          setFocusNotice(
            `Seleção para Hoje não gravada: ${
              eligibility.label ?? 'somente ações "pronta" recebem nova seleção'
            }. As demais alterações serão salvas.`,
          )
        } else {
          setFocusNotice(null)
        }
      } else {
        setFocusNotice(null)
      }

      const payload: CreateActionInput = {
        title: title.trim(),
        context,
        project_id: projectId ? projectId : undefined,
        status,
        // FATIA P1C — dia-calendário puro: aceita só 'YYYY-MM-DD'; vazio/parcial
        // NÃO cria prazo (sem parse de fuso que desloque o dia).
        deadline: calendarDayOrNull(deadline),
        is_next_step: effNext,
        is_today_selected: effToday,
        waiting_for: waitingFor.trim() || undefined,
        // DESCRIÇÃO OPCIONAL: preserva quebras de linha e acentos; vazio segue
        // explícito (string ''), nunca undefined — limpar o campo apaga no banco.
        // Sem truncamento silencioso; PocketBase rejeita acima de 20000 e o
        // erro aparece visível com o texto preservado no formulário.
        description: description,
      }

      if (actionToEdit) {
        await actionService.update(actionToEdit.id, payload)
        toast({ title: 'Ação atualizada' })
      } else {
        await actionService.create(payload)
        toast({ title: 'Ação criada com sucesso' })
      }

      onSaved?.()
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar ação'
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: msg,
      })
    } finally {
      setIsSaving(false)
    }
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
        'Projeto pausado — você pode planejar ações; execução e seleção de foco continuam sujeitas às regras existentes.',
      )
    }
  }, [isOpen, actionToEdit, selectedPaused, defaultProjectId, projectId])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(680px,calc(100vw-16px))] rounded-[20px] bg-card text-foreground">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground">
            {actionToEdit ? 'Editar ação' : 'Nova ação'}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {actionToEdit
              ? 'Ajuste os dados desta ação. As alterações são gravadas somente ao confirmar.'
              : 'Preencha os dados da ação. Ela é gravada somente ao confirmar.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor={ids.title} className="text-sm font-medium text-foreground">
              Título da ação
            </Label>
            <Input
              id={ids.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Ligar para fornecedor X e alinhar especificação"
              className="border-input bg-card text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-ring sm:text-sm"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={ids.description} className="text-sm font-medium text-foreground">
              Descrição e notas (opcional)
            </Label>
            <Textarea
              id={ids.description}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes, orientações e informações úteis para executar esta ação."
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
                  <SelectItem value="pronta">Pronta</SelectItem>
                  <SelectItem value="em_andamento">Em andamento</SelectItem>
                  <SelectItem value="aguardando">Aguardando</SelectItem>
                  <SelectItem value="bloqueada">Bloqueada</SelectItem>
                  <SelectItem value="feita">Feita</SelectItem>
                  <SelectItem value="cancelada">Cancelada</SelectItem>
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
                Projeto vinculado (opcional)
              </Label>
              <Select value={projectId} onValueChange={(v) => setProjectId(v === 'none' ? '' : v)}>
                <SelectTrigger
                  id={ids.project}
                  className="truncate border-input bg-card text-base text-foreground sm:text-sm"
                >
                  <SelectValue placeholder="Ação solta (sem projeto)" />
                </SelectTrigger>
                <SelectContent className="max-h-56 border-border bg-popover text-popover-foreground">
                  <SelectItem value="none">Ação solta (sem projeto)</SelectItem>
                  {/* Novos vínculos: apenas projetos permitidos pela regra atual. */}
                  {selectableProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      [{p.context}] {p.title}
                    </SelectItem>
                  ))}
                  {/* B5 — vínculo atual fora da lista continua legível, com status. */}
                  {linkedOutsideSelectable && (
                    <SelectItem value={projectId} disabled>
                      {(() => {
                        const linked = projects.find((p) => p.id === projectId)
                        return linked
                          ? `[${linked.context}] ${linked.title} (${linked.status})`
                          : 'Projeto vinculado (indisponível)'
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

          {/* BLOCO 5.1 — motivo legível de bloqueio ao criar com vínculo encerrado. */}
          {blockedByClosedProject && (
            <p role="alert" className="text-xs font-medium text-ginga-warning">
              Projeto {selectedProject!.status === 'concluido' ? 'concluído' : 'arquivado'} — não
              recebe novas ações. Reabra o projeto pelo comando existente antes de planejar ações
              vinculadas a ele.
            </p>
          )}

          {/* BLOCO 5.2 — planejamento em projeto pausado: permitido com aviso. */}
          {contextualPausedNotice && (
            <p role="note" className="text-xs font-medium text-ginga-warning">
              Projeto pausado — você pode planejar ações; execução e seleção de foco continuam
              sujeitas às regras existentes.
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
                  Coloca esta ação entre as poucas de Hoje
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
              {isSaving ? 'Salvando...' : actionToEdit ? 'Atualizar' : 'Criar ação'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
