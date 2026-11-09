# Ideias futuras

Atualizado em 09/11/2026. Lista para editar com o dono, sem prazo ou compromisso de implementar.
Trabalho em andamento fica em [PENDENCIAS.md](PENDENCIAS.md).

- **Personalização mais ampla:** avaliar temas e plano de fundo do app/perfil além das
  opções atuais. Parte da personalização já saiu na 4.2.0; falta definir o que ainda faz falta.
- **Vários servidores (anotado em 09/11/2026, para depois):** no máximo mais dois servidores,
  para outros grupos de amigos, com até oito pessoas cada e limite configurável para menos.
  A pessoa começaria sem nenhum servidor adicionado. A entrada teria **Criar servidor**
  (somente para quem puder) e **Adicionar servidor**, informando ID e senha. Não implementar
  nesta etapa; depois definir isolamento de dados/cargos, permissão de criação, limite de
  membros/conexões e capacidade de voz/transmissão na VM.
- **Detalhes dos jogos:** mapa, placar e fila exigem integrações específicas. A detecção
  atual foi confirmada pelo dono em 08/11/2026 para quase todos os jogos do grupo no Windows/Linux.
- **Mudança maior no Android:** avaliar apenas quando houver necessidade; o APK atual
  continua acompanhando as atualizações, com testes físicos pendentes.

Modo invisível e atividades como “estudando” estão no protótipo de 09/11/2026; acompanhar em
[Pendências](PENDENCIAS.md), sem tratá-los como recursos já publicados.

Bot de música, GIF ampliado, recorte de perfil/banner, ping, atividade de jogos, miniplayer,
modo cinema, privacidade dos canais, dados de RPG, ícones, launcher, contas opcionais e os
ajustes de cinema/chat já entraram nas versões 3.5–4.2. Os pedidos originais continuam no
[histórico de ideias](historico/IDEIAS-FUTURAS.md).

- **Comandos e mensagens privadas no chat (implementado no protótipo de 09/11/2026, branch `prototipo/comandos-chat-e-fotos-amigos`):**
  `/t <segundos> <mensagem>` (1 a 600 s = até 10 min) envia uma mensagem temporária com
  contagem regressiva, removida automaticamente ao expirar e sem gravação em disco.
  `/w @pessoa ... <mensagem>` ou `/whisper @pessoa ... <mensagem>` envia mensagem privada
  visível apenas ao remetente e aos destinatários marcados, sem vazar no histórico em disco,
  busca, contexto, mensagens fixadas, citações públicas de resposta ou texto de notificação.
- **Fotos dos amigos na tela inicial (implementado no protótipo de 09/11/2026, branch `prototipo/comandos-chat-e-fotos-amigos`):**
  fotos de perfil dos amigos (incluindo WebP e GIF) aparecem na tela inicial (`connect.html`)
  e na aba Amigos das configurações (`/api/launcher/friend-avatar/:accountId` e
  `/api/friend-avatar/:accountId`), resolvendo a imagem pelo socket ativo, pelo perfil da
  conta ou pelo `MemberAvatarStore` em disco sem perder a foto ao entrar em call.
