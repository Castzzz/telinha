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
