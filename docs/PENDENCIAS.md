# Pendências para a próxima sessão

Anotado em 26/10/2026, a pedido do dono, para retomar amanhã.
Retomado com o dono; os itens concluídos ficam marcados abaixo.

## Próxima retomada: ajustes após testar cinema, música e chat (28/10/2026)

**Só anotar por enquanto**, a pedido do dono, para implementar quando o limite voltar.
Continuar na branch `melhoria/cinema-dados-contas-e-privacidade`. Estes itens ainda não
foram implementados. Referências: quatro capturas enviadas na conversa de 28/10/2026.

- [ ] **Tirar o texto com o nome de quem está falando.** O dono não gostou de aparecer
  “Cast falando” / “Neves falando” no cabeçalho de Participantes. Remover essa indicação
  textual; preservar a indicação visual de fala nos avatares.
- [ ] **Ocultar automaticamente a faixa recolhida de Participantes.** Quando a pessoa
  recolher a faixa, depois de um tempo sem interação o cabeçalho também deve sumir.
  Reaparecer ao passar/mover o mouse sobre a transmissão. Definir o tempo no ajuste e
  manter uma forma de acessar por teclado e toque. O pedido de ocultação é para a faixa
  recolhida, sem decidir agora que a faixa expandida também deve desaparecer.
- [ ] **Corrigir participantes cobrindo as reações.** Relato: a camada de Participantes
  permanece por cima, os emojis ficam atrás e não dá para clicar. Reproduzir com a
  transmissão aberta e verificar sobreposição, camadas e áreas que capturam cliques,
  incluindo faixa recolhida, expandida e tela cheia. O seletor de reações precisa continuar
  visível e clicável.
- [ ] **Refinar o visual de Repetir e Seu volume no bot de música.** A segunda captura
  destaca o seletor “Repetir → Desligado” e a barra de volume. O dono ainda não gostou do
  design dessa região; integrar melhor esses controles ao visual do Teletela. O layout
  final fica para a retomada.
- [ ] **Permitir limpar os resultados da busca de músicas.** Depois de buscar e adicionar
  uma música, permitir retirar a lista de resultados. Pode ser um botão de limpar ou
  buscar novamente com o campo vazio; o dono aceita esse caminho sem exigir uma opção
  de configuração. Definir o gesto final na implementação e revisar a validação do campo
  vazio. Limpar os resultados deve preservar a música tocando e a fila.
- [ ] **Corrigir o redimensionamento do chat lateral.** Na quarta captura, com uma
  transmissão aberta e um canal de texto selecionado, não dá para arrastar a divisória
  para aumentar/diminuir o chat. Reproduzir e corrigir a interação.
- [ ] **Canais de texto no centro, com transmissão reduzida.** Ao clicar em um canal de
  texto principal, a conversa deve ocupar a área central, como no Discord, em vez de
  ficar limitada à lateral. Se estiver assistindo a uma transmissão, ela deve continuar
  em tamanho reduzido. Definir posição e layout depois, preservando vídeo e áudio durante
  a troca. Esse pedido de chat central é para os canais de texto, distintos do chat da call.

## Trabalho de 28/10/2026

Branch `melhoria/cinema-dados-contas-e-privacidade`, separada da `main`:
miniplayer de música, faixa de participantes no modo cinema, privacidade inclusive para o dono,
dados de RPG com últimas 30 rolagens do servidor inteiro, troca dos ícones, launcher e conta opcional
com usuário/senha/código de recuperação. Conta preserva perfil/cargos e funciona entre
PC e APK. Amigos continuam pendentes; vários servidores ficam para bem depois.
O bot e o APK já existem na 4.0.0. Manter o Android nas próximas atualizações; reformulação
maior dele fica para o futuro. Código e APK de teste locais; publicação depende do pedido do dono.

## Próxima sessão: pedidos acrescentados após a 3.7.0

Anotados em 26/10/2026 e retomados depois do reset, com autorização do dono.
Implementados na branch `melhoria/perfis-cargos-e-canais` e publicados na 3.8.0:

- [x] **Corrigir cargos que somem após atualizar o app.** Relato do dono: a pessoa
  atualiza e perde o cargo. Investigar antes de atribuir uma causa. A implementação já
  tem identificação assinada por instalação (`permissionToken` nas preferências e
  vínculos em `permissions.json` no servidor), mas a atualização deveria preservá-la.
  Conferir instalação/atualização real, caminhos dos dados, criação/troca/importação de
  perfil e eventual emissão de outra identificação. Não contornar criando um novo ID
  a cada atualização e exigindo redistribuir os cargos.
- [x] **Identidade fixa para cada perfil, sem exigir conta se possível.** O dono quer
  um ID que permaneça ao atualizar o app. Avaliar a ligação entre o ID do perfil local
  e a identificação usada pelos cargos, com migração que preserve os vínculos atuais.
  Conta não é obrigatória para uma identidade persistente no aparelho; preservar também
  a credencial que comprova a identidade, pois um UUID público informado pelo cliente
  sozinho não deve conceder cargos. Diferenciar atualização normal de apagar dados ou
  mudar de aparelho. Contas/amigos continuam podendo ficar para depois.
- [x] **Configuração própria para cada chat/canal, como no Discord.** Incluir canais
  privados e públicos, com entrada clara para abrir suas configurações e administrar
  acesso/permissões por cargo ou pessoa. Na retomada, alinhar quais opções pertencem
  ao canal de texto, canal de voz e chat da call; o pedido não se limita aos invisíveis.
- [x] **Dono do servidor separado dos cargos.** O proprietário da sala deve ser o dono
  do projeto (quem fez este pedido), com identidade persistente e poderes de propriedade
  nas configurações gerais do servidor. Substituir o modelo atual de “admin pela senha”
  por essa distinção: poderes de moderação/administração comuns passam a ser definidos
  pelos cargos. Planejar a migração da senha atual para a propriedade sem perder acesso
  à sala nem permitir que alguém se declare dono pelo cliente. Definir recuperação e
  eventual transferência de propriedade ao desenhar o fluxo.
- [x] **Cargos no perfil ao clicar na pessoa.** Tirar os cargos do lado do nome por
  padrão; mostrá-los no perfil/popover aberto ao clicar na pessoa. Oferecer opção para
  a própria pessoa exibir o cargo junto ao nome, se quiser. Definir a escolha quando há
  vários cargos. Essa preferência muda a apresentação, preservando as permissões.

Resultado da retomada:

- Preferências desktop com gravação atômica, cópia independente da identidade e migração
  da credencial 3.7 para a mesma identificação de membro. Chave Ed25519 persistente por
  perfil, provada por assinatura; ID público sozinho não recupera cargos.
- Propriedade persistente e única. Uma chave exclusiva de propriedade é usada; depois os poderes
  comuns são delegados pelos cargos. Recuperação explícita com a chave do servidor e
  transferência pelo dono disponíveis. A sala oficial já teve o dono vinculado por sua credencial comprovada.
- Botão de configurações em cada canal de voz/texto: nome, descrição, acesso por pessoa
  ou cargo, escrita do chat e senha da call. Texto privado protege eventos, histórico,
  fixadas e downloads de imagens/anexos. Revogação retira acesso imediatamente.
- Cargos no popover e perfil; ocultos ao lado do nome por padrão. Cada pessoa pode escolher
  um cargo para exibir no próprio perfil. Contas e amigos continuam para outra branch.
- Exportação de perfil v2 inclui a chave privada para recuperar cargos em outro aparelho;
  backups antigos só com ID público não têm essa capacidade.
- Testes de servidor, persistência e interface desktop/celular passaram. O Electron real
  executou o código da 3.7.0 e o novo sobre os mesmos dados isolados, preservando ID, cargo
  e propriedade; testou nova URL e recuperação após prefs ilegível. A causa exata do relato
  original não foi reproduzida numa atualização normal. Falta conferir o instalador/atualizador
  no Windows real e o aparelho Android; nenhuma alteração nos dados reais dos amigos.
- A correção do microfone foi preservada nesta branch. Release/deploy 3.8.0 foram autorizados e concluídos ao final da retomada.

## Pedidos do dono

- [x] **Lembrar o estado do microfone ao reabrir.** Pedido acrescentado na retomada:
  guardar a escolha de mutado/desmutado nas preferências, restaurar o botão ao abrir e
  abrir a captura ao entrar na call com o mic ligado. Primeira abertura começa mutada.
- [x] **PiP automático no celular.** O vídeo remoto continua numa janela do Android ao
  minimizar, usando o mesmo áudio e respeitando mute/volume. Voltar restaura a interface;
  parar a transmissão retira o PiP sem desligar o microfone. Validado no emulador com
  transmissão real por WebRTC e testes de seleção/troca/saída na interface.
- [ ] **Acertar contas e amigos.** Levantar os problemas percebidos e revisar cadastro,
  login/logout, sessão após reabrir o app, perfil entre PC e celular, pedidos de amizade,
  aceitar/recusar/remover e indicação de presença. A implementação experimental está na
  branch `teste/contas-amigos-e-canais-com-senha`; precisa ser revisada junto com a
  compatibilidade do servidor da sala e não é requisito para os pedidos acima.
- [x] **Cargos e permissões de administração sem conta.** Só quem usa a senha de admin
  cria/edita/atribui cargos. Permissões separadas para tirar/mover da call, mutar,
  ensurdecer e gerenciar canais. Hierarquia de 1 a 99; moderadores só agem abaixo deles.
  A identificação assinada fica salva por instalação, independente do nome e da conta.
- [x] **Canais de voz invisíveis por pessoa ou cargo.** Regras por pessoa OU cargo no
  servidor, incluindo listagem, eventos de participantes, entrada, sinalização e SFU.
  A senha do canal continua obrigatória, inclusive para admin; Geral fica público.
  Perder acesso durante a call retira a pessoa e revoga os tokens/conexões do SFU.

Implementação atual: PiP nativo no Android, cargos atribuídos por instalação e regras de
visibilidade por pessoa/cargo. Testados em servidor local, interface Electron e emulador.
Só quem usa a senha de admin define/atribui cargos; moderadores agem abaixo de sua hierarquia.
A revisão de contas/amigos segue pendente. Servidor oficial atualizado para 3.7.0, com backup anterior em
`~/Teletela-backups/teletela-dados-2026-10-26_11-38-47.tar.gz`. Instaladores Windows/Linux
e APK publicados em [v3.7.0](https://github.com/Castzzz/telinha/releases/tag/v3.7.0),
com atualização automática desktop conferida. Contas e amigos não entraram no lançamento.

Sugestão de sequência original: acertar a identidade das contas, definir cargos/permissões e então
aplicar a visibilidade dos canais. O PiP pode ser trabalhado separadamente no Android.

## Retomada do volume após a 3.7.0

- O dono confirmou voz baixa também com IA desligada.
- Branch `correcao/volume-microfone`: reforço nativo em todos os filtros e mono explícito.
- Referência sem IA: aproximadamente −38,9 dBFS na 3.7.0 e −26,1 dBFS com reforço,
  preservados por Opus e pelo mixer em 100%. Controles e filtros passaram nos testes.
- Portátil de teste Windows em `dist/microfone-teste/Teletela-Portatil.exe`, sem publicar.
  Falta ouvir com os dispositivos reais e decidir a próxima publicação. A sala oficial
  e a versão 3.7.0 não foram modificadas por esta retomada.

## Ajustes pedidos durante a revisão

- [x] Hover do ping simples no estilo do app: cartão próprio, valor em destaque, qualidade
  por cor e foco pelo teclado. Sem mudar a medição ou exigir deploy para o visual.
- [x] Configurações de canal na ponta direita da linha, aparecendo no hover/foco ou
  enquanto estiver naquele canal. Ajustado em voz e texto.
- [x] Investigar teclas com IA, inclusive durante a fala. IA forte passou para GTCRN,
  IA anterior mantida como opção leve. Modelos inicializam com confirmação e fallback.
  Comparação de voz + teclas melhorou sem baixar a voz junto; números e limites em
  [DIAGNOSTICO-MICROFONES.md](DIAGNOSTICO-MICROFONES.md). Nenhuma gravação privada usada.
- [ ] Ouvir o novo filtro com o teclado/microfone reais do dono e validar CPU/bateria no
  Android real. Os testes locais não substituem essa escuta.

## Outras pendências da conversa

Estas são lembranças para avaliar com o dono, sem compromisso de fazer todas amanhã:

- [ ] Conferir PiP no aparelho real, inclusive fechar a janela pelo sistema, trocar de
  aplicativo, bloquear a tela e usar fone/Bluetooth. O emulador validou entrada/retorno,
  vídeo avançando, microfone aberto e encerramento da transmissão.
- [ ] Conferir a correção do volume do microfone em aparelhos reais, incluindo Windows
  e Android, e testar fone/Bluetooth, troca de rede, tela bloqueada e bateria.
- [ ] Transmitir a tela e o som de outros aplicativos do próprio celular. A primeira
  versão Android já recebe as transmissões do PC; a captura do celular segue pendente.
- [ ] Definir a distribuição e atualização dos APKs. Hoje a instalação/atualização é
  manual e usa uma assinatura de teste; preservar a assinatura ao atualizar o app.

## Onde o trabalho ficou

- Branch atual: `melhoria/perfis-cargos-e-canais`, criada de `correcao/volume-microfone`.
  Reforço preservado no commit `059e36a`; revisão de identidade/cargos/canais nesta retomada.
  O portátil de teste está pronto, mas a correção ainda não foi publicada. Aguardar
  a validação dos microfones reais e o pedido do dono antes de outra publicação.
- Branch de lançamento: `release/3.7-sem-contas`, baseada na `main` 3.6.2.
- Contas/amigos e reforço de microfone preservados em
  `teste/contas-amigos-e-canais-com-senha`, commit `08b262e`. Não entram na 3.7.0.
- Android com PiP e cargos: `3.7.0`, `versionCode 4`.
- APK local: `dist/Teletela-Android-teste.apk`.
- Contas/amigos: `account-store.js`, `public/accounts.js` e seus testes na branch preservada.
- Android e navegação móvel: [ANDROID.md](ANDROID.md), `android/`, `public/mobile.js`
  e `public/mobile.css`.
- Experimento de reforço de voz: diagnóstico e código permanecem na branch de testes.
  A versão publicada mantém o processamento estável da 3.6.2.
- O código da 3.7.0 está na `main`; a branch de testes também foi enviada ao GitHub.
  Os sons privados continuam no disco e fora do Git, conforme `AGENTS.md`.
- Release desktop e deploy 3.7.0 foram autorizados pelo dono nesta retomada e concluídos.
  Publicações seguintes continuam dependendo de pedido explícito.


## Publicação 3.8.0 autorizada nesta retomada

O dono autorizou deploy e release após corrigir um amigo aparecendo como proprietário
na sala oficial. Confirmado: servidor ainda em 3.7.0, sem `ownerId`; o cliente novo havia
interpretado o campo legado `permissions-state.owner` (admin por senha) como propriedade.

Correção: protocolo `ownershipVersion: 2`, `isOwner` explícito, admin antigo identificado
como tal e nenhuma reivindicação automática por senha salva. A antiga `ADMIN_KEY` não
concede propriedade: `OWNER_KEY` independente fica só na VM. O deploy usa uma credencial
HMAC verificada do perfil do dono para vinculá-lo, preservando cargos/canais. A regressão
foi reproduzida contra o servidor 3.7 real e passou após a correção.

Versões preparadas: desktop 3.8.0 e Android 3.8.0/versionCode 5. Backup anterior íntegro:
`~/Teletela-backups/teletela-dados-2026-10-26_17-23-58.tar.gz`. Publicação concluída: [v3.8.0](https://github.com/Castzzz/telinha/releases/tag/v3.8.0).
Oito arquivos verificados por tamanho/SHA256, atualização automática Windows/Linux
conferida por SHA512 e APK com a assinatura anterior preservada. Node/SFU ativos,
propriedade confirmada e cargos preservados. Novo backup após a migração:
`~/Teletela-backups/teletela-dados-2026-10-26_17-37-35.tar.gz`.
Código publicado em `main`, commit de release `364043e`. Os sons privados continuam
fora do Git. Seguem pendentes os testes de escuta e aparelhos físicos.
