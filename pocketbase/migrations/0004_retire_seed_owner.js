// FATIA 1 (P1A) — Limpeza residual de credencial no código-fonte.
//
// A migration 0002 (seed com senha fixa e dados de exemplo) já foi aplicada e
// NÃO é reeditada aqui (histórico preservado). Esta migration é um NO-OP
// intencional contra o banco: ela existe apenas para (1) deixar explícito no
// histórico de migrations que o seed de 0002 está DESCONTINUADO — nada dele
// deve voltar a rodar em uma nova instância — e (2) registrar que o
// provisionamento do dono, quando necessário, deve ser nativo e seguro
// (criação manual por superusuário no painel admin), nunca com senha no
// código.
//
// Restrições respeitadas: nenhum dado é criado, alterado ou apagado; nenhuma
// regra de acesso é tocada (regras P0 de 0003 permanecem); nenhuma conta,
// e-mail, tokenKey, senha ou sessão existente é modificada.
migrate(
  (app) => {
    // no-op deliberado: provisionamento do dono é feito nativamente no painel
    // admin (superusuário) e não por seed de senha embutida no código.
    void app
  },
  (app) => {
    // no-op deliberado (rollback igualmente inerte; nada a desfazer).
    void app
  },
)
