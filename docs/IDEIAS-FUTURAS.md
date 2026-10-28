# Ideias e melhorias futuras

Anotadas em 22/10/2026. Esta lista guarda pedidos para avaliar no futuro, sem ordem de
prioridade nem prazo de implementação. As dúvidas abaixo ainda precisam ser investigadas.

## 1. Mais personalização

- Ter uma personalização mais completa, inspirada no BetterDiscord, com temas.
- Permitir mudar o plano de fundo do perfil e do próprio app.
- Os detalhes e as opções ficam para definir quando essa ideia for desenvolvida.

## 2. Bot de música

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

- Fazer uma versão do Teletela para celular Android.
- Avaliar a abordagem e quais funcionalidades precisam estar disponíveis na primeira versão.

## 7. Mais de um servidor

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

- Quando alguém estiver assistindo a uma transmissão de tela ou câmera no palco principal
  (`#video-stage`), exibir uma pílula flutuante discreta na barra superior ou canto do palco
  com o nome da música atual, mini visualizador de áudio e botões rápidos de Pausar/Continuar (⏸/▶)
  e Pular (⏭).
- Assim dá para ver o que está tocando e pular faixas sem precisar sair da transmissão nem abrir
  o modal completo de música.

## 10. Modo Cinema com faixa de participantes durante transmissões

- Quando uma transmissão estiver aberta no palco (`#video-stage`), mostrar uma tirinha horizontal
  recolhível na parte inferior ou superior com as fotos dos amigos na call (acendendo a borda
  verde quando falam), o indicador do bot de música e os balões de reação de emoji subindo por cima.
- Permite acompanhar quem está falando e reagindo na call mesmo com a barra lateral recolhida ou
  em tela cheia.
