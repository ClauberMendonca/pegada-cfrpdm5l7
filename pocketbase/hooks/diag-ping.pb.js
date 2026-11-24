// Hook de diagnóstico TEMPORÁRIO — probe individual de cada caminho de require
// da pegada-core. NADA é persistido; nenhuma coleção é tocada. Remover no fim.
routerAdd('GET', '/backend/v1/diag/require', (e) => {
  var __hooksStr = __hooks
  var paths = [
    __hooksStr + '/pegada-core.pb.js',
    __hooksStr + '/lib/pegada-core.js',
    __hooksStr + '/pegada-core.js',
    __hooksStr + '/pegada-core',
    __hooksStr + '/lib/pegada-core',
  ]
  var out = {}
  for (var i = 0; i < paths.length; i++) {
    try {
      var m = require(paths[i])
      out[paths[i]] = 'OK: ' + (m && m.VERSION ? 'VERSION=' + m.VERSION : typeof m)
    } catch (err) {
      out[paths[i]] = 'ERRO: ' + err
    }
  }
  out.__hooks = __hooksStr
  return e.json(200, out)
})
