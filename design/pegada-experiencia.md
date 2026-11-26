# Sistema de experiência Pegada

O sistema visual (`pegada-tokens.css`) diz como as coisas se parecem. Este documento diz como se comportam e onde ficam. Toda tela nova ou alterada segue o que está aqui.

## Os quatro lugares

| Lugar | Para quê | Endereço |
| --- | --- | --- |
| Hoje | Agir: os três passos da escolha do dia | `/` |
| Mapa | Ver o todo: a escada, do Propósito ao avanço | `/mapa` |
| Caixa | Decidir o que entrou: capturas e propostas de agentes | `/caixa` |
| Revisão | Ajustar o rumo: semanal, trimestral e anual | `/revisao` |

Capturar fica no centro, em todas as telas. O avatar guarda só o que é da conta: Configurações, Histórico e Sair. Toda tela pertence a um dos quatro lugares (`src/lib/pegada/lugar.ts`), e o menu fica sempre aceso.

## O Mapa e as fichas

O Mapa é uma lista só, que abre e fecha (`src/components/mapa/ArvoreDoMapa.tsx`). Do Propósito saem três ramos:

| Ramo | O que mora nele |
| --- | --- |
| Vontades | O que a pessoa quer construir e ninguém cobra se ela largar, com os resultados de cada uma |
| Responsabilidades | O que alguém cobra se ela largar, com os resultados e os avanços (rotinas) que as mantêm de pé |
| Livres | Resultados e avanços que não estão ligados a nada. É legítimo, e aparece sem tom de erro |

O teste que separa as duas: "se eu largar, alguém me cobra?". Sim é Responsabilidade, não é Vontade. Um resultado nasce de uma vontade ou de uma responsabilidade, nunca das duas.

Resultados sem prazo ou guardados para depois ficam recolhidos em "Depois". O que foi concluído ou arquivado fica em "Encerrados", no fim do Mapa.

Toda ficha mora embaixo do Mapa e tem endereço próprio (`src/lib/pegada/enderecos.ts`):

| Ficha | Endereço |
| --- | --- |
| Propósito | `/mapa/proposito` |
| Vontade | `/mapa/vontade/:id` |
| Responsabilidade | `/mapa/responsabilidade/:id` |
| Resultado | `/mapa/resultado/:id` (a estratégia é uma parte dele: `#estrategia-:id`) |
| Avanço | `/mapa/avanco/:id` |

A ficha (`src/components/Ficha.tsx`) tem sempre três zonas, na ordem da escada: "Para quê" em cima, o item no meio e "Como" embaixo. No celular ela ocupa a tela, com a seta de voltar. No computador ela abre ao lado, e o Mapa continua à vista. Os catálogos antigos (`/resultados`, `/responsabilidades`, `/avancos`) não existem mais: os endereços levam ao Mapa ou à ficha do item.

Toda ficha tem a mesma tríade de ícones, na mesma ordem (`src/components/Triade.tsx`): editar, arquivar e excluir. No avanço, arquivar é cancelar. Excluir mostra o que vai junto (tudo o que está embaixo) e manda para a Lixeira (`/lixeira`, no menu da conta). Na Lixeira dá para restaurar, excluir de vez só o que for marcado, ou esvaziar tudo. Só excluir de vez não tem volta.

Criar o que já tem lugar é sempre pelo "Adicionar" embaixo do item (`AdicionarNoLugar.tsx`). O tipo vem do degrau. No Mapa, o ponto ao lado de cada avanço escolhe o dia: laranja quer dizer que está em Hoje.

## As onze regras

1. **Cada coisa mora em um lugar só.** Um item existe no Mapa. Hoje, Caixa e Revisão são vistas dele, nunca cópias.
2. **Para cima é "para quê", para baixo é "como".** Em toda tela, o que explica está acima e o que executa está abaixo.
3. **Todo item mostra o seu fio.** Nenhum avanço aparece sem a frase do porquê ou o convite para ligá-lo.
4. **O caminho padrão custa um toque.** Concluir, escolher para hoje, aceitar uma sugestão.
5. **Uma ação principal por tela.** O laranja aparece em um botão só.
6. **Sempre dá para voltar e desfazer.** A seta de voltar fica no mesmo lugar, e há "Desfazer" depois de cada ação.
7. **O app sugere, a pessoa decide.** Toda sugestão da IA vem com o motivo em uma linha e pode ser dispensada.
8. **Nenhuma tela vazia.** Onde não há nada, há um convite com exemplo e um botão.
9. **Mostrar o mínimo, revelar o resto.** Cada linha mostra título e fio. O resto aparece ao abrir.
10. **Mesma palavra para a mesma coisa.** O glossário vale em botões, títulos, dicas e mensagens.
11. **No dia a dia, o fio. Nas revisões, os números.** Contagens, tempo e parados só aparecem na Revisão.

## As nove peças

| Peça | O que é | Onde aparece |
| --- | --- | --- |
| Linha de item | Círculo de concluir, título e fio em uma linha | Hoje, Mapa, busca, Revisão |
| Ficha | Três zonas: para quê, item, como | Os cinco elementos |
| Trilha do fio | Os degraus acima do item, como links (`Trilha.tsx`) | Topo de toda ficha |
| Adicionar no lugar | Campo que cria o filho do tipo certo | Mapa e fichas |
| Sugestão da IA | Proposta, motivo em uma linha, aceitar ou dispensar | Caixa, desdobrar, correção gentil |
| Folha de escolha | Lista curta que sobe da base da tela | Escolher o dia, mover, ligar |
| Convite | Estado vazio com exemplo e um botão | Qualquer lista sem itens |
| Dica que some | Uma linha de ajuda, vista até três vezes (`Dica.tsx`) | Primeiros usos de cada tela |
| Aviso com desfazer | Confirmação curta no pé da tela | Depois de concluir, mover ou descartar |

## Glossário

| Usar | No lugar de |
| --- | --- |
| Avanço principal | próximo avanço, foco, estrela |
| Hoje | selecionado para hoje, poucos avanços de hoje |
| Esperando | aguardando, bloqueado |
| Depois | futuro, rascunho |
| Caixa | capturas, propostas, decisões para você |
| Mapa | catálogo, lista de resultados |
| Prazo | prazo factual |
| Descartar | descartar logicamente |

Um resultado é só um estado alcançado e um prazo, mais "como vou saber que cheguei". Aspiração, Entrega Controlável, Aprendizado e os Oito Rs saíram do método e das telas.

## O ciclo de cada mudança

| Etapa | No Pegada | O que sai dela |
| --- | --- | --- |
| Entender | Observar uma pessoa usando o app e ouvir onde ela se perde | Lista de pontos de dor |
| Definir | Escrever o trabalho da tela em uma frase | "Quando..., quero..., para..." |
| Idear | Desenhar duas ou três saídas usando só as nove peças | Esboços comparados |
| Prototipar | Publicar na prévia | Protótipo navegável |
| Testar | Cinco pessoas, seis tarefas, sem ajuda | Aprovado ou volta para idear |

## Uma tela só está pronta quando responde sim a seis perguntas

1. Olhando só para ela, dá para dizer onde estou e como voltar?
2. A ação principal é única e óbvia?
3. O caminho padrão custa um toque?
4. Ela usa só as nove peças e as palavras do glossário?
5. O estado vazio convida e o erro explica como sair?
6. Funciona no celular com uma mão e no computador só com o teclado?

## Teclado

| Tecla | O que faz |
| --- | --- |
| C | Capturar |
| / ou Ctrl+K (⌘K) | Buscar em tudo |
| 1, 2, 3, 4 | Hoje, Mapa, Caixa, Revisão |
