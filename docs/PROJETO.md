# Teletela: documentação do projeto

Tudo o que precisa pra entender, rodar, mudar, publicar e manter o Teletela. Escrito pra quem
for mexer no código, inclusive agentes de IA (Claude Code, Antigravity, etc.) em outra conversa.

**Pedidos e andamento:** [pendências anotadas com o dono](PENDENCIAS.md). PiP Android,
cargos sem conta e canais invisíveis na 3.7.0. Contas/amigos e reforço de voz estão
preservados em `teste/contas-amigos-e-canais-com-senha` (commit `08b262e`).

**Implementado para teste (28/10/2026):** branch `melhoria/cinema-dados-contas-e-privacidade`:
miniplayer, modo cinema, privacidade inclusive para o dono, dados de RPG, ícones,
launcher e contas opcionais. O APK continua acompanhando as atualizações; múltiplos
servidores ficam para depois. Este trabalho ainda não tem versão publicada.

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
- **Android em teste** (`android/`): APK com a mesma interface empacotada em WebView e serviço
  nativo para a chamada. Veja [ANDROID.md](ANDROID.md) para compilar, instalar e testar.
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
  usar texto sem voz. `prefs.micOn` guarda a escolha de mutado/desmutado entre aberturas;
  sem preferência salva, começa mutado. Restaurar o botão não abre a captura: ao entrar na
  call, ela é aberta se o mic estiver ligado. Clicar num canal preserva o estado escolhido
  no dock, inclusive ao sair e entrar de novo. Moderação não sobrescreve a escolha salva;
  ensurdecer pelo botão salva o mic desligado e restaurar o áudio salva o estado recuperado.
  Falha ao abrir o microfone volta ao mute e salva esse estado. Reconectar após uma queda
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
- **Microfone (3.9.0):** revertido ao processamento da 3.7 por relato de áudio estranho.
  `microphone.js` usa RNNoise opcional → ganho manual → destino Web Audio, sem GTCRN,
  compressão, limitador ou reforço automático. Mantém o formato do destino da 3.7.
  `prefs.micOn` lembra o mute; `micGain` controla 0–300%. O modo antigo `ia-leve` é
  tratado como IA/RNNoise. A troca de filtro preserva o mute e libera a captura anterior.
  [DIAGNOSTICO-MICROFONES.md](DIAGNOSTICO-MICROFONES.md) guarda o experimento histórico.
- **Celular:** `mobile.css` e `mobile.js` usam navegação própria: Canais e Você.
  A call e o chat abrem em telas separadas; uma faixa compacta mantém mute e saída da call
  disponíveis ao navegar. Os botões móveis disparam os controles originais, sem duplicar
  a lógica de WebRTC. Configurações abrem por assunto e ações de mensagem usam uma folha
  embaixo. O layout desktop continua em `style.css`/`redesign.css`.
  O APK usa `WebViewAssetLoader` em `https://appassets.androidplatform.net/` para
  servir os arquivos instalados, conectando ao mesmo Node/SFU do desktop. A ponte
  `TeletelaAndroid` recebe o estado da call e abre a escolha de saída de áudio.
  `CallService` mantém uma notificação e o serviço de microfone/reprodução enquanto há call.
  A saída nativa carrega um ID da chamada: o encerramento assíncrono de um serviço antigo
  não pode tirar a pessoa da call seguinte. Ao sair, a captura é fechada, preservando a
  escolha do botão para a próxima entrada.
  PiP nativo usa `mobile-pip.js` e `MainActivity`: vídeo remoto em uma janela do sistema
  ao minimizar, sem duplicar a captura ou mudar o mixer. Detalhes em [ANDROID.md](ANDROID.md).
  Compartilhar a tela do celular exige integração MediaProjection e ainda não existe.

## 3. Organização das pastas

```
server.js                  Servidor da sala (Express + Socket.IO).
permission-store.js        Identidade persistente, propriedade, cargos e regras dos canais sem conta.
sfu/main.go                SFU em Go (Pion). Compilado no deploy.
go.mod, go.sum             Dependências do SFU.

public/                    A interface (vai dentro do app E é servida pelo server.js)
  index.html               Toda a estrutura da tela, modais e o popup de novidades
  app.js                   Toda a lógica do cliente (~6400 linhas, dividido em seções numeradas)
  permissions.js           Cargos, propriedade e configurações de voz/texto por pessoa/cargo
  profile-identity.js       Chave local Ed25519 e prova de identidade no handshake
  mobile-pip.js            Seleção de vídeo e apresentação compacta do PiP Android
  audio-manager.js         Mixer de volume, ensurdecer, captura de áudio, VAD
  microphone.js            Envio mono, reforço nativo, ganho manual e proteção de picos (teste)
  mobile.css, mobile.js    Layout por toque e integração com o APK Android
  style.css                Estilos base + temas (escuro / preto / claro)
  redesign.css             O visual 3.0 (vale com <html data-look="novo">, fixo no index.html)
  icon.png                 Ícone (favicon, logo da barra de cima, janela)
  sounds/amigo-1..9.ogg    Áudios de entrar/sair gravados pelos amigos. FORA DO GIT (veja §13)
  sounds/microfone-*.ogg   Avisos locais de mutar/desmutar (também fora do git)
  sounds/audio-*.ogg       Avisos locais de desativar/restaurar o áudio (fora do git)
  sounds/controle-alternativo-*.ogg  Segunda dupla de avisos, compartilhada entre mic/áudio
  vendor/emoji-picker/     Seletor de emojis (emoji-picker-element, copiado; ver README.txt dele)
  vendor/noise-suppressor/ RNNoise, WASM local e licenças

electron/
  main.cjs                 Processo principal: janela, tela inicial, hospedar sala, túnel,
                           captura de tela/áudio, atalhos globais, auto-update, preferências
  game-activity.cjs         Catálogo de jogos, leitura local dos processos e tempo da atividade
  preferences.cjs          Preferências atômicas e cópia independente da identidade
  preload.cjs              Ponte segura (window.electronAPI) entre a página e o main
  app-protocol.cjs         Protocolo telinha://app que serve public/ empacotado
  connect.html             Tela inicial (entrar na sala do servidor / hospedar / colar link)
  bin/                     telinha-audio.exe compilado (FORA DO GIT, gerado no build)

native/win-audio/          Auxiliar do Windows que captura o som de UM programa só (C++)
android/                  APK Android (WebView local, permissões e serviço da call)
scripts/build-android.sh  Gera somente o APK de teste, sem publicar nem alterar a VM
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
| `ADMIN_KEY` | Antiga chave de admin, mantida apenas para compatibilidade de entrada na sala | vazio = sem esse atalho |
| `OWNER_KEY` | Chave exclusiva para assumir/recuperar a propriedade | vazio = apenas proprietário já vinculado |
| `SFU_SECRET` | Liga o SFU e assina as senhas dele | vazio = sem SFU (P2P) |
| `SFU_PATH` | Caminho do websocket do SFU atrás do Caddy (mandado pro cliente junto com a senha) | `/sfu/ws` |
| `TELINHA_MUSIC` | Liga o bot experimental de música nos canais de voz | desligado; `1` liga |
| `MUSIC_PROXY` | Proxy opcional (ex: `socks5://127.0.0.1:40000`) passado ao `yt-dlp` para contornar bloqueios de IP de datacenter no YouTube | vazio = conexão direta |

Exemplo de servidor local completo pra testar admin e dados salvos:

```bash
PORT=3999 OWNER_KEY=segredo-dono TELINHA_DATA_DIR=/tmp/teletela-data node server.js
```

Sem `SFU_SECRET` a transmissão vai P2P, o que é ótimo pra testar no mesmo PC.

### Laboratório isolado do bot de música

`npm run music:setup` instala o yt-dlp oficial em `.cache/music-lab/` (fora do git),
conferindo SHA-256. O laboratório exige Python 3.10+, Node 22+ para os desafios JavaScript
do YouTube e FFmpeg. Não modifica dependências nem pacotes do sistema.
Quando chamado dentro do Electron, o extrator deve usar `node` do PATH, nunca
`process.execPath` (que nesse caso abre outro Electron em vez do runtime de console).
`npm run music:lab` abre um Express independente em **127.0.0.1:3998**, sem importar
`server.js`, conectar à VM nem ler dados/perfis da sala. `MUSIC_LAB_PORT` troca a porta;
`MUSIC_YTDLP` pode indicar outro executável yt-dlp já instalado.

`music/source.mjs` (reexportado por `scripts/music-lab/resolver.mjs`) identifica vídeos e faixas Spotify pelo
oEmbed público, busca cinco versões no YouTube e prepara MP3 temporário usando yt-dlp +
FFmpeg; `broadcast.mjs` executa **uma reprodução central** no ritmo real e distribui os
mesmos blocos MP3 por HTTP para todos; `server.mjs` coordena busca, reprodução, parada,
eventos SSE e arquivos temporários. Os clientes só decodificam a transmissão recebida.
O ponto de entrada tardia é o ponto atual do bot, não o começo do arquivo. O volume é local.
O laboratório limita as faixas a vídeos gravados de até 20 minutos e 80 MB de entrada,
uma preparação de áudio por vez e uma busca por vez. Limpa a faixa ao fechar seu FFmpeg e
o diretório temporário ao encerrar o processo por Ctrl+C/SIGTERM.

**Limites do laboratório HTTP:** oEmbed Spotify só informa o título, sem garantir o artista; mostrar
as versões e permitir ajuste manual evita prometer correspondência exata. Playlists/álbuns
ainda são recusados. Identificar o link ou encontrar uma versão não prova que o áudio
funciona: testar a preparação e a escuta. YouTube pode bloquear downloads, inclusive
dependendo do IP; sucesso no PC não valida a Oracle. HTTP MP3 central permite conferir a
distribuição, mas os buffers dos navegadores podem diferir em segundos. A integração das
calls descrita abaixo já transmite Opus por WebRTC/SFU, com permissões e fila por canal.

`npm run test:music` cobre a distribuição real com FFmpeg, dois ouvintes, entrada tardia,
validação de links, origem local e cancelamento. `npm run test:music:ui` verifica dois
ouvintes Electron, áudio efetivo, volume individual, temas e tela estreita com um tom
gerado localmente. `MUSIC_LAB_REAL=1 npm run test:music:ui` faz o mesmo percurso com uma
faixa Spotify pública e a versão correspondente no YouTube (usa internet).
Andamento e próximos passos: [TESTE-BOT-MUSICA.md](TESTE-BOT-MUSICA.md).

### Bot experimental nas calls (teste local)

`npm run music:build` compila `cmd/music-publisher/` e o SFU para `.cache/music-lab/`.
`npm run music:call` inicia o servidor normal só em **127.0.0.1:3999**, com música habilitada,
dados/credenciais temporários e WebRTC direto. `npm run music:call:sfu` também sobe um SFU
isolado em portas livres, com segredo novo e ICE local. Nenhum dos comandos acessa a VM.
`MUSIC_CALL_PORT` troca a porta da sala. O SFU aceita `SFU_HOST` para limitar seu endereço
HTTP de escuta; o padrão de produção continua igual. Os comandos de teste usam `127.0.0.1`.

`music/manager.mjs` mantém uma fila em memória por canal (até 150 pedidos, até quatro canais
ativos), transmite uma faixa por vez, pré-carrega a próxima, descarta faixas que falham e avança após o fim. Parar
limpa a fila; pular preserva os próximos pedidos. Sair da última pessoa cancela preparação,
fecha as conexões do bot e limpa a fila. Faixas são apagadas após seus processos fecharem.
Pausa interrompe só o consumo de música na ponte Go e mantém Opus de silêncio a cada 20 ms.
O encoder não é suspenso por SIGSTOP e os receptores não ficam sem relógio RTP ao pausar.

`music/transport.mjs` executa um FFmpeg por canal para codificar Opus estéreo a 160 kbps,
48 kHz, pacotes de 20 ms. Opus em Ogg segue por TCP no loopback para a ponte Go/Pion.
`audio.go` separa os pacotes pelas tabelas de segmentos Ogg e controla a emissão com relógio
monotônico. Atrasos pulam posições RTP (perda/silêncio), sem enviar rajadas para recuperar
tempo. Pausa e falta de dados usam silêncio Opus, sem consumir a faixa nem acelerar depois.
Com SFU, a ponte
publica como host em `<canal>__musica` pelo protocolo existente: o SFU distribui aos ouvintes.
Sem SFU, a mesma faixa RTP é entregue a uma conexão WebRTC por ouvinte. O navegador nunca
abre um player de YouTube/Spotify; recebe apenas o áudio central do bot.

`prepareStream` resolve e guarda os metadados da fonte em cache por cinco minutos (até 64
entradas). Consultas simultâneas compartilham o trabalho; cancelar um consumidor não cancela
os outros. Após uma busca, a primeira versão pode adiantar a consulta em segundo plano.
Na primeira reprodução, o yt-dlp lê a fonte para stdout e o FFmpeg decodifica a partir do
pipe, sem MP3 intermediário nem espera pelo arquivo inteiro. `available_at` do YouTube é
respeitado: ignorar essa liberação causou 403 no teste com FFmpeg abrindo a URL diretamente.
A próxima faixa da fila pode ser baixada em formato original para evitar outra espera na
troca. Pular durante esse download o cancela e usa streaming. Cada operação tem sua pasta
temporária, removida ao terminar/cancelar. A pausa não pausa o encoder, e fim do encoder
não significa fim da música: a ponte avisa quando tocou todos os pacotes recebidos.
Ao encerrar, aguardar o evento `exit` e destruir os pipes: esperar somente `close` pode
travar se um stdout estiver pausado após o FFmpeg encerrar sua entrada.

Playlists YouTube usam extração plana paginada (`offset` e até 150 itens por página), sem baixar todas
as músicas para listar. Vídeo com `list=` mantém a opção de tocar só o vídeo ou carregar
a playlist explicitamente. Playlists/álbuns Spotify usam somente os dados públicos de
`open.spotify.com/embed/...`; não usam cookies de usuário nem credenciais. O leitor extrai
título/artista/URI de `__NEXT_DATA__`, ignora podcasts/arquivos locais e informa o limite
da leitura pública (listas grandes podem vir incompletas). Não pressupor que esse HTML é
uma API estável: falhas respondem com erro claro. Resolver as versões YouTube é adiado
para a reprodução/pré-carregamento, sem fazer 150 buscas antes de aceitar a lista. A fila aceita reordenação manual (`action: 'move'`) atualizando o pré-carregamento caso a primeira faixa mude.

`music/integration.mjs` registra eventos Socket.IO somente com `TELINHA_MUSIC=1`. Todos
derivam o canal da presença atual do socket; payloads não permitem escolher outro canal.
Buscar, adicionar e controlar exigem permissão de escrita e ausência de mute/deafen de
moderação. A busca guarda escolhas por socket/canal; adicionar exige uma dessas escolhas.
Consultar/assinar exige presença e visibilidade. Sinais usam a geração atual da faixa.
O token SFU de música é só de **viewer**, vinculado à identidade de mídia revogável já usada
pelas calls. O host só é criado pelo servidor; clientes não podem pedir esse papel.

`public/music.js` integra o botão de fone, o modal, a fila e a presença visual do bot, com
alternativa nas opções móveis. O áudio passa por `VolumeMixerManager.attachUserStream`
(`teletela-music-bot`), respeitando volume geral, saída de áudio e ensurdecer. O controle
individual é salvo como `musicVolume` nas preferências. Trocar de canal/desconectar fecha
a recepção. A interface continua escondida quando o backend não anuncia `music: true` em `me`.

Eventos: `music-get` → estado; `music-search` → versões; `music-enqueue` → pedido;
`music-control` (`pause`, `resume`, `skip`, `stop`, `remove`) → fila/reprodução;
`music-state` → atualização só aos membros da call; `music-subscribe`/`music-offer`/
`music-signal` → sinalização no modo direto; `sfu-token` com `kind: 'music'` → acesso pelo SFU.

`music-search` também retorna `playlist` com faixas e `nextOffset` quando o link é uma
coleção. `music-enqueue-playlist` aceita apenas IDs da página carregada pelo socket no
canal atual, com seleção e embaralhamento. A inclusão é atômica: se não couberem todas as
selecionadas, nenhuma entra. `music-control` aceita `shuffle` e `repeat` (`off`, `one`, `all`).
Repetir vale para fim natural; pular/erro não recolocam a faixa no início. Escolhas de
busca e cache da página são descartados ao desconectar.

Validação: `npm run test:music` testa laboratório, fila e autorização; `npm run test:music:call`
usa três janelas Electron, tom gerado, dois ouvintes no mesmo encoder, volume, deafen, pausa,
fila, isolamento e troca de canais. `MUSIC_TEST_SFU=1` repete pelo SFU;
`MUSIC_LAB_REAL=1 MUSIC_TEST_SFU=1` usa uma faixa Spotify real, buscando áudio no YouTube.
O teste mede cadência RTP e amostras alteradas por aceleração/desaceleração no receptor,
confere silêncio com relógio ativo durante a pausa e exercita seleção de playlist/repetição.
`go test -race ./cmd/music-publisher` testa páginas Ogg, pausa sem consumir música e atraso
do processo sem rajadas de recuperação.

O deploy compila a ponte para a arquitetura da VM e instala em
`/opt/telinha/bin/telinha-music-publisher`. Instala Python 3.10+ e FFmpeg/libopus via apt
na Ubuntu antes de parar a sala. Baixa o yt-dlp oficial com SHA-256, versão fixada em
`2026.10.26` (altere com `YTDLP_VERSION`), e instala em `/opt/telinha/bin/yt-dlp`.
Para evitar o bloqueio de IP de nuvem (`Sign in to confirm you're not a bot`) do YouTube na Oracle,
`install.sh` também instala `wireproxy` em `/opt/telinha/bin/wireproxy`, gera uma credencial
Cloudflare WARP em `/opt/telinha/data/warp.conf` (uma vez, modo `0600`) e sobe o serviço
`telinha-warp` (SOCKS5 em `127.0.0.1:40000`, em userspace, sem alterar rotas/interfaces da VM).
O serviço define `MUSIC_PUBLISHER`, `MUSIC_YTDLP`, `MUSIC_PROXY=socks5://127.0.0.1:40000` e
`TELINHA_MUSIC=1`; não altera os segredos da VM. `ENABLE_MUSIC=0` desativa o recurso e dispensa
as ferramentas no deploy. Após 3 falhas seguidas na fila, `music/manager.mjs` interrompe e limpa
o restante da fila para não tentar 50 faixas em cascata.
`MUSIC_ICE_SERVERS` usa o formato Pion: `urls` precisa ser uma lista, mesmo com um único
STUN (`[{"urls":["stun:stun.l.google.com:19302"]}]`). O formato string aceito pelo navegador
causava `invalid ICEServer` na ponte Go; a validação real na Oracle detectou e corrigiu isso.
Salas hospedadas pelo app continuam com música desativada por padrão; as ferramentas
nativas não vão dentro dos instaladores desktop.

## 5. Testes

```bash
npm test                                   # runner próprio: 62 testes, devem passar todos
node --test tests/m1-*.test.js tests/m2-*.test.js tests/m3-*.test.js
node tests/m4-channels-admin.test.js       # integração: sobe o server.js de verdade
node --test tests/m4-permissions.test.js tests/identity-persistence.test.js # propriedade, hierarquia, texto/voz privados, provas e persistência
node --test tests/identity-upgrade.test.js # Electron real: dados da 3.7 → código novo, URL diferente e recuperação de prefs
npm run test:permissions                  # formulários reais de cargos/acesso, móvel e desktop
/usr/lib/electron42/electron tests/ownership-browser.cjs # regressão: interface nova contra servidor 3.7 real
npm run test:mobile                       # navegação, chat, mute e tamanhos móvel/desktop
npm run test:microphone                   # áudio real: nível, Opus/mixer, mute e comparação com 3.7.0
npm run test:microphone:ui                # controles reais, três temas e avatares durante a fala
go test -race ./sfu                       # SFU: erro de espectador não interrompe os demais
```

- Todos os testes têm que passar. (O `M2.3` falhou por muito tempo porque esperava o AGC do
  microfone ligado; ele foi desligado de propósito e o teste foi corrigido na 3.2.)
- O `m4` cobre: canais salvos, apagar canal, admin (login, tirar da call, mutar/ensurdecer pra
  todos, mover de call), cor do nome, GIF de perfil, várias telas, imagens no chat, canais de
  texto (inclusive sobrevivendo a reinício), perfil 3.0 (banner, moldura, som de entrada),
  responder/editar/apagar/reagir, soundboard, fixar, "digitando" e senha da sala (com chave
  de membro), enquadramento de foto/banner (inclusive validação e preservação do GIF) e
  resposta de ping e atividade de jogos (validação, estado, chegada tardia, encerramento e
  desconexão). O `m3-image-crop` confere a geometria e os limites do recorte; o
  `m3-game-activity` cobre Windows/Linux/Proton, Minecraft, jogos manuais e o relógio.
  **Quando mexer no servidor, acrescente um caso
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
   - inclua o identificador da versão anterior na lista de `openWhatsNew()` (`app.js`),
     que compara os componentes da versão para mostrar só as novidades ainda não vistas.
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
| `permission-store.js` | **sim** (também vai no servidor hospedado pelo app) | **sim** |
| `sfu/` | não | **sim** |
| `electron/`, `build/`, `package.json` (build) | **sim** | não |
| `android/` | APK Android separado (`npm run build:android`) | não |
| `deploy/oracle/install.sh` | não | **sim** |

Se mudou o protocolo entre os dois (evento novo), normalmente são os dois. O servidor novo
tem que continuar funcionando com o app antigo até todo mundo atualizar.

O APK também embute `public/`: gere outro APK para levar mudanças da interface ao Android.
O build de Android não executa o release desktop nem publica o APK. Os identificadores,
artefatos e atualização automática do desktop continuam independentes.

## 7. Atualizar o servidor (deploy)

```bash
npm run deploy:oracle
```

O que o `deploy/oracle/deploy.sh` faz, no seu PC:

1. Detecta a arquitetura da VM pelo SSH e compila o SFU e a ponte de música para `linux/amd64` ou `linux/arm64`.
2. Empacota `server.js`, `permission-store.js`, `package.json`, `package-lock.json`, `public/` e `music/` com
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
| `telinha-warp` | `/opt/telinha/bin/wireproxy -c /opt/telinha/data/warp.conf` (proxy SOCKS5 local pro `yt-dlp`) | `127.0.0.1:40000` | 64 MB |
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
| `/etc/telinha/telinha.env` | `SFU_SECRET`, `OWNER_KEY` e `ADMIN_KEY` legado (gerados uma vez, só ficam aqui) |
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

**Chave de propriedade/recuperação (`OWNER_KEY`):** fica em `/etc/telinha/telinha.env` e não aparece nos logs do deploy. Pra
trocar: apague a linha `OWNER_KEY` desse arquivo e rode o deploy. **Ela nunca vai pro git.**

## 9. Dados guardados

**Salvos em disco** (`TELINHA_DATA_DIR`, na VM `/opt/telinha/data`):

| Arquivo | O quê |
|---|---|
| `channels.json` | `{ channels, textChannels, defaultSettings }`: canais de voz/texto, regras de acesso/escrita e configurações do Geral (fixo e público) |
| `text/<canal>.jsonl` | histórico de cada canal de texto (veja abaixo) |
| `text/images/` | imagens/GIFs dos canais de texto (15 MB por envio, até 25 GB no total) |
| `text/files/` | vídeos e arquivos dos canais de texto (20 MB por envio, até 5 GB no total) |
| `soundboard/index.json` + arquivos | sons do soundboard (16 por pessoa, até 1 MB, 300 no total) |
| `room.json` | senha da sala (só o hash scrypt) e o segredo das chaves de membro |
| `accounts.json` | contas opcionais, accessId original, perfil completo, scrypt e hashes dos códigos/tokens; arquivo atômico 0600, falha fechada se ilegível |
| `dice.json` | últimas 30 rolagens por canal de voz/texto; autor, horário, dados individuais, modificador e total; arquivo atômico 0600 |
| `permissions.json` | segredo HMAC, dono (`ownerId`), cargos, nomes, vínculos e hash das chaves públicas; acesso 0600 |
| `chat-images/` | imagens/GIFs da call (15 MB por envio, até 2 GB; **apagadas a cada reinício**) |
| `chat-files/` | vídeos e arquivos da call (20 MB por envio, até 1 GB; **apagados a cada reinício**) |

Os limites de espaço removem os arquivos mais antigos, mantendo o histórico da mensagem;
o download de um arquivo removido responde 404. Apagar uma mensagem com anexo ou o canal de
texto também remove o arquivo correspondente. Anexos dos canais de texto entram no backup;
mídias da call ficam de fora.

Eventos `text-file` (canal de texto, funciona sem call) e `chat-file` (somente dentro da call)
recebem `{ data: Buffer, mime, name, text?, replyTo?, channelId? }`. A mensagem guarda
`attachment: { url, name, mime, size }` junto com os campos habituais. O servidor valida
tamanho, nome e assinatura de MP4/WebM; outros arquivos são servidos como download em
`application/octet-stream`, com `nosniff`. Rotas `/api/text-file/:file` e
`/api/chat-file/:file` só aceitam UUID gerado no servidor, nunca caminhos do cliente. Vídeos
aceitam Range para o player. Os eventos antigos de imagem continuam compatíveis.

Sons dos controles são locais: `playControlSound` usa gravações privadas e sai
pelo `outputGain`, seguindo o volume geral e permitindo ouvir o aviso mesmo ao ensurdecer.
Só ações nos botões/atalhos tocam esses sons; entrar na call e moderação não os disparam.
Entrar/sair da call e alternar microfone/áudio não exibem toast: o estado aparece nos ícones.
Toasts de erro e moderação continuam ativos.
`prefs.controlSounds` permite desligá-los. Trocar de aviso interrompe o anterior para evitar
sobreposição. A reprodução não envia evento de som para os outros usuários.
`prefs.controlSoundSet` escolhe `originais` (padrão, quatro sons) ou `alternativos` (a nova
dupla, com o mesmo mutar/desmutar para mic e deafen). Mudar de opção cancela o som atual e
qualquer decodificação pendente; a escolha fica salva por perfil, sem mudar áudio de terceiros.

Formato do `text/<canal>.jsonl`: uma linha por mensagem. Editar, apagar e reagir **não
reescrevem** o arquivo: viram uma linha nova com `op` (`{"op":"edit",...}`,
`{"op":"delete",...}`, `{"op":"reactions",...}`) que é aplicada na leitura
(`readTextMessages`). A cada 1000 ops, ou passando de 50 mil mensagens (fica com 90%), o
arquivo é reescrito limpo. As últimas 100 mensagens de cada canal ficam na memória.

Mensagem fixada também é uma op (`{"op":"pin",...}`), guardada no campo `pinned: { by, at }`.

**Backup:** `npm run backup` (`deploy/oracle/backup.sh`) baixa essa pasta (menos `chat-images/` e `chat-files/`)
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
- atividade de jogo (`activity: { id, name, startedAt }` ou `null`), reenviada pelo app ao reconectar;
- canais de voz criados por link (temporários).

**No PC de cada um** (preferências): no app desktop, um arquivo JSON na pasta de dados do
Electron, lido e gravado pelo `main.cjs` (`prefs-get`/`prefs-set`). A pasta continua sendo a
antiga, **"Telinha"**, de propósito, pra ninguém perder perfil e configurações. No navegador
as preferências ficam no `localStorage` (`telinha_prefs`). O perfil (nome, foto, banner, som
de entrada, cor, moldura) fica nas preferências e é mandado pra sala a cada conexão.

A aba **Atividade** salva `shareGameActivity` (padrão ligado) e `customGames`
(`[{ name, executable }]`, até 20 jogos). `get-game-activity` no main consulta os processos
locais a pedido da interface, a cada 15 s, sem bloquear a janela. No Windows usa
[`tasklist /fo csv /nh`](https://learn.microsoft.com/windows-server/administration/windows-commands/tasklist)
e, apenas para Java, PowerShell/CIM para distinguir Minecraft de launchers. No Linux lê
[`/proc/<pid>/exe` e `cmdline`](https://www.kernel.org/doc/html/latest/filesystems/proc.html)
dos processos do próprio usuário; o primeiro argumento permite reconhecer jogos via Proton.
Launchers não entram no catálogo. O cadastro manual compara só o nome exato do executável.
O relógio começa na detecção, preserva o início enquanto o mesmo processo existe e reinicia
ao trocar de processo. Se houver dois jogos, mantém o já exibido até ele fechar.
Só `{ id, name, startedAt }` chega à interface e ao servidor: PID, caminhos e argumentos
ficam no main. Desligar limpa imediatamente a atividade compartilhada e interrompe a consulta.
No navegador a detecção fica indisponível, mas a atividade dos amigos continua visível.

O editor fica em **Configurações → Perfil**. Clicar no próprio nome/foto ou abrir o app
pela primeira vez leva à mesma aba (`openProfileSettings`), com um único `#form-profile`.
Em janelas largas a prévia fica ao lado dos campos; em janelas menores vai para cima.
Salvar e descartar ficam no rodapé fixo das configurações. Trocar de aba mantém o rascunho;
fechar as configurações o descarta. Salvar persiste e mantém a aba aberta.
Todas as abas usam o mesmo cartão (até 1120 × 820 px, limitado à janela), sem mudar
de tamanho ao trocar de tópico. `selectSettingsTab` controla o painel e os botões do rodapé;
`openSettings` inicia uma nova sessão de edição quando necessário. Os dispositivos de
áudio só são consultados ao entrar nas abas Microfone, Som ou Transmissão.

O enquadramento fica nos campos opcionais `avatarCrop` e `bannerCrop` do perfil:
`{ x, y, zoom }`, com posições de 0 a 1 sobre a sobra da imagem e zoom de 1 a 4.
Sem esses campos, usa o centro e zoom 1. `public/image-crop.js` compartilha a normalização
entre cliente e servidor e calcula o recorte do canvas e o estilo da imagem animada.
As imagens paradas novas são reduzidas mantendo a imagem inteira (lado maior de até
1024 px na foto e 1800 px no banner, respeitando os limites de 200 KB/1 MB); os GIFs
continuam nos bytes originais, até 10 MB cada. Assim dá para reenquadrar depois, inclusive
GIFs, sem congelar a animação. Fotos antigas já cortadas só podem ser ajustadas dentro da
área que ainda existe; para recuperar o resto, é preciso escolher o arquivo original.
O recorte também vai em `publicUser`, na exportação/importação e nos estados da sala;
clientes antigos ignoram esses campos e mostram o centro da imagem. Os banners da
prévia, do popup e do perfil grande usam proporção 3:1 para manter o mesmo enquadramento.

Identidade: cada pessoa tem um `profileId` aleatório gerado no primeiro uso e guardado nas
preferências. Dá pra levar pra outro PC com *Exportar/Importar perfil* (no modal do perfil):
o arquivo JSON tem o perfil inteiro, inclusive o `profileId`. É ele que identifica "quem criou o canal", "de quem é a mensagem", reações,
moderação do admin e o volume que você deu pra cada amigo. **Não existe conta nem senha
pessoal.**

### Senha da sala e chave de membro

- O dono ou quem tem `manageServer` define a senha pelo app (`admin-set-room-password`; vazio tira). O servidor guarda
  só o hash (scrypt + sal) em `room.json`.
- Um middleware do Socket.IO (`io.use`) barra a conexão sem uma destas, mandadas no
  `auth` do handshake: `roomPassword`, `adminKey` ou `profileId` + `memberKey`. O erro é
  `room-password` (com `data.reason` `required` ou `wrong`), e o app abre o modal de senha.
- **Chave de membro:** toda conexão aceita recebe `member-key` = HMAC-SHA256(`memberSecret`,
  `profileId`). O app guarda por sala (`prefs.roomAccess[servidor]`). Por isso quem já usou o
  app, ou estava online quando a senha foi colocada, não precisa digitar nada.
- `admin-reset-members` troca o `memberSecret`: quem não estiver online precisa da senha de
  novo (quem está online ganha a chave nova na hora).
- Com senha, `/api/channels` responde 401. As rotas de imagens/arquivos privados também exigem a chave efêmera da conexão e conferem a visibilidade do canal.
- App antigo (antes da 3.2) não sabe pedir senha: **só coloque senha depois que todo mundo
  atualizar**, senão quem estiver desatualizado fica preso.

### Identidade persistente, dono e cargos sem conta

Na 3.8.0, a identidade é vinculada ao perfil e há um único dono do servidor.
Na 3.7.0, o acesso administrativo vinha de uma senha compartilhada.

Cada perfil novo preserva uma semente privada Ed25519 de 32 bytes em
`prefs.profileCredentials[profileId]`. `public/profile-identity.js` gera/salva a chave antes
de conectar. Ela nunca entra em `profilePayload`, listagens ou mensagens. O backup de
perfil v2 inclui `accessIdentity`: é privado e permite usar o mesmo perfil em outro aparelho.
Backups v1, só com `profileId`, não comprovam a identidade e não recuperam cargos.

Antes do handshake, o cliente consulta `GET /api/identity` (CORS liberado, sem cache).
O servidor gera um desafio com expiração de 60 s, nonce e HMAC. O cliente assina
`teletela-profile|host:porta|desafio` e manda `profileProof: { publicKey, challenge, signature }`.
O Node verifica a assinatura e o host da conexão; uma sala não consegue reutilizar a prova
assinada para outro host. A chave privada permanece no aparelho. O hash da chave pública
fica no registro de membro; o UUID desse registro continua sendo usado em cargos e ACLs.

O `permissionToken` HMAC da 3.7.0 ainda é aceito. Na primeira conexão com os dados antigos,
a prova associa a chave pública ao mesmo membro, sem recriar cargos ou alterar as regras.
Depois, a prova assinada recupera o membro mesmo se mudar a URL da sala e o token por URL
não estiver disponível. Essa recuperação exige que o vínculo tenha sido migrado antes.
IDs públicos, nomes e chaves públicas sem assinatura não concedem poderes. Servidores
antigos continuam funcionando pelo token por sala, sem receber a semente privada.
A prova assinada requer WebCrypto Ed25519 (disponível no Electron atual e WebViews recentes);
sem esse suporte, o cliente mantém a identificação pelo token salvo por URL.

No desktop, `electron/preferences.cjs` mantém a pasta **Telinha** e grava `prefs.json` com
arquivo temporário + rename (0600). `identities.json` mantém uma cópia pequena do ID do
perfil, chaves privadas e tokens por sala, independente das fotos/banners. A leitura recupera
a identidade se `prefs.json` estiver ilegível; dados visuais não são recuperados por essa
cópia. No navegador/Android, há também uma cópia da semente em uma chave própria do
localStorage. Apagar os dados do aplicativo remove essa proteção: use o backup de perfil.
A causa exata do relato original não foi reproduzida em uma atualização normal; a gravação
antiga direta e sem cópia era uma fragilidade, não um diagnóstico confirmado.

`permissions.json.ownerId` define um único dono. `owner-claim` com `OWNER_KEY` só assume
propriedade quando ainda não há dono. `ADMIN_KEY` antigo não concede propriedade nem cargos. Após assumir,
a identidade recupera o acesso automaticamente, inclusive em sala com senha. A chave do
servidor continua em `/etc/telinha/telinha.env` e inclui `OWNER_KEY`, usada em `owner-recover` explícito, que
substitui o dono anterior. `owner-transfer` só aceita o dono atual e um membro existente.
O protocolo anuncia `ownershipVersion: 2`. Em servidor 3.7, `permissions-state.owner`
representava admin por senha, não propriedade. O cliente distingue esse caso, mostra um
escudo de admin antigo e nunca inicia reivindicação automaticamente por senha salva.
`publicUser.isOwner` é o campo explícito para a coroa. `admin-login` continua compatível
para reconhecer a identidade que já é dona; a senha antiga não promove outros perfis. `isAdmin` continua no protocolo por compatibilidade, significando
**dono**, nunca um cargo do cliente. Propriedade inválida em disco impede iniciar o servidor.

Cargos têm posição de 1 a 99 e permissões `kickMembers`, `moveMembers`, `muteMembers`,
`deafenMembers`, `manageChannels`, `manageRoles`, `manageServer` e `manageMessages`.
O dono tem todos os poderes. Moderação exige hierarquia maior que a do alvo, inclusive
contra o dono. `manageRoles` só altera cargos abaixo do ator, com poderes que ele já tem;
atribuições não podem alterar o próprio ator nem pessoas de hierarquia igual/maior.
`manageServer` administra senha e chaves de entrada; `manageMessages` modera mensagens
e soundboard. Os cargos ficam no popover/perfil. `displayRoleId` escolhe um cargo para
aparecer junto ao nome, sem alterar as permissões; vazio é o padrão.

### Configurações por canal e privacidade

Voz e texto guardam `description`, `access` e `writeAccess` em `channels.json`. Ambas as
regras usam `{ private, roles: [], members: [] }`. Em `access`, privado libera a visualização
por pessoa OU cargo, com exceção para o dono. `writeAccess` restringe mensagens/anexos
entre quem já tem acesso; não restringe o microfone. Sem restrição, todos com acesso podem
enviar. O Geral permanece público e salva nome, descrição, senha e escrita em
`defaultSettings.geral`. Regras inválidas carregadas do disco falham fechadas.

O botão de configurações fica no fim da linha, depois da lixeira, e aparece no hover,
foco pelo teclado ou canal ativo. O botão de configurações em cada canal usa `get-channel-settings` / `channel-settings`.
`manageChannels` exige que o ator veja o canal. A alteração valida todos os campos antes
de salvar; uma falha de gravação restaura as configurações anteriores. Senhas de voz são
scrypt com sal, não são retornadas pelo editor e continuam obrigatórias para todos.
Os eventos `get-channel-access` / `channel-access` continuam disponíveis para a 3.7.

Listas Socket.IO são individuais para voz e texto. Histórico, fixadas, edição, reações,
mensagens, anexos e digitação de texto verificam o acesso no servidor. REST público só
mostra voz pública. Cada conexão recebe `assetKey` efêmera em `room-info`; o cliente a usa
nas URLs de imagens/arquivos. O servidor mantém índice de anexo → canal (reconstruído do
histórico ao iniciar) e verifica o acesso atual em todo download privado. URLs privadas
sem chave válida respondem 404; mídia usa `Cache-Control: private, no-store`. Revogar o
acesso bloqueia novos downloads imediatamente, sem conseguir apagar cópias já recebidas.
O cliente fecha o texto revogado e descarta seu histórico em memória.

Mudar acesso, cargo ou propriedade reavalia a call atual. Quem perdeu acesso sai, recebe
`kicked` e deixa de obter sinalização ou tokens de mídia. Cada entrada tem um `mediaId`
aleatório. O Node chama `POST /revoke` no SFU (Bearer `SFU_SECRET`) para fechar conexões
WebSockets/WebRTC desse ID e impedir reutilização de tokens válidos. O token revogável é
`mediaId.assinatura`, com HMAC de `sala|role|exp|mediaId`. A próxima entrada usa outro ID.
`SFU_INTERNAL_URL` configura o endereço interno; padrão `http://127.0.0.1:8081`.
A revisão atual não muda o protocolo do SFU da 3.7.0.

Sem `TELINHA_DATA_DIR`, identidade, dono e cargos vivem só no processo. O backup do servidor
copia toda a pasta de dados, incluindo `permissions.json` e o índice dos canais. A revisão
requer o aplicativo e o Node da 3.8.0. O deploy pode vincular o proprietário antes da primeira conexão, conforme a migração abaixo.

## 10. Protocolo: eventos do Socket.IO

Cliente → servidor (com callback `cb({ success, error })` quando faz sentido):

| Evento | Pra quê |
|---|---|
| `join-channel` `{ channelId, profile, isMicOn, ... }` | entrar num canal de voz (o perfil vai junto) |
| `leave-channel` | sair da call |
| `update-profile` | mudou o perfil |
| `update-activity` `{ id, name, startedAt }` ou `null` | mudou/encerrou o jogo; valida nome (até 80 caracteres), identificador e início (até 30 dias atrás; tolera 1 min de relógio adiantado). Só os três campos públicos são aceitos; até 10 mudanças em 10 s, limpeza sempre permitida |
| `connection-ping` (só callback) | responde `{ success: true }` para medir a ida e volta até o servidor |
| `user-state-changed` | mic, ensurdecer, transmitindo, câmera, telas extras, falando, o que está assistindo (`watching`) |
| `create-channel` / `delete-channel` | canais de voz |
| `create-text-channel` / `delete-text-channel` / `text-history` / `text-message` / `text-image` | canais de texto |
| `text-file` / `chat-file` | enviar vídeo/arquivo de até 20 MB para texto/call |
| `chat-message` / `chat-image` | chat da call (aceitam `replyTo`) |
| `message-edit` / `message-delete` / `message-react` | `{ scope: 'call'|'text', channelId?, messageId, ... }` |
| `message-pin` / `text-pins` | fixar/desfixar e listar as fixadas (só canal de texto) |
| `typing` `{ scope, channelId? }` | "está digitando" (o app manda a cada ~3 s enquanto digita) |
| `admin-set-room-password` / `admin-reset-members` | senha da sala e chaves de membro |
| `soundboard-add` / `soundboard-delete` / `soundboard-play` | soundboard |
| `reaction` | emoji flutuando na call |
| `sfu-token` | senha temporária pra entrar numa sala do SFU |
| `owner-claim` / `owner-recover` / `owner-transfer` | assumir, recuperar e transferir a propriedade com chave exclusiva |
| `admin-login` | compatibilidade antiga; não promove admin a dono |
| `role-save` / `role-delete` / `member-roles` | administrar cargos com hierarquia |
| `get-channel-settings` / `channel-settings` | configurações de um canal `{ type: 'voice'|'text', channelId, ... }` |
| `kick-user`, `admin-move-user`, `admin-mute-user`, `admin-deafen-user` | moderação autorizada pelos cargos |
| `webrtc-offer` / `webrtc-answer` / `webrtc-ice-candidate` / `webrtc-signal` / `request-stream` | sinalização P2P (sala no PC) |

Servidor → cliente (principais): `channels-list` (e `channels-summary`, mesmo conteúdo, pra
app antigo), `channel-state`, `user-joined`, `user-left`, `user-state-changed` (e
`user-state-updated`), `user-profile-updated`, `user-activity-updated` (`{ userId, activity }`), `chat-message`, `chat-message-updated`,
`chat-message-deleted`, `text-channels`, `text-message`, `text-message-updated`,
`text-message-deleted`, `text-channel-deleted`, `soundboard-list`, `soundboard-played`,
`typing`, `member-key`, `room-info`, `room-password-changed`,
`server-moderation`, `moved-by-admin`, `kicked`, `reaction`.

`room-info` inclui `connectionPing: true` nos servidores com suporte ao ping. Durante
a call, o cliente mede uma vez e espera 5 s após cada resposta antes de medir de novo.
O limite de espera é 4 s: sem resposta, o painel fica vermelho; ao desconectar, mostra
“Reconectando…”. Verde para menos de 150 ms, amarelo de 150 a 299 ms e vermelho a partir
de 300 ms. Sair da call cancela as medições e respostas antigas são ignoradas.
O `title` nativo foi substituído por `#connection-tooltip`, um cartão com ping/qualidade e
cores dos temas, fora da barra lateral para evitar corte por overflow. Abre por hover ou
foco, permite passar o mouse sobre o cartão e fecha com Escape, blur da janela ou saída
da call. O cálculo de ping e o protocolo não mudaram; o visual não exige deploy do Node.
Sem a capacidade anunciada (servidor antigo), o indicador fica neutro e informa que o
ping está indisponível. A medida é da sinalização Socket.IO, não do trajeto de mídia
WebRTC/SFU nem da perda de pacotes de áudio.

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
| Contas opcionais | `account-store.js`, `accounts-protocol.js`, `public/accounts.js`/`.css`; auth `accountToken`, aba Conta e login HTTP antes da senha da sala |
| Dados de RPG | `dice-store.js`, `public/dice.js`/`.css`; eventos `dice-roll`, `dice-history`, `dice-rolled` |
| Cinema e miniplayer | `public/stage-social.js`/`.css` e API de estado/ações em `public/music.js`; integração em `app.js` |
| Tela inicial e controles por contexto | `renderServerHome` e `setupServerHome`: cartões de voz/pessoas e atalhos de texto; `updateTextLayout` e `updateStageControls`: chat e controles apenas no contexto correspondente |
| Canais de texto | `renderTextChannels`, `openTextChannel`, `loadTextHistory`; servidor: `readTextMessages`, `appendTextMessage` |
| Chat (responder, reagir, editar, apagar) | `buildChatMessage`, `setupChatMessageActions`, `startEditMessage`; servidor: `message-edit/delete/react` |
| @menção | `mentionify`, `mentionsMe`, `notifyMention`, `setupMentionAutocomplete` |
| Reações da call | `setupEmojiPicker`: hover/clique/teclado abre só os atalhos; **＋** carrega o seletor completo; `renderQuickReactions`, `countReactionUse`, `closeCallReactions` |
| Fixar mensagem | `pinMessage`, `renderPins`, `setupPins`; servidor: `message-pin`, `text-pins` |
| "Está digitando" | `setupTyping`, `renderTyping`; servidor: `typing` |
| Senha da sala | cliente: `roomAccess`, `openRoomPasswordModal`, `setupRoomPasswordAdmin`; servidor: `io.use`, `isMemberKey`, `setRoomPassword` |
| Cargos e canais invisíveis | `permission-store.js`, `public/permissions.js`; `permissions-state`, `channel-access`, listas individualizadas e revogação no SFU |
| Exportar/importar perfil | `setupProfileTransfer` |
| Soundboard | `setupSoundboard`, `renderSoundboard`, `playSoundboard`; servidor: bloco `SOUNDBOARD` |
| Vídeos e arquivos no chat | `sendChatImage`, `chatAttachmentHtml`; servidor: `attachmentStorage`, `prepareAttachment`, `text-file`/`chat-file` |
| Sons ao mutar/desmutar | `playControlSound`, `setupDockControls`, `prefs.controlSounds`; quatro `.ogg` privados em `public/sounds/` |
| Sons de entrar/sair | `playCallSound`, `callSoundChoiceUrl`, `joinSoundUrl` (som do perfil) |
| Perfil (banner, moldura, gradiente, perfil grande) | `renderProfileDraft`, `frameClass`, `nameCss`, `renderBanner`, `openProfileCard`; servidor: `applyProfile` |
| Editor do próprio perfil | `openProfileSettings`, `setupProfileSettings`, `resetProfileDraft`; `#form-profile` na aba `data-settings-section="perfil"` |
| Enquadramento de foto/banner | `editProfileImage`, `setupImageCrop`, `prepareProfileImage`, `renderBanner`; geometria/validação: `image-crop.js` |
| Ping e cores da conexão | `syncConnectionMonitor`, `showConnectionQuality`, `setupConnectionTooltip`; servidor: `connection-ping` e capacidade `room-info.connectionPing` |
| Jogo e tempo de atividade | `setupGameActivity`, `pollGameActivity`, `renderUserActivity`; relógio: `public/game-activity.js`; detecção: `electron/game-activity.cjs`, IPC `get-game-activity`; servidor: `update-activity` |
| Admin | `setupAdminSettings`, popup da pessoa (`openUserPopover`); servidor: `moderate`, `applyServerModeration` |
| Transmissão de tela/câmera, várias telas | `startExtraScreen`, `streamKey`, `updateStageLayout`, `layoutMosaic` (mosaico redimensionável) |
| Prévia própria sob demanda | `showLocalPreview` guarda o stream mesmo oculto; `openStream` registra a prévia local ao clicar no próprio selo; `removeScreenStream` fecha a prévia sem parar a captura |
| Quem está assistindo | `syncWatching`, `renderStreamViewers` |
| Volume / ensurdecer | `audio-manager.js`: `VolumeMixerManager`, `DeafenController` |
| Volume e IA do microfone | `microphone.js`: RNNoise e ganho manual como na 3.7; `app.js`: `setupMicGain`, `openMicrophone`, `restartMicrophone` |
| Atalhos de teclado | seção 8d (`eventToAccelerator`, `SOLO_KEY_CODES`); globais: `setGlobalHotkeys` no `main.cjs` (Ctrl/Shift/Alt sozinhos via `uiohook-napi`) |
| Temas e visual | `style.css` (tokens em `:root`, `[data-theme="preto"]`, `[data-theme="claro"]`), `redesign.css` |
| Modo leve e pausa de animações | `applyPerformancePrefs`, `syncAppVisibility`, `setupPerformanceSelect`, `freezeAvatar`; CSS: `light-mode`, `pause-in-background` |
| Configurações (abas) | `openSettings`, `selectSettingsTab`; `#modal-settings` no `index.html`, abas `data-settings-tab` |
| Popup de novidades | `showWhatsNewOnce` (automático), `openWhatsNew`/`setupWhatsNew` (reabertura no início e configurações), `#modal-whats-new` |
| Tela inicial, hospedar sala, túnel | `electron/connect.html`, `ensureLocalServer`, `startTunnel` no `main.cjs` |
| Som de um app só | Linux: `routeAppAudio` (PipeWire/Pulse); Windows: `native/win-audio` + `start-win-audio` |
| Auto-update | `electron-updater` no `main.cjs` (lê o `latest*.yml` do release) |

### Contas, privacidade e dados (branch de testes)

- A conta é opcional, local à sala, sem e-mail/telefone/amigos. Usuário único de 3–24 letras,
  números ou `_`, sem diferença entre maiúsculas/minúsculas; senha 8–128 caracteres e apelido
  independente. Cadastro mantém `accessId` (cargos, ACL e dono) e o perfil. Se um ID público
  já estiver associado a outra conta, gera outro ID público, preservando o accessId comprovado.
- `accounts.json` confirma conta, perfil e sessão juntos. Scrypt assíncrono, até dois hashes
  simultâneos; limites por IP/usuário compartilhados entre HTTP e sockets. Sessões de 30 dias,
  até oito por conta, tokens de 256 bits e recuperação de 192 bits guardados só como hashes.
  Recuperar troca senha/código e revoga sessões e mídia. Logout revoga só a sessão atual.
- Handshake `accountToken` resolve a identidade antes da senha da sala. Token expirado retorna
  `account-session-expired`; o cliente volta ao visitante e permite novo login. `GET /api/account`
  anuncia suporte; `POST /api/account/login`, `/recover` e `/logout` permitem entrar mesmo antes
  da senha da sala. Cadastro usa `account-register` em socket que já entrou na sala. Eventos
  `account-state` e `account-session-ended` sincronizam perfil/sessão. Não emitir `permission-identity`
  para contas: tokens de permissões/provas antigos deixam de autenticar identidades vinculadas.
- Perfis de conta são carregados do servidor antes de editar e nunca sobrescritos pelo visitante
  ao conectar. Edição aguarda a gravação atômica antes de publicar ou anunciar sucesso.
  A sessão local guarda só os campos leves; avatar/banner/som completos ficam na RAM e no
  servidor, evitando duplicar GIFs nas preferências. Importar outro perfil exige sair da conta.
  IDs públicos de contas não podem ser apresentados por visitantes para assumir autoria.
- `PermissionStore.visible` aplica ACL inclusive ao dono; `has` ainda delega administração
  global. Alterar cargos que afetam um canal inacessível é recusado, evitando autoliberação.
  Limpeza nunca mescla perfis apenas pelo nome nem apaga referências de conta/canal no reset.
  Continua sendo controle de acesso do aplicativo: o operador da VM tem acesso aos arquivos.
- Rolagens `NdM` com modificador opcional: 1–100 dados, 2–10.000 lados e modificador até 10.000.
  `crypto.randomInt` sorteia no servidor, que persiste antes de anunciar. Limites: 500 ms e
  20 pedidos/minuto por identidade, inclusive entre canais/reconexões. Histórico acessível só
  a quem vê o texto ou está na call; escrita respeita `canWrite`. Excluir o canal remove o
  histórico. Arquivo sem pasta persistente dura só até reiniciar.
- Novos módulos Node precisam entrar em `build.files` e no staging de `deploy/oracle/deploy.sh`.
  O APK usa todos os arquivos de `public/`; incrementar `versionCode` junto da próxima release
  e manter assinatura, ID e nome do artefato existentes.

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

- **Reversão dos microfones na 3.6.2:** a 3.6.1 foi revertida após relatos de flicker
  e falha na redução de ruído. O grafo de áudio e os controles voltaram aos da 3.6.0;
  o nivelador, o worklet novo e a atualização periódica do nível na interface foram retirados.
  Os testes locais anteriores não reproduziram os problemas relatados; a causa não foi
  isolada. Não reaplicar essa mudança sem investigar nos dispositivos afetados. O código
  e o diagnóstico da tentativa continuam no histórico do commit `e5ac540`.

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
17. **SFU parando uma faixa por erro de um espectador:** o `TrackLocalStaticRTP.Write` do Pion
    tenta enviar para todos e retorna erros agregados. Encerrar a leitura do host nesse erro
    interrompia a faixa também para espectadores saudáveis. `forwardPackets` continua o
    repasse até o host encerrar; erros de envio são registrados no máximo a cada 5 s por faixa.
    Testes em `sfu/main_test.go`; contexto e limites em
    [DIAGNOSTICO-TRANSMISSOES.md](DIAGNOSTICO-TRANSMISSOES.md).
18. **GIF congelando com modo leve desligado:** as regras de avatar estático precisam de
    `html.light-mode`. A pausa em segundo plano é independente (`pauseInBackground`) e deve
    prevalecer sobre fala, mouse e perfil aberto. GIF não obedece `animation-play-state`:
    avatares usam o canvas de `freezeAvatar`; animações CSS precisam pausar também os
    pseudoelementos das molduras. Sem as duas opções, os avatares animam continuamente.
19. **GIF parado no perfil grande impedindo ampliar:** `.profile-card-avatar` também
    precisa liberar a animação no modo leve. O clique para ampliar procura a imagem dentro
    do avatar inteiro, inclusive se o alvo do clique for o canvas estático.
    Os avatares têm uma janela `.avatar-photo` que recorta a imagem animada; o canvas de
    `freezeAvatar` recebe o mesmo enquadramento. A pausa em segundo plano continua
    prevalecendo no perfil aberto.
20. **Próprio AO VIVO sem abrir com a prévia oculta:** `hideOwnStream` controla a abertura
    automática. `localPreviews` guarda o `MediaStream` original mesmo escondido; o clique
    explícito usa esse mesmo objeto em `registerScreenStream(..., true)`, sem outra captura,
    conexão SFU ou assinatura de si próprio. O ✕ na aba local chama `removeScreenStream`,
    mantendo captura e transmissão. Parar a transmissão chama `dropLocalPreview` e limpa
    também o registro. Não chame `unwatchScreen` nem pare faixas para esconder a prévia.
21. **Início e hover em PC fraco:** o início usa as listas que já chegam do servidor,
    sem consultas extras ou vídeos. As fotos usam `avatarInnerHtml`, respeitando recorte,
    modo leve e pausa em segundo plano. Uma assinatura de canais/nomes/cores/fotos/recortes/
    molduras evita reconstruir os cartões durante mudanças de fala, mas atualiza a foto editada.
    O hover das reações exibe apenas sete botões já disponíveis; a importação e os dados
    do seletor completo só são carregados pelo **＋**. Há apenas um timeout curto ao
    sair do hover para atravessar o espaço entre botão e painel.
22. **Atividade sem varrer processos na interface:** só o main lê processos locais, com
    operações assíncronas e limite de concorrência. O tempo na tela muda apenas o texto,
    sem reconstruir canais ou fotos. Uma geração de consulta descarta detecções pendentes
    ao desligar o compartilhamento. O preload não expõe a lista de processos.

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


### Migração de propriedade da 3.8.0

O deploy gera `OWNER_KEY` independente de `ADMIN_KEY` em `/etc/telinha/telinha.env`, sem
imprimir seu valor. Quem conhece a senha compartilhada antiga não pode assumir/recuperar
a propriedade. Não reutilize o valor antigo nessa chave nova.

O operador pode fornecer `/etc/telinha/owner-bootstrap.json` (root, 0600) contendo apenas
`permissionToken` do perfil confirmado. Com os serviços parados, o instalador executa
`scripts/configurar-dono.mjs`: verifica o HMAC contra `permissions.json`, vincula o dono,
preserva os cargos e apaga o pedido. UUID público/nome não são aceitos como comprovação.
O script não imprime a credencial; o arquivo nunca deve entrar no Git. O backup anterior
à migração precisa incluir `data/permissions.json` e `telinha/telinha.env`.


### Publicação 3.8.0 concluída em 26/10/2026

Código de release: `364043e`, tag [v3.8.0](https://github.com/Castzzz/telinha/releases/tag/v3.8.0).
Node/SFU/Caddy ativos na VM; perfil do proprietário comprovado por HMAC e vinculado antes
do início do Node novo. Cargos e atribuições anteriores foram comparados ao backup e
preservados. API `get-channel-settings` e protocolo de propriedade v2 conferidos na sala.

Windows Setup/portátil, Linux AppImage/tar.gz, blockmap, `latest.yml`, `latest-linux.yml`
e APK publicados (8 arquivos), tamanhos/SHA256 verificados contra o GitHub. SHA512 dos
metadados Windows/Linux corresponde aos instaladores. APK 3.8.0/versionCode 5 usa a mesma
assinatura da 3.7.0. Ainda falta escuta dos microfones/teclados e teste físico no Android.

Backups íntegros antes/depois: `~/Teletela-backups/teletela-dados-2026-10-26_17-23-58.tar.gz`
e `~/Teletela-backups/teletela-dados-2026-10-26_17-37-35.tar.gz`. O segundo inclui a
propriedade e a chave exclusiva de recuperação; o pedido privado de migração foi removido.

### Publicação 3.9.0 concluída em 27/10/2026

Tag [v3.9.0](https://github.com/Castzzz/telinha/releases/tag/v3.9.0), código `63d5d99`.
Microfones restaurados ao processamento da 3.7; música compartilhada e playlists
habilitadas na Oracle. SFU/Node/Caddy ativos; fontes extraídas como usuário telinha.
Node v24.22.1 e Caddy 2.11.7 preservados, FFmpeg 8.0.1/libopus e yt-dlp 2026.10.26 instalados.

Validação pública com faixa Spotify buscada no YouTube: dois ouvintes Electron receberam
áudio da mesma sala SFU na Oracle, ~49,99 pacotes/s e ~0,15% de correção de ritmo.
Corrigido o formato de `urls` ICE exigido pelo Pion. Canal temporário encerrado após o teste.

Publicados os oito artefatos: Windows Setup/portátil, Linux AppImage/tar.gz, blockmap,
`latest.yml`, `latest-linux.yml` e APK. SHA-256/tamanhos iguais ao GitHub; SHA-512 dos
metadados de atualização conferido contra os instaladores. APK 3.9.0/versionCode 6 mantém
a assinatura da 3.8.0. Assets de microfone/música nos pacotes equivalem aos arquivos testados.

Testes: 62 do runner, 78 de permissões/perfil, 15 de música, integração m4, Go com race,
áudio comparado ao grafo 3.7, controles/mute, celular/permissões na interface e bot pelo
SFU com STUN. A qualidade nos aparelhos reais deve ser conferida pelos amigos.
Backups antes e depois: `~/Teletela-backups/teletela-dados-2026-10-27_17-49-34.tar.gz` e
`~/Teletela-backups/teletela-dados-2026-10-27_18-01-25.tar.gz`. Segredos preservados na VM,
sons dos amigos fora do git. Resultado e histórico em [TESTE-BOT-MUSICA.md](TESTE-BOT-MUSICA.md).
