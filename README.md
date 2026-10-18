# 📺 Telinha PRO — App Desktop & Web (Estilo Discord / TeamSpeak)

Aplicativo completo de **Salas de Voz e Transmissão de Tela Ao Vivo (Watch Party)** estilo Discord/TeamSpeak, com **Aplicativo Desktop Nativo (Electron)** e **Acesso Web**, onde o **som do seu PC/jogo/vídeo é capturado diretamente da saída do sistema (100% separado do microfone)**.

---

## ✨ Principais Recursos

1. **Interface Estilo Discord / TeamSpeak:**
   - **Canais de Voz na Barra Lateral:** `🔊 Geral`, `🎬 Cinema`, `⚽ Futebol`, `🎮 Gameplay` + botão **`+ Criar Canal`** para criar salas personalizadas em tempo real.
   - **Presença em Tempo Real:** Veja quem está em cada sala, quem está falando (**anel verde pulsante de atividade de voz - VAD**), quem está mutado/ensurdecido e quem está **`🔴 AO VIVO`**.
   - **Barra Inferior de Controles (User Dock):**
     - **🎙️ Mutar / Desmutar Microfone** (atalho `M`, dá pra trocar)
     - **🎧 Ensurdecer / Desativar Áudio (Deafen)** (atalho `D`, dá pra trocar)
     - **🖥️ Transmitir Tela com Som do Sistema**
     - **⚙️ Configurações de Dispositivos de Entrada, Saída e Som do Sistema**
   - **Volume por pessoa (0% a 200%):** clique num amigo pra aumentar, diminuir ou silenciar a voz dele só pra você. Fica salvo pro próximo dia, mesmo com link novo.
   - **Perfil:** nome, foto, cor e uma frase "sobre você". Clique no seu nome lá embaixo pra editar.
   - **Atalhos configuráveis:** troque as teclas de mutar/ensurdecer em ⚙️ Configurações. No app desktop eles funcionam até com o Telinha minimizado (ex: no meio do jogo).

2. **🔊 Som do Jogo/Vídeo 100% Independente do Microfone:**
   - Ao transmitir a tela, o áudio vem direto do **Monitor de Saída do Sistema** (`som_do_pc` / PipeWire / PulseAudio Loopback) em **Opus 48kHz Estéreo (256 kbps)** sem filtros de voz (`echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`).
   - **Voz limpa:** cancelamento de ruído com IA (RNNoise) tira teclado, ventilador e barulho de fundo, e a voz vai em Opus 64 kbps (o dobro do padrão). Quando a internet aperta, o som tem prioridade sobre o vídeo.
   - **Você NÃO precisa ligar o microfone para transmitir o som do vídeo ou jogo!** Seu microfone pode ficar 100% desligado (`🔇`) enquanto seus amigos ouvem o áudio do filme ou partida perfeitamente.

3. **🎬 Palco Multi-Tela & Modo Mosaico:**
   - Vários amigos podem transmitir a tela ao mesmo tempo no mesmo canal.
   - Alterne entre as transmissões com 1 clique nas abas superiores ou ative o **🔲 Modo Mosaico** para assistir várias telas lado a lado.
   - Suporte a **Tela Cheia**, **Picture-in-Picture (PiP)**, **Chat de Texto por Canal** e **Reações Flutuantes Ao Vivo** (🔥, 😂, 😱, ⚽, 🎮, 👏, ❤️).

---

## 🚀 Guia rápido

O Telinha funciona assim: **um PC hospeda a sala** (o seu) e **os amigos entram nela** pelo app, usando um link que você manda.

```
  Você (anfitrião)                         Amigos (Windows ou Linux)
  ┌──────────────────┐    link https://    ┌──────────────────┐
  │ Telinha          │ ◄────────────────── │ Telinha          │
  │ 🏠 Hospedar      │   ...trycloudflare  │ Entrar na sala   │
  │ servidor+túnel   │        .com         │ (cola o link)    │
  └──────────────────┘                     └──────────────────┘
```

---

## 🏠 Parte 1 — Como iniciar aqui (no seu PC)

### Passo 1: abrir o app
Escolha **um** dos jeitos:

- **Pelo menu de aplicativos:** procure **"Telinha (WatchParty & Voz)"** e clique.
- **Pelo terminal:**
  ```bash
  cd ~/Dev/telinha
  npm run app
  ```

Vai abrir a tela inicial do Telinha.

### Passo 2: hospedar a sala
1. Clique em **🏠 Hospedar no meu PC**.
2. Espere a mensagem *"Iniciando servidor e criando link público…"*. **Pode levar até 1 minuto.**
3. Aparece um link parecido com `https://palavra-palavra-palavra.trycloudflare.com`.
4. Clique em **📋 Copiar link** e mande pros seus amigos (WhatsApp, Discord, etc.).
5. Clique em **Entrar na sala**.

### Passo 3: usar
- Escolha um canal na barra lateral (`🔊 Geral`, `🎬 Cinema`…).
- **🖥️ Transmitir tela:** escolha a tela ou janela. O som do PC vai junto automaticamente.
  - **No Linux** aparece antes a janela *"Qual som transmitir?"*: escolha o jogo pra mandar **só o som dele** (sem as vozes da chamada), *Som do PC inteiro* ou *Sem som*. O jogo precisa estar aberto tocando algum som. Você continua ouvindo o jogo normalmente.
  - **No Windows** (10 versão 2004+ ou 11): se escolher uma **janela**, vai **só o som daquele app**; se escolher a **tela inteira**, vai o som do PC **sem as vozes da chamada**. Em Windows mais antigo vai o som do PC inteiro.
- **🎙️ `M`** muta o microfone · **🎧 `D`** ensurdece. O som da transmissão continua indo mesmo com o microfone mutado.
- **Seu perfil:** clique no seu nome (canto de baixo à esquerda) pra trocar nome, foto, cor e a frase "sobre você". Na primeira vez que abre, o Telinha já pede.
- **Volume de um amigo:** clique no nome dele (na lista ou no card do meio). Aparece o perfil dele com uma barra de volume (0–200%) e o botão **Silenciar pra mim**. Só muda pra você, e fica salvo.
- **Cancelamento de ruído:** ⚙️ → *Cancelamento de ruído do microfone*. **Forte, com IA** (padrão) tira teclado, ventilador e barulho da rua; **Básico** é o filtro do navegador; **Desligado** manda o som cru. Só afeta a sua voz, nunca o som da transmissão.
- **Trocar os atalhos:** ⚙️ → *Atalhos de teclado* → clique no botão e aperte a tecla nova. Pra funcionar com o Telinha minimizado, use uma combinação com `Ctrl` ou `Alt` (ex: `Ctrl + Alt + M`) ou uma tecla `F1`–`F24`: letra sozinha só funciona com o Telinha na frente, senão você não conseguiria digitar essa letra em outros programas.

### ⚠️ Importante
- **O link muda toda vez** que você clica em *Hospedar*. Sempre mande o link novo.
- **A sala só existe enquanto o seu Telinha estiver aberto.** Se você fechar, todo mundo cai.
- Precisa do `cloudflared` instalado (já está neste PC). Se não estiver: `sudo pacman -S cloudflared`.

### Atalhos
| Atalho | O que faz |
|---|---|
| `Ctrl+Shift+H` | Voltar à tela inicial |
| `Ctrl+Shift+L` | Copiar o link da sala |
| `Alt` | Mostrar o menu do app |

---

## 📦 Parte 2 — Como mandar o app pros amigos

Os instaladores ficam publicados no GitHub. Mande **sempre este link** (ele aponta pra versão mais nova):

👉 **https://github.com/Castzzz/telinha/releases/latest**

Lá embaixo, em *Assets*, cada um baixa o arquivo do seu sistema:

| Seu amigo usa… | Arquivo | Atualiza sozinho? |
|---|---|---|
| **Windows** | `Telinha-Setup-<versão>.exe` | ✅ Sim |
| **Windows** (sem instalar) | `Telinha-Portatil-<versão>.exe` | ❌ Não, precisa baixar de novo |
| **Linux** | `Telinha-<versão>.AppImage` | ✅ Sim |
| **Linux** (se o AppImage não abrir) | `Telinha-<versão>.tar.gz` | ❌ Não, precisa baixar de novo |

> Os amigos só baixam **uma vez**. Quando você publica uma versão nova, o app deles baixa sozinho em segundo plano e pergunta se quer reiniciar (ou instala quando eles fecharem o app).

### Publicar uma versão nova (quando mudar o código)
1. Aumente a versão no `package.json` (ex: `"version": "1.1.0"` → `"1.2.0"`). **Sem aumentar, ninguém recebe a atualização.**
2. Salve as mudanças no git e mande pro GitHub:
   ```bash
   cd ~/Dev/telinha
   git add -A
   git commit -m "O que mudou"
   git push
   ```
3. Gere e publique os instaladores (leva uns 3–5 minutos):
   ```bash
   npm run release
   ```
   Isso compila tudo e cria a versão em *Releases* no GitHub, usando o login do `gh`.

> 💡 A parte da sala (chat, perfil, volume, botões) vem do **servidor de quem hospeda**. Se você só mudou arquivos de `public/` ou o `server.js`, basta você hospedar com o código novo: todo mundo recebe na hora, sem reinstalar. A atualização do app só é necessária quando muda algo em `electron/` ou `native/`.

---

## 🙋 Parte 3 — O que os amigos fazem

### Windows
1. Abra **https://github.com/Castzzz/telinha/releases/latest** e baixe o `Telinha-Setup-<versão>.exe` (em *Assets*).
2. Abra o arquivo. O Windows vai mostrar **"O Windows protegeu o computador"**. Isso acontece porque o app não tem assinatura paga. Clique em **Mais informações → Executar assim mesmo**.
3. O Telinha instala e abre sozinho (depois fica no Menu Iniciar).
4. Cole o link da sala que você mandou em **Entrar na sala de um amigo** → **Entrar**.
5. Se o Windows perguntar sobre o firewall, clique em **Permitir**.

> 💡 Ao transmitir no Windows 10 (2004+) ou 11: escolhendo uma **janela**, vai só o som daquele app; escolhendo a **tela inteira**, vai o som do PC sem as vozes do Telinha (não dá eco). Em Windows mais antigo o app pega **todo** o som do PC, inclusive as vozes — aí use **fone de ouvido**.

### Linux (passo a passo)
1. Abra **https://github.com/Castzzz/telinha/releases/latest** e baixe o `Telinha-<versão>.AppImage` (em *Assets*).
2. Abra um terminal na pasta onde baixou (normalmente `~/Downloads`) e dê permissão de execução:
   ```bash
   cd ~/Downloads
   chmod +x Telinha-*.AppImage
   ```
   (ou: botão direito no arquivo → *Propriedades* → *Permissões* → marcar *Permitir executar como programa*)
3. Abra:
   ```bash
   ./Telinha-*.AppImage
   ```
   Se der erro falando de **`libfuse.so.2`**, instale o fuse2 e tente de novo:
   - Arch / CachyOS / Manjaro: `sudo pacman -S fuse2`
   - Ubuntu / Mint / Pop!_OS: `sudo apt install libfuse2` (no Ubuntu 24.04+: `sudo apt install libfuse2t64`)
   - Fedora: `sudo dnf install fuse fuse-libs`
4. *(Opcional)* Pra ter no menu de aplicativos: mova o AppImage pra uma pasta fixa (ex: `~/Aplicativos`) **antes** de criar atalho. Se mover depois, o atalho quebra.
5. Cole o link da sala em **Entrar na sala de um amigo** → **Entrar**.

As atualizações chegam sozinhas: o AppImage baixa a versão nova e substitui o próprio arquivo.

**Se o AppImage não funcionar de jeito nenhum**, use o `.tar.gz` (esse não se atualiza sozinho):
```bash
cd ~/Downloads
tar -xzf Telinha-*.tar.gz
cd Telinha-*/
./telinha
```

---

## 🛠️ Problemas comuns

| Problema | Solução |
|---|---|
| *"Não encontrei uma sala do Telinha nesse link"* | O anfitrião fechou o app ou o link é antigo. Peça o link novo. Logo depois de gerar, espere uns segundos e tente de novo. |
| *"A porta 8080 está ocupada"* | Tem um servidor antigo rodando. Feche com `pkill -f "node server.js"` e tente de novo. |
| *"cloudflared não está instalado"* | `sudo pacman -S cloudflared` |
| Tela branca / app travou | `Alt` → **Telinha → Recarregar**, ou `Ctrl+Shift+H` para voltar ao início. |
| Amigos não ouvem o som da transmissão (Linux) | ⚙️ Configurações → *Som do sistema* → escolha **Som_do_PC_Jogos_e_Videos** ou **Monitor of …**. |
| Amigos não ouvem o som da transmissão (Windows) | Veja o aviso que aparece ao começar a transmitir: ele diz o erro. Se continuar, `Alt` → **Telinha → Ferramentas de desenvolvedor** → aba *Console* e procure linhas `[WebRTC]`. |
| Windows transmite o som do PC inteiro em vez de só o app | O Windows é anterior à versão 2004, ou o `telinha-audio.exe` falhou (no Console aparece `Per-app audio unavailable` com o motivo). |
| Atalho não funciona com o Telinha minimizado | Use `Ctrl`/`Alt` + tecla ou `F1`–`F24`. Se aparecer *"Outro programa já usa esse atalho"*, escolha outro. No Linux com Wayland depende do ambiente gráfico permitir atalhos globais (KDE e GNOME recentes permitem). |
| Perfil ou volumes sumiram | No navegador eles ficam salvos por link, e o link muda toda vez. Use o app desktop, que guarda no próprio PC. |
| AppImage não abre (*"libfuse.so.2"*) | Use o `.tar.gz`, ou instale: `sudo pacman -S fuse2`. |

---

## 👩‍💻 Para desenvolvedores

| Comando | O que faz |
|---|---|
| `npm run app` | Abre o app desktop (Electron do sistema) |
| `npm start` | Só o servidor web em `http://localhost:8080` |
| `npm run dev` | Servidor que reinicia sozinho ao editar `server.js` |
| `npm run dist` | Gera instaladores Linux + Windows em `dist/` (sem publicar) |
| `npm run release` | Gera e **publica** os instaladores no GitHub Releases (atualização automática) |
| `npm run dist:linux` / `npm run dist:win` | Só um dos sistemas |
| `npm run build:win-audio` | Só compila o `electron/bin/telinha-audio.exe` (precisa de `mingw-w64-gcc`) |
| `npm test` | Suíte de testes |

Pelo navegador também funciona (`npm start` + `cloudflared tunnel --url http://localhost:8080`), mas transmitir o som do PC só funciona bem no app desktop ou no Chrome/Edge.

Estrutura: `server.js` (servidor de sinalização), `public/` (interface), `electron/main.cjs` (app desktop: hospedar, túnel, captura de tela), `electron/connect.html` (tela inicial), `native/win-audio/` (auxiliar do Windows que captura o som de um processo só).
