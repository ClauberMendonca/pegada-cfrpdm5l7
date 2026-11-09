import React, { useState, useEffect } from 'react'
import { ActionItem, EntityContext, ActionStatus, Project } from '@/types/execution'
import { actionService, CreateActionInput } from '@/services/actionService'
import { projectService } from '@/services/projectService'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { calendarDayOrNull } from '@/lib/datetime'

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
  const [title, setTitle] = useState('')
  const [context, setContext] = useState<EntityContext>(defaultContext)
  const [projectId, setProjectId] = useState<string>(defaultProjectId || '')
  const [status, setStatus] = useState<ActionStatus>('pronta')
  const [deadline, setDeadline] = useState('')
  const [isNextStep, setIsNextStep] = useState(false)
  const [isTodaySelected, setIsTodaySelected] = useState(false)
  const [waitingFor, setWaitingFor] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      projectService
        .list()
        .then((list) => {
          // Only active/draft projects
          setProjects(list.filter((p) => p.status === 'ativo' || p.status === 'rascunho'))
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
      } else {
        setTitle('')
        setContext(defaultContext)
        setProjectId(defaultProjectId || '')
        setStatus('pronta')
        setDeadline('')
        setIsNextStep(false)
        setIsTodaySelected(true)
        setWaitingFor('')
      }
    }
  }, [isOpen, actionToEdit, defaultContext, defaultProjectId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setIsSaving(true)
    try {
      const payload: CreateActionInput = {
        title: title.trim(),
        context,
        project_id: projectId ? projectId : undefined,
        status,
        // FATIA P1C — dia-calendário puro: aceita só 'YYYY-MM-DD'; vazio/parcial
        // NÃO cria prazo (sem parse de fuso que desloque o dia).
        deadline: calendarDayOrNull(deadline),
        is_next_step: isNextStep,
        is_today_selected: isTodaySelected || isNextStep,
        waiting_for: waitingFor.trim() || undefined,
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-white">
            {actionToEdit ? 'Editar Ação' : 'Nova Ação'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label
              htmlFor="actionTitle"
              className="text-xs uppercase tracking-wider text-slate-400"
            >
              Título da Ação
            </Label>
            <Input
              id="actionTitle"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Ligar para fornecedor X e alinhar especificação"
              className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus-visible:ring-emerald-500"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-slate-400">Contexto</Label>
              <Select value={context} onValueChange={(val) => setContext(val as EntityContext)}>
                <SelectTrigger className="bg-slate-950 border-slate-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                  <SelectItem value="trabalho">Trabalho</SelectItem>
                  <SelectItem value="vida">Vida</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-slate-400">Status</Label>
              <Select value={status} onValueChange={(val) => setStatus(val as ActionStatus)}>
                <SelectTrigger className="bg-slate-950 border-slate-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
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
              <Label className="text-xs uppercase tracking-wider text-slate-400">
                Motivo / Bloqueio
              </Label>
              <Input
                value={waitingFor}
                onChange={(e) => setWaitingFor(e.target.value)}
                placeholder="Pelo que está aguardando?"
                className="bg-slate-950 border-slate-800 text-white text-xs"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-slate-400">
                Projeto Vinculado (Opcional)
              </Label>
              <Select value={projectId} onValueChange={(v) => setProjectId(v === 'none' ? '' : v)}>
                <SelectTrigger className="bg-slate-950 border-slate-800 text-white text-xs truncate">
                  <SelectValue placeholder="Ação solta (sem projeto)" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-200 max-h-56">
                  <SelectItem value="none">Ação solta (sem projeto)</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      [{p.context}] {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-slate-400">
                Prazo Factual (Opcional)
              </Label>
              <Input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="bg-slate-950 border-slate-800 text-white text-xs"
              />
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium text-white block">Selecionar para Hoje</Label>
                <span className="text-xs text-slate-400">
                  Coloca esta ação entre as poucas de Hoje
                </span>
              </div>
              <Switch
                checked={isTodaySelected || isNextStep}
                disabled={isNextStep}
                onCheckedChange={setIsTodaySelected}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium text-amber-300 block">
                  Próximo Avanço Único
                </Label>
                <span className="text-xs text-slate-400">
                  Destaque central absoluto de Hoje (escolha explícita por você)
                </span>
              </div>
              <Switch
                checked={isNextStep}
                onCheckedChange={(checked) => {
                  setIsNextStep(checked)
                  if (checked) setIsTodaySelected(true)
                }}
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="text-slate-400 hover:text-white"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !title.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {isSaving ? 'Salvando...' : actionToEdit ? 'Atualizar' : 'Criar Ação'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
