import React from 'react'

/**
 * Aviso de privacidade do Pegada, em linguagem direta. Aparece na criação da
 * conta (a pessoa precisa aceitar) e em Configurações (para reler).
 */
export const AvisoPrivacidade: React.FC<{ className?: string }> = ({ className }) => (
  <div className={className}>
    <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
      <li>
        <strong className="font-medium text-foreground">O que guardamos.</strong> O que você escreve no
        Pegada (propósito, vontades, responsabilidades, resultados, estratégias, avanços, capturas e
        tempo), o seu nome, e-mail e foto, e um registro de acessos com data, endereço IP e navegador.
      </li>
      <li>
        <strong className="font-medium text-foreground">Quem vê.</strong> Só você. Outras pessoas só veem
        um resultado se você o compartilhar com elas. Quem administra o servidor do Pegada tem acesso
        técnico ao banco de dados para manter o sistema e fazer cópias de segurança, e se compromete a
        não abrir o conteúdo de ninguém.
      </li>
      <li>
        <strong className="font-medium text-foreground">IA.</strong> Quando você pede uma sugestão, o
        texto do pedido vai para a Anthropic, que fornece a IA. Você pode desligar a IA em Configurações.
      </li>
      <li>
        <strong className="font-medium text-foreground">Como sair.</strong> Você pode baixar os seus
        dados e excluir a conta quando quiser, em Configurações.
      </li>
    </ul>
  </div>
)
