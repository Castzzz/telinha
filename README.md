# 📺 Teletela

Salas de voz e transmissão de tela entre amigos, estilo Discord/TeamSpeak. Dá pra assistir filme, jogo ou vídeo junto: **o som do PC vai na transmissão, separado do microfone**, então você pode ficar mutado e todo mundo ouve o filme direitinho.

- 🔊 Canais de voz: o `Geral` e os que vocês criarem (ficam salvos até alguém apagar)
- 🖥️ Várias pessoas transmitindo a tela ao mesmo tempo, com modo mosaico
- 🎧 No Windows e no Linux dá pra mandar **só o som de um app** (sem as vozes da chamada)
- 🧠 Cancelamento de ruído com IA no microfone (tira teclado, ventilador, barulho da rua)
- 🎚️ Volume de cada amigo só pra você, perfil com foto, chat e reações
- 🔄 O app se atualiza sozinho

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
| **Mutar o microfone** | Botão 🎙️ ou tecla `M`. Ao entrar na call o microfone já abre |
| **Parar de ouvir todo mundo** | Botão 🎧 ou tecla `D` |
| **Transmitir minha tela** | Botão 🖥️ → escolha a qualidade (720p a Nativa, 30 ou 60 fps) e a tela ou a janela. Internet fraca? Use 720p |
| **Mudar o volume de um amigo** | Clique no nome dele → barra de volume (0–200%) ou **Silenciar pra mim**. Só muda pra você, e fica salvo |
| **Mudar meu perfil** | Clique no seu nome, no canto de baixo à esquerda: foto (pode ser GIF animado, até 1 MB), cor do nome (todo mundo vê) e bio |
| **Reagir com qualquer emoji** | Barra de baixo: os rápidos, ou **＋** pra todos (tem busca) |
| **Tema claro / escuro / preto** | ⚙️ → *Tema* |
| **Criar e apagar canal** | **＋ Criar Canal**. Pra apagar, passe o mouse no canal e clique na 🗑️ (aparece pra quem criou e pra admin). O Geral não apaga |
| **Admin 👑** | ⚙️ → *Admin* → senha da sala. Admin tira alguém da call (clique na pessoa → *Tirar da call*) e apaga qualquer canal |
| **Trocar microfone, fone ou filtro de ruído** | ⚙️ Configurações |
| **Trocar os atalhos** | ⚙️ → *Atalhos de teclado* → clique no botão e aperte a tecla nova |
| **Ver várias transmissões juntas** | Automático: com 2 ou mais, o palco vira mosaico. Clique numa pra ver só ela; clique de novo pra voltar |
| **Tela cheia** | Botão ⛶ no canto de baixo, tecla `F` ou duplo clique na transmissão |
| **Janela flutuante** | Botão ⧉ no canto de baixo ou tecla `P`: a transmissão fica numa janelinha por cima do jogo/outros programas |
| **Sair da call** | Botão 📞 *Sair da call* no topo: desliga voz e transmissões sem fechar o app. Clique num canal pra voltar |
| **Assistir uma transmissão** | Ninguém entra sozinho: clique no 🔴 *AO VIVO* do lado da pessoa. Pra parar, ⏹ na barra de baixo ou ✕ na aba do topo |
| **Volume de cada transmissão** | Passe o mouse na tela da transmissão e use o 🔊 (0–200%), ou a barra de baixo pra que está aberta. Fica salvo por pessoa |
| **Volume geral** | ⚙️ → *Volume geral do Teletela*: vozes e transmissões juntas, até 200% |
| **Volume do seu microfone** | ⚙️ → *Volume do seu microfone* (0–300%): sobe se os amigos te ouvem baixo, vale na hora |
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
- **Forte, com IA** (padrão): tira teclado, ventilador, barulho da rua;
- **Básico**: o filtro do navegador;
- **Desligado**: som cru do microfone.

Só afeta a sua voz, nunca o som da transmissão.

### ⌨️ Atalhos com o jogo aberto
Os atalhos funcionam mesmo com o Teletela minimizado, se forem uma combinação com `Ctrl` ou `Alt` (ex: `Ctrl + Alt + M`) ou uma tecla `F1`–`F24`. Letra sozinha (como o `M` padrão) só funciona com o Teletela na frente, senão você não conseguiria digitar essa letra no jogo.

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

---

## 👩‍💻 Para quem mantém o projeto

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
2. Envie o código: `git add -A && git commit -m "O que mudou" && git push`
3. Publique: `npm run release` (usa o login do `gh`; leva uns 3–5 minutos).

Os links de download deste README apontam sempre pra versão mais nova, então não precisa mudar nada aqui.

> O app desktop usa a interface da sala (`public/`) **que vem instalada com ele** (`telinha://app`); do servidor só vem a conexão. Então mudou `public/`: publique versão (`npm run release`) **e** atualize o servidor (`npm run deploy:oracle`, pra quem entra pelo navegador). Mudou só `server.js` ou `sfu/`: basta o deploy.

### Senha de admin
A sala da nuvem tem uma senha de admin, gerada no primeiro deploy e mostrada no fim do `npm run deploy:oracle` (fica em `/etc/telinha/telinha.env` na VM). Pra trocar, apague a linha `ADMIN_KEY` de lá e rode o deploy de novo. Sala hospedada no PC não tem admin; quem cria um canal sempre pode apagar o seu.

Os canais criados ficam em `/opt/telinha/data/channels.json` na VM (sala hospedada no PC: na pasta de dados do app).

### Estrutura
- `server.js`: servidor de sinalização e canais (Socket.IO)
- `sfu/main.go`: repassador (SFU) da sala na nuvem: tela, câmera e voz passam por ele (cada um manda uma vez só); sala hospedada no PC continua P2P
- `public/`: interface da sala (servida por quem hospeda)
- `electron/main.cjs`: app desktop (hospedar, túnel, captura de tela, atualização, atalhos globais)
- `electron/connect.html`: tela inicial
- `native/win-audio/`: auxiliar do Windows que captura o som de um processo só
- `public/vendor/noise-suppressor/`: RNNoise (cancelamento de ruído)

Pelo navegador também funciona (`npm start` + `cloudflared tunnel --url http://localhost:8080`), mas transmitir o som do PC só funciona bem no app desktop ou no Chrome/Edge.
</details>
