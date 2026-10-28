# Ideias e melhorias futuras

Anotadas em 22/10/2026, atualizadas em 28/10/2026. Esta lista guarda pedidos para avaliar
no futuro, sem ordem de prioridade nem prazo de implementação. As dúvidas abaixo ainda
precisam ser investigadas.

## 1. Mais personalização

- Ter uma personalização mais completa, inspirada no BetterDiscord, com temas.
- Permitir mudar o plano de fundo do perfil e do próprio app.
- Os detalhes e as opções ficam para definir quando essa ideia for desenvolvida.

## 2. Bot de música

**Já disponível na 4.0.0**, com músicas e playlists compartilhadas na call.

- Poder criar um bot de música, parecido com os do Discord, para tocar na call para todos.
- Colar um link do YouTube e o bot tocar a música.
- Investigar se isso ainda é viável e quais limitações existem antes de escolher uma solução.

## 3. GIF ampliado no modo leve

**Incluído na versão 3.5.0.** O perfil grande libera a animação no
modo leve e o clique para ampliar também funciona quando o avatar mostra o frame parado.
Conferido no navegador e no Electron; a pausa em segundo plano continua valendo no perfil.

- Possível bug relatado: no modo leve, em que os GIFs só animam quando a pessoa fala,
  o GIF funciona ao abrir o perfil com um clique, mas para de animar ao ampliar a imagem.
- Reproduzir esse caminho e confirmar o comportamento esperado: permitir ver o GIF animado
  ao ampliá-lo, mesmo com o modo leve ligado.

## 4. Ajustar foto de perfil e banner

**Incluído na versão 3.5.0.** Editor com arraste, zoom, posição
horizontal/vertical, centralizar, cancelar e prévia. Permite reajustar imagens já salvas,
preserva GIFs animados e compartilha o enquadramento com os outros clientes.

- Ao escolher uma foto de perfil ou um banner, permitir ajustar o tamanho/zoom e a posição
  da imagem dentro do recorte.
- Mostrar uma prévia para a pessoa acertar o enquadramento antes de salvar.

## 5. Qualidade da conexão no painel de voz

**Incluído na versão 3.5.0.** Ping ao passar o mouse e cores:
verde abaixo de 150 ms, amarelo de 150 a 299 ms e vermelho a partir de 300 ms.
Medição a cada 5 segundos após a resposta anterior, com limite de espera de 4 segundos.
Sem resposta ou reconectando, fica vermelho; servidor antigo sem suporte exibe ping indisponível.

- Usar o painel **Voz conectada**, no canto inferior esquerdo, como indicador da conexão
  da própria pessoa com o servidor, inspirado no Discord e na captura enviada no pedido.
- Possibilidades: mostrar o ping ao passar o mouse sobre o indicador e/ou mudar sua cor
  entre verde, amarelo e vermelho conforme a qualidade da conexão.
- Avaliar como medir a conexão e definir os critérios das cores na implementação.

## 6. Versão para Android

**APK já existente.** Continuar incluindo o Android nas atualizações. Uma mudança maior
na abordagem fica para o futuro, conforme decisão do dono em 28/10/2026.

- Fazer uma versão do Teletela para celular Android.
- Avaliar a abordagem e quais funcionalidades precisam estar disponíveis na primeira versão.

## 7. Mais de um servidor

**Adiado para bem depois**, conforme decisão do dono em 28/10/2026.

- Considerar permitir criar mais de um servidor.
- Ideia ainda em consideração pelo dono, que talvez mantenha o app só para o grupo atual,
  sem distribuir para mais pessoas.
- Deixar o escopo e a decisão de seguir com isso em aberto.

## 8. Atividade de jogos no perfil

**Incluído na versão 3.6.0.** Fotos reais nos cartões da tela inicial;
atividade abaixo do nome, na call, no popup e no perfil, com ícone de controle e tempo desde
a detecção. Catálogo inicial para Windows/Linux (inclui Proton), consulta a cada 15 s,
limpeza ao fechar, opção de desligar e cadastro manual em Configurações → Atividade.
Testes de detecção, relógio e protocolo; conferência no Electron com processos locais.
A detecção nativa no Windows ainda precisa ser conferida em um PC Windows.

- Mostrar o jogo que a pessoa está jogando, inspirado nas atividades do Discord.
- Detectar automaticamente jogos no app desktop e exibir abaixo do nome e no perfil,
  por exemplo: **Jogando Counter-Strike 2 · há 23 min**. Limpar a atividade ao fechar o jogo.
- Começar pelos jogos mais usados pelo grupo, com nome, ícone e tempo desde a detecção.
- Incluir opção para desativar o compartilhamento e considerar cadastro manual de jogos
  não reconhecidos.
- Avaliar a detecção no Windows e no Linux, incluindo launchers e jogos via Proton.
  Identificar o jogo localmente e enviar ao servidor apenas a atividade para os demais.
- Detalhes como mapa, placar e fila ficam para uma etapa posterior, pois dependem de
  integração específica com cada jogo.

## 9. Miniplayer do bot de música durante transmissões

**Implementado para teste** na branch `melhoria/cinema-dados-contas-e-privacidade`,
a pedido do dono em 28/10/2026. Ainda não publicado.

- Quando alguém estiver assistindo a uma transmissão de tela ou câmera no palco principal
  (`#video-stage`), exibir uma pílula flutuante discreta na barra superior ou canto do palco
  com o nome da música atual, mini visualizador de áudio e botões rápidos de Pausar/Continuar (⏸/▶)
  e Pular (⏭).
- Assim dá para ver o que está tocando e pular faixas sem precisar sair da transmissão nem abrir
  o modal completo de música.

## 10. Modo Cinema com faixa de participantes durante transmissões

**Implementado para teste** na branch `melhoria/cinema-dados-contas-e-privacidade`,
a pedido do dono em 28/10/2026. Ainda não publicado.

- Quando uma transmissão estiver aberta no palco (`#video-stage`), mostrar uma tirinha horizontal
  recolhível na parte inferior ou superior com as fotos dos amigos na call (acendendo a borda
  verde quando falam), o indicador do bot de música e os balões de reação de emoji subindo por cima.
- Permite acompanhar quem está falando e reagindo na call mesmo com a barra lateral recolhida ou
  em tela cheia.

## 11. Canais realmente privados, inclusive para o dono

**Implementado para teste** na branch `melhoria/cinema-dados-contas-e-privacidade`,
a pedido do dono em 28/10/2026. Ainda não publicado.

- Respeitar a privacidade independentemente de quem criou o canal e de para quem ele foi criado.
- Ser dono do servidor não deve dar acesso automático a canais privados nem ao chat deles.
  Se a pessoa não quiser liberar o acesso ao dono, ele não deve ver o canal nem ler o chat.
- O dono só acessa quando estiver autorizado pelas regras do canal, como qualquer outro membro.
- Remover a exceção atual de acesso para o dono e garantir a regra no servidor, incluindo
  histórico, mensagens em tempo real, anexos e demais caminhos de acesso ao conteúdo.
- Conferir também as permissões de gerenciamento, para que o cargo de dono não permita
  contornar a privacidade e liberar o próprio acesso.

## 12. Rolar dados no aplicativo

**Implementado para teste** na branch `melhoria/cinema-dados-contas-e-privacidade`,
a pedido do dono em 28/10/2026. Ainda não publicado.

- Adicionar um botão com ícone de dado que abre um seletor, conforme o desenho enviado.
- Mostrar o ícone e a identificação de cada dado nas opções, como d4, d6, d8, d10, d12,
  d20 e d100.
- Abaixo das opções prontas, permitir informar uma rolagem personalizada, por exemplo
  `1d15` (um dado de 15 lados).
- Seletor disponível na call e nos canais de texto, com resultados compartilhados pelo servidor.
- Manter as últimas **30 rolagens do servidor inteiro**, com horário, autor e resultados individuais,
  salvas para conferir durante um RPG, com nome, dado e resultado.
- Um clique no dado pronto rola automaticamente e mostra o total em destaque. Suportar modificadores, como `2d6+3`.

## 13. Trocar os ícones do bot de música e do soundboard

**Implementado para teste** na branch `melhoria/cinema-dados-contas-e-privacidade`,
a pedido do dono em 28/10/2026. Ainda não publicado.

- Trocar entre si os ícones dos dois botões na barra da call, conforme a captura enviada.
- Usar as notas musicais, hoje no soundboard, para o bot de música.
- Usar o fone de ouvido, hoje no bot de música, para o soundboard.
- Preservar os rótulos e as ações de cada botão; a mudança é nos ícones.

## 14. Redesenhar a tela inicial do aplicativo

**Implementado para teste** na branch `melhoria/cinema-dados-contas-e-privacidade`,
a pedido do dono em 28/10/2026. Ainda não publicado.

- Mudar o design da tela de entrada do app, onde aparecem as opções de entrar no servidor
  e criar uma sala local.
- Definir a direção visual quando essa mudança for desenvolvida; ainda não foi escolhido
  um novo layout.

## 15. Conta simples, só com usuário e senha

**Implementado para teste** na branch `melhoria/cinema-dados-contas-e-privacidade`,
a pedido do dono em 28/10/2026. Ainda não publicado.

- Avaliar criar conta usando apenas nome de usuário e senha, sem exigir e-mail, telefone
  ou outros dados de cadastro.
- Facilitar usar o mesmo perfil em outro computador ou no futuro app Android, sem precisar
  exportar e importar o perfil manualmente. Manter a sessão salva para entrar direto.
- Separar o nome de usuário único usado para entrar do apelido exibido aos amigos.
- Definir a recuperação de acesso sem e-mail; uma possibilidade é entregar um código de
  recuperação para a pessoa guardar. Sem a senha nem esse código, pode perder o acesso.
- Preservar a identidade dos perfis atuais, cargos e propriedade do servidor ao vincular
  uma conta. Revisar o trabalho de contas/amigos já guardado na branch de testes antes
  de escolher a implementação.
- Conta **opcional**, com usuário único, senha e código de recuperação; apelido separado.
  Sessão salva, perfil compartilhado entre aparelhos e cargos/propriedade preservados.
  Amigos não fazem parte deste pedido.

## 16. Ajustes após testar cinema, música e chat

**Anotados em 28/10/2026 para fazer mais tarde, quando o limite voltar.**
Lista detalhada e andamento em [PENDENCIAS.md](PENDENCIAS.md#próxima-retomada-ajustes-após-testar-cinema-música-e-chat-28102026).

- Remover o texto com o nome de quem está falando no cabeçalho de Participantes.
- Quando a faixa estiver recolhida, ocultar também o cabeçalho após inatividade e
  reaparecer ao passar/mover o mouse na transmissão.
- Corrigir a camada de Participantes que deixa os emojis atrás e impede clicar nas reações.
- Melhorar o visual do seletor de repetição e da barra de volume no painel de música.
- Permitir limpar os resultados da busca de músicas, por botão ou ao buscar com campo
  vazio, preservando a reprodução e a fila.
- Corrigir a divisória do chat lateral que não permite aumentar/diminuir sua largura.
- Abrir canais de texto na área central, com a transmissão em tamanho reduzido, como no
  Discord. Distinguir esses canais do chat da call; posição e layout ficam para definir.
