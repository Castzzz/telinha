# Pendências para a próxima sessão

## Publicação 4.3.0 autorizada (31/10/2026)

O dono pediu release e deploy das mudanças desta conversa. Preparados desktop 4.3.0 e
Android 4.3.0/código 11, com novidades e assinatura do APK preservada. Inclui amigos,
membros do servidor, tempo por canal, exclusão do Geral, controles em tela cheia e captura
Android. Magic continua separado. Testes funcionais e popup conferidos; backup anterior
íntegro em `~/Teletela-backups/teletela-dados-2026-10-31_14-23-51.tar.gz`.

As menções a desenvolvimento local/sem publicação abaixo registram as etapas anteriores.

Anotado em 26/10/2026, a pedido do dono, para retomar amanhã.
Retomado com o dono; os itens concluídos ficam marcados abaixo.

## Retomada de 31/10/2026: controles, contas/amigos e captura Android

Pedidos acrescentados na mesma conversa, feitos localmente, sem publicação:

- [x] Tempo individual acumulado por canal: pausar o Geral ao ir ao AFK, contar o AFK e
  retomar cada acumulado ao voltar. Mesmo reset diário à meia-noite de Brasília. Contagem
  e arquivo por identidade/canal, sem duplicar aparelhos no mesmo canal; o total antigo
  é preservado, sem inventar em quais canais foi gasto. Testes de troca, AFK automático,
  pausa, persistência, identidade, exclusão, virada e interface desktop/celular passaram.

- [x] Lista de pessoas do servidor na lateral direita: online/offline, fotos disponíveis,
  busca, perfil, recolher e botão no celular. Pessoas fora da call aparecem; aparelhos da
  mesma identidade não duplicam a lista. Não revela canais privados.
- [x] Permitir apagar o Geral com gerenciamento de canais. Exclusão persiste ao reiniciar,
  não volta por links antigos nem pelo cliente e preserva a call se falhar a gravação.
  Recriar Geral explicitamente funciona. Testes de servidor, interface e canais passaram.

Autorizada pelo dono nesta conversa. Desenvolvimento local, sem release/deploy.

- [x] Esconder a barra inferior após 3 s em tela cheia; revelar com mouse/toque/teclado
  e preservar a interação. Conferido em vídeo único, mosaico e alternativa CSS.
- [x] Revisar contas: cadastro, login, recuperação, logout, persistência e sincronização
  entre aparelhos/cargos. Corrigida a restauração do estado local se salvar a sessão falhar.
- [x] Integrar amigos nas contas atuais: pedir, aceitar/recusar, cancelar, remover e
  presença considerando os aparelhos conectados. Listas persistentes, testes de autorização,
  falha de gravação e interface nos três temas e celular passaram.
- [x] Captura nativa Android: tela e áudio de outro app chegaram ao desktop por P2P e
  SFU local, em segundo plano e com mic mutado. Parar a tela preservou o microfone ligado;
  recusar a autorização e aceitar depois de sair não deixaram captura/serviço ativos.

Validação: runner 62/62, regressões 99/99 (incluindo contas/amigos), interface de contas e
controles, regressão móvel e build/lint Android passaram. Conferidos pixels recebidos e
tom de 440 Hz de um segundo app. Servidor e dados de teste temporários; sala oficial intacta.

APK de teste: `dist/Teletela-Android-teste.apk`. Continua com a versão de desenvolvimento
4.2.1/código 10; aumentar apenas ao preparar uma publicação autorizada. Falta conferir o
telefone físico, consumo de bateria e apps reais que permitem/bloqueiam captura.

Os registros de versões e branches abaixo são históricos; o estado desta retomada está
no bloco acima.

## Bot de música: bloqueio do YouTube (29/10/2026)

Retomado na `main`, a pedido do dono. Magic guardado na branch separada, commit `aeebdbb`.

- [x] Confirmar configuração do bot, versão do extrator e saída WARP na Oracle.
- [x] Reproduzir a exigência de confirmar que não é robô, sem tocar nas calls reais.
  Uma faixa falhou direto e com WARP e funcionou neste PC; outra entregou áudio na VM.
- [x] Testar Firefox real/assinatura Firefox, cliente alternativo e PO Tokens. Esses
  caminhos não resolveram a faixa bloqueada pela saída WARP.
- [x] Validar uma ponte pelo PC como teste; o dono descartou a dependência do PC ligado.
  A ponte ficou desativada e o comando auxiliar foi retirado do projeto.
- [x] Testar uma sessão WARP nova na Oracle. Entregou áudio inicialmente; após ativação
  autorizada, voltou a bloquear as duas fontes, inclusive no controle isolado.
- [x] Restaurar a configuração anterior, revogar somente o registro novo e remover os testes.
  Apenas WARP foi reiniciado; servidor da sala e SFU mantiveram seus processos.
- [x] Testar a conta Google separada autenticada pelo dono. As duas fontes entregaram áudio;
  busca retornou cinco resultados. Teste inteiramente na Oracle, após encerrar o túnel do PC.
- [x] Preparar suporte opcional a `MUSIC_COOKIES_BASE64`: segredo no ambiente, arquivos
  temporários privados, limpeza ao encerrar e cache separado por sessão. Validado na VM.
- [x] Aplicar a correção autorizada no servidor e configurar a sessão no `telinha.env`.
  Reiniciado somente Node em 29/10, às 20:46 UTC; saúde pública OK, quatro clientes reconectados.
  Código instalado e ambiente do processo oficial entregaram áudio das duas fontes e cinco
  resultados de busca. SFU/WARP mantiveram os processos. Arquivos e perfil de teste removidos.

Correção ativa na Oracle, sem precisar atualizar o app ou manter o PC ligado. Resultados e limites em
[DIAGNOSTICO-BOT-MUSICA.md](DIAGNOSTICO-BOT-MUSICA.md).

## Publicação da 4.1.0 concluída (28/10/2026)

Autorizada pelo dono para testar com a galera, **sem o Magic**. Reaproveitada a validação
já feita, sem repetir toda a bateria. Código integrado e enviado à `main` em `7f68864`.

- Release pública: https://github.com/Castzzz/telinha/releases/tag/v4.1.0
- Windows: instalador/portátil; Linux: AppImage/tar.gz; manifests do auto-update atualizados.
- Android: APK 4.1.0, `versionCode 8`, assinatura anterior preservada.
- Servidor Oracle atualizado, com Node/Caddy mantidos nas versões já instaladas;
  serviços ativos e saúde HTTP conferida, com arquivos iguais aos locais.
- Backup anterior ao deploy: `~/Teletela-backups/teletela-dados-2026-10-28_19-42-14.tar.gz`.
- Oito arquivos publicados; tamanhos/hashes dos uploads e manifests conferidos.
- Magic permanece somente em `experimento/magic-no-teletela` (`03cc5d2`), fora dos pacotes
  e do servidor publicados.

As menções a “sem release/deploy” abaixo descrevem as etapas anteriores desta sessão.
Agora falta o uso em grupo, incluindo a troca das lentes em celulares físicos.

## Câmera do celular e coroinha (28/10/2026)

Retomada na branch `melhoria/cinema-dados-contas-e-privacidade`, a pedido do dono.

- [x] **Virar a câmera do celular.** Botão **Virar** durante a câmera ligada, também em
  **⋯ → Virar câmera**, alternando frontal/traseira e indicando a lente atual.
  Preserva o microfone, a MediaStream e os espectadores P2P/SFU; trata lente indisponível,
  liberação do hardware, recuperação da anterior e cancelamento ao desligar/sair.
- [x] **Retirar a coroinha ao lado do nome do dono.** Só o selo visual foi removido;
  identificação nos detalhes do perfil e permissões de proprietário permanecem.
- [x] **Deixar o Magic para depois.** Trabalho guardado em `experimento/magic-no-teletela`,
  commit `03cc5d2`. Sem merge nesta branch ou na `main` e sem publicação conjunta.

Testes de lentes simuladas com vídeo recebido por outra pessoa via WebRTC real, em P2P e
SFU local, testes unitários de falha/cancelamento e regressão mobile passaram. Build/lint
do APK local atualizado; falta confirmar as duas lentes num telefone físico. Sem release/deploy.

## Próxima retomada: ajustes após testar cinema, música e chat (28/10/2026)

**Retomados com autorização do dono em 28/10/2026.** Implementados para teste na branch
`melhoria/cinema-dados-contas-e-privacidade`, sem release/deploy. Referências: quatro
capturas enviadas na conversa de 28/10/2026.

- [x] **Tirar o texto com o nome de quem está falando.** O dono não gostou de aparecer
  “Cast falando” / “Neves falando” no cabeçalho de Participantes. Remover essa indicação
  textual; preservar a indicação visual de fala nos avatares.
- [x] **Ocultar automaticamente a faixa recolhida de Participantes.** Quando a pessoa
  recolher a faixa, depois de um tempo sem interação o cabeçalho também deve sumir.
  Reaparecer ao passar/mover o mouse sobre a transmissão. Definir o tempo no ajuste e
  manter uma forma de acessar por teclado e toque. O pedido de ocultação é para a faixa
  recolhida, sem decidir agora que a faixa expandida também deve desaparecer.
- [x] **Corrigir participantes cobrindo as reações.** Relato: a camada de Participantes
  permanece por cima, os emojis ficam atrás e não dá para clicar. Reproduzir com a
  transmissão aberta e verificar sobreposição, camadas e áreas que capturam cliques,
  incluindo faixa recolhida, expandida e tela cheia. O seletor de reações precisa continuar
  visível e clicável.
- [x] **Refinar o visual de Repetir e Seu volume no bot de música.** A segunda captura
  destaca o seletor “Repetir → Desligado” e a barra de volume. O dono ainda não gostou do
  design dessa região; integrar melhor esses controles ao visual do Teletela. O layout
  final fica para a retomada.
- [x] **Permitir limpar os resultados da busca de músicas.** Depois de buscar e adicionar
  uma música, permitir retirar a lista de resultados. Pode ser um botão de limpar ou
  buscar novamente com o campo vazio; o dono aceita esse caminho sem exigir uma opção
  de configuração. Definir o gesto final na implementação e revisar a validação do campo
  vazio. Limpar os resultados deve preservar a música tocando e a fila.
- [x] **Corrigir o redimensionamento do chat lateral.** Na quarta captura, com uma
  transmissão aberta e um canal de texto selecionado, não dá para arrastar a divisória
  para aumentar/diminuir o chat. Reproduzir e corrigir a interação.
- [x] **Canais de texto no centro, com transmissão reduzida.** Ao clicar em um canal de
  texto principal, a conversa deve ocupar a área central, como no Discord, em vez de
  ficar limitada à lateral. Se estiver assistindo a uma transmissão, ela deve continuar
  em tamanho reduzido. Definir posição e layout depois, preservando vídeo e áudio durante
  a troca. Esse pedido de chat central é para os canais de texto, distintos do chat da call.

Resultado desta retomada:
- Cabeçalho sem nomes de quem fala; a borda do avatar mantém a indicação.
- Faixa recolhida some após 3 segundos sem interação; mouse, toque e teclado a revelam.
- Barra de ações acima dos participantes; controles e reações acompanham a tela cheia.
- Repetição por botões e volume com trilha nas cores do tema.
- **Limpar busca** e busca vazia removem resultados, inclusive respostas atrasadas,
  preservando a reprodução e a fila.
- Alça do chat da call ampliada, com arraste por mouse/toque e ajuste pelas setas.
- Canais de texto ocupam o centro, com vídeo contínuo na prévia inferior direita e botão
  **Voltar à transmissão**. No celular a prévia some enquanto o teclado estiver aberto.

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
- [x] **Acertar contas e amigos.** Concluído na retomada de 31/10/2026 acima. Pedido original: levantar os problemas percebidos e revisar cadastro,
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

- [x] Ocultar automaticamente a barra inferior de controles da transmissão em tela cheia
  após alguns segundos sem interação, deixando a imagem livre. Reaparecer ao movimentar
  o mouse; manter os controles acessíveis ao interagir com eles ou pelo teclado.
  Pedido de 30/10/2026, com captura de referência enviada pelo dono.
- [ ] Conferir PiP no aparelho real, inclusive fechar a janela pelo sistema, trocar de
  aplicativo, bloquear a tela e usar fone/Bluetooth. O emulador validou entrada/retorno,
  vídeo avançando, microfone aberto e encerramento da transmissão.
- [ ] Conferir a correção do volume do microfone em aparelhos reais, incluindo Windows
  e Android, e testar fone/Bluetooth, troca de rede, tela bloqueada e bateria.
- [x] Transmitir a tela e o som de outros aplicativos do próprio celular. Implementado
  e validado localmente em 31/10/2026, conforme o bloco da retomada acima. Falta conferir
  aparelhos físicos e publicar quando o dono pedir.
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
