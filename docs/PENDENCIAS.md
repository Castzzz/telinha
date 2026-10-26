# Pendências para a próxima sessão

Anotado em 26/10/2026, a pedido do dono, para retomar amanhã.
Retomado com o dono; os itens concluídos ficam marcados abaixo.

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
  aceitar/recusar/remover e indicação de presença. A implementação experimental já existe
  nesta branch; precisa ser revisada junto com a compatibilidade do servidor da sala.
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
A revisão de contas/amigos segue pendente. Não houve release desktop nem deploy da VM.

Sugestão de sequência original: acertar a identidade das contas, definir cargos/permissões e então
aplicar a visibilidade dos canais. O PiP pode ser trabalhado separadamente no Android.

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
- Há alterações locais ainda sem commit; preservá-las ao retomar. Os sons privados
  continuam fora do Git, conforme `AGENTS.md`.
- Release desktop e deploy da VM continuam dependendo de pedido explícito do dono.
