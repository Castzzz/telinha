# 📺 Telinha

Salas de voz e transmissão de tela entre amigos, estilo Discord/TeamSpeak. Dá pra assistir filme, jogo ou vídeo junto: **o som do PC vai na transmissão, separado do microfone**, então você pode ficar mutado e todo mundo ouve o filme direitinho.

- 🔊 Canais de voz (`Geral`, `Cinema`, `Futebol`, `Gameplay` e os que vocês criarem)
- 🖥️ Várias pessoas transmitindo a tela ao mesmo tempo, com modo mosaico
- 🎧 No Windows e no Linux dá pra mandar **só o som de um app** (sem as vozes da chamada)
- 🧠 Cancelamento de ruído com IA no microfone (tira teclado, ventilador, barulho da rua)
- 🎚️ Volume de cada amigo só pra você, perfil com foto, chat e reações
- 🔄 O app se atualiza sozinho

---

## ⬇️ Downloads

| Sistema | Baixar | Atualiza sozinho? |
|---|---|---|
| **Windows** 10/11 | **[Telinha-Setup.exe](https://github.com/Castzzz/telinha/releases/latest/download/Telinha-Setup.exe)** | ✅ Sim |
| **Linux** (qualquer distro) | **[Telinha.AppImage](https://github.com/Castzzz/telinha/releases/latest/download/Telinha.AppImage)** | ✅ Sim |

<details>
<summary>Outras opções (não se atualizam sozinhas)</summary>

| Sistema | Baixar | Quando usar |
|---|---|---|
| Windows | [Telinha-Portatil.exe](https://github.com/Castzzz/telinha/releases/latest/download/Telinha-Portatil.exe) | Se não puder instalar nada no PC |
| Linux | [Telinha.tar.gz](https://github.com/Castzzz/telinha/releases/latest/download/Telinha.tar.gz) | Se o AppImage não abrir de jeito nenhum |

Todas as versões e o que mudou em cada uma: [Releases](https://github.com/Castzzz/telinha/releases).
</details>

---

## 🪟 Instalar no Windows

1. Baixe o **[Telinha-Setup.exe](https://github.com/Castzzz/telinha/releases/latest/download/Telinha-Setup.exe)** e abra.
2. Vai aparecer **"O Windows protegeu o computador"**. É porque o app não tem assinatura digital paga, não é vírus. Clique em **Mais informações** e depois em **Executar assim mesmo**.
3. O Telinha instala e abre sozinho. Depois ele fica no **Menu Iniciar**.
4. Se o Windows perguntar sobre o **Firewall**, clique em **Permitir**.

Pronto. Agora é [entrar na sala](#-entrar-na-sala).

## 🐧 Instalar no Linux

1. Baixe o **[Telinha.AppImage](https://github.com/Castzzz/telinha/releases/latest/download/Telinha.AppImage)**.
2. Abra um terminal na pasta onde baixou e libere a execução:
   ```bash
   cd ~/Downloads
   chmod +x Telinha.AppImage
   ```
   *(sem terminal: botão direito no arquivo → Propriedades → Permissões → marque "Permitir executar como programa")*
3. Abra:
   ```bash
   ./Telinha.AppImage
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

Baixe o **[Telinha.tar.gz](https://github.com/Castzzz/telinha/releases/latest/download/Telinha.tar.gz)** e:
```bash
cd ~/Downloads
tar -xzf Telinha.tar.gz
cd Telinha*/
./telinha
```
Esse jeito não se atualiza sozinho: quando sair versão nova, baixe de novo.
</details>

---

## 🚪 Entrar na sala

1. Peça o **link da sala** pra quem está hospedando. Ele é parecido com `https://palavra-palavra-palavra.trycloudflare.com`.
2. No Telinha, cole o link em **Entrar na sala de um amigo** e clique em **Entrar**.
3. Na primeira vez, o Telinha pede seu **perfil** (nome, foto, cor). Dá pra mudar depois.

> ⚠️ **O link muda toda vez** que alguém abre a sala. Se der erro, peça o link novo.

<details>
<summary>Quero hospedar a sala eu mesmo</summary>

1. Instale o [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (no Arch/CachyOS: `sudo pacman -S cloudflared`; no Windows: `winget install --id Cloudflare.cloudflared`).
2. No Telinha, clique em **🏠 Hospedar no meu PC** e espere o link aparecer (pode levar até 1 minuto).
3. Clique em **📋 Copiar link**, mande pros amigos e clique em **Entrar na sala**.

A sala só existe enquanto o seu Telinha estiver aberto: se você fechar, todo mundo cai.
</details>

---

## 🎮 Como usar

| Quero… | Como |
|---|---|
| **Mutar o microfone** | Botão 🎙️ ou tecla `M` |
| **Parar de ouvir todo mundo** | Botão 🎧 ou tecla `D` |
| **Transmitir minha tela** | Botão 🖥️ → escolha a tela ou a janela |
| **Mudar o volume de um amigo** | Clique no nome dele → barra de volume (0–200%) ou **Silenciar pra mim**. Só muda pra você, e fica salvo |
| **Mudar meu perfil** | Clique no seu nome, no canto de baixo à esquerda |
| **Trocar microfone, fone ou filtro de ruído** | ⚙️ Configurações |
| **Trocar os atalhos** | ⚙️ → *Atalhos de teclado* → clique no botão e aperte a tecla nova |
| **Ver várias transmissões juntas** | Botão 🔲 **Mosaico**, lá em cima |
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
Os atalhos funcionam mesmo com o Telinha minimizado, se forem uma combinação com `Ctrl` ou `Alt` (ex: `Ctrl + Alt + M`) ou uma tecla `F1`–`F24`. Letra sozinha (como o `M` padrão) só funciona com o Telinha na frente, senão você não conseguiria digitar essa letra no jogo.

---

## 🔄 Atualizações

Instalou pelo **Setup** (Windows) ou pelo **AppImage** (Linux)? Então não precisa fazer nada. O Telinha confere se tem versão nova quando abre, baixa em segundo plano e pergunta se quer reiniciar. Se escolher "Depois", ele instala quando você fechar o app.

---

## 🛠️ Problemas comuns

| Problema | Solução |
|---|---|
| *"Não encontrei uma sala do Telinha nesse link"* | A sala fechou ou o link é antigo. Peça o link novo. Se o link acabou de ser criado, espere uns segundos e tente de novo. |
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

> A interface da sala (`public/`) e o `server.js` vêm do **servidor de quem hospeda**: se só mudou isso, basta hospedar com o código novo, sem publicar versão. Publicar só é necessário quando muda algo em `electron/` ou `native/`.

### Estrutura
- `server.js`: servidor de sinalização e canais (Socket.IO)
- `public/`: interface da sala (servida por quem hospeda)
- `electron/main.cjs`: app desktop (hospedar, túnel, captura de tela, atualização, atalhos globais)
- `electron/connect.html`: tela inicial
- `native/win-audio/`: auxiliar do Windows que captura o som de um processo só
- `public/vendor/noise-suppressor/`: RNNoise (cancelamento de ruído)

Pelo navegador também funciona (`npm start` + `cloudflared tunnel --url http://localhost:8080`), mas transmitir o som do PC só funciona bem no app desktop ou no Chrome/Edge.
</details>
