import React, { useState, useEffect, useId } from 'react'
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
import { EntityNumberBadge } from '@/components/EntityNumberBadge'

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
  // BLOCO 4B — IDs estáveis e únicos por instância (useId no topo, antes de
  // qualquer retorno condicional): rótulos apontam para o controle efetivo
  // mesmo com dois modais de projeto montados ao mesmo tempo.
  const uid = useId()
  const ids = React.useMemo(
    () => ({
      title: `${uid}-project-title`,
      context: `${uid}-project-context`,
      status: `${uid}-project-status`,
      aspiration: `${uid}-project-aspiration`,
      aspirationHelp: `${uid}-project-aspiration-help`,
      delivery: `${uid}-project-delivery`,
      deliveryHelp: `${uid}-project-delivery-help`,
      completionCondition: `${uid}-project-completion-condition`,
      deadline: `${uid}-project-deadline`,
      learningAsset: `${uid}-project-learning-asset`,
      rResultado: `${uid}-project-r-resultado`,
      rRazao: `${uid}-project-r-razao`,
      rReferencia: `${uid}-project-r-referencia`,
      rRumo: `${uid}-project-r-rumo`,
      rRecursos: `${uid}-project-r-recursos`,
      rRestricoes: `${uid}-project-r-restricoes`,
      rRiscos: `${uid}-project-r-riscos`,
      rResponsavel: `${uid}-project-r-responsavel`,
    }),
    [uid],
  )
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
        toast({ title: 'Ficha do resultado atualizada' })
      } else {
        await projectService.create(payload)
        toast({ title: 'Resultado criado com sucesso' })
      }

      onSaved?.()
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar resultado'
      toast({ variant: 'destructive', title: 'Erro', description: msg })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-card border-border text-card-foreground max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">
            {projectToEdit ? 'Editar Ficha do Resultado' : 'Novo Resultado'}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Conceito da Inteligência Pragmática: separe o que você quer alcançar (aspiração externa)
            daquilo que você realmente controla entregar (entrega controlável).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Título & Contexto */}
          <div className="space-y-1.5">
            <Label
              htmlFor={ids.title}
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Título do Resultado
            </Label>
            <Input
              id={ids.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Reformulação da esteira de prospecção"
              className="font-medium"
              required
            />
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor={ids.context}
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Contexto
              </Label>
              <Select value={context} onValueChange={(v) => setContext(v as EntityContext)}>
                <SelectTrigger id={ids.context}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trabalho">Trabalho</SelectItem>
                  <SelectItem value="vida">Vida</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor={ids.status}
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Status
              </Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                <SelectTrigger id={ids.status}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
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
          <div className="p-3.5 rounded-xl bg-muted border border-border space-y-3">
            <div className="space-y-1.5">
              <Label
                htmlFor={ids.aspiration}
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Aspiração: O que quero alcançar?</span>
              </Label>
              <Textarea
                id={ids.aspiration}
                rows={2}
                value={aspiration}
                onChange={(e) => setAspiration(e.target.value)}
                placeholder="Ex: Dobrar a taxa de conversão comercial ou eliminar ruído mental."
                aria-describedby={ids.aspirationHelp}
                className="bg-card text-xs"
              />
              <span id={ids.aspirationHelp} className="text-[11px] text-muted-foreground block">
                O resultado desejado no ambiente, que depende de variáveis fora do seu controle
                direto.
              </span>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-border">
              <Label
                htmlFor={ids.delivery}
                className="flex items-center gap-1.5 text-xs font-semibold text-ginga-success"
              >
                <Target className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Entrega Controlável: O que vou entregar?</span>
              </Label>
              <Textarea
                id={ids.delivery}
                rows={2}
                value={controllableDelivery}
                onChange={(e) => setControllableDelivery(e.target.value)}
                placeholder="Ex: Escrever roteiro padronizado, realizar 40 abordagens e documentar objeções."
                aria-describedby={ids.deliveryHelp}
                className="bg-card text-xs"
              />
              <span id={ids.deliveryHelp} className="text-[11px] text-muted-foreground block">
                Aquilo cuja execução depende 100% de você, independente do resultado de mercado.
              </span>
            </div>
          </div>

          {/* Condição de término & Prazo opcional */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor={ids.completionCondition}
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Condição de Término
              </Label>
              <Input
                id={ids.completionCondition}
                value={completionCondition}
                onChange={(e) => setCompletionCondition(e.target.value)}
                placeholder="Ex: Planilha de métricas preenchida por 30 dias"
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor={ids.deadline}
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Prazo Factual (Opcional)
              </Label>
              <Input
                id={ids.deadline}
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          {/* Aprendizado ou Ativo Durável */}
          <div className="space-y-1.5">
            <Label
              htmlFor={ids.learningAsset}
              className="flex items-center gap-1.5 text-xs font-semibold text-ginga-info"
            >
              <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Possível Aprendizado ou Ativo (sem garantia de ganho)</span>
            </Label>
            <Input
              id={ids.learningAsset}
              value={learningAsset}
              onChange={(e) => setLearningAsset(e.target.value)}
              placeholder="Ex: Framework de prospecção documentado e reutilizável"
              className="text-xs"
            />
          </div>

          {/* Os Oito Rs Opcionais (Recolhíveis) */}
          <div className="border border-border rounded-xl bg-muted/50 p-3">
            <Collapsible open={is8RsOpen} onOpenChange={setIs8RsOpen}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-ginga-success" aria-hidden="true" />
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                      Os Oito Rs Opcionais
                    </span>
                    <span className="text-[11px] text-muted-foreground block">
                      Resultado, Razão, Referência, Rumo, Recursos, Restrições, Riscos, Responsável
                    </span>
                  </div>
                </div>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
                    <span>{is8RsOpen ? 'Recolher' : 'Preencher Rs'}</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 ml-1 transition-transform ${is8RsOpen ? 'rotate-180' : ''}`}
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>

              <CollapsibleContent className="mt-3 space-y-3 pt-3 border-t border-border">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor={ids.rResultado} className="text-[11px] text-muted-foreground">
                      1. Resultado (O efeito final esperado)
                    </Label>
                    <Input
                      id={ids.rResultado}
                      value={rResultado}
                      onChange={(e) => setRResultado(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={ids.rRazao} className="text-[11px] text-muted-foreground">
                      2. Razão (Por que este resultado importa agora?)
                    </Label>
                    <Input
                      id={ids.rRazao}
                      value={rRazao}
                      onChange={(e) => setRRazao(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={ids.rReferencia} className="text-[11px] text-muted-foreground">
                      3. Referência (Padrão de qualidade ou benchmark)
                    </Label>
                    <Input
                      id={ids.rReferencia}
                      value={rReferencia}
                      onChange={(e) => setRReferencia(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={ids.rRumo} className="text-[11px] text-muted-foreground">
                      4. Rumo (Etapas e direção principal)
                    </Label>
                    <Input
                      id={ids.rRumo}
                      value={rRumo}
                      onChange={(e) => setRRumo(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={ids.rRecursos} className="text-[11px] text-muted-foreground">
                      5. Recursos (Tempo, energia, ferramentas)
                    </Label>
                    <Input
                      id={ids.rRecursos}
                      value={rRecursos}
                      onChange={(e) => setRRecursos(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={ids.rRestricoes} className="text-[11px] text-muted-foreground">
                      6. Restrições (Limites inegociáveis, orçamento)
                    </Label>
                    <Input
                      id={ids.rRestricoes}
                      value={rRestricoes}
                      onChange={(e) => setRRestricoes(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={ids.rRiscos} className="text-[11px] text-muted-foreground">
                      7. Riscos (O que pode dar errado e contingência)
                    </Label>
                    <Input
                      id={ids.rRiscos}
                      value={rRiscos}
                      onChange={(e) => setRRiscos(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={ids.rResponsavel} className="text-[11px] text-muted-foreground">
                      8. Responsável (Papel do dono ou terceiro)
                    </Label>
                    <Input
                      id={ids.rResponsavel}
                      value={rResponsavel}
                      onChange={(e) => setRResponsavel(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

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
