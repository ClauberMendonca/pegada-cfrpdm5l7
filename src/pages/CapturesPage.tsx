import React, { useState, useEffect, useCallback, useRef } from 'react'
import { CaptureItem, CaptureStatus } from '@/types/execution'
import { captureService } from '@/services/captureService'
import { projectService } from '@/services/projectService'
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

export const CapturesPage: React.FC = () => {
  const { toast } = useToast()
  const { contextFilter } = useGlobalFilter()

  const [captures, setCaptures] = useState<CaptureItem[]>([])
  const [filterStatus, setFilterStatus] = useState<CaptureStatus | 'todas'>('pendente')
  const [newCaptureText, setNewCaptureText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Conversion Modals
  const [selectedCapture, setSelectedCapture] = useState<CaptureItem | null>(null)
  const [conversionType, setConversionType] = useState<'project' | 'action' | null>(null)

  // FATIA M1B1 — Painel do Copiloto (estado SEPARADO da conversão manual)
  const [copilotCapture, setCopilotCapture] = useState<CaptureItem | null>(null)
  const [copilotOpen, setCopilotOpen] = useState(false)
  const copilotSession = useRef(0)
  const pageActive = useRef(true)
  const [conversionFromCopilot, setConversionFromCopilot] = useState(false)
  useEffect(() => {
    pageActive.current = true
    return () => {
      pageActive.current = false
      ++copilotSession.current
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
  const [availableProjects, setAvailableProjects] = useState<
    { id: string; title: string; context: string }[]
  >([])

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

  useEffect(() => {
    loadCaptures()
  }, [loadCaptures])

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

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCaptureText.trim()) return

    setIsSubmitting(true)
    try {
      await captureService.create(newCaptureText.trim())
      setNewCaptureText('')
      toast({
        title: 'Ideia capturada',
        description: 'Armazenada com segurança para processar depois.',
      })
      loadCaptures()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao capturar'
      toast({ variant: 'destructive', title: 'Erro', description: msg })
    } finally {
      setIsSubmitting(false)
    }
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
    setSelectedCapture(capture)
    setProjectTitle(capture.raw_text.split('\n')[0].slice(0, 80))
    setProjectContext(contextFilter === 'vida' ? 'vida' : 'trabalho')
    setProjectAspiration('')
    setProjectControllable('')
    setProjectCompletion('')
    setConversionType('project')
  }

  const openConvertToAction = (capture: CaptureItem) => {
    setConversionFromCopilot(false)
    setSelectedCapture(capture)
    setActionTitle(capture.raw_text.slice(0, 100))
    setActionContext(contextFilter === 'vida' ? 'vida' : 'trabalho')
    setActionProjectId('')
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
    setSelectedCapture(capture)
    setConversionFromCopilot(true)
    setCaptures((list) => list.map((item) => (item.id === capture.id ? capture : item)))
    if (proposal.kind === 'projeto') {
      setProjectTitle(proposal.title)
      setProjectContext(proposal.context)
      setProjectAspiration(proposal.aspiration ?? '')
      setProjectControllable(proposal.controllable_delivery ?? '')
      setProjectCompletion(proposal.completion_condition ?? '')
      setConversionType('project')
    } else {
      setActionTitle(proposal.title)
      setActionContext(proposal.context)
      setActionProjectId('')
      setConversionType('action')
    }
  }

  const [isConverting, setIsConverting] = useState(false)

  const handleConfirmConvert = async (target: 'project' | 'action') => {
    if (!selectedCapture) return
    if (target === 'project' && !projectTitle.trim()) return
    if (target === 'action' && !actionTitle.trim()) return

    setIsConverting(true)
    try {
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
            }
          : {
              title: actionTitle.trim(),
              context: actionContext,
              project_id: actionProjectId ? actionProjectId : undefined,
            },
      )

      // Idempotente: quando a captura já estava convertida (retry após perder
      // a resposta, duplo clique, chamada concorrente), o backend retorna o
      // destino REAL que já existia — nunca cria um segundo destino.
      if (result.duplicate) {
        const destino = result.target_type === 'project' ? 'Projeto' : 'Ação'
        toast({
          title: `Captura já estava convertida`,
          description: `Exibindo o ${destino} que já existia — nenhum destino duplicado foi criado.`,
        })
      } else {
        toast({
          title:
            target === 'project'
              ? 'Captura convertida em Projeto com sucesso!'
              : 'Captura convertida em Ação pronta!',
        })
      }
      setConversionType(null)
      setSelectedCapture(null)
      loadCaptures()
    } catch (err: unknown) {
      // Falha: erro visível e dados digitados preservados (o modal permanece
      // aberto com o estado do formulário intacto — nada é apagado).
      const msg = err instanceof Error ? err.message : 'Erro na conversão'
      toast({ variant: 'destructive', title: 'Erro na conversão', description: msg })
    } finally {
      setIsConverting(false)
    }
  }

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
          <Badge className="bg-ginga-info-bg text-ginga-info border-ginga-info/30">Projeto</Badge>
        )
      case 'convertida_acao':
        return (
          <Badge className="bg-ginga-success-bg text-ginga-success border-ginga-success/30">
            Ação
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
            Caixa de entrada rápida para descarregar a mente sem fricção. Converta em Projeto ou
            Ação, ou descarte.
          </p>
        </div>

        {/* Filter by status */}
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
                    ? 'Projetos'
                    : st === 'convertida_acao'
                      ? 'Ações'
                      : 'Descartadas'}
            </button>
          ))}
        </div>
      </div>

      {/* Input de Captura Rápida */}
      <Card className="bg-card border-border shadow-md">
        <form onSubmit={handleQuickAdd}>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <Lightbulb className="w-3.5 h-3.5" />
              <span>Anotação Rápida em Texto Livre</span>
            </div>
            <Textarea
              value={newCaptureText}
              onChange={(e) => setNewCaptureText(e.target.value)}
              placeholder="O que está na sua cabeça? Ideia, insight, pendência que surgiu, oportunidade..."
              rows={3}
            />
            <div className="flex justify-between items-center pt-1">
              <span className="text-xs text-muted-foreground">
                Pressione Capturar para guardar sem precisar organizar agora.
              </span>
              <Button
                type="submit"
                disabled={isSubmitting || !newCaptureText.trim()}
                className="gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Capturar Ideia
              </Button>
            </div>
          </CardContent>
        </form>
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
        ) : (
          <div className="grid gap-3">
            {captures.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-xl border border-border bg-card hover:bg-accent/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {getStatusBadge(item.status)}
                    <span className="text-xs font-mono text-muted-foreground">
                      {new Date(item.created).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                    {item.raw_text}
                  </p>
                </div>

                {/* Ações de processamento */}
                {item.status === 'pendente' && (
                  <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openConvertToAction(item)}
                      className="text-xs gap-1.5"
                    >
                      <CheckSquare className="w-3.5 h-3.5 text-primary" />
                      Virar Ação
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openConvertToProject(item)}
                      className="text-xs gap-1.5"
                    >
                      <FolderKanban className="w-3.5 h-3.5 text-primary" />
                      Virar Projeto
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        ++copilotSession.current
                        setCopilotCapture(item)
                        setCopilotOpen(true)
                      }}
                      className="text-xs gap-1.5"
                      title="Ver pedidos e comandos explícitos do copiloto"
                    >
                      <Bot className="w-3.5 h-3.5 text-primary" />
                      Copiloto
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
            ))}
          </div>
        )}
      </div>

      {/* Modal: Converter em Projeto */}
      <Dialog
        open={conversionType === 'project'}
        onOpenChange={(open) => !open && setConversionType(null)}
      >
        <DialogContent className="bg-card text-card-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <FolderKanban className="w-5 h-5 text-primary" />
              Converter Captura em Projeto
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Crie o projeto como rascunho com título e contexto. Você pode preencher o resto
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
                Título do Projeto
              </Label>
              <Input
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Contexto
              </Label>
              <Select
                value={projectContext}
                onValueChange={(v) => setProjectContext(v as 'vida' | 'trabalho')}
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
                Aspiração (O que quero alcançar? Opcional)
              </Label>
              <Textarea
                rows={2}
                value={projectAspiration}
                onChange={(e) => setProjectAspiration(e.target.value)}
                placeholder="Ex: Ampliar minha influência estratégica na empresa"
                className="text-xs"
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
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConversionType(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => handleConfirmConvert('project')}
              disabled={isConverting || !projectTitle.trim()}
            >
              {isConverting ? 'Gravando…' : 'Criar Projeto Rascunho'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Converter em Ação */}
      <Dialog
        open={conversionType === 'action'}
        onOpenChange={(open) => !open && setConversionType(null)}
      >
        <DialogContent className="bg-card text-card-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-primary" />
              Converter Captura em Ação
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Crie uma ação executável vinculada ou solta, pronta para a execução.
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
                Título da Ação
              </Label>
              <Input
                value={actionTitle}
                onChange={(e) => setActionTitle(e.target.value)}
                required
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
                  Projeto (Opcional)
                </Label>
                <Select
                  value={actionProjectId}
                  onValueChange={(v) => setActionProjectId(v === 'none' ? '' : v)}
                >
                  <SelectTrigger className="truncate text-xs">
                    <SelectValue placeholder="Ação solta" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ação solta</SelectItem>
                    {availableProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        [{p.context}] {p.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConversionType(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => handleConfirmConvert('action')}
              disabled={isConverting || !actionTitle.trim()}
            >
              {isConverting ? 'Gravando…' : 'Criar Ação Pronta'}
            </Button>
          </DialogFooter>
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
