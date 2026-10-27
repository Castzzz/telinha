# Bot de música: teste local e continuação

Pedido de 27/10/2026: testar links de YouTube e Spotify antes de integrar à sala oficial.
O dono quer **uma reprodução central transmitida para todos**, como um bot do Discord.
Não usar players independentes de YouTube/Spotify em cada cliente.

## Limites e autorização

- **Autorizado em 27/10:** deploy na Oracle e release para testar com os amigos.
- Pedido adicional: reverter os microfones da 3.8 ao processamento da 3.7 antes de publicar.
- Não adicionar `public/sounds/` ao git nem apagar seus arquivos.
- O dono pediu para parar a 20% do limite do chat e registrar a continuação. O agente não
  recebe um medidor confiável dessa porcentagem; manter este arquivo atualizado por etapa.

## Andamento

- Ajustes pedidos após o primeiro teste: demora ao iniciar, variação de velocidade e opções
  de playlist. Implementados localmente; sem release/deploy.
- Primeira faixa usa streaming (metadados → yt-dlp stdout → FFmpeg → Opus/Ogg por TCP local).
  A próxima é baixada em segundo plano no formato original. Busca adianta a consulta da
  primeira versão e há cache compartilhado/cancelável de fontes por cinco minutos.
- Relógio movido para `cmd/music-publisher/audio.go`: pacotes de 20 ms, sem rajadas após
  atraso. Pausa envia silêncio Opus e não consome música. O fim da codificação não encerra
  a faixa enquanto a ponte ainda tem pacotes para tocar. Não usar mais -re/SIGSTOP no encoder.
- Playlists públicas YouTube, playlists/álbuns públicos Spotify, seleção de faixas, até 50
  por página, embaralhar ao adicionar, embaralhar fila, repetir faixa ou repetir fila.
  Importação atômica pelo servidor; não aceitar IDs fora da página carregada no canal.
- Spotify usa só a lista pública do embed (`__NEXT_DATA__`), com título/artista e sem
  credenciais/cookies; pode disponibilizar apenas parte de listas grandes. Correspondência
  com YouTube é resolvida ao tocar/pré-carregar, sem bloquear a importação com 50 buscas.
- Medições reais: primeira faixa sem cache levou 7,7–9,4 s, incluindo espera de 4 s exigida
  pelo YouTube (`available_at`). Próxima faixa já carregada começou em 443–644 ms.
  Dois ouvintes via SFU receberam aproximadamente 49,99 pacotes/s; teste mediu 192.000
  amostras em quatro segundos, com ajustes do receptor abaixo de 1%.
- Corrigido travamento de limpeza: aguardar apenas `close` de processo pode ficar preso
  num pipe pausado após EPIPE. O transporte destrói pipes e aguarda `exit` com limite de kill.
- Testes desta revisão: 15 testes Node; três testes novos de Go (Ogg/cadência/pausa) com
  race detector; Electron direto e SFU, playlist e repetição, áudio real e troca pré-carregada;
  runner 62/62, unitários 78/78, integração de canais/admin e teste móvel passaram.
  Logs em `/tmp/teletela-musica-ritmo-{testes,go,direto,sfu,real,runner,unitarios,integracao,mobile}.log`.
- Sala local reiniciada em `http://127.0.0.1:3999` com o código e a ponte novos. Recarregar
  as janelas para receber os controles novos. O laboratório HTTP em 3998 continua sendo
  o ensaio antigo e ainda prepara MP3 completo; testar estas melhorias nas calls de 3999.

- Continuação autorizada pelo dono: integração do bot às calls locais concluída para teste.
  `TELINHA_MUSIC=1` liga o recurso; desligado por padrão. Sem release/deploy.
- Nova ponte `cmd/music-publisher/` recebe uma única codificação Opus/Ogg do FFmpeg e
  publica no SFU existente ou distribui por WebRTC direto no teste sem SFU.
- `music/manager.mjs` coordena fila de até 50 faixas por canal, pausa, retomada, pular,
  remoção, cancelamento e limpeza. `music/integration.mjs` autoriza os eventos pelo canal
  real do socket e suas permissões. Canal vazio encerra a música.
- Interface em `public/music.js`/`music.css`, modal no `index.html` e botão de fone de ouvido
  na call; volume pelo mixer de voz, respeitando ensurdecer e volume geral.
- `npm run music:build` compila ponte e SFU de teste em `.cache/music-lab/`.
  `npm run music:call` inicia a sala local em 3999; `npm run music:call:sfu` testa o mesmo
  usando SFU local. Dados ficam em pasta temporária, sem ler a sala oficial.
- Resolução das fontes movida para `music/source.mjs`, compartilhada pelo laboratório
  antigo através de um módulo de reexportação. Sem mudança no protocolo de mídia do SFU.
- Verificação desta continuação: dois ouvintes passaram nos modos direto e SFU, com
  reconexão, volume individual, ensurdecer, pausa, fila, pular e troca de canais. Teste com
  link Spotify real também passou pelo SFU local. Não é validação da rede da Oracle.

- Arquitetura consultada: `server.js` coordena canais; `sfu/main.go` distribui mídia;
  clientes locais sem SFU usam P2P. Interface do app vem instalada em `public/`.
- Implementado: laboratório independente em `scripts/music-lab/`, servido apenas
  em `127.0.0.1`, sem importar nem modificar o servidor da sala.
- Fontes: identificar faixa Spotify pelo oEmbed público, buscar versões no YouTube e
  deixar a pessoa conferir a correspondência. Não obter áudio do Spotify.
- Reprodução implementada para o laboratório: baixar uma faixa temporária e executar **um**
  FFmpeg no servidor, distribuindo os mesmos blocos MP3 para todos os ouvintes HTTP.
  Cada navegador só decodifica a transmissão recebida, com volume local.
- A distribuição HTTP continua como ensaio separado. O bot das calls já publica uma
  faixa Opus por WebRTC/SFU, sem players independentes de plataformas nos clientes.

## Como rodar

```bash
npm run music:setup
npm run music:build
npm run music:call:sfu
# Abra http://127.0.0.1:3999 em duas janelas, entre no Geral e clique no fone de ouvido.
# Sem SFU: npm run music:call. Laboratório HTTP antigo: npm run music:lab (porta 3998).
```

Ferramentas já presentes neste PC: FFmpeg e Python 3; yt-dlp 2026.10.26 instalado pelo
comando acima em `.cache/music-lab/` (ignorado no git). O Node é 26.12.1.

Na continuação foram alterados `public/`, `server.js` e o endereço de escuta opcional do
SFU (`SFU_HOST`). A ponte Go usa o protocolo SFU existente, sem mudar seu formato de mídia.
`deploy/oracle/deploy.sh` inclui os módulos `music/`, compila a ponte e instala as
ferramentas com SHA-256. O serviço ativa o bot; `ENABLE_MUSIC=0` permite desativar.
O dono autorizou deploy e release na etapa final desta sessão.

## Verificações nesta sessão

- `npm test`: 62/62 passaram. Log em `/tmp/teletela-musica-runner.log`.
- Laboratório inicial: cinco testes passaram, incluindo dois clientes recebendo os mesmos
  blocos MP3, terceiro cliente entrando depois sem novo FFmpeg e cancelamento de preparação.
- Link YouTube `https://www.youtube.com/watch?v=jNQXAC9IVRw`: identificou “Me at the zoo” e
  preparou MP3 de 457.388 bytes em aproximadamente 3,5 segundos.
- Link Spotify `https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT`: identificou “Never Gonna
  Give You Up” e encontrou cinco versões no YouTube, com o canal Rick Astley em primeiro.
- Versão encontrada `https://www.youtube.com/watch?v=dQw4w9WgXcQ`: preparou MP3 de 5.114.348
  bytes em aproximadamente dez segundos. Nenhuma credencial ou cookie foi utilizado.
- `MUSIC_LAB_REAL=1 npm run test:music:ui`: passou com a faixa Spotify acima. Dois ouvintes
  Electron receberam áudio efetivo da mesma reprodução, incluindo entrada tardia e volume
  independente. Picos medidos no analisador: 33 e 37 (escala de desvio PCM de 8 bits).
  Três temas e largura de 390 px conferidos; parar em uma janela interrompeu a outra.
- Corrigida armadilha: no Electron, `process.execPath` aponta para o Electron, não para Node.
  O extrator usa `node` do PATH nesse ambiente; usar o executável errado abre outro app e
  trava a extração. O teste foi refeito com sucesso depois da correção.
- `npm run test:music:ui` também passou sem fontes externas, com tom de 440 Hz e picos
  de áudio 8/8 nos ouvintes. Capturas conferidas em `/tmp/teletela-musica-escuro.png`,
  `/tmp/teletela-musica-transmissao-escuro.png` e `/tmp/teletela-musica-celular.png`.
- Laboratório deixado rodando em `http://127.0.0.1:3998` no fim desta sessão; se não estiver
  mais ativo na próxima, basta executar `npm run music:lab`. Não houve release nem deploy.

## Verificações da integração às calls

- `npm run test:music`: 9/9, incluindo fila em ordem, cancelamento durante preparação,
  erro que não trava a próxima faixa, geração antiga recusada, canal privado e parada ao esvaziar.
  Log: `/tmp/teletela-musica-call-novos.log`.
- `npm run test:music:call`: passou no modo direto, com duas janelas no mesmo encoder,
  entrada tardia, reconexão sem reiniciar a música, volume individual, ensurdecer, pausa,
  fila, remoção, pular, terceiro ouvinte em outro canal, troca de canal e parada do canal vazio.
  Log: `/tmp/teletela-musica-call-ui-direto.log`.
- `MUSIC_TEST_SFU=1 npm run test:music:call`: mesmo percurso passou pelo SFU local.
  Log: `/tmp/teletela-musica-call-ui-sfu.log`.
- `MUSIC_LAB_REAL=1 MUSIC_TEST_SFU=1 npm run test:music:call`: faixa Spotify real resolvida
  para YouTube, um encoder Opus, dois ouvintes via SFU, volume, pausa e isolamento passaram.
  Log: `/tmp/teletela-musica-call-ui-real.log`.
- Regressões: runner 62/62; unitários m1–m3 78/78; permissões/persistência 17/17;
  integração de canais/admin; `go test -race ./sfu ./cmd/music-publisher`; teste móvel/desktop.
  Logs em `/tmp/teletela-musica-call-{runner,unitarios,permissoes,integracao,go,mobile}.log`.
- Três temas e largura de 390 px conferidos. Capturas em
  `/tmp/teletela-musica-call-sfu-{escuro,preto,claro,celular}.png` e equivalentes `direto`.

Armadilhas dos testes: o servidor novo só cria Geral por padrão (o teste cria Cinema pela
API); medir áudio no ganho do bot para não confundir sons de entrada com sua música;
aguardar o botão terminar o pedido anterior antes de clicar de novo. Reconectar muda o
socket e apaga as escolhas de busca, então a busca deve ser refeita para novos pedidos.

## Próximos passos

Sala deixada rodando com **SFU local em http://127.0.0.1:3999** no fim da continuação.
Se parar, reiniciar com `npm run music:call:sfu`. O laboratório antigo em 3998 também
continua separado. O servidor de teste de 3999 foi reiniciado vazio, sem usuários conectados.

1. O dono pode testar suas músicas na call local; registrar links que falharem.
2. Playlists/álbuns, cache, pré-carregamento e repetição já estão implementados. Se solicitado,
   acrescentar listas salvas, correspondência mais precisa por identificadores e persistência
   da fila (atualmente volátil). Validar links do dono, inclusive coleções maiores/indisponíveis.
3. WebRTC direto e SFU já funcionam no PC de teste. Validar NAT/rede real antes de oferecer
   salas hospedadas remotamente. Não prometer que
   a leitura pública de títulos Spotify fornece artista, ISRC ou todas as faixas de playlists.
4. Deploy/release autorizados. Versão 3.9.0 preparada com novidades e reversão do microfone.
   Scripts instalam FFmpeg/libopus, Python/yt-dlp e ponte ARM64 e ativam `TELINHA_MUSIC=1`.
   Pendentes: testes finais, backup, deploy, validação real na VM e publicação dos instaladores.

## Referências consultadas

- https://developer.spotify.com/documentation/embeds/reference/oembed
- https://github.com/yt-dlp/yt-dlp
- https://github.com/yt-dlp/yt-dlp/wiki/EJS
- https://github.com/topi314/LavaSrc#what-is-mirroring
- https://github.com/pion/webrtc/blob/main/examples/rtp-to-webrtc/main.go
- https://github.com/pion/webrtc/blob/main/examples/play-from-disk/main.go
- https://ffmpeg.org/ffmpeg-formats.html#ogg

Identificação por oEmbed retorna o título, sem garantir artista. A busca precisa mostrar
resultados para conferência, permitir ajuste manual e não prometer correspondência exata.
Playlists e álbuns não devem ser tratados silenciosamente como uma única faixa.

## Preparação da 3.9.0

- Microfone revertido ao grafo da 3.7 (RNNoise opcional e ganho manual), removidos
  GTCRN/compressores/limitador/mono explícito. Comparação de áudio em Electron passou:
  RNNoise atual −36,54 dBFS e grafo da 3.7 −36,54 dBFS. Sem IA, 100% não adiciona ganho.
- Controles passaram nos três temas: ganho sem trocar faixa, mute, filtros e avatar estável.
- Bot pelo SFU local: dois ouvintes, mesmo encoder, ~50 pacotes/s, pausa, reconexão,
  playlist, repetição, volume, deafen e isolamento passaram; início com tom local em 905 ms.
- Backup feito antes da publicação em `~/Teletela-backups/teletela-dados-2026-10-27_17-49-34.tar.gz`.
- Node e Caddy da VM serão preservados em v24.22.1 e 2.11.7. yt-dlp fixado em 2026.10.26.
- APK atualizado para versionCode 6 / 3.9.0, build e lint passaram.
- Pendentes nesta etapa: deploy, validar fonte real na Oracle, release e conferir artefatos.

- Deploy concluído na Oracle com serviços ativos, FFmpeg 8.0.1/libopus e yt-dlp 2026.10.26.
  Extração de faixa Spotify e publicação Opus no SFU funcionaram. Corrigido o ICE padrão:
  Pion exige `urls` como lista; o teste local também pode receber essa configuração.
  A escuta externa ainda está sendo conferida antes da publicação dos instaladores.

## Validação na Oracle (27/10/2026, 3.9.0)

- Servidor/SFU/Caddy ativos; endpoint `/api/health` respondeu OK. Interface e versão 3.9.0
  instaladas. Node/Caddy preservados. Segredos preservados e não exibidos.
- Faixa Spotify `4cOdK2wGLETKBW3PvgPWqT` encontrada e tocada pelo YouTube na Oracle.
- Dois ouvintes Electron no PC receberam a mesma sala SFU pública por HTTPS/WSS:
  picos 0,234, ~49,99 pacotes/s, correções de ritmo ~0,15% (6 segundos de medição).
  A escuta de teste precisou de elemento Audio ativo para iniciar a decodificação;
  a interface real já mantém esse elemento. Não era falha na transmissão do servidor.
- Logs finais em `/tmp/teletela-390-*.log`: testes62/62, permissões78/78, música15/15,
  Go/race, microfone/controles, celular/permissões na interface, SFU com STUN e escuta Oracle.
  A integração m4 passou na repetição; na primeira tentativa pegou evento de atividade
  anterior ao disconnect (corrida já existente entre sockets).
- Canal de teste temporário; nenhum chat enviado ou canal real alterado.
- Código enviado ao GitHub. Publicação dos artefatos 3.9.0 em andamento.
