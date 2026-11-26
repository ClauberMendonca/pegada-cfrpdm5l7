/**
 * Prepara a foto do perfil no próprio aparelho: corta em quadrado pelo
 * centro, reduz para 512 px e grava em JPEG. Assim uma foto de celular de
 * vários MB vira um arquivo pequeno, e o limite do servidor (2 MB) deixa de
 * ser um problema de quem usa.
 */
const LADO = 512

async function abrir(arquivo: File): Promise<{ fonte: CanvasImageSource; largura: number; altura: number; fechar: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' })
      return { fonte: bmp, largura: bmp.width, altura: bmp.height, fechar: () => bmp.close() }
    } catch {
      // cai no caminho pelo elemento <img>
    }
  }
  const url = URL.createObjectURL(arquivo)
  try {
    const img = new Image()
    await new Promise<void>((ok, erro) => {
      img.onload = () => ok()
      img.onerror = () => erro(new Error('imagem ilegível'))
      img.src = url
    })
    return { fonte: img, largura: img.naturalWidth, altura: img.naturalHeight, fechar: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

export async function reduzirFoto(arquivo: File): Promise<File> {
  let aberta: Awaited<ReturnType<typeof abrir>>
  try {
    aberta = await abrir(arquivo)
  } catch {
    throw new Error('Não consegui abrir esta imagem. Use uma foto em JPG, PNG ou WebP.')
  }
  try {
    const { fonte, largura, altura } = aberta
    if (!largura || !altura) throw new Error('Não consegui abrir esta imagem. Use uma foto em JPG, PNG ou WebP.')
    const corte = Math.min(largura, altura)
    const lado = Math.min(LADO, corte)
    const tela = document.createElement('canvas')
    tela.width = lado
    tela.height = lado
    const ctx = tela.getContext('2d')
    if (!ctx) throw new Error('Não consegui preparar a foto neste navegador.')
    // Fundo branco: PNG com transparência não vira preto no JPEG.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, lado, lado)
    ctx.drawImage(fonte, (largura - corte) / 2, (altura - corte) / 2, corte, corte, 0, 0, lado, lado)
    const blob = await new Promise<Blob | null>((ok) => tela.toBlob(ok, 'image/jpeg', 0.86))
    if (!blob) throw new Error('Não consegui preparar a foto neste navegador.')
    return new File([blob], 'foto.jpg', { type: 'image/jpeg' })
  } finally {
    aberta.fechar()
  }
}
