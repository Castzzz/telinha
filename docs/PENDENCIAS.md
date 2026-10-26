# Pendências para a próxima sessão

Anotado em 26/10/2026, a pedido do dono, para retomar amanhã.
Retomado com o dono; os itens concluídos ficam marcados abaixo.

## Próxima sessão: pedidos acrescentados após a 3.7.0

Anotados em 26/10/2026. O dono pediu **somente registrar, sem implementar agora**, pois
vai esperar o limite de uso resetar. Estes itens têm prioridade na próxima retomada:

- [ ] **Corrigir cargos que somem após atualizar o app.** Relato do dono: a pessoa
  atualiza e perde o cargo. Investigar antes de atribuir uma causa. A implementação já
  tem identificação assinada por instalação (`permissionToken` nas preferências e
  vínculos em `permissions.json` no servidor), mas a atualização deveria preservá-la.
  Conferir instalação/atualização real, caminhos dos dados, criação/troca/importação de
  perfil e eventual emissão de outra identificação. Não contornar criando um novo ID
  a cada atualização e exigindo redistribuir os cargos.
- [ ] **Identidade fixa para cada perfil, sem exigir conta se possível.** O dono quer
  um ID que permaneça ao atualizar o app. Avaliar a ligação entre o ID do perfil local
  e a identificação usada pelos cargos, com migração que preserve os vínculos atuais.
  Conta não é obrigatória para uma identidade persistente no aparelho; preservar também
  a credencial que comprova a identidade, pois um UUID público informado pelo cliente
  sozinho não deve conceder cargos. Diferenciar atualização normal de apagar dados ou
  mudar de aparelho. Contas/amigos continuam podendo ficar para depois.
- [ ] **Configuração própria para cada chat/canal, como no Discord.** Incluir canais
  privados e públicos, com entrada clara para abrir suas configurações e administrar
  acesso/permissões por cargo ou pessoa. Na retomada, alinhar quais opções pertencem
  ao canal de texto, canal de voz e chat da call; o pedido não se limita aos invisíveis.
- [ ] **Dono do servidor separado dos cargos.** O proprietário da sala deve ser o dono
  do projeto (quem fez este pedido), com identidade persistente e poderes de propriedade
  nas configurações gerais do servidor. Substituir o modelo atual de “admin pela senha”
  por essa distinção: poderes de moderação/administração comuns passam a ser definidos
  pelos cargos. Planejar a migração da senha atual para a propriedade sem perder acesso
  à sala nem permitir que alguém se declare dono pelo cliente. Definir recuperação e
  eventual transferência de propriedade ao desenhar o fluxo.
- [ ] **Cargos no perfil ao clicar na pessoa.** Tirar os cargos do lado do nome por
  padrão; mostrá-los no perfil/popover aberto ao clicar na pessoa. Oferecer opção para
  a própria pessoa exibir o cargo junto ao nome, se quiser. Definir a escolha quando há
  vários cargos. Essa preferência muda a apresentação, preservando as permissões.

Ordem sugerida: reproduzir a perda da identidade/cargos → persistência e migração →
propriedade do servidor e poderes dos cargos → configurações por canal → exibição dos
cargos. Validar a atualização por cima da versão instalada, além de reinício e reconexão.
Nenhuma dessas mudanças foi implementada ao fazer esta anotação.

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

- Branch atual: `correcao/volume-microfone`; código do reforço no commit `059e36a`.
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
