// PEGADA — busca global: acha qualquer item dos cinco elementos e da Caixa,
// de qualquer tela. Cada resultado mostra de onde vem (o fio), para a pessoa
// reconhecer o item sem precisar saber em que tela ele mora.
// Abre pela lupa (abrirBusca), por Ctrl+K / ⌘K ou pela tecla "/".
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { op } from '@/lib/pegada/api'
import { actionService } from '@/services/actionService'
import { digitandoEmCampo } from '@/lib/pegada/lugar'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'

const EVENTO = 'pegada:buscar'

export function abrirBusca() {
  window.dispatchEvent(new Event(EVENTO))
}

interface Item {
  id: string
  titulo: string
  /** De onde vem: o degrau de cima, em uma linha. */
  fio: string
  to: string
}
interface Grupos {
  responsabilidades: Item[]
  resultados: Item[]
  estrategias: Item[]
  avancos: Item[]
  capturas: Item[]
}
const VAZIO: Grupos = { responsabilidades: [], resultados: [], estrategias: [], avancos: [], capturas: [] }

interface MapaBusca {
  proposito: string
  responsabilidades: { id: string; titulo: string; contexto: string }[]
  resultados: {
    id: string
    titulo: string
    responsabilidade_id: string | null
    estrategias: { id: string; titulo: string }[]
  }[]
}

async function carregarTudo(): Promise<Grupos> {
  const [mapa, avancos, capturas] = await Promise.all([
    op<MapaBusca>('ver_mapa', {}).then((r) => r.resultado ?? null).catch(() => null),
    actionService.list().catch(() => []),
    op<{ capturas: { id: string; texto: string }[] }>('listar_capturas', { status: 'pendente', limite: 200 })
      .then((r) => r.resultado?.capturas ?? [])
      .catch(() => []),
  ])
  const respPorId = new Map((mapa?.responsabilidades ?? []).map((r) => [r.id, r.titulo]))
  const resultadoPorId = new Map((mapa?.resultados ?? []).map((r) => [r.id, r.titulo]))
  return {
    responsabilidades: (mapa?.responsabilidades ?? []).map((r) => ({
      id: r.id,
      titulo: r.titulo,
      fio: r.contexto === 'vida' ? 'Vida' : 'Trabalho',
      to: `/responsabilidades?id=${encodeURIComponent(r.id)}`,
    })),
    resultados: (mapa?.resultados ?? []).map((r) => ({
      id: r.id,
      titulo: r.titulo,
      fio: (r.responsabilidade_id && respPorId.get(r.responsabilidade_id)) || 'Do seu propósito',
      to: `/resultados?id=${encodeURIComponent(r.id)}`,
    })),
    estrategias: (mapa?.resultados ?? []).flatMap((r) =>
      r.estrategias.map((s) => ({
        id: s.id,
        titulo: s.titulo,
        fio: r.titulo,
        to: `/resultados?id=${encodeURIComponent(r.id)}`,
      })),
    ),
    avancos: avancos
      .filter((a) => a.status !== 'cancelada')
      .map((a) => ({
        id: a.id,
        titulo: a.title,
        fio:
          a.expand?.project_id?.title ||
          (a.project_id && resultadoPorId.get(a.project_id)) ||
          (a.responsibility_id && respPorId.get(a.responsibility_id)) ||
          'Avanço livre',
        to: `/avancos?id=${encodeURIComponent(a.id)}`,
      })),
    capturas: capturas.map((c) => ({ id: c.id, titulo: c.texto, fio: 'Para decidir', to: '/caixa' })),
  }
}

const NOMES: [keyof Grupos, string][] = [
  ['avancos', 'Avanços'],
  ['resultados', 'Resultados'],
  ['estrategias', 'Estratégias'],
  ['responsabilidades', 'Responsabilidades'],
  ['capturas', 'Caixa'],
]

export function BuscaGlobal() {
  const navigate = useNavigate()
  const [aberta, setAberta] = useState(false)
  const [grupos, setGrupos] = useState<Grupos>(VAZIO)
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    const abrir = () => setAberta(true)
    const tecla = (e: KeyboardEvent) => {
      const atalho = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)
      const barra = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey
      if (!atalho && !barra) return
      if (barra && (digitandoEmCampo(e.target) || document.querySelector('[role="dialog"]'))) return
      e.preventDefault()
      setAberta(true)
    }
    window.addEventListener(EVENTO, abrir)
    window.addEventListener('keydown', tecla)
    return () => {
      window.removeEventListener(EVENTO, abrir)
      window.removeEventListener('keydown', tecla)
    }
  }, [])

  // Lê tudo a cada abertura: a busca nunca mostra um retrato velho.
  useEffect(() => {
    if (!aberta) return
    let vivo = true
    setCarregando(true)
    void carregarTudo().then((g) => {
      if (!vivo) return
      setGrupos(g)
      setCarregando(false)
    })
    return () => {
      vivo = false
    }
  }, [aberta])

  const ir = useCallback(
    (to: string) => {
      setAberta(false)
      navigate(to)
    },
    [navigate],
  )

  const total = NOMES.reduce((n, [k]) => n + grupos[k].length, 0)

  return (
    <CommandDialog open={aberta} onOpenChange={setAberta}>
      <DialogTitle className="sr-only">Buscar</DialogTitle>
      <DialogDescription className="sr-only">
        Procure por avanços, resultados, estratégias, responsabilidades e capturas.
      </DialogDescription>
      <CommandInput placeholder="Buscar em tudo" aria-label="Buscar em tudo" className="text-base" />
      <CommandList className="max-h-[60vh]">
        {carregando && total === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <CommandEmpty>Nada encontrado com esse nome.</CommandEmpty>
        )}
        {NOMES.map(([chave, nome]) =>
          grupos[chave].length === 0 ? null : (
            <CommandGroup key={chave} heading={nome}>
              {grupos[chave].map((item) => (
                <CommandItem
                  key={`${chave}-${item.id}`}
                  value={`${item.titulo} ${item.fio} ${chave}-${item.id}`}
                  onSelect={() => ir(item.to)}
                  className="min-h-11 cursor-pointer flex-col items-start gap-0.5"
                >
                  <span className="break-words text-base font-medium text-foreground">{item.titulo}</span>
                  <span className="text-[13px] text-muted-foreground">{item.fio}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ),
        )}
      </CommandList>
    </CommandDialog>
  )
}

export default BuscaGlobal
