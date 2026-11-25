import { useState } from 'react'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { op, RegraError } from '@/lib/pegada/api'
import { notificarMudanca } from '@/services/actionService'
import { projectService } from '@/services/projectService'
import { ACTION_KIND_LABEL, ActionKind, CaptureItem, Project } from '@/types/execution'

// PEGADA — processar captura em um toque, sempre pela operação do método.
// Espera fica de fora do toque único porque exige "aguardando": ela se cria em Novo Avanço.
const TIPOS_UM_TOQUE: ActionKind[] = ['acao', 'compromisso', 'estudo', 'reflexao', 'ideia']

interface Props {
  capture: CaptureItem
  onDone: () => void
  /** Nome do botão; na Caixa é "Decidir". */
  rotulo?: string
}

export function ProcessCaptureMenu({ capture, onDone, rotulo = 'Processar' }: Props) {
  const [busy, setBusy] = useState(false)
  const [resultados, setResultados] = useState<Project[] | null>(null)

  const run = async (nome: string, entrada: Record<string, unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await op(nome, entrada, {
        desfazer: true,
        onDesfeito: () => {
          onDone()
          notificarMudanca()
        },
      })
      onDone()
      notificarMudanca()
    } catch (e) {
      const msg =
        e instanceof RegraError || e instanceof Error ? e.message : 'Não foi possível processar.'
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  const processar = (destino: string, dados: Record<string, unknown> = {}) =>
    run('processar_captura', { captura_id: capture.id, destino, dados })

  const carregarResultados = async (open: boolean) => {
    if (!open || resultados) return
    try {
      setResultados(await projectService.list(undefined, 'ativo'))
    } catch {
      setResultados([])
    }
  }

  return (
    <DropdownMenu onOpenChange={carregarResultados}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="default" disabled={busy} className="text-xs gap-1.5">
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          {rotulo}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Virar Avanço</DropdownMenuLabel>
        {TIPOS_UM_TOQUE.map((tipo) => (
          <DropdownMenuItem key={tipo} onSelect={() => processar('avanco', { tipo })}>
            {ACTION_KIND_LABEL[tipo]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => processar('resultado', { situacao: 'rascunho' })}>
          Resultado (rascunho)
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Vontade</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => processar('vontade', { contexto: 'vida' })}>
              de Vida
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => processar('vontade', { contexto: 'trabalho' })}>
              de Trabalho
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Responsabilidade</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => processar('responsabilidade', { contexto: 'vida' })}>
              de Vida
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => processar('responsabilidade', { contexto: 'trabalho' })}
            >
              de Trabalho
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Estratégia de…</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {resultados === null && <DropdownMenuItem disabled>Carregando…</DropdownMenuItem>}
            {resultados?.length === 0 && (
              <DropdownMenuItem disabled>Nenhum resultado ativo</DropdownMenuItem>
            )}
            {resultados?.map((r) => (
              <DropdownMenuItem
                key={r.id}
                onSelect={() => processar('estrategia', { resultado_id: r.id })}
              >
                {r.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive"
          onSelect={() => run('descartar_captura', { captura_id: capture.id })}
        >
          Descartar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ProcessCaptureMenu
