// PEGADA — 0002 NEUTRALIZADA.
//
// A versão original criava o dono com e-mail real e SENHA FIXA no código e
// semeava dados de exemplo do modelo antigo. Isso (1) expunha uma credencial
// no repositório e (2) impedia montar uma base nova do zero, porque o seed
// disparava a numeração antes de a tabela de contadores existir (0009).
//
// Em bases onde a 0002 já rodou, o PocketBase não a executa de novo: trocar o
// conteúdo não altera nenhum dado. Em base nova, ela agora não faz nada.
// O dono é criado pelo painel (superusuário) — nunca com senha no código.
migrate(
  () => {},
  () => {},
)
