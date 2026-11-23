// PEGADA — pedido do rastro (regra do rastro).
// Estudo, Reflexão e Ideia só se concluem com conclusão, decisão ou destino.
// Os serviços chamam pedirRastro(); o <RastroPromptHost/> (montado no Layout)
// abre o diálogo e devolve o texto, ou null se a pessoa cancelar.

export type TipoComRastro = 'estudo' | 'reflexao' | 'ideia'

export interface PedidoRastro {
  tipo: TipoComRastro
  titulo: string
  resolve: (texto: string | null) => void
}

type Listener = (p: PedidoRastro) => void
let listener: Listener | null = null

export function onPedidoRastro(fn: Listener): () => void {
  listener = fn
  return () => {
    if (listener === fn) listener = null
  }
}

export function pedirRastro(tipo: TipoComRastro, titulo: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!listener) {
      const texto = window.prompt(`${PERGUNTA[tipo]}\n\n${titulo}`)
      resolve(texto && texto.trim() ? texto.trim() : null)
      return
    }
    listener({ tipo, titulo, resolve })
  })
}

export const PERGUNTA: Record<TipoComRastro, string> = {
  estudo: 'Qual é a conclusão deste estudo?',
  reflexao: 'Qual decisão você tomou?',
  ideia: 'Qual foi o destino da ideia? Virou outro avanço ou foi descartada?',
}
