# Android: versão de teste

O APK reaproveita `public/`, Socket.IO, WebRTC, RNNoise e o SFU existentes. O projeto nativo
fica em `android/` e usa Java + WebView, sem trocar o aplicativo desktop de Electron.
Não há cliente para iPhone nesta implementação.

Registro dos pedidos e do que já foi concluído: [PENDENCIAS.md](PENDENCIAS.md).

## O que funciona

- Canais de voz e texto, perfil local, chat, cargos e canais com senha ou invisíveis.
  Não exige conta; contas e amigos ficaram para uma versão futura.
- Microfone com o filtro e o ganho manual do desktop, mute, ensurdecer e câmera frontal.
- Assistir às transmissões dos computadores. Abrir uma transmissão leva à aba Sala.
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

Ainda não há captura da tela ou do som de outros aplicativos Android. Isso precisa de
`MediaProjection`, serviço e integração de mídia próprios; `getDisplayMedia` do desktop
não resolve essa função na WebView. Os controles indisponíveis ficam ocultos.

O APK abre a sala oficial. Não hospeda um servidor local, não detecta jogos de outros apps
e não implementa os atalhos globais do PC. Também não tem atualização automática ou
publicação em loja. Captura de câmera em segundo plano não é prometida.
O serviço melhora a continuidade da voz, mas fabricantes, economia de bateria e mudanças
de rede precisam ser testados nos aparelhos reais.

## Compilar e instalar

Precisa de JDK 17+ e Android SDK com a plataforma 35. O Gradle Wrapper 8.9 está no
repositório, com checksum da distribuição; o Android Gradle Plugin é 8.7.3. A combinação
é compatível com SDK 35 e dispensa trocar as ferramentas do desktop.

O APK atual usa `versionCode 4` / `3.7.0`, com o mesmo ID e a mesma assinatura
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
