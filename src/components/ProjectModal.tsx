import React, { useState, useEffect } from 'react'
import { Project, EntityContext, ProjectStatus } from '@/types/execution'
import { projectService, CreateProjectInput } from '@/services/projectService'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { ChevronDown, Sparkles, Target, Compass, BookOpen } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { calendarDayOrNull } from '@/lib/datetime'

interface ProjectModalProps {
  isOpen: boolean
  onClose: () => void
  projectToEdit?: Project | null
  defaultContext?: EntityContext
  onSaved?: () => void
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  projectToEdit,
  defaultContext = 'trabalho',
  onSaved,
}) => {
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [context, setContext] = useState<EntityContext>(defaultContext)
  const [status, setStatus] = useState<ProjectStatus>('rascunho')
  const [aspiration, setAspiration] = useState('')
  const [controllableDelivery, setControllableDelivery] = useState('')
  const [completionCondition, setCompletionCondition] = useState('')
  const [deadline, setDeadline] = useState('')
  const [learningAsset, setLearningAsset] = useState('')

  // Os 8 Rs (opcionais recolhíveis)
  const [is8RsOpen, setIs8RsOpen] = useState(false)
  const [rResultado, setRResultado] = useState('')
  const [rRazao, setRRazao] = useState('')
  const [rReferencia, setRReferencia] = useState('')
  const [rRumo, setRRumo] = useState('')
  const [rRecursos, setRRecursos] = useState('')
  const [rRestricoes, setRRestricoes] = useState('')
  const [rRiscos, setRRiscos] = useState('')
  const [rResponsavel, setRResponsavel] = useState('')

  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      if (projectToEdit) {
        setTitle(projectToEdit.title)
        setContext(projectToEdit.context)
        setStatus(projectToEdit.status)
        setAspiration(projectToEdit.aspiration || '')
        setControllableDelivery(projectToEdit.controllable_delivery || '')
        setCompletionCondition(projectToEdit.completion_condition || '')
        setDeadline(projectToEdit.deadline || '')
        setLearningAsset(projectToEdit.learning_asset || '')

        setRResultado(projectToEdit.r_resultado || '')
        setRRazao(projectToEdit.r_razao || '')
        setRReferencia(projectToEdit.r_referencia || '')
        setRRumo(projectToEdit.r_rumo || '')
        setRRecursos(projectToEdit.r_recursos || '')
        setRRestricoes(projectToEdit.r_restricoes || '')
        setRRiscos(projectToEdit.r_riscos || '')
        setRResponsavel(projectToEdit.r_responsavel || '')

        const hasAnyR = Boolean(
          projectToEdit.r_resultado ||
          projectToEdit.r_razao ||
          projectToEdit.r_referencia ||
          projectToEdit.r_rumo ||
          projectToEdit.r_recursos ||
          projectToEdit.r_restricoes ||
          projectToEdit.r_riscos ||
          projectToEdit.r_responsavel,
        )
        setIs8RsOpen(hasAnyR)
      } else {
        setTitle('')
        setContext(defaultContext)
        setStatus('rascunho')
        setAspiration('')
        setControllableDelivery('')
        setCompletionCondition('')
        setDeadline('')
        setLearningAsset('')

        setRResultado('')
        setRRazao('')
        setRReferencia('')
        setRRumo('')
        setRRecursos('')
        setRRestricoes('')
        setRRiscos('')
        setRResponsavel('')
        setIs8RsOpen(false)
      }
    }
  }, [isOpen, projectToEdit, defaultContext])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setIsSaving(true)
    try {
      const payload: CreateProjectInput = {
        title: title.trim(),
        context,
        status,
        aspiration: aspiration.trim() || undefined,
        controllable_delivery: controllableDelivery.trim() || undefined,
        completion_condition: completionCondition.trim() || undefined,
        // FATIA P1C — dia-calendário puro: aceita só 'YYYY-MM-DD'; vazio/parcial
        // NÃO cria prazo (sem parse de fuso que desloque o dia).
        deadline: calendarDayOrNull(deadline),
        learning_asset: learningAsset.trim() || undefined,

        r_resultado: rResultado.trim() || undefined,
        r_razao: rRazao.trim() || undefined,
        r_referencia: rReferencia.trim() || undefined,
        r_rumo: rRumo.trim() || undefined,
        r_recursos: rRecursos.trim() || undefined,
        r_restricoes: rRestricoes.trim() || undefined,
        r_riscos: rRiscos.trim() || undefined,
        r_responsavel: rResponsavel.trim() || undefined,
      }

      if (projectToEdit) {
        await projectService.update(projectToEdit.id, payload)
        toast({ title: 'Ficha do projeto atualizada' })
      } else {
        await projectService.create(payload)
        toast({ title: 'Projeto criado com sucesso' })
      }

      onSaved?.()
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar projeto'
      toast({ variant: 'destructive', title: 'Erro', description: msg })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-white">
            {projectToEdit ? 'Editar Ficha do Projeto' : 'Novo Projeto'}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400">
            Conceito da Inteligência Pragmática: separe o que você quer alcançar (aspiração externa)
            daquilo que você realmente controla entregar (entrega controlável).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Título & Contexto */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-slate-400">
              Título do Projeto
            </Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Reformulação da esteira de prospecção"
              className="bg-slate-950 border-slate-800 text-white font-medium"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-slate-400">Contexto</Label>
              <Select value={context} onValueChange={(v) => setContext(v as EntityContext)}>
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
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                <SelectTrigger className="bg-slate-950 border-slate-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                  <SelectItem value="rascunho">Rascunho (apenas título/contexto)</SelectItem>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="pausado">Pausado</SelectItem>
                  <SelectItem value="concluido">Concluído</SelectItem>
                  <SelectItem value="arquivado">Arquivado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Aspiração vs Entrega Controlável */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Aspiração: O que quero alcançar?</span>
              </div>
              <Textarea
                rows={2}
                value={aspiration}
                onChange={(e) => setAspiration(e.target.value)}
                placeholder="Ex: Dobrar a taxa de conversão comercial ou eliminar ruído mental."
                className="bg-slate-900 border-slate-800 text-white text-xs"
              />
              <span className="text-[11px] text-slate-500 block">
                O resultado desejado no ambiente, que depende de variáveis fora do seu controle
                direto.
              </span>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-slate-850">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <Target className="w-3.5 h-3.5" />
                <span>Entrega Controlável: O que vou entregar?</span>
              </div>
              <Textarea
                rows={2}
                value={controllableDelivery}
                onChange={(e) => setControllableDelivery(e.target.value)}
                placeholder="Ex: Escrever roteiro padronizado, realizar 40 abordagens e documentar objeções."
                className="bg-slate-900 border-slate-800 text-white text-xs"
              />
              <span className="text-[11px] text-slate-500 block">
                Aquilo cuja execução depende 100% de você, independente do resultado de mercado.
              </span>
            </div>
          </div>

          {/* Condição de término & Prazo opcional */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-slate-400">
                Condição de Término
              </Label>
              <Input
                value={completionCondition}
                onChange={(e) => setCompletionCondition(e.target.value)}
                placeholder="Ex: Planilha de métricas preenchida por 30 dias"
                className="bg-slate-950 border-slate-800 text-white text-xs"
              />
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

          {/* Aprendizado ou Ativo Durável */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-400">
              <BookOpen className="w-3.5 h-3.5" />
              <span>Possível Aprendizado ou Ativo (sem garantia de ganho)</span>
            </div>
            <Input
              value={learningAsset}
              onChange={(e) => setLearningAsset(e.target.value)}
              placeholder="Ex: Framework de prospecção documentado e reutilizável"
              className="bg-slate-950 border-slate-800 text-white text-xs"
            />
          </div>

          {/* Os Oito Rs Opcionais (Recolhíveis) */}
          <div className="border border-slate-800 rounded-xl bg-slate-950/40 p-3">
            <Collapsible open={is8RsOpen} onOpenChange={setIs8RsOpen}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-emerald-400" />
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                      Os Oito Rs Opcionais
                    </span>
                    <span className="text-[11px] text-slate-500 block">
                      Resultado, Razão, Referência, Rumo, Recursos, Restrições, Riscos, Responsável
                    </span>
                  </div>
                </div>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-400">
                    <span>{is8RsOpen ? 'Recolher' : 'Preencher Rs'}</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 ml-1 transition-transform ${is8RsOpen ? 'rotate-180' : ''}`}
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>

              <CollapsibleContent className="mt-3 space-y-3 pt-3 border-t border-slate-850">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400">
                      1. Resultado (O efeito final esperado)
                    </Label>
                    <Input
                      value={rResultado}
                      onChange={(e) => setRResultado(e.target.value)}
                      className="bg-slate-900 border-slate-800 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400">
                      2. Razão (Por que este projeto importa agora?)
                    </Label>
                    <Input
                      value={rRazao}
                      onChange={(e) => setRRazao(e.target.value)}
                      className="bg-slate-900 border-slate-800 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400">
                      3. Referência (Padrão de qualidade ou benchmark)
                    </Label>
                    <Input
                      value={rReferencia}
                      onChange={(e) => setRReferencia(e.target.value)}
                      className="bg-slate-900 border-slate-800 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400">
                      4. Rumo (Etapas e direção principal)
                    </Label>
                    <Input
                      value={rRumo}
                      onChange={(e) => setRRumo(e.target.value)}
                      className="bg-slate-900 border-slate-800 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400">
                      5. Recursos (Tempo, energia, ferramentas)
                    </Label>
                    <Input
                      value={rRecursos}
                      onChange={(e) => setRRecursos(e.target.value)}
                      className="bg-slate-900 border-slate-800 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400">
                      6. Restrições (Limites inegociáveis, orçamento)
                    </Label>
                    <Input
                      value={rRestricoes}
                      onChange={(e) => setRRestricoes(e.target.value)}
                      className="bg-slate-900 border-slate-800 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400">
                      7. Riscos (O que pode dar errado e contingência)
                    </Label>
                    <Input
                      value={rRiscos}
                      onChange={(e) => setRRiscos(e.target.value)}
                      className="bg-slate-900 border-slate-800 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400">
                      8. Responsável (Papel do dono ou terceiro)
                    </Label>
                    <Input
                      value={rResponsavel}
                      onChange={(e) => setRResponsavel(e.target.value)}
                      className="bg-slate-900 border-slate-800 text-xs"
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="text-slate-400">
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !title.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {isSaving ? 'Salvando...' : projectToEdit ? 'Atualizar Projeto' : 'Criar Projeto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
