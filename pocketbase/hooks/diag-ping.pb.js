// Cron de diagnóstico TEMPORÁRIO — roda a cada minuto e registra no stream
// "hooks" o que o ambiente JSVM oferece, sem depender de HTTP:
//   1. listagem de $os.readDir(pb_hooks)   → quais arquivos existem em disco
//   2. globalThis.__pegadaCore             → se o global do core atravessa arquivos
//   3. globalThis.__diagModMin             → idem, módulo mínimo de 2 linhas
// NADA é persistido; nenhuma coleção é tocada. Remover no fim.
cronAdd('diag_pegada', '* * * * *', () => {
  var out = {}
  try {
    var files = $os.readDir(__hooks)
    var names = []
    for (var i = 0; i < files.length; i++) names.push(files[i].name)
    out.dir = names.join(',')
  } catch (err) {
    out.dir = 'ERRO: ' + err
  }
  try {
    out.global_core = typeof globalThis.__pegadaCore
    if (typeof globalThis.__pegadaCore !== 'undefined')
      out.core_version = globalThis.__pegadaCore.VERSION
  } catch (err) {
    out.global_core = 'ERRO: ' + err
  }
  try {
    out.global_min = typeof globalThis.__diagModMin
  } catch (err) {
    out.global_min = 'ERRO: ' + err
  }
  console.log('DIAG ' + JSON.stringify(out))
})
