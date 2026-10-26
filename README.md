# 📺 Teletela

Salas de voz e transmissão de tela entre amigos, estilo Discord/TeamSpeak. Dá pra assistir filme, jogo ou vídeo junto: **o som do PC vai na transmissão, separado do microfone**, então você pode ficar mutado e todo mundo ouve o filme direitinho.

- 🔊 Canais de voz: o `Geral` e os que vocês criarem (ficam salvos até alguém apagar)
- 🖥️ Várias pessoas transmitindo a tela ao mesmo tempo, com modo mosaico
- 🎧 No Windows e no Linux dá pra mandar **só o som de um app** (sem as vozes da chamada)
- 🧠 Cancelamento de ruído com IA no microfone (tira teclado, ventilador, barulho da rua)
- 🎚️ Volume de cada amigo só pra você, perfil com foto, chat e reações
- 🔄 O app de PC se atualiza sozinho

---

## ⬇️ Downloads

| Sistema | Baixar | Atualiza sozinho? |
|---|---|---|
| **Windows** 10/11 | **[Teletela-Setup.exe](https://github.com/Castzzz/telinha/releases/latest/download/Teletela-Setup.exe)** | ✅ Sim |
| **Linux** (qualquer distro) | **[Teletela.AppImage](https://github.com/Castzzz/telinha/releases/latest/download/Teletela.AppImage)** | ✅ Sim |

<details>
<summary>Outras opções (não se atualizam sozinhas)</summary>

| Sistema | Baixar | Quando usar |
|---|---|---|
| Windows | [Teletela-Portatil.exe](https://github.com/Castzzz/telinha/releases/latest/download/Teletela-Portatil.exe) | Se não puder instalar nada no PC |
| Linux | [Teletela.tar.gz](https://github.com/Castzzz/telinha/releases/latest/download/Teletela.tar.gz) | Se o AppImage não abrir de jeito nenhum |

Todas as versões e o que mudou em cada uma: [Releases](https://github.com/Castzzz/telinha/releases).
</details>

---

## 🪟 Instalar no Windows

1. Baixe o **[Teletela-Setup.exe](https://github.com/Castzzz/telinha/releases/latest/download/Teletela-Setup.exe)** e abra.
2. Vai aparecer **"O Windows protegeu o computador"**. É porque o app não tem assinatura digital paga, não é vírus. Clique em **Mais informações** e depois em **Executar assim mesmo**.
3. O Teletela instala e abre sozinho. Depois ele fica no **Menu Iniciar**.
4. Se o Windows perguntar sobre o **Firewall**, clique em **Permitir**.

Pronto. Agora é [entrar na sala](#-entrar-na-sala).

## 🐧 Instalar no Linux

1. Baixe o **[Teletela.AppImage](https://github.com/Castzzz/telinha/releases/latest/download/Teletela.AppImage)**.
2. Abra um terminal na pasta onde baixou e libere a execução:
   ```bash
   cd ~/Downloads
   chmod +x Teletela.AppImage
   ```
   *(sem terminal: botão direito no arquivo → Propriedades → Permissões → marque "Permitir executar como programa")*
3. Abra:
   ```bash
   ./Teletela.AppImage
   ```
4. Se der erro falando de **`libfuse.so.2`**, instale o fuse2 e tente de novo:

   | Distro | Comando |
   |---|---|
   | Arch, CachyOS, Manjaro | `sudo pacman -S fuse2` |
   | Ubuntu, Mint, Pop!_OS | `sudo apt install libfuse2` *(Ubuntu 24.04 ou mais novo: `libfuse2t64`)* |
   | Fedora | `sudo dnf install fuse fuse-libs` |

> 💡 **Dica:** coloque o AppImage numa pasta fixa (ex: `~/Aplicativos`) antes de criar atalho no menu. Se mover o arquivo depois, o atalho quebra.

<details>
<summary>Se o AppImage não abrir de jeito nenhum (usar o .tar.gz)</summary>

Baixe o **[Teletela.tar.gz](https://github.com/Castzzz/telinha/releases/latest/download/Teletela.tar.gz)** e:
```bash
cd ~/Downloads
tar -xzf Teletela.tar.gz
cd Teletela*/
./telinha
```
Esse jeito não se atualiza sozinho: quando sair versão nova, baixe de novo.
</details>

---

## 📱 Android (versão de teste)

Baixe o [APK Android de teste](https://github.com/Castzzz/telinha/releases/latest/download/Teletela-Android-teste.apk) para Android 8 ou mais novo.

Também dá para gerar o APK no PC. Ele abre a sala oficial, com canais,
chat, voz, câmera e reprodução das transmissões do PC. No celular, a navegação é própria:
**Canais** e **Você**. A call abre uma tela com participantes e controles grandes;
ao voltar, fica numa faixa compacta. O chat ocupa a tela inteira, e as opções de cada
mensagem abrem pelo **⋯** ou segurando a mensagem. Em **Você**, cada configuração abre
uma página dedicada.

No PC, com Android SDK 35 e JDK 17 ou mais novo instalados:

```bash
npm run build:android
```

Transfira `dist/Teletela-Android-teste.apk` para o celular e abra o arquivo para instalar.
Se o Android pedir, permita que o aplicativo usado para abrir o APK instale esse arquivo.
Ao entrar, use seu perfil e a senha habitual da sala. As permissões de microfone e câmera
só são pedidas ao usar essas funções. A notificação permite voltar ou sair da call;
em **⋯ → Saída de áudio** na tela da call, escolha o alto-falante ou fone.
Ao assistir a uma transmissão, aperte Início ou troque de aplicativo: o vídeo continua
numa janela PiP acima dos outros apps. Toque na janela para voltar. O volume e o mute
continuam como você escolheu; precisa de um aparelho com PiP permitido para o Teletela.

Esta primeira versão não transmite a tela/som de outros apps do celular, não hospeda salas
e não tem atualização automática nem publicação na Play Store. A versão para iPhone ainda
não foi implementada. Bluetooth, bateria e qualidade de voz precisam de validação em
aparelhos reais. [Detalhes de desenvolvimento e testes](docs/ANDROID.md).

## Dono, cargos e configurações dos canais (sem conta)

Mudanças da versão 3.8.0. A versão 3.7.0 usava o modelo anterior de admin por senha.

Em **Configurações → Servidor e cargos**, o proprietário usa uma chave exclusiva de propriedade
para **Assumir propriedade** uma vez. Depois, o perfil é reconhecido ao reabrir o app.
Há um único dono; ele pode transferir a propriedade a outro perfil. Quem perdeu o perfil
pode recuperar a propriedade com a chave exclusiva do servidor, que substitui o dono anterior. A antiga senha de admin não concede propriedade.

O dono cria cargos e distribui os poderes de moderação, gerenciamento de canais, cargos,
entrada do servidor e conteúdo. A hierarquia vai de 1 a 99: a moderação só age abaixo do
próprio cargo. Quem gerencia cargos também só altera pessoas e cargos abaixo de si, sem
conceder poderes que não possui.

O botão **Configurações do canal** fica na ponta direita da linha e aparece ao passar o
mouse, focar pelo teclado ou estar naquele canal. Use-o na lista de voz ou texto para mudar nome, descrição,
visibilidade e quem pode enviar no chat. O envio pode ser liberado por pessoa ou cargo;
na call essa regra afeta o chat, preservando o microfone. Canais invisíveis só aparecem
para quem tem acesso. A revogação também bloqueia histórico e anexos; em voz, retira da
call. A senha de entrada continua obrigatória inclusive para o dono. O Geral fica público.

Os cargos aparecem ao clicar na pessoa. Em **Configurações → Perfil → Cargo ao lado do
nome**, cada pessoa pode escolher um cargo para exibir junto ao nome; por padrão ficam
ocultos nessa lista.

A identidade do perfil fica salva no aparelho e permanece nas atualizações, sem cadastro.
Os vínculos da 3.7.0 são migrados pela credencial já salva. **Exportar perfil** agora inclui
a chave privada necessária para restaurar os cargos e acessos em outro aparelho: guarde
esse backup só com você. Um backup antigo, apenas com nome e ID público, não recupera
cargos sozinho. Apagar todos os dados sem backup exige nova liberação pelo dono.
O servidor e os aplicativos precisam ser atualizados para todas as opções funcionarem.

## 🚪 Entrar na sala

1. Peça o **link da sala** pra quem está hospedando. Ele é parecido com `https://palavra-palavra-palavra.trycloudflare.com`.
2. No Teletela, cole o link em **Entrar na sala de um amigo** e clique em **Entrar**.
3. Na primeira vez, o Teletela pede seu **perfil** (nome, foto, cor). Dá pra mudar depois.

> ⚠️ **O link muda toda vez** que alguém abre a sala. Se der erro, peça o link novo.

<details>
<summary>Quero hospedar a sala eu mesmo</summary>

1. Instale o [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (no Arch/CachyOS: `sudo pacman -S cloudflared`; no Windows: `winget install --id Cloudflare.cloudflared`).
2. No Teletela, clique em **🏠 Hospedar no meu PC** e espere o link aparecer (pode levar até 1 minuto).
3. Clique em **📋 Copiar link**, mande pros amigos e clique em **Entrar na sala**.

A sala só existe enquanto o seu Teletela estiver aberto: se você fechar, todo mundo cai.
</details>

---

## 🎮 Como usar

| Quero… | Como |
|---|---|
| **Entrar numa chamada** | A tela inicial mostra cartões dos canais e quem está em voz, com as fotos de perfil e o recorte escolhido (iniciais para quem não tem foto). Clique em **Entrar** no cartão ou no canal da lista. Os atalhos de texto abrem as conversas sem ligar a voz |
| **Mostrar o jogo que estou jogando** | No app para Windows e Linux, jogos reconhecidos aparecem abaixo do nome e no perfil, como **Jogando Counter-Strike 2 · há 23 min**. A atividade some ao fechar o jogo; a detecção é feita a cada 15 segundos. Em ⚙️ → **Atividade**, você pode desligar o compartilhamento ou cadastrar um jogo pelo nome do executável. No navegador dá para ver a atividade dos amigos |
| **Mutar o microfone** | Botão 🎙️ ou tecla `M`. O app lembra se você estava mutado ou desmutado ao fechar e restaura essa escolha ao abrir. Na primeira vez, começa mutado. Entrar, trocar de canal ou reconectar também preserva a escolha. Entrar, sair, mutar/desmutar e ensurdecer/restaurar o áudio atualizam os ícones sem abrir popups; erros e avisos de moderação continuam aparecendo |
| **Lista de canais** | Canais de voz vazios têm o mesmo espaçamento dos canais de texto; as duas seções ficam próximas na barra lateral |
| **Parar de ouvir todo mundo** | Botão 🎧 ou tecla `D`. Cala as vozes, mas as transmissões continuam tocando (⚙️ tem a opção de calar elas também) |
| **Transmitir minha tela** | Entre num canal de voz e use o botão 🖥️ → escolha a qualidade (720p a Nativa, 30 ou 60 fps) e a tela ou a janela. Internet fraca? Use 720p |
| **Transmitir mais de uma tela** | Já transmitindo, clique de novo no 🖥️ → *Transmitir outra tela* (até 3 ao mesmo tempo). As extras vão só com imagem; o som vai na tela 1. O mesmo menu para cada uma |
| **Mudar o volume de um amigo** | Clique no nome dele → barra de volume (0–200%) ou **Silenciar pra mim**. Só muda pra você, e fica salvo |
| **Mudar meu perfil** | Clique no seu nome, no canto de baixo à esquerda, ou em ⚙️ → **Perfil**. O editor tem prévia ao lado em janelas largas, foto e banner com GIF até 10 MB, cores, gradiente, moldura, bio e som de entrada (até 5 s / 1 MB). Arraste e ajuste o zoom ao escolher uma imagem; **Ajustar foto/banner** permite reenquadrar depois. Confirme em **Salvar perfil**; **Descartar alterações** volta ao último perfil salvo |
| **Ver o perfil de alguém** | Clique na pessoa e depois na foto (ou na foto dela no chat): abre o perfil grande. Clique na foto de novo pra ver ela grande. Os GIFs animam no perfil aberto e na ampliação, mesmo com o modo leve ligado |
| **Ver meu ping** | Em call, passe o mouse ou foque pelo teclado em **Voz conectada**, no canto inferior esquerdo: o cartão mostra o ping em destaque e o tempo de ida e volta até o servidor. Verde abaixo de 150 ms, amarelo de 150 a 299 ms e vermelho a partir de 300 ms; sem resposta ou durante a reconexão, também fica vermelho |
| **Escolher os áudios de entrar/sair** | ⚙️ → *Som*: sorteado, um fixo ou nenhum (só pra você). O som de entrada do perfil de cada um continua tocando pra todos |
| **Sair da call** | Botão vermelho no painel *Voz conectada*, lá embaixo à esquerda |
| **Abrir o chat da call** | 💬 do lado do canal em que você está (bolinha vermelha = mensagem nova). Clicar no canal volta da tela de texto pra call |
| **Mudar o tamanho das transmissões** | Vendo várias lado a lado, arraste a divisória entre elas (duplo clique deixa igual) |
| **Mandar imagem ou GIF no chat** | 📎 do lado do campo, `Ctrl+V` ou arraste pro chat (até 15 MB; GIF continua animado). O texto vai como legenda. Clique na imagem pra ver grande |
| **Enviar vídeo ou arquivo** | Use o mesmo 📎 ou arraste pro chat (até 20 MB por arquivo). MP4/WebM têm player; outros formatos ficam disponíveis para baixar. Nos canais de texto os anexos ficam salvos; no chat da call são temporários |
| **Sons ao mutar/desmutar** | Em ⚙️ → *Som* → *Áudios dos controles*, escolha a opção 1 (quatro sons separados) ou a opção 2 (a nova dupla, igual para microfone e áudio). Dá para desligar os avisos; só você ouve, seguindo o volume geral, inclusive ao ensurdecer |
| **Esconder minha própria transmissão** | Menu do botão 🖥️ ou ⚙️ → *Transmissão*. A prévia fica escondida automaticamente, mas clicar no seu **AO VIVO** ou **CÂMERA** abre só a prévia escolhida. O **✕** na aba volta a escondê-la. Os amigos continuam vendo e a preferência fica salva |
| **Responder, reagir, editar e apagar mensagens** | Passe o mouse na mensagem do chat: ↩ responde, 😊 reage, ✏️ edita e 🗑️ apaga (as suas; admin apaga qualquer uma). `↑` com o campo vazio edita a sua última |
| **Fixar mensagem** | Canal de texto: passe o mouse na mensagem e clique no 📌. O 📌 no topo do chat lista as fixadas |
| **Levar o perfil pra outro PC** | Clique no seu nome → *Exportar perfil*; no outro PC, *Importar perfil*. Não mande o arquivo pra ninguém: ele é a sua identidade nas salas |
| **Marcar alguém** | Digite `@` no chat e escolha a pessoa (ou `@todos`). Ela recebe um aviso, mesmo com o Teletela minimizado |
| **Soundboard** | Em call, use 🎵 lá embaixo, ao lado de **Reagir**: toca um som pra toda a call. *＋ Adicionar som* sobe os seus (até 16, de até 10 s / 1 MB). Volume e desligar em ⚙️ → *Som* |
| **Reagir com qualquer emoji** | Em call, passe o mouse sobre **Reagir** para ver os emojis mais usados. Clique em **＋** para abrir a busca completa. Também funciona por clique ou teclado; escolher um emoji envia para a call e fecha o painel |
| **Rever as novidades da versão** | Botão **Novidades** na tela inicial ou nas configurações. Reabre o popup com o histórico, mesmo depois de ter fechado. O aviso automático continua aparecendo uma vez por versão |
| **Tema claro / escuro / preto** | ⚙️ → *Tema* |
| **Manter os avatares animados** | ⚙️ → *Aparência* → desmarque **Modo leve** para os GIFs animarem mesmo sem ninguém falar. Desmarque também **Pausar animações em segundo plano** para continuarem quando o app estiver sem foco ou minimizado. As duas opções são independentes e ficam salvas |
| **Canal de texto** | *Canais de Texto* → **+**. Mensagens e imagens ficam salvas (dá pra rolar e ver as antigas) e funcionam sem estar em call. Abre em tela cheia (no cantinho se você estiver vendo uma transmissão). **🔊 Chat da call** no topo do chat volta pro chat da call, que continua temporário |
| **Recolher os canais** | Clique em *Canais de Voz* ou *Canais de Texto*. Recolhido, fica só o canal em que você está (com as fotos lado a lado) e os canais de texto com mensagem nova |
| **Cargo: mover pessoas de call** | Arraste a pessoa da lista e solte em outro canal de voz |
| **Cargo: mutar / ensurdecer pra todos** | Clique na pessoa → *Mutar pra todos* / *Ensurdecer pra todos*. Vale até a moderação desfazer, mesmo se ela reconectar (🛡️ do lado do ícone) |
| **Criar e apagar canal** | Use o **＋** ao lado de *Canais de Voz* ou *Canais de Texto*. Pra apagar, passe o mouse no canal e clique na 🗑️ (aparece pra quem criou e pra admin). O Geral não apaga |
| **Dono 👑 e cargos** | ⚙️ → *Servidor e cargos*. O dono assume a propriedade e delega moderação e administração pelos cargos |
| **Trocar microfone, fone ou filtro de ruído** | ⚙️ Configurações. Todas as abas mantêm o mesmo tamanho da janela de Perfil, adaptado à tela |
| **Trocar os atalhos** | ⚙️ → *Atalhos* → clique no botão e aperte a tecla nova. Vale qualquer tecla, até `Ctrl`/`Shift`/`Alt` sozinhos (ex: o `Ctrl` da direita). `Esc` tira o atalho |
| **Ver várias transmissões juntas** | Automático: com 2 ou mais, o palco vira mosaico. Clique numa pra ver só ela; clique de novo pra voltar |
| **Tela cheia** | Botão ⛶ no canto de baixo, tecla `F` ou duplo clique na transmissão |
| **Janela flutuante** | Botão ⧉ no canto de baixo ou tecla `P`: a transmissão fica numa janelinha por cima do jogo/outros programas |
| **Sair da call** | Botão 📞 *Sair da call* no topo: desliga voz e transmissões sem fechar o app. Clique num canal pra voltar |
| **Assistir uma transmissão** | Ninguém entra sozinho: clique no 🔴 *AO VIVO* do lado da pessoa. Pra parar, ⏹ na barra de baixo ou ✕ na aba do topo |
| **Volume de cada transmissão** | Passe o mouse na tela da transmissão e use o 🔊 (0–300%), ou a barra de baixo pra que está aberta. Fica salvo por pessoa |
| **Volume geral** | ⚙️ → *Volume geral do Teletela*: vozes e transmissões juntas, até 200% |
| **Volume do seu microfone** | Desde a 3.8.0: ⚙️ → *Microfone* → **Reforçar vozes baixas** aumenta a voz em qualquer filtro e contém picos, sem alterar o volume do sistema. Comece com o microfone e os amigos em 100%. O controle manual de 0–300% continua disponível |
| **Som de entrada/saída** | Toca um áudio dos amigos quando alguém entra ou sai da call: o servidor sorteia e todo mundo do canal (inclusive quem entrou ou saiu) ouve o mesmo. Desliga em ⚙️ |
| **Câmera** | Botão 📷 no canto de baixo: aparece *📷 CÂMERA* do seu lado e os amigos clicam pra ver. Dá pra ligar junto com a transmissão de tela (são dois selos separados) |
| **Parou de ouvir alguém** | Clique na pessoa → *🔄 Reconectar a voz* (a conexão também se refaz sozinha se cair) |
| **Voltar pra tela inicial** | `Ctrl+Shift+H` |

### 🔊 O som da transmissão
O microfone pode ficar desligado: o som do PC vai separado, em estéreo.

- **Windows 10 (versão 2004 ou mais nova) ou 11:**
  - escolhendo uma **janela**, vai **só o som daquele programa**;
  - escolhendo a **tela inteira**, vai o som do PC **sem as vozes da chamada** (não dá eco).
  - Em Windows mais antigo vai o som do PC inteiro, inclusive as vozes. Aí use **fone de ouvido**.
- **Linux:** antes de transmitir aparece *"Qual som transmitir?"*. Escolha o jogo/app pra mandar só o som dele (ele precisa estar aberto tocando algum som), o **som do PC inteiro** ou **sem som**.

### 🧠 Cancelamento de ruído
Em ⚙️ → *Cancelamento de ruído do microfone*:
- **Forte, com IA** (padrão): usa um modelo mais forte para reduzir teclas e ruído também durante a fala;
- **IA leve**: mantém o filtro anterior com menor uso de CPU;
- **Básico**: o filtro do navegador;
- **Desligado**: som cru do microfone.

Só afeta a sua voz, nunca o som da transmissão. Se a IA forte não carregar, o app avisa
e tenta a IA leve; se as duas falharem, usa o básico. As mudanças estão na 3.8.0.
O resultado com cada teclado/microfone precisa ser conferido no aparelho real.

### ⌨️ Atalhos com o jogo aberto
Os atalhos funcionam mesmo com o Teletela minimizado se forem `Ctrl`/`Shift`/`Alt` sozinhos (ex: o `Ctrl` da direita; a tecla continua indo pro jogo), uma combinação com `Ctrl` ou `Alt` (ex: `Ctrl + Alt + M`) ou uma tecla `F1`–`F24`. Letra sozinha (como o `M` padrão) só funciona com o Teletela na frente, senão você não conseguiria digitar essa letra no jogo.

No **Linux com Wayland** (Hyprland, Sway…) quem segura a tecla no meio do jogo é o sistema: crie o atalho na config dele chamando o Teletela. No Hyprland:

```
bindn = , F8, exec, curl -s --unix-socket $XDG_RUNTIME_DIR/telinha.sock http://telinha/mute
```

(`/deafen` no lugar de `/mute` pra ensurdecer; `bindn` deixa o jogo receber a tecla também.)

---

## 🔄 Atualizações

Instalou pelo **Setup** (Windows) ou pelo **AppImage** (Linux)? Então não precisa fazer nada. O Teletela confere se tem versão nova quando abre, baixa em segundo plano e pergunta se quer reiniciar. Se escolher "Depois", ele instala quando você fechar o app.

---

## 🛠️ Problemas comuns

| Problema | Solução |
|---|---|
| *"Não encontrei uma sala do Teletela nesse link"* | A sala fechou ou o link é antigo. Peça o link novo. Se o link acabou de ser criado, espere uns segundos e tente de novo. |
| *"O Windows protegeu o computador"* | Normal: **Mais informações → Executar assim mesmo**. |
| AppImage não abre (*"libfuse.so.2"*) | Instale o fuse2 ([veja a tabela](#-instalar-no-linux)) ou use o `.tar.gz`. |
| Amigos não ouvem o som da minha transmissão (Linux) | ⚙️ → *Áudio da Transmissão* → escolha **Som_do_PC_Jogos_e_Videos** ou **Monitor of …**. |
| Amigos não ouvem o som da minha transmissão (Windows) | O aviso que aparece ao começar a transmitir diz o motivo. Mande um print dele pra quem hospeda. |
| Ninguém me ouve | Veja se o 🎙️ não está riscado e se o microfone certo está em ⚙️. Teste falando: a barra *Teste de Atividade de Voz* tem que mexer. |
| Atalho não funciona com o jogo aberto | Use `Ctrl`/`Alt` + tecla ou `F1`–`F24`. Se aparecer *"Outro programa já usa esse atalho"*, escolha outro. |
| Tela branca / travou | `Ctrl+R` recarrega; `Ctrl+Shift+H` volta pra tela inicial. |

Quedas de resolução e imagem congelada com som continuando podem ter causas diferentes.
A análise da transmissão e a correção do SFU incluída na versão 3.4 estão em
[docs/DIAGNOSTICO-TRANSMISSOES.md](docs/DIAGNOSTICO-TRANSMISSOES.md).

---

## 👩‍💻 Para quem mantém o projeto

📘 **Documentação completa do projeto (arquitetura, deploy, release, dados, armadilhas): [docs/PROJETO.md](docs/PROJETO.md).** Pra agentes de IA: [AGENTS.md](AGENTS.md).

Ideias e melhorias para avaliar no futuro: [docs/IDEIAS-FUTURAS.md](docs/IDEIAS-FUTURAS.md).

<details>
<summary>Rodar pelo código, publicar versões e estrutura</summary>

### Rodar pelo código
```bash
npm install
npm run app     # app desktop (usa o Electron do sistema)
npm start       # só o servidor web em http://localhost:8080
```

### Comandos
| Comando | O que faz |
|---|---|
| `npm run app` | Abre o app desktop |
| `npm start` / `npm run dev` | Servidor web (o `dev` reinicia ao editar o `server.js`) |
| `npm test` | Testes |
| `npm run dist` | Gera os instaladores Linux + Windows em `dist/` (sem publicar) |
| `npm run release` | Gera e **publica** os instaladores no GitHub Releases |
| `npm run build:win-audio` | Compila o `electron/bin/telinha-audio.exe` (precisa de `mingw-w64-gcc`) |

### Publicar uma versão nova
1. Aumente o `version` no `package.json` (ex: `1.1.0` → `1.2.0`). **Sem aumentar, ninguém recebe a atualização.**
2. Atualize o popup de novidades (`WHATS_NEW_VERSION` no `public/app.js` e o texto em `#modal-whats-new` no `public/index.html`).
3. Envie o código **sem os áudios dos amigos**: `git add -A -- . ':!public/sounds' && git commit -m "O que mudou" && git push`
4. Publique: `npm run release` (usa o login do `gh`; leva uns 3–5 minutos).

Os links de download deste README apontam sempre pra versão mais nova, então não precisa mudar nada aqui.

> O app desktop usa a interface da sala (`public/`) **que vem instalada com ele** (`telinha://app`); do servidor só vem a conexão. Então mudou `public/`: publique versão (`npm run release`) **e** atualize o servidor (`npm run deploy:oracle`, pra quem entra pelo navegador). Mudou só `server.js` ou `sfu/`: basta o deploy.

### Backup dos dados da sala
`npm run backup` baixa os canais, o histórico dos canais de texto, o soundboard e os segredos da VM pra `~/Teletela-backups` (fica com os 15 mais novos). `npm run backup:auto` faz isso sozinho 1x por dia. O `npm run deploy:oracle` também faz um backup antes de mexer. Pra voltar um backup: `npm run restore -- ~/Teletela-backups/<arquivo>.tar.gz`. **A VM sumiu?** Siga o [docs/RECUPERAR-SERVIDOR.md](docs/RECUPERAR-SERVIDOR.md).

A sala roda numa VM Ampere ARM64 com Ubuntu 26.04, 12 GB de RAM e disco de 100 GB. Para
trocar de VM mantendo dados e endereço, siga [docs/MIGRAR-SERVIDOR.md](docs/MIGRAR-SERVIDOR.md).
O deploy também suporta x86_64; IP, usuário e chave SSH ficam em `deploy/oracle/config.sh`.

### Senha da sala
O dono ou quem tem permissão para gerenciar o servidor coloca em ⚙️ → *Servidor e cargos* → *Senha da sala*. Quem já usa o app guarda uma chave e continua entrando direto; só gente nova precisa digitar. *Pedir senha de novo pra todos* faz quem não estiver online precisar digitar.

### Senha de admin
A propriedade da sala usa `OWNER_KEY`, exclusiva e guardada em `/etc/telinha/telinha.env` na VM. O deploy preserva essa chave sem exibi-la. Para renová-la, o operador remove a linha `OWNER_KEY` e executa o deploy. A antiga `ADMIN_KEY` não concede propriedade. Na sala hospedada no PC, configure `OWNER_KEY` para reivindicar um dono; quem cria um canal público continua podendo apagar o seu.

Os canais criados ficam em `/opt/telinha/data/channels.json` na VM (sala hospedada no PC: na pasta de dados do app). O histórico dos canais de texto fica em `data/text/<canal>.jsonl` (até 50 mil mensagens por canal), as imagens em `data/text/images/` (até 25 GB) e vídeos/arquivos em `data/text/files/` (até 5 GB). Passando dos limites de espaço, os arquivos mais antigos são apagados.

### Testar anexos e sons localmente

Rode `PORT=3999 TELINHA_DATA_DIR=/tmp/teletela-teste-anexos npm start`
e abra `http://127.0.0.1:3999`. Para testar no desktop, rode `npm run app` e entre por esse link
na tela inicial. Assim o app usa o servidor local com os eventos novos. Os seis áudios de
controle ficam em `public/sounds/`, fora do git como os demais sons privados; precisam estar
no disco. Esse servidor local usa P2P; testar o repasse do SFU exige subir o SFU também.

### Estrutura
- `server.js`: servidor de sinalização e canais (Socket.IO)
- `sfu/main.go`: repassador (SFU) da sala na nuvem: tela, câmera e voz passam por ele (cada um manda uma vez só); sala hospedada no PC continua P2P
- `public/`: interface da sala (servida por quem hospeda)
- `electron/main.cjs`: app desktop (hospedar, túnel, captura de tela, atualização, atalhos globais)
- `electron/connect.html`: tela inicial
- `native/win-audio/`: auxiliar do Windows que captura o som de um processo só
- `public/vendor/noise-suppressor/`: GTCRN e RNNoise (cancelamento de ruído local)

Pelo navegador também funciona (`npm start` + `cloudflared tunnel --url http://localhost:8080`), mas transmitir o som do PC só funciona bem no app desktop ou no Chrome/Edge.
</details>
