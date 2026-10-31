# Android: versão de teste

O APK reaproveita `public/`, Socket.IO, WebRTC, RNNoise e o SFU existentes. O projeto nativo
fica em `android/` e usa Java + WebView, sem trocar o aplicativo desktop de Electron.
Não há cliente para iPhone nesta implementação.

A reformulação maior do Android fica para o futuro; continuar empacotando as melhorias
de `public/` no APK a cada lançamento, mantendo o ID e a assinatura.

Registro dos pedidos e do que já foi concluído: [PENDENCIAS.md](PENDENCIAS.md).

## O que funciona

- Canais de voz e texto, perfil local, chat, cargos e canais com senha ou invisíveis.
  Conta opcional com usuário/senha e o mesmo perfil do desktop. Acesso em **Você → Conta**.
  Amigos em **Você → Amigos** desde a 4.3.0: pedidos, aceitar/recusar, cancelar,
  remover e presença entre aparelhos. O servidor oficial já tem o suporte novo.
  Dados de RPG e os controles do palco usam a mesma interface.
- Microfone com o filtro e o ganho manual do desktop, mute, ensurdecer e câmera frontal/traseira.
  Com a câmera ligada, **Virar** nos controles da call ou **⋯ → Virar câmera** alterna a lente.
  O nome do botão de câmera indica **Frontal** ou **Traseira**; a troca não altera o microfone.
- Assistir às transmissões dos computadores. Abrir uma transmissão leva à aba Sala.
- Desde a 4.3.0, botão **Membros** no topo abre pessoas online/offline do
  servidor, com busca e perfil. Voltar fecha o painel.
- Contador individual por canal desde a 4.3.0: ao ir para AFK, o acumulado
  da outra call pausa; voltar o retoma. Zera à meia-noite de Brasília. Exige o servidor
  atualizado; em servidor anterior continua mostrando o total único da versão publicada.
- PiP automático: enquanto recebe vídeo de um amigo, Início/trocar de app mantém a imagem
  numa janela do Android. Voltar restaura a interface. Usa o mesmo vídeo/mixer; não muda
  mute, volume ou microfone. Precisa de suporte e autorização de PiP no sistema.
- Navegação própria por toque: Canais e Você. A call tem uma tela com controles
  grandes e uma faixa compacta ao minimizar; o chat usa a tela inteira. Configurações
  abrem por assunto, e as ações de mensagem ficam numa folha embaixo, sem a barra do PC.
  Retrato/paisagem e campo de chat adaptado ao teclado continuam disponíveis.
- Serviço de chamada com notificação, ação de sair e escolha da saída de áudio. O estado
  da call chega pela ponte `TeletelaAndroid`; o áudio continua sendo transportado por WebRTC.

## Limites

O APK 4.3.0 inclui captura nativa da tela e do som de outros apps. Cada início pede
consentimento pelo `MediaProjection`; não reaproveita autorização antiga. Áudio interno
requer Android 10+ e `RECORD_AUDIO`. Android 8/9 transmite só imagem. Apps com proteção de
conteúdo ou política que proíbe captura podem ficar sem imagem/áudio. Não há garantia de
capturar áudio de conversas de outros apps. O próprio Teletela é excluído do áudio capturado.
Publicada na 4.3.0; os testes em telefone físico continuam necessários.

O APK abre a sala oficial. Não hospeda um servidor local, não detecta jogos de outros apps
e não implementa os atalhos globais do PC. Também não tem atualização automática ou
publicação em loja. Captura de câmera em segundo plano não é prometida.
O serviço melhora a continuidade da voz, mas fabricantes, economia de bateria e mudanças
de rede precisam ser testados nos aparelhos reais.

## Compilar e instalar

Precisa de JDK 17+ e Android SDK com a plataforma 35. O Gradle Wrapper 8.9 está no
repositório, com checksum da distribuição; o Android Gradle Plugin é 8.7.3. A combinação
é compatível com SDK 35 e dispensa trocar as ferramentas do desktop.

O APK da 4.3.1 usa `versionCode 12` / `4.3.1`, com o mesmo ID e a mesma assinatura
do primeiro APK, permitindo instalar por cima e manter o perfil.

```bash
npm run build:android
```

O script procura `ANDROID_HOME`, `ANDROID_SDK_ROOT` ou `~/Android/Sdk`; para o Java usa
`JAVA_HOME`, o Java do PATH ou o JBR do Android Studio. Também roda `lintDebug`. Copia
`public/`, inclusive os sons privados disponíveis localmente, para os assets gerados e
reaproveita o ícone existente. Não executa release, deploy nem publica nada.

Saída: `dist/Teletela-Android-teste.apk`. Android mínimo: 8 (API 26). A interface e o filtro
dependem de uma versão atual do Android System WebView.

O APK é de desenvolvimento, assinado com a chave de debug local do Android. Para futuras
atualizações, preserve a assinatura; antes de distribuição definitiva, configure uma chave
de produção fora do Git. O identificador Android é `com.castzin.teletela.mobile`, separado
do `appId` desktop. APKs, builds, configurações locais e chaves não vão para o repositório.

## Arquitetura e permissões

`MainActivity` serve os assets por HTTPS local com `WebViewAssetLoader`, evitando `file://`.
Links externos abrem no navegador. A permissão WebRTC é concedida somente à origem local
e somente para microfone/câmera após a permissão Android correspondente. O seletor de
arquivos usa o picker do sistema. Dados ficam no armazenamento privado da WebView.

`CallService` inicia com a atividade visível ao entrar na call; quando há captura, inclui
o tipo `microphone`, além de `mediaPlayback`. Uma notificação permite voltar ou sair. O
serviço mantém a CPU ativa durante a chamada e libera o recurso e o foco de áudio ao sair.
Fechar o serviço também pede à interface que deixe a call. Rotação não recria a WebView.
Cada entrada recebe um identificador: a saída emitida pelo serviço carrega esse ID para
que o encerramento atrasado da chamada anterior não derrube uma nova entrada.
Sair da call encerra a captura do microfone no Android. O botão mantém sua escolha para
a próxima entrada, quando a captura é aberta novamente; escolher mic ligado fora da call
não abre a captura antecipadamente.

O manifesto de produção exige HTTPS. Apenas o build de debug permite HTTP e o extra
`serverUrl` para os testes locais. Não ignore erros de certificado SSL.

Referências oficiais: [assets locais](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content),
[permissões da WebView](https://developer.android.com/reference/android/webkit/WebChromeClient#onPermissionRequest(android.webkit.PermissionRequest)),
[tipos de serviço](https://developer.android.com/develop/background-work/services/fgs/service-types),
[compatibilidade do AGP 8.7](https://developer.android.com/build/releases/agp-8-7-0-release-notes).

## Picture-in-Picture

A ponte `setPipState` recebe disponibilidade, proporção e retângulo do vídeo remoto.
`mobile-pip.js` escolhe a transmissão aberta, ignora prévias locais e aplica `android-pip`
para esconder controles sem recriar o vídeo. A atividade declara PiP e trata as mudanças
de tamanho para preservar a WebView. Android 12+ usa `setAutoEnterEnabled`; Android 8–11
usa `onUserLeaveHint`. Android 15+ prepara a interface no início da transição.
Sem vídeo/call, desabilita a entrada automática. Se a transmissão termina durante PiP,
`moveTaskToBack` retira a janela sem trazer o app à frente e a voz continua.

Validado no emulador API 37 com vídeo 1280×720 e áudio recebidos de um cliente Electron
por WebRTC: Início abre PiP, o relógio do vídeo avança, voltar preserva a call e o mute,
microfone aberto continua ativo em PiP e parar a transmissão retira a janela sem mutar
o microfone. Fechar o PiP pelos controles do sistema segue no checklist do aparelho real.
O teste de interface cobre seleção/troca de vídeo, ausência de prévias locais,
saída da call e preservação dos estados de áudio. Ainda é preciso conferir o aparelho real.

## Testes

```bash
npm test
node --test tests/m1-*.test.js tests/m2-*.test.js tests/m3-*.test.js
npm run test:mobile
npm run build:android
```

O teste de interface usa Electron do sistema, servidor local, captura falsa e perfil
temporário. Confere navegação, envio de chat, mute, entrada/saída da call e larguras de
360, 390, 760 e 1280 px, além do celular em paisagem.
Também confere a faixa minimizada, os controles grandes, a página Você, o menu de mensagem acionando respostas/reações e o retorno ao layout desktop.
Fecha e reabre a janela para conferir a preferência de microfone ligada/desligada,
a captura ao entrar novamente na call, o ensurdecer e a preservação da escolha após moderação.

No emulador Android, instale e aponte para um servidor de teste no PC:

```bash
adb install -r dist/Teletela-Android-teste.apk
adb shell am force-stop com.castzin.teletela.mobile
adb shell am start -n com.castzin.teletela.mobile/.MainActivity --es serverUrl http://10.0.2.2:3999
```

`10.0.2.2` é o PC visto pelo emulador. O app precisa estar fechado para o extra de teste
ser aplicado na criação da atividade. A sala oficial pode pedir sua senha antes de conectar.

Validação desta implementação: build/lint sem erros, suítes existentes (62 + 78 testes),
navegação móvel/desktop, câmera frontal 720×1280 e voz entre Electron e Android. Com o
emulador em segundo plano e tela apagada, a call permaneceu ativa e o sinal de referência
do PC continuou presente no mixer, com pico próximo de 0,086. Não é uma medição de voz
captada em um telefone físico. É necessário conferir microfone, fone/Bluetooth, rede móvel,
bateria e bloqueio de tela no aparelho do dono antes de distribuir como versão definitiva.


## Captura da tela e áudio (31/10/2026, desenvolvimento local)

`MainActivity` pede autorização a cada início e passa o resultado uma única vez ao
`ScreenCaptureService`, com tipo `mediaProjection`. A notificação oferece **Parar transmissão**.
Parar pelo app, sair da call, revogar no sistema ou destruir a atividade encerra a captura;
o serviço da voz é independente. Cada operação usa um ID para ignorar respostas atrasadas,
inclusive se a pessoa sair enquanto o consentimento ainda está aberto.

`NativeScreenCapture` usa `io.github.webrtc-sdk:android:144.7559.15`, fixada no Gradle.
`ScreenCapturerAndroid` fornece o vídeo; AudioRecord/AudioPlaybackCapture captura estéreo
48 kHz de `USAGE_MEDIA/GAME/UNKNOWN`, excluindo o UID do Teletela. O ADM nativo usa
`setAudioRecordEnabled(false)` e recebe esses blocos pelo `AudioBufferCallback`, com relógio
de 10 ms; nunca abre um segundo microfone nem passa áudio da tela pelos filtros da voz.
O início pede `RECORD_AUDIO` quando necessário; se negado, transmite só imagem e avisa.

Uma conexão WebRTC sem STUN/TURN entrega as faixas do serviço à WebView. SDP trafega só
pela ponte Android. `public/mobile-screen.js` recebe a MediaStream e `app.js` a envia pelo
P2P/SFU existente, sem mudar o servidor para capturar. Não grava arquivos nem usa uma
sequência de imagens na ponte JS. O custo extra dessa conexão local e da recodificação
precisa ser medido em aparelhos físicos; o emulador não valida bateria/temperatura.

Qualidades móveis: 720p/1080p, até 30 fps, lado maior limitado a 1280/1920 pixels e proporção
preservada. `adaptOutputFormat` limita os quadros (o capturador ignora o argumento fps).
Rotação redimensiona o VirtualDisplay; Android 14+ também trata redimensionamento do app
compartilhado sem reutilizar o token para criar outra projeção.

**Armadilha:** a biblioteca nativa exige `ACCESS_NETWORK_STATE`, além de `INTERNET`.
Sem isso, o monitor de rede lança SecurityException pelo JNI e aborta o processo; build e
lint sozinhos não detectaram a ausência. A permissão normal está declarada no manifesto.
Use o contexto da aplicação na fábrica WebRTC: o contexto de um serviço tem seus receivers
retirados automaticamente ao fechar. Liberar a fábrica depois tentava retirar o mesmo
receiver outra vez e abortava o processo. A inicialização da biblioteca acontece uma única
vez; callbacks atrasados são descartados ao encerrar e a liberação roda fora da thread da UI.

```bash
npm run build:android
# Instalar o APK no emulador já aberto; nunca usar a sala oficial neste teste.
adb -s emulator-5554 install -r dist/Teletela-Android-teste.apk
npm run test:android:screen
# Mesmo teste passando pelo SFU local (binário de npm run music:build):
ANDROID_TEST_SFU=1 npm run test:android:screen
```

O teste gera/instala um segundo app temporário com cores e um tom de 440 Hz, aceita o
diálogo real de consentimento e usa um cliente Electron como espectador. Ao terminar,
remove o app auxiliar e encerra o APK/sala temporários. Precisa de SDK/build-tools 36,
plataforma 35, JDK e emulador; aceita `ANDROID_HOME`, `JAVA_HOME`, `ANDROID_TEST_SERIAL`
(somente serial de emulador). Não é um teste em telefone real.

Validação local: pixels e áudio de 440 Hz recebidos por outro cliente em P2P e SFU,
com Android em segundo plano e microfone mutado. Parar a tela preservou o mesmo stream
de microfone ligado. Recusar e sair antes de aceitar a permissão não deixaram serviços
ativos. Build/lint, regressão móvel e interface desktop/celular passaram. Nenhuma
publicação ou alteração da sala oficial nesta retomada.

## Alternar câmera (28/10/2026)

Implementado para teste na branch `melhoria/cinema-dados-contas-e-privacidade`, separado do
experimento do Magic. O APK local foi atualizado; nenhum release/deploy foi executado.

`public/camera-source.js` abre a frontal por preferência inicial e alterna entre
`facingMode: user/environment`. Na troca exige a orientação pedida, usando `deviceId`
como alternativa quando a WebView expõe as lentes dessa forma. A MediaStream da câmera
permanece a mesma e só a faixa de vídeo é substituída nos emissores P2P/SFU. O microfone
não entra na solicitação de câmera (`audio: false`) e não é recriado.

Se o aparelho exigir liberar a lente antiga, o app encerra só esse vídeo e tenta a outra.
Falhando depois de liberar, tenta recuperar a anterior; se nenhuma abrir, desliga apenas
a câmera. Uma captura que termine depois de sair da call ou desligar a câmera é encerrada
sem reativar o envio. O encerramento da lente antiga pelo próprio Android durante a troca
é tratado pelo fluxo de troca, sem derrubar a conexão inteira.

Testes:

```bash
npm run test:camera
npm run test:camera:ui
CAMERA_TEST_SFU=1 npm run test:camera:ui
npm run test:mobile
npm run build:android
```

Os testes de interface usam duas instâncias Electron com imagens de cores diferentes
simulando as lentes. Conferem pixels recebidos por WebRTC real, tanto em P2P quanto via
SFU local, preservando os peers e o microfone, além do botão, menu, falha e saída durante
a troca. Não substituem a confirmação da abertura das duas lentes num telefone físico.
Referências: [troca de faixa com replaceTrack](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/replaceTrack)
e [seleção/liberação de câmera](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#front_and_back_camera).
