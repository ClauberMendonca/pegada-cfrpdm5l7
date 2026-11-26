import { AiSuggest } from '@/components/AiSuggest'
import React, { useState, useEffect, useId } from 'react'
import { Project, EntityContext, ProjectStatus } from '@/types/execution'
import { projectService, UpdateProjectInput } from '@/services/projectService'
import { RegraError, conferirResultado, op } from '@/lib/pegada/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { calendarDayOrNull } from '@/lib/datetime'
import { EntityNumberBadge } from '@/components/EntityNumberBadge'
import { ResponsibilitySelect, useResponsibilityOptions } from '@/components/ResponsibilitySelect'
import { wishService } from '@/services/wishService'
import type { Wish } from '@/types/execution'

interface ProjectModalProps {
  isOpen: boolean
  onClose: () => void
  projectToEdit?: Project | null
  defaultContext?: EntityContext
  onSaved?: () => void
}

// PEGADA — formulário mínimo do Resultado: título, situação (ativo/futuro/
// rascunho), prazo, "como vou saber que cheguei" e origem (Responsabilidade).
const STATUS_ATUAL_LABEL: Partial<Record<ProjectStatus, string>> = {
  pausado: 'Pausado',
  concluido: 'Concluído',
  arquivado: 'Arquivado',
  abandonado: 'Abandonado',
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  projectToEdit,
  defaultContext = 'trabalho',
  onSaved,
}) => {
  const { toast } = useToast()
  // BLOCO 4B — IDs estáveis e únicos por instância (useId no topo, antes de
  // qualquer retorno condicional): rótulos apontam para o controle efetivo
  // mesmo com dois modais de projeto montados ao mesmo tempo.
  const uid = useId()
  const ids = React.useMemo(
    () => ({
      title: `${uid}-project-title`,
      context: `${uid}-project-context`,
      status: `${uid}-project-status`,
      completionCondition: `${uid}-project-completion-condition`,
      deadline: `${uid}-project-deadline`,
      responsibility: `${uid}-project-responsibility`,
      wish: `${uid}-project-wish`,
    }),
    [uid],
  )
  const [title, setTitle] = useState('')
  const [context, setContext] = useState<EntityContext>(defaultContext)
  const [status, setStatus] = useState<ProjectStatus>('rascunho')
  const [completionCondition, setCompletionCondition] = useState('')
  const [deadline, setDeadline] = useState('')
  // FATIA 3C1 — origem (vínculo com Responsabilidade): ID nativo; '' = nasce
  // do Propósito/remoção. Comportamento de vínculo mantido como estava.
  const [responsibilityId, setResponsibilityId] = useState('')
  const responsibilityOptions = useResponsibilityOptions(isOpen)
  // Origem alternativa: uma Vontade. Um resultado nasce de uma vontade OU de
  // uma responsabilidade, nunca das duas; escolher uma solta a outra.
  const [wishId, setWishId] = useState('')
  const [vontades, setVontades] = useState<Wish[]>([])
  useEffect(() => {
    if (!isOpen) return
    let vivo = true
    wishService.list().then((l) => vivo && setVontades(l)).catch(() => {})
    return () => {
      vivo = false
    }
  }, [isOpen])

  const [isSaving, setIsSaving] = useState(false)
  // Correção gentil: se o texto não tem linha de chegada, o Pegada oferece
  // em uma linha o lugar certo. A pessoa dispensa com um toque.
  const [correcao, setCorrecao] = useState<{ e: string; por_que: string } | null>(null)
  const conferido = React.useRef('')
  const conferir = async () => {
    const t = title.trim()
    if (projectToEdit || t.length < 12 || conferido.current === t) return
    conferido.current = t
    try {
      const r = await conferirResultado(t)
      if (conferido.current !== t) return
      setCorrecao(['responsabilidade', 'estrategia', 'proposito'].includes(r.e) ? r : null)
    } catch {
      // Sem IA no servidor, ou falha: o formulário segue como sempre.
    }
  }
  const guardarComoResponsabilidade = async () => {
    setIsSaving(true)
    try {
      const res = await op('criar_responsabilidade', { titulo: title.trim(), contexto: context })
      const id = String((res.resultado as { responsabilidade_id?: string })?.responsabilidade_id || '')
      await responsibilityOptions.reload()
      if (id) setResponsibilityId(id)
      toast({
        title: 'Responsabilidade guardada',
        description: 'Agora escreva o resultado que nasce dela.',
      })
      setTitle('')
      setCorrecao(null)
      conferido.current = ''
      onSaved?.()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Não foi possível guardar.')
    } finally {
      setIsSaving(false)
    }
  }
  // Mensagem de regra do método (código entre colchetes), exibida no próprio
  // formulário, perto de Salvar — sem perder o rascunho do usuário.
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (isOpen) {
      setFormError('')
      if (projectToEdit) {
        setTitle(projectToEdit.title)
        setContext(projectToEdit.context)
        setStatus(projectToEdit.status)
        setCompletionCondition(projectToEdit.completion_condition || '')
        setDeadline(projectToEdit.deadline || '')
        setResponsibilityId(projectToEdit.responsibility_id || '')
        setWishId(projectToEdit.wish_id || '')
      } else {
        setTitle('')
        setCorrecao(null)
        conferido.current = ''
        setContext(defaultContext)
        setStatus('rascunho')
        setCompletionCondition('')
        setDeadline('')
        setResponsibilityId('')
        setWishId('')
      }
    }
  }, [isOpen, projectToEdit, defaultContext])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setIsSaving(true)
    setFormError('')
    try {
      // Campos do formulário mínimo. Na edição o contexto NÃO é reenviado: o
      // servidor preserva o atual (trocar de Responsabilidade atualiza o
      // contexto pelo backend); na criação o contexto vai sempre.
      const base = {
        title: title.trim(),
        status,
        completion_condition: completionCondition.trim() || undefined,
        // FATIA P1C — dia-calendário puro: aceita só 'YYYY-MM-DD'; vazio/parcial
        // NÃO cria prazo (sem parse de fuso que desloque o dia).
        deadline: calendarDayOrNull(deadline) || undefined,
        // FATIA 3C1 — '' remove; ID escolhido vincula; nunca o sentinel 'none'.
        responsibility_id: responsibilityId,
        wish_id: wishId,
      }
      if (projectToEdit) {
        await projectService.update(projectToEdit.id, base)
        toast({ title: 'Ficha do resultado atualizada' })
      } else {
        await projectService.create({ ...base, context })
        toast({ title: 'Resultado criado com sucesso' })
      }

      onSaved?.()
      onClose()
    } catch (err: unknown) {
      // Regra do método (a API do método responde "[CODIGO] mensagem", em
      // qualquer caixa): a mensagem aparece no próprio formulário, sem fechar
      // nem limpar o rascunho do usuário.
      const raw = err instanceof Error ? err.message : 'Erro ao salvar resultado'
      const regra =
        err instanceof RegraError ? err.message : raw.match(/^\[[^\]]+\]\s*([\s\S]+)$/)?.[1]
      if (regra) {
        setFormError(regra)
      } else {
        toast({ variant: 'destructive', title: 'Erro', description: raw })
      }
    } finally {
      setIsSaving(false)
    }
  }

  // Situação: só ativo/futuro/rascunho. Em edição de um resultado em outro
  // estado (pausado/concluído/arquivado/abandonado), ele aparece como opção
  // "(atual)" — salvar sem tocar nele não muda nada (sem decidir_resultado).
  const statusOptions: { value: ProjectStatus; label: string }[] = [
    { value: 'ativo', label: 'Ativo' },
    { value: 'futuro', label: 'Futuro' },
    { value: 'rascunho', label: 'Rascunho' },
  ]

  if (
    projectToEdit &&
    projectToEdit.status !== 'ativo' &&
    projectToEdit.status !== 'futuro' &&
    projectToEdit.status !== 'rascunho'
  ) {
    statusOptions.push({
      value: projectToEdit.status,
      label: `${STATUS_ATUAL_LABEL[projectToEdit.status] || projectToEdit.status} (atual)`,
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-card border-border text-card-foreground max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">
            {projectToEdit ? 'Editar Ficha do Resultado' : 'Novo Resultado'}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Um resultado é um estado alcançado, com prazo para poder responder &quot;alcancei ou
            não?&quot; e uma forma de saber que chegou.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Título */}
          <div className="space-y-1.5">
            <Label
              htmlFor={ids.title}
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              O que estará pronto, e até quando?
            </Label>
            <Input
              id={ids.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Até dezembro, empresa funcionando duas semanas sem mim"
              className="font-medium"
              required
              onBlur={() => void conferir()}
            />
            {!projectToEdit && !correcao && (
              <p className="text-xs text-muted-foreground">
                Escreva como algo já pronto, com linha de chegada: “Até [data], …”.
              </p>
            )}
            {correcao && (
              <div
                className="space-y-2 rounded-2xl border border-border bg-secondary p-3"
                role="status"
                data-correcao={correcao.e}
              >
                <p className="break-words text-sm text-foreground">
                  {correcao.por_que}{' '}
                  {correcao.e === 'responsabilidade'
                    ? 'Quer guardar como Responsabilidade e criar um resultado dentro dela?'
                    : correcao.e === 'estrategia'
                      ? 'Parece um caminho, não o destino. Para quê você faria isso? A resposta é o resultado.'
                      : 'Parece o seu propósito, que nunca se conclui. Que estado você quer alcançar por causa dele?'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {correcao.e === 'responsabilidade' && (
                    <Button type="button" size="sm" disabled={isSaving} onClick={() => void guardarComoResponsabilidade()}>
                      Guardar como Responsabilidade
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setCorrecao(null)}>
                    Dispensar
                  </Button>
                </div>
              </div>
            )}
            {!projectToEdit && (
              <AiSuggest
                tipo="resultado"
                texto={title}
                descrever={(s) => `${s.titulo}${/^\d{4}-\d{2}-\d{2}$/.test(s.prazo || '') ? ` · prazo ${s.prazo}` : ''}`}
                onUsar={(s) => {
                  if (s.titulo) setTitle(s.titulo)
                  if (/^\d{4}-\d{2}-\d{2}$/.test(s.prazo || '')) setDeadline(s.prazo)
                }}
              />
            )}
            {/* NUMERAÇÃO PERMANENTE — número do projeto FORA do input: selo de
               leitura na edição; na criação, nota discreta (nunca P-0 ou
               número previsto). O título digitado continua puro. */}
            {projectToEdit ? (
              <span className="flex items-center gap-1.5">
                <EntityNumberBadge
                  kind="project"
                  n={projectToEdit.sequence_number}
                  entityId={projectToEdit.id}
                />
                <span className="text-sm text-foreground">{projectToEdit.title}</span>
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">Número atribuído ao salvar</span>
            )}
          </div>

          {/* Situação */}
          <div className="space-y-1.5">
            <Label
              htmlFor={ids.status}
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Situação
            </Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
              <SelectTrigger id={ids.status}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* FATIA 3C1 — Origem: Responsabilidade (opcional; sem vínculo =
             nasce do Propósito). Comportamento de vínculo mantido como estava. */}
          <div className="space-y-1.5">
            <Label htmlFor={ids.wish} className="text-xs uppercase tracking-wider text-muted-foreground">
              Vontade (opcional)
            </Label>
            <Select
              value={wishId || 'none'}
              onValueChange={(v) => {
                const nextId = v === 'none' ? '' : v
                setWishId(nextId)
                if (nextId) setResponsibilityId('')
                const escolhida = vontades.find((w) => w.id === nextId)
                if (escolhida) setContext(escolhida.context as EntityContext)
              }}
              disabled={isSaving}
            >
              <SelectTrigger id={ids.wish} className="min-h-11 w-full">
                <SelectValue placeholder="Nenhuma" />
              </SelectTrigger>
              <SelectContent className="max-h-56">
                <SelectItem value="none" className="min-h-11">
                  Nenhuma
                </SelectItem>
                {vontades
                  .filter((w) => w.status === 'ativa' || w.id === wishId)
                  .map((w) => (
                    <SelectItem key={w.id} value={w.id} className="min-h-11">
                      {w.title} · {w.context === 'trabalho' ? 'Trabalho' : 'Vida'}
                      {w.status === 'arquivada' ? ' (arquivada)' : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <span className="block text-[11px] text-muted-foreground">
              O resultado nasce de uma vontade ou de uma responsabilidade. Sem nenhuma, fica livre.
            </span>
          </div>

          <ResponsibilitySelect
            id={ids.responsibility}
            value={responsibilityId}
            onChange={(nextId) => {
              setResponsibilityId(nextId)
              if (nextId) setWishId('')
              // O Resultado herda o contexto da Responsabilidade de onde nasce.
              const escolhida = responsibilityOptions.list.find((r) => r.id === nextId)
              if (escolhida) setContext(escolhida.context as EntityContext)
            }}
            context={context}
            options={responsibilityOptions}
            disabled={isSaving}
            anyContext
          />

          {/* Prazo & Como vou saber que cheguei */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor={ids.deadline}
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Prazo (Opcional)
              </Label>
              <Input
                id={ids.deadline}
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor={ids.completionCondition}
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Como vou saber que cheguei
              </Label>
              <Input
                id={ids.completionCondition}
                value={completionCondition}
                onChange={(e) => setCompletionCondition(e.target.value)}
                placeholder="Ex: Planilha de métricas preenchida por 30 dias"
                className="text-xs"
              />
            </div>
          </div>

          {/* Regra do método: mensagem visível no próprio formulário, perto
             de Salvar. O rascunho do usuário permanece intocado. */}
          {formError && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {formError}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSaving || !title.trim()}>
              {isSaving ? 'Salvando...' : projectToEdit ? 'Atualizar Resultado' : 'Criar Resultado'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
