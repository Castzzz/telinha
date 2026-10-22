# Teletela: documentação do projeto

Tudo o que precisa pra entender, rodar, mudar, publicar e manter o Teletela. Escrito pra quem
for mexer no código, inclusive agentes de IA (Claude Code, Antigravity, etc.) em outra conversa.

> O nome antigo era **Telinha**. O app virou **Teletela** na 2.0, mas muita coisa por dentro
> continua com o nome antigo de propósito (pasta do repositório, `appId`, serviços da VM,
> chaves de preferências). Veja [Nomes que não podem mudar](#nomes-que-não-podem-mudar).

---

## Sumário

1. [O que é](#1-o-que-é)
2. [Como funciona (arquitetura)](#2-como-funciona-arquitetura)
3. [Organização das pastas](#3-organização-das-pastas)
4. [Rodar no seu PC](#4-rodar-no-seu-pc)
5. [Testes](#5-testes)
6. [Publicar uma versão (release)](#6-publicar-uma-versão-release)
7. [Atualizar o servidor (deploy)](#7-atualizar-o-servidor-deploy)
8. [O servidor na nuvem (VM da Oracle)](#8-o-servidor-na-nuvem-vm-da-oracle)
9. [Dados guardados](#9-dados-guardados)
10. [Protocolo: eventos do Socket.IO](#10-protocolo-eventos-do-socketio)
11. [Onde fica cada funcionalidade no código](#11-onde-fica-cada-funcionalidade-no-código)
12. [Convenções](#12-convenções)
13. [Armadilhas conhecidas](#13-armadilhas-conhecidas)
14. [Checklist pra uma mudança](#14-checklist-pra-uma-mudança)

---

## 1. O que é

Um "Discord pequeno" pra um grupo de amigos: canais de voz, transmissão de tela com o som do PC
separado do microfone, chat, canais de texto que ficam salvos, soundboard, perfil personalizado
e um admin pra moderar.

- **App desktop** (Electron) pra Windows e Linux, com atualização automática pelo GitHub Releases.
- **Servidor** (Node + Socket.IO) que cuida de canais, chat, presença e moderação.
- **SFU** (Go + Pion WebRTC) que repassa voz, tela e câmera: cada um manda uma vez só pro
  servidor e ele distribui pra quem está assistindo.
- A sala "oficial" roda numa VM grátis da Oracle em **https://colheitafartus.duckdns.org**.
- Também dá pra **hospedar uma sala no próprio PC** pelo app (sem SFU, tudo P2P), com link
  público temporário via `cloudflared`.

Repositório público: https://github.com/Castzzz/telinha

## 2. Como funciona (arquitetura)

```
        App desktop (Electron)                          VM Oracle (colheitafartus.duckdns.org)
 ┌──────────────────────────────────┐            ┌──────────────────────────────────────────┐
 │ electron/main.cjs                │            │ Caddy :443 (HTTPS automático)             │
 │  - janela, atalhos, atualização  │            │   /sfu/*  → telinha-sfu   :8081 (Go)      │
 │  - serve public/ em telinha://app│  Socket.IO │   resto   → telinha-server:8080 (Node)    │
 │                                  │ ─────────► │                                          │
 │ public/ (a interface da sala)    │            │ server.js: canais, chat, texto, perfil,   │
 │  app.js, audio-manager.js, ...   │  WebRTC    │   admin, soundboard, senhas pro SFU       │
 │                                  │ ─────────► │ sfu/main.go: repassa voz/tela/câmera      │
 └──────────────────────────────────┘ (UDP/TCP   │   (porta de mídia 50000 UDP/TCP)          │
                                        50000)   └──────────────────────────────────────────┘
```

Pontos importantes:

- **A interface vem instalada no app.** O Electron serve a pasta `public/` empacotada pelo
  protocolo `telinha://app` (`electron/app-protocol.cjs`) e passa o endereço da sala em
  `?server=https://...`. Do servidor só vem a conexão Socket.IO e os arquivos de mídia
  (`/api/avatar/...`, `/api/banner/...`, etc.). **Mudou `public/`? Precisa de release**, não
  basta o deploy.
- Pelo navegador também funciona: aí a página vem do próprio `server.js` (que serve `public/`).
- Abrir o site ou a sala pelo app começa **fora da call**, inclusive ao recarregar e com
  `?channel=` ou um canal salvo por versões antigas. O perfil é enviado ao conectar para
  usar texto sem voz. Clicar num canal entra na call e abre o mic; reconectar após uma queda
  de rede retoma apenas a call já escolhida nessa janela, mantendo o estado do microfone.
- **Sala na nuvem:** voz, tela e câmera passam pelo SFU. O `server.js` dá uma senha temporária
  (HMAC com `SFU_SECRET`) pra cada conexão no SFU (evento `sfu-token`). Salas do SFU:
  `<canal>__<id>` (tela 1), `<canal>__<id>__cam`, `<canal>__<id>__voz`, `<canal>__<id>__s2`,
  `<canal>__<id>__s3` (telas extras).
- **Sala hospedada no PC:** o Electron sobe o próprio `server.js` (`ensureLocalServer`) na
  porta 8080, sem SFU (`SFU_SECRET` vazio); tudo vai P2P. O link público é um quick tunnel do
  `cloudflared` (precisa estar instalado).
- **Áudio no cliente:** Web Audio. Vozes passam por um ganho que o "ensurdecer" zera; as
  transmissões passam por outro (dá pra continuar ouvindo as telas ensurdecido). Tudo termina
  no volume geral. Veja `VolumeMixerManager` em `public/audio-manager.js`.

## 3. Organização das pastas

```
server.js                  Servidor da sala (Express + Socket.IO). Um arquivo só.
sfu/main.go                SFU em Go (Pion). Compilado no deploy.
go.mod, go.sum             Dependências do SFU.

public/                    A interface (vai dentro do app E é servida pelo server.js)
  index.html               Toda a estrutura da tela, modais e o popup de novidades
  app.js                   Toda a lógica do cliente (~6400 linhas, dividido em seções numeradas)
  audio-manager.js         Mixer de volume, ensurdecer, captura de áudio, VAD
  style.css                Estilos base + temas (escuro / preto / claro)
  redesign.css             O visual 3.0 (vale com <html data-look="novo">, fixo no index.html)
  icon.png                 Ícone (favicon, logo da barra de cima, janela)
  sounds/amigo-1..9.ogg    Áudios de entrar/sair gravados pelos amigos. FORA DO GIT (veja §13)
  vendor/emoji-picker/     Seletor de emojis (emoji-picker-element, copiado; ver README.txt dele)
  vendor/noise-suppressor/ RNNoise (cancelamento de ruído com IA)

electron/
  main.cjs                 Processo principal: janela, tela inicial, hospedar sala, túnel,
                           captura de tela/áudio, atalhos globais, auto-update, preferências
  preload.cjs              Ponte segura (window.electronAPI) entre a página e o main
  app-protocol.cjs         Protocolo telinha://app que serve public/ empacotado
  connect.html             Tela inicial (entrar na sala do servidor / hospedar / colar link)
  bin/                     telinha-audio.exe compilado (FORA DO GIT, gerado no build)

native/win-audio/          Auxiliar do Windows que captura o som de UM programa só (C++)
build/                     Ícone do app pro electron-builder (icon.svg é a fonte; png/ico gerados)
deploy/oracle/
  deploy.sh                Roda no SEU PC: backup, compila, empacota, manda pra VM e chama o install
  config.sh                IP da VM, domínio e chave SSH (os outros scripts leem daqui)
  backup.sh / restore.sh   npm run backup / npm run restore (dados da sala ↔ ~/Teletela-backups)
  backup-auto.sh           npm run backup:auto (timer diário no seu PC)
  install.sh               Roda NA VM: instala Node/Caddy, serviços systemd, firewall, segredos

tests/
  runner.js                Runner próprio (npm test): 62 testes em 4 "tiers" (unit/mocks)
  m1-*.test.js ...         Testes de servidor/áudio com node:test
  m4-channels-admin.test.js  Teste de integração grande: sobe o server.js de verdade
  helpers/, e2e/           Utilitários e cenários do runner

README.md                  Pra quem USA (download, instalar, como usar) + resumo pra quem mantém
LEIA-ME-AMIGOS.txt         Guia curtinho pros amigos
docs/PROJETO.md            Este arquivo
docs/RECUPERAR-SERVIDOR.md Passo a passo pra recriar a sala se a VM sumir
AGENTS.md / CLAUDE.md      Guia rápido pra agentes de IA
telinha.desktop            Atalho de menu pro Linux
```

## 4. Rodar no seu PC

Pré-requisitos: Node 20.11+ (o projeto usa Node 26 no PC do dono), **Electron instalado no
sistema** (o `npm run app` usa o `electron` do sistema; não há Electron em `node_modules`),
e Go (só pra mexer no SFU; está em `~/.local/go/bin` no PC do dono).

```bash
npm install
npm run app        # abre o app desktop (usa o Electron do sistema)
npm start          # só o servidor, em http://localhost:8080 (abra no navegador)
npm run dev        # servidor reiniciando ao salvar o server.js
npm run sfu        # SFU local (go run ./sfu), raramente necessário
```

Variáveis de ambiente do `server.js`:

| Variável | Pra quê | Padrão |
|---|---|---|
| `PORT` | Porta HTTP | `8080` |
| `TELINHA_DATA_DIR` | Pasta onde ficam canais, histórico de texto, soundboard | vazio = tudo temporário (some ao reiniciar) |
| `ADMIN_KEY` | Senha de admin da sala | vazio = sala sem admin |
| `SFU_SECRET` | Liga o SFU e assina as senhas dele | vazio = sem SFU (P2P) |
| `SFU_PATH` | Caminho do websocket do SFU atrás do Caddy (mandado pro cliente junto com a senha) | `/sfu/ws` |

Exemplo de servidor local completo pra testar admin e dados salvos:

```bash
PORT=3999 ADMIN_KEY=segredo1 TELINHA_DATA_DIR=/tmp/teletela-data node server.js
```

Sem `SFU_SECRET` a transmissão vai P2P, o que é ótimo pra testar no mesmo PC.

## 5. Testes

```bash
npm test                                   # runner próprio: 62 testes, devem passar todos
node --test tests/m1-*.test.js tests/m2-*.test.js tests/m3-*.test.js
node tests/m4-channels-admin.test.js       # integração: sobe o server.js de verdade
```

- Todos os testes têm que passar. (O `M2.3` falhou por muito tempo porque esperava o AGC do
  microfone ligado; ele foi desligado de propósito e o teste foi corrigido na 3.2.)
- O `m4` cobre: canais salvos, apagar canal, admin (login, tirar da call, mutar/ensurdecer pra
  todos, mover de call), cor do nome, GIF de perfil, várias telas, imagens no chat, canais de
  texto (inclusive sobrevivendo a reinício), perfil 3.0 (banner, moldura, som de entrada),
  responder/editar/apagar/reagir, soundboard, fixar, "digitando" e senha da sala (com chave
  de membro). **Quando mexer no servidor, acrescente um caso
  lá.**
- Pra conferir a interface sem abrir o app na mão, o jeito usado até agora foi um script
  Electron "headless" (janelas `offscreen: true`) com dois ou três clientes conectados num
  servidor local, simulando cliques com `executeJavaScript` e tirando prints com
  `capturePage()`. Esses scripts não ficam no repositório.

## 6. Publicar uma versão (release)

Uma versão nova é o que faz os apps da galera atualizarem sozinhos.

1. Aumente o `version` no `package.json` (ex: `3.1.0` → `3.2.0`). **Sem isso ninguém recebe.**
2. Atualize o popup de novidades:
   - `WHATS_NEW_VERSION` em `public/app.js` (ex: `'3.2'`);
   - o texto em `#modal-whats-new` no `public/index.html`: a lista de cima é a versão nova; a
     anterior vira um bloco `<div id="whats-new-3-1" class="whats-new-older hidden">`;
   - em `showWhatsNewOnce()` (`app.js`), uma linha mostrando o bloco pra quem pulou a versão
     (`seen >= 3.1`).
3. Commit (veja [Convenções](#12-convenções): **nunca** adicione `public/sounds/`).
4. `npm run release`

O `release` compila o `telinha-audio.exe` (precisa do `mingw-w64-gcc`), gera AppImage,
tar.gz, instalador e portátil do Windows, e publica no GitHub Releases usando o login do
`gh` (`gh auth token`). Leva uns 3 a 5 minutos. O release já sai publicado (não fica rascunho).

Confira:

```bash
gh release view v3.2.0 --json isDraft,assets -q '{draft: .isDraft, assets: [.assets[].name]}'
```

Precisa ter: `latest.yml`, `latest-linux.yml`, `Teletela-Setup.exe`(+`.blockmap`),
`Teletela-Portatil.exe`, `Teletela.AppImage`, `Teletela.tar.gz`.

Depois, se quiser, `git push` (o release não depende do push, mas o código no GitHub fica
atrás se esquecer).

### Quando precisa de release e quando de deploy

| Mudou | Release | Deploy |
|---|---|---|
| `public/` (interface) | **sim** | sim (pra quem usa pelo navegador) |
| `server.js` | não | **sim** |
| `sfu/` | não | **sim** |
| `electron/`, `build/`, `package.json` (build) | **sim** | não |
| `deploy/oracle/install.sh` | não | **sim** |

Se mudou o protocolo entre os dois (evento novo), normalmente são os dois. O servidor novo
tem que continuar funcionando com o app antigo até todo mundo atualizar.

## 7. Atualizar o servidor (deploy)

```bash
npm run deploy:oracle
```

O que o `deploy/oracle/deploy.sh` faz, no seu PC:

1. Detecta a arquitetura da VM pelo SSH e compila o SFU pra `linux/amd64` ou `linux/arm64`.
2. Empacota `server.js`, `package.json`, `package-lock.json` e `public/` com
   `npm ci --omit=dev` (sem as dependências do app desktop).
3. Descobre a versão LTS mais nova do Node e a mais nova do Caddy (ou usa `NODE_VERSION` e
   `CADDY_VERSION`, se definidos).
4. Manda tudo por `scp` pra VM e roda o `install.sh` lá com `sudo`.

No fim ele mostra o endereço. A senha de admin continua em `/etc/telinha/telinha.env`, sem
ser exibida nos logs do deploy.

Precisa de:

- A chave SSH `~/.ssh/oracle_telinha_ampere`, que só existe no PC do dono. Sem ela não tem deploy.
- Go instalado. O script procura no PATH e, se não achar, em `~/.local/go/bin/go`.
- IP da VM, domínio e chave ficam em `deploy/oracle/config.sh` (dá pra sobrescrever com
  `VM=...`, `DOMAIN=...`, `SSH_KEY=...` na linha de comando).
- `DUCKDNS_TOKEN=xxxx`, só na primeira vez ou pra trocar o token.
- `ACTIVATE_DUCKDNS=0` no deploy **e** restore permite preparar uma VM sem mudar o domínio.
  Para uma troca planejada, siga [MIGRAR-SERVIDOR.md](MIGRAR-SERVIDOR.md).

**O deploy reinicia o servidor.** Isso derruba todo mundo por uns segundos (o app reconecta
sozinho) e perde o que só existe na memória (veja [§9](#9-dados-guardados)).

## 8. O servidor na nuvem (VM da Oracle)

- **VM:** Oracle Cloud Ampere `VM.Standard.A1.Flex`, 2 CPUs ARM64, 12 GB de RAM, disco de
  100 GB, Ubuntu 26.04 LTS, região São Paulo. IP `144.22.225.236`, usuário `ubuntu`.
  Domínio DuckDNS (`colheitafartus.duckdns.org`), com timer que atualiza o IP a cada 30 min.
- O instalador usa binários oficiais de Node e Caddy com hash conferido e detecta ARM64 ou
  x86_64. No Ubuntu da Oracle, acrescenta regras de iptables antes do REJECT e salva com
  `netfilter-persistent`, preservando as regras existentes; também suporta ufw ativo e firewalld.
- **VM antiga:** `opc@163.176.189.41`, Oracle Linux 9, x86_64, 1 GB de RAM. Não rode `dnf`
  nela: trava por falta de memória. Depois da migração, Node/SFU e DuckDNS ficam desativados;
  o Caddy encaminha para a nova VM enquanto houver clientes com DNS antigo em cache.

Serviços (systemd):

| Serviço | O quê | Porta | Limite de RAM |
|---|---|---|---|
| `telinha-server` | `node server.js` | 8080 | 3 GB (`--max-old-space-size=2048`) |
| `telinha-sfu` | `/opt/telinha/bin/telinha-sfu` | 8081 + mídia 50000 UDP/TCP | 2 GB |
| `caddy` | HTTPS, `/sfu/*` → 8081, resto → 8080 | 80/443 | 150 MB |
| `duckdns.timer` | atualiza o IP no DuckDNS | | |
| `telinha-keepalive.timer` | a cada 2 h, gasta meio núcleo por 20 min (só CPU, prioridade mínima) pra VM não ser "recuperada" pela Oracle por ficar parada. Desliga com `sudo touch /etc/telinha/keepalive.off` | | 16 MB |

Em máquinas com até 4 GB de RAM, o instalador mantém os limites menores: Node com heap de
192 MB e serviço de 300 MB, SFU com 200 MB.

Caminhos na VM:

| Caminho | O quê |
|---|---|
| `/opt/telinha/app/` | o servidor (apagado e recriado a cada deploy) |
| `/opt/telinha/data/` | **dados que ficam** (canais, texto, soundboard) |
| `/opt/telinha/bin/telinha-sfu` | SFU compilado |
| `/opt/telinha/node/` | Node |
| `/etc/telinha/telinha.env` | `SFU_SECRET` e `ADMIN_KEY` (gerados uma vez, só ficam aqui) |
| `/etc/telinha/duckdns.env` | token do DuckDNS |
| `/etc/caddy/Caddyfile` | proxy |

Comandos úteis (pelo SSH):

```bash
ssh -i ~/.ssh/oracle_telinha_ampere ubuntu@144.22.225.236
sudo systemctl status telinha-server telinha-sfu caddy
sudo journalctl -u telinha-server -n 100 --no-pager      # logs do servidor
sudo journalctl -u telinha-sfu -f                        # logs do SFU ao vivo
sudo systemctl restart telinha-server
```

**Senha de admin:** fica em `/etc/telinha/telinha.env` e não aparece nos logs do deploy. Pra
trocar: apague a linha `ADMIN_KEY` desse arquivo e rode o deploy. **Ela nunca vai pro git.**

## 9. Dados guardados

**Salvos em disco** (`TELINHA_DATA_DIR`, na VM `/opt/telinha/data`):

| Arquivo | O quê |
|---|---|
| `channels.json` | `{ channels, textChannels }`: canais de voz e de texto criados (o Geral é fixo) |
| `text/<canal>.jsonl` | histórico de cada canal de texto (veja abaixo) |
| `text/images/` | imagens dos canais de texto (até 5 GB; passando, apaga as mais antigas) |
| `soundboard/index.json` + arquivos | sons do soundboard (8 por pessoa, até 400 KB, 150 no total) |
| `room.json` | senha da sala (só o hash scrypt) e o segredo das chaves de membro |
| `chat-images/` | imagens do chat da call (300 MB; **apagadas a cada reinício**) |

Formato do `text/<canal>.jsonl`: uma linha por mensagem. Editar, apagar e reagir **não
reescrevem** o arquivo: viram uma linha nova com `op` (`{"op":"edit",...}`,
`{"op":"delete",...}`, `{"op":"reactions",...}`) que é aplicada na leitura
(`readTextMessages`). A cada 1000 ops, ou passando de 20 mil mensagens (fica com 90%), o
arquivo é reescrito limpo. As últimas 100 mensagens de cada canal ficam na memória.

Mensagem fixada também é uma op (`{"op":"pin",...}`), guardada no campo `pinned: { by, at }`.

**Backup:** `npm run backup` (`deploy/oracle/backup.sh`) baixa essa pasta (menos `chat-images/`)
e o `/etc/telinha` da VM (senha de admin, segredo do SFU, token do DuckDNS) pra
`~/Teletela-backups` no seu PC e guarda os 15 mais novos. `npm run backup:auto` liga um timer
do systemd do seu usuário que faz isso uma vez por dia (`-- off` desliga). **Se a VM sumir:
[docs/RECUPERAR-SERVIDOR.md](RECUPERAR-SERVIDOR.md).** O deploy faz um backup antes de
mexer na VM (pule com `SKIP_BACKUP=1`). Pra voltar: `npm run restore -- <arquivo.tar.gz>`
(`deploy/oracle/restore.sh` pede confirmação, faz backup do estado atual, para o servidor,
troca a pasta e sobe de novo).

**Só na memória** (somem quando o servidor reinicia):

- o chat da call (últimas 50 mensagens por canal);
- quem está mutado/ensurdecido pelo admin;
- foto, banner e som de entrada de cada pessoa (cada app manda de novo quando conecta);
- canais de voz criados por link (temporários).

**No PC de cada um** (preferências): no app desktop, um arquivo JSON na pasta de dados do
Electron, lido e gravado pelo `main.cjs` (`prefs-get`/`prefs-set`). A pasta continua sendo a
antiga, **"Telinha"**, de propósito, pra ninguém perder perfil e configurações. No navegador
as preferências ficam no `localStorage` (`telinha_prefs`). O perfil (nome, foto, banner, som
de entrada, cor, moldura) fica nas preferências e é mandado pra sala a cada conexão.

Identidade: cada pessoa tem um `profileId` aleatório gerado no primeiro uso e guardado nas
preferências. Dá pra levar pra outro PC com *Exportar/Importar perfil* (no modal do perfil):
o arquivo JSON tem o perfil inteiro, inclusive o `profileId`. É ele que identifica "quem criou o canal", "de quem é a mensagem", reações,
moderação do admin e o volume que você deu pra cada amigo. **Não existe conta nem senha
pessoal.**

### Senha da sala e chave de membro

- O admin define a senha pelo app (`admin-set-room-password`; vazio tira). O servidor guarda
  só o hash (scrypt + sal) em `room.json`.
- Um middleware do Socket.IO (`io.use`) barra a conexão sem uma destas, mandadas no
  `auth` do handshake: `roomPassword`, `adminKey` ou `profileId` + `memberKey`. O erro é
  `room-password` (com `data.reason` `required` ou `wrong`), e o app abre o modal de senha.
- **Chave de membro:** toda conexão aceita recebe `member-key` = HMAC-SHA256(`memberSecret`,
  `profileId`). O app guarda por sala (`prefs.roomAccess[servidor]`). Por isso quem já usou o
  app, ou estava online quando a senha foi colocada, não precisa digitar nada.
- `admin-reset-members` troca o `memberSecret`: quem não estiver online precisa da senha de
  novo (quem está online ganha a chave nova na hora).
- Com senha, `/api/channels` responde 401. As outras rotas de mídia usam ids difíceis de
  adivinhar.
- App antigo (antes da 3.2) não sabe pedir senha: **só coloque senha depois que todo mundo
  atualizar**, senão quem estiver desatualizado fica preso.

## 10. Protocolo: eventos do Socket.IO

Cliente → servidor (com callback `cb({ success, error })` quando faz sentido):

| Evento | Pra quê |
|---|---|
| `join-channel` `{ channelId, profile, isMicOn, ... }` | entrar num canal de voz (o perfil vai junto) |
| `leave-channel` | sair da call |
| `update-profile` | mudou o perfil |
| `user-state-changed` | mic, ensurdecer, transmitindo, câmera, telas extras, falando, o que está assistindo (`watching`) |
| `create-channel` / `delete-channel` | canais de voz |
| `create-text-channel` / `delete-text-channel` / `text-history` / `text-message` / `text-image` | canais de texto |
| `chat-message` / `chat-image` | chat da call (aceitam `replyTo`) |
| `message-edit` / `message-delete` / `message-react` | `{ scope: 'call'|'text', channelId?, messageId, ... }` |
| `message-pin` / `text-pins` | fixar/desfixar e listar as fixadas (só canal de texto) |
| `typing` `{ scope, channelId? }` | "está digitando" (o app manda a cada ~3 s enquanto digita) |
| `admin-set-room-password` / `admin-reset-members` | senha da sala e chaves de membro |
| `soundboard-add` / `soundboard-delete` / `soundboard-play` | soundboard |
| `reaction` | emoji flutuando na call |
| `sfu-token` | senha temporária pra entrar numa sala do SFU |
| `admin-login`, `kick-user`, `admin-move-user`, `admin-mute-user`, `admin-deafen-user` | admin |
| `webrtc-offer` / `webrtc-answer` / `webrtc-ice-candidate` / `webrtc-signal` / `request-stream` | sinalização P2P (sala no PC) |

Servidor → cliente (principais): `channels-list` (e `channels-summary`, mesmo conteúdo, pra
app antigo), `channel-state`, `user-joined`, `user-left`, `user-state-changed` (e
`user-state-updated`), `user-profile-updated`, `chat-message`, `chat-message-updated`,
`chat-message-deleted`, `text-channels`, `text-message`, `text-message-updated`,
`text-message-deleted`, `text-channel-deleted`, `soundboard-list`, `soundboard-played`,
`typing`, `member-key`, `room-info`, `room-password-changed`,
`server-moderation`, `moved-by-admin`, `kicked`, `reaction`.

Rotas HTTP: `/api/health`, `/api/channels`, `/api/avatar/:userId`, `/api/banner/:userId`,
`/api/join-sound/:userId`, `/api/soundboard/:id`, `/api/chat-image/:file`,
`/api/text-image/:file`.

## 11. Onde fica cada funcionalidade no código

`public/app.js` é dividido em seções numeradas (procure por `// 1.`, `// 2.`, etc.):
1 helpers, 2 estado (`appState`), 3 conexão, 4 eventos do servidor, 5 navegação de canais,
6 lista de canais e pessoas, 7 chat, 8 dock e configurações (8a tela cheia, 8b volume por
pessoa, 8c perfil, 8d atalhos), 9 WebRTC P2P, 10 áudio do sistema, depois SFU e cancelamento
de ruído, e 11 inicialização (`initApp`).

| Funcionalidade | Onde procurar |
|---|---|
| Lista de canais/pessoas (ordem alfabética, recolher, arrastar pra mover) | `renderChannelsTree`, `sortedUsers`, `setupCategoryCollapse`, `moveUserToChannel` |
| Canais de texto | `renderTextChannels`, `openTextChannel`, `loadTextHistory`; servidor: `readTextMessages`, `appendTextMessage` |
| Chat (responder, reagir, editar, apagar) | `buildChatMessage`, `setupChatMessageActions`, `startEditMessage`; servidor: `message-edit/delete/react` |
| @menção | `mentionify`, `mentionsMe`, `notifyMention`, `setupMentionAutocomplete` |
| Fixar mensagem | `pinMessage`, `renderPins`, `setupPins`; servidor: `message-pin`, `text-pins` |
| "Está digitando" | `setupTyping`, `renderTyping`; servidor: `typing` |
| Senha da sala | cliente: `roomAccess`, `openRoomPasswordModal`, `setupRoomPasswordAdmin`; servidor: `io.use`, `isMemberKey`, `setRoomPassword` |
| Exportar/importar perfil | `setupProfileTransfer` |
| Soundboard | `setupSoundboard`, `renderSoundboard`, `playSoundboard`; servidor: bloco `SOUNDBOARD` |
| Sons de entrar/sair | `playCallSound`, `callSoundChoiceUrl`, `joinSoundUrl` (som do perfil) |
| Perfil (banner, moldura, gradiente, perfil grande) | `renderProfileDraft`, `frameClass`, `nameCss`, `bannerCss`, `openProfileCard`; servidor: `applyProfile` |
| Admin | `setupAdminSettings`, popup da pessoa (`openUserPopover`); servidor: `moderate`, `applyServerModeration` |
| Transmissão de tela/câmera, várias telas | `startExtraScreen`, `streamKey`, `updateStageLayout`, `layoutMosaic` (mosaico redimensionável) |
| Quem está assistindo | `syncWatching`, `renderStreamViewers` |
| Volume / ensurdecer | `audio-manager.js`: `VolumeMixerManager`, `DeafenController` |
| Atalhos de teclado | seção 8d (`eventToAccelerator`, `SOLO_KEY_CODES`); globais: `setGlobalHotkeys` no `main.cjs` (Ctrl/Shift/Alt sozinhos via `uiohook-napi`) |
| Temas e visual | `style.css` (tokens em `:root`, `[data-theme="preto"]`, `[data-theme="claro"]`), `redesign.css` |
| Configurações (abas) | `#modal-settings` no `index.html`, abas `data-settings-tab` |
| Popup de novidades | `showWhatsNewOnce`, `#modal-whats-new` |
| Tela inicial, hospedar sala, túnel | `electron/connect.html`, `ensureLocalServer`, `startTunnel` no `main.cjs` |
| Som de um app só | Linux: `routeAppAudio` (PipeWire/Pulse); Windows: `native/win-audio` + `start-win-audio` |
| Auto-update | `electron-updater` no `main.cjs` (lê o `latest*.yml` do release) |

## 12. Convenções

- **Tudo em português**: interface, mensagens, comentários e commits. Tom informal, do jeito
  que o grupo fala.
- Comentários explicam o **porquê**, curtos, no mesmo estilo dos que já existem.
- Commits: `git add -A -- . ':!public/sounds'` (**nunca** adicionar os áudios) e mensagem em
  português dizendo o que mudou pra quem usa. Quem commita com IA costuma terminar com a
  linha `Co-Authored-By` da ferramenta.
- Sem framework no front: HTML + CSS + JS puro, módulos ES. Sem build do front.
- Ícones: SVG desenhado no mesmo traço (`stroke-width 2`, `round`), classe `icon-svg`.
  Emojis só onde é emoji mesmo (reações, soundboard).
- Cores sempre pelos tokens CSS (`var(--bg-primary)` etc.) pra funcionar nos 3 temas.
- O servidor valida tudo que vem do cliente (`safeObject`, regex, limites de tamanho) e nunca
  confia no app. Mídia enviada passa por checagem de tipo (`imageMatchesType`, `SOUND_RE`).
- Compatibilidade: o servidor manda alguns eventos com dois nomes pra app antigo
  (`channels-list` + `channels-summary`, `user-state-changed` + `user-state-updated`), e o
  cliente só escuta um. Evento novo não pode quebrar quem ainda não atualizou.

## 13. Armadilhas conhecidas

Coisas que já deram problema e o motivo:

1. **Mudou `public/` e só fez deploy:** quem usa o app não recebe nada, porque a interface
   vem instalada nele. Precisa de release.
2. **Esqueceu de aumentar a versão** no `package.json`: o release sai, mas ninguém atualiza.
3. **`public/sounds/` fora do git:** são vozes dos amigos e o repositório é público. Os
   arquivos ficam só no PC do dono, mas **vão dentro do instalador**, então o release tem que
   ser feito de um PC que tenha essa pasta. Clonando o repositório em outro lugar, os sons de
   entrar/sair e os "Áudios do app" do soundboard não existem.
4. **`dnf` na VM antiga** trava a máquina (1 GB de RAM). Não rode; a nova usa Ubuntu.
5. **Mídia baixada com `fetch()` pelo app** (som de entrada, soundboard) precisa do cabeçalho
   `Access-Control-Allow-Origin: *` no servidor, porque o app roda em `telinha://app` (outra
   origem). Sem isso o som toca só pra quem subiu. `<img>` não precisa disso.
6. **Reiniciar o servidor** (todo deploy faz isso) perde o chat da call, a moderação do admin
   e a mídia do perfil até cada um reabrir o app.
7. **Electron do sistema:** não há Electron em `node_modules`; o `npm run app` e os scripts de
   teste usam o binário do sistema (`command -v electron` ou `/usr/lib/electron*/electron`).
   `npx electron` baixa outra versão: não use.
8. **Ícone no `.exe`:** a config do Windows usa `"signExecutable": false` (e não
   `signAndEditExecutable: false`), senão o electron-builder não grava o ícone no executável.
9. **`uiohook-napi`** (atalhos com Ctrl/Shift/Alt sozinhos) é dependência **opcional** e usa
   binário pronto (N-API). Por isso o build tem `"npmRebuild": false`. Se ela não carregar, as
   teclas sozinhas só funcionam com a janela em foco.
10. **Wayland:** atalho global no meio do jogo é do compositor; o app abre um socket em
    `$XDG_RUNTIME_DIR/telinha.sock` que o compositor chama (`/mute`, `/deafen`). Está no README.
11. **Ensurdecer não cala as transmissões** (escolha do grupo). Quem quiser o jeito antigo
    marca a opção em Configurações → Som (`prefs.deafenStreams`).
12. **Mic aparecendo mutado mas falando:** quem ouve zera o volume de quem está com
    `isMicOn: false` (proteção contra app antigo). Se mexer em `applyUserVolume`, mantenha isso.
13. **Senha da sala com app antigo:** quem está numa versão antes da 3.2 não consegue digitar
    a senha. Coloque senha só depois que todo mundo atualizar.
14. **Arquivo `channels.json`/`text/*.jsonl` corrompido:** o servidor ignora linhas inválidas
    em vez de cair; o arquivo é reescrito via `.tmp` + `rename` pra não corromper no meio.
15. **Duas VMs atualizando DuckDNS:** a antiga pode reapontar o domínio para si a cada 30 min.
    Desative o timer antigo antes de ativar o novo. A cópia final dos dados precisa da antiga
    parada. Procedimento e volta em [MIGRAR-SERVIDOR.md](MIGRAR-SERVIDOR.md).
16. **Restore rejeitando backup válido:** não use `grep -q` na listagem do tar com pipefail;
    o pipe fecha antes de o tar terminar e provoca SIGPIPE. O validador lê a listagem completa.

### Nomes que não podem mudar

Mudar qualquer um destes quebra a atualização automática ou faz a galera perder dados:

- `appId: com.castzin.telinha` e `desktopName: telinha.desktop` (package.json).
- A pasta de dados do Electron fixada em **"Telinha"** (`app.setPath('userData', ...)` no
  `main.cjs`).
- Repositório `Castzzz/telinha` (o auto-update procura os releases lá).
- Chaves de preferências como `telinha_prefs`, `telinha_audio_*`.
- Nomes de artefato `Teletela.AppImage`, `Teletela-Setup.exe` etc. (os links do README
  apontam pra eles).
- Na VM: serviços `telinha-*`, `/opt/telinha`, `/etc/telinha`. Dá pra mudar, mas exige
  migrar na mão.

## 14. Checklist pra uma mudança

1. Ler a seção certa do `app.js`/`server.js` (tabela da §11) e seguir o estilo do redor.
2. Mexeu no servidor: validar entrada, pensar em app antigo e acrescentar caso no `m4`.
3. Rodar `npm test`, `node --test tests/m1-*.test.js tests/m2-*.test.js tests/m3-*.test.js`
   e `node tests/m4-channels-admin.test.js`.
4. Conferir na tela (`npm run app`, de preferência com dois apps num servidor local).
5. Atualizar o README (tabela "Como usar") se mudou algo que o usuário vê, e este arquivo se
   mudou arquitetura, deploy, dados ou uma armadilha nova.
6. Pra lançar: versão no `package.json` + popup de novidades, commit sem `public/sounds/`,
   `npm run release` e/ou `npm run deploy:oracle` (tabela da §6).
