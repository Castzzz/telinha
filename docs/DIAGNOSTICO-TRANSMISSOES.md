# Imagem congelada e quedas de qualidade

Análise de 22/10/2026, após o relato de problemas na VM antiga de 1 GB. A correção abaixo
faz parte da versão 3.4.0; a inspeção inicial das VMs foi somente leitura, sem reiniciar a sala.

## O que foi observado

- A VM antiga limitava o SFU a 200 MB. Nos registros de kernel e do serviço consultados para
  21/10 até a migração não apareceram eventos de OOM/morte por falta de memória. Há registros
  de conexões fechadas e erros de escrita em transporte fechado, que também ocorrem quando
  alguém sai ou perde a conexão. Esses registros não provam falta de RAM nem identificam o
  congelamento relatado. Não havia séries históricas de CPU, memória e banda para correlacionar.
- Na inspeção da nova VM, o SFU usava aproximadamente 8 MB e tinha limite de 2 GB, sem
  reinícios automáticos. Essa leitura foi feita com pouca carga e não é teste de capacidade.
- O SFU repassa VP8/Opus sem recodificar: a redução da resolução acontece no emissor WebRTC.
  A VM pode contribuir indiretamente se houver congestionamento, perda ou falta de recursos.

## Por que 1080p pode ficar borrado e depois voltar

Os presets do `public/app.js` usam resolução/FPS ideais de captura e um teto de bitrate.
1080p60 tem teto de vídeo de 5,5 Mbps; não é uma reserva ou garantia de banda. O emissor usa
`degradationPreference = 'maintain-framerate'` e, nos presets de 60 FPS, `contentHint = 'motion'`.
Isso prioriza fluidez e permite sacrificar resolução/detalhes quando CPU ou rede apertam.
O áudio também recebe prioridade maior no código, então pode continuar enquanto o vídeo sofre.

Esse comportamento é compatível com a queda de qualidade relatada; sem estatísticas do
incidente não é possível afirmar qual recurso limitou a transmissão, nem confirmar que a
resolução chegou a 144p. A configuração de adaptação não foi alterada nesta investigação.
Uma comparação entre 1080p30 e 1080p60 ajuda a investigar carga de captura/encoding, sem
garantir que isso resolva perda de pacotes ou banda insuficiente.

Referências: [W3C, dicas de conteúdo de vídeo](https://w3c.github.io/mst-content-hint/#video-content-hints)
e [W3C, estatísticas de limitação da qualidade](https://www.w3.org/TR/webrtc-stats/#dom-rtcoutboundrtpstreamstats-qualitylimitationreason).

## Falha encontrada e corrigida na versão 3.4

O laço de `Room.forward` encerrava o repasse ao receber um erro de escrita diferente de
`io.ErrClosedPipe`. Porém, [o Pion 4.2.24 tenta todos os espectadores e agrega seus erros](https://github.com/pion/webrtc/blob/v4.2.24/track_local_static.go).
Um erro de um espectador podia, portanto, encerrar a faixa para os demais. Como áudio e vídeo
têm laços separados, isso pode deixar só a imagem parada. Não há evidência suficiente para
afirmar que foi a causa do episódio de ontem.

`forwardPackets` agora continua lendo o host e entregando aos espectadores restantes. Ele só
termina quando a leitura do host termina; falhas de envio são registradas no máximo a cada
5 segundos por faixa. A recuperação/remoção das conexões continua com os mecanismos existentes.

Validação:

- `go test -race ./sfu`: erro temporário, erro persistente, transporte fechado e término do host.
  O teste verifica que todos os pacotes ainda chegam ao espectador saudável.
- Teste local com Electron e SFU compilado: um emissor de vídeo/áudio e dois espectadores,
  saída de um espectador e reconexão. O outro continuou recebendo áudio e vídeo; quem voltou
  recebeu vídeo novamente. O teste usou mídia sintética de 640×360, sem simular o incidente
  original nem afirmar estabilidade de 1080p60 sob congestionamento.
- Testes existentes do app/servidor também passaram. Nenhum deploy foi feito.

## Se acontecer de novo

Anote se afetou todos os espectadores ao mesmo tempo e o horário. No emissor, as estatísticas
`outbound-rtp` de `getStats()` mostram `qualityLimitationReason` (`cpu`, `bandwidth`, `none`
ou `other`), resolução, FPS, bytes enviados e mudanças de resolução. No receptor, confira
quadros decodificados, `freezeCount`, perdas de pacotes e jitter. Esses números precisam ser
comparados ao longo do tempo, junto com CPU/memória/rede da VM, para distinguir as causas.


## Saltos na imagem ao assistir (10/11/2026, correção local)

Relato: um espectador vê glitches e a imagem parece ir e voltar no tempo ao assistir às
transmissões dos outros. Ainda falta comparar o mesmo instante entre espectadores e medir
as estatísticas durante o incidente; a causa do relato não está confirmada.

Consulta somente de leitura na VM às 21:58 UTC (18:58 de Brasília): Node/SFU ativos,
carga de aproximadamente 0,6 e cerca de 10,9 GB de memória disponível. Os últimas duas horas
de registros consultados não mostraram erros de envio; isso não mede perda de rede nem exclui
picos anteriores. Nenhum serviço foi reiniciado.

Foi encontrado um defeito independente no repasse: `forwardPackets` copiava as extensões RTP
do host para os espectadores. MID identifica a seção de mídia da conexão negociada, e TWCC
identifica pacotes de um transporte. Os IDs/extensões da conexão host → SFU não podem ser
reutilizados cegamente na conexão SFU → espectador. O `TrackLocalStaticRTP` do Pion troca
SSRC/payload type, mas não faz essa tradução das extensões recebidas.

A correção remove as extensões de entrada antes de entregar o pacote ao Pion e habilita
`ConfigureTWCCHeaderExtensionSender`, gerando uma sequência de transporte por conexão de
saída. Áudio/vídeo, sequência RTP, timestamps, marcador e CSRC são preservados; pacotes
atrasados continuam sendo repassados para permitir recuperação por NACK. Não há descarte de
quadros antigos nem alteração artificial da velocidade de reprodução. Pacotes RTP malformados
são ignorados sem encerrar a faixa.

Referências: [MID no RFC 8843 §15](https://www.rfc-editor.org/rfc/rfc8843.html#section-15),
[repasse no Pion 4.2.24](https://github.com/pion/webrtc/blob/v4.2.24/track_local_static.go) e
[configuração de TWCC no Pion 4.2.24](https://github.com/pion/webrtc/blob/v4.2.24/interceptor.go).

Regressões reproduzem o vazamento das extensões antes da correção e verificam sua remoção,
bytes da mídia, pacotes fora de ordem, volta do contador de sequência, pacote inválido e
continuidade quando um espectador falha. `go test -race ./sfu` e o runner de 62 testes passaram.
O teste de janela pode usar SFU real com `TEST_SFU=1 npm run test:stream:ui`, após compilar
`go build -o .cache/music-lab/music-sfu ./sfu` e preparar a ponte local de música já usada
pelo teste. A checagem com SFU corrigido e Electron passou: reprodução, tela cheia, três temas,
fechar/reabrir e parar de assistir. Usa vídeo sintético; não reproduz a rede do amigo.

A mudança de produção é só em `sfu/`; para chegar à sala oficial exige deploy explicitamente
pedido pelo dono. Sem release nem deploy nesta investigação.

## Travamentos em 1080p60 e 1440p60 (11/11/2026, análise)

O dono confirmou que o travamento aparece para quem assiste. Ainda não foi confirmado se
atinge todos simultaneamente nem se a prévia local também trava. Nenhum ajuste de mídia,
release, deploy ou reinício foi feito nesta análise; alterações locais anteriores foram
preservadas.

### Evidências na VM

Consulta somente de leitura em 11/11 às 18:53–18:56 UTC (15:53–15:56 de Brasília):

- Carga de 0,13/0,29/0,49; aproximadamente 10,9 GB de memória disponível, swap sem uso.
  SFU ativo desde 10/11 às 00:30 UTC, sem reinícios automáticos, usando cerca de 26 MB,
  limite de memória de 2 GB e sem quota de CPU. Isso descreve aquele instante, não a carga
  durante o travamento.
- `sudo ss -uanmp 'sport = :50000'`: socket UDP do processo `telinha-sfu` com
  `rb212992` e `d493`: buffer de recepção de 212.992 bytes (208 KiB) e 493 descartes
  acumulados naquele socket. A fila estava vazia. O contador permaneceu igual nas duas
  consultas; há evidência de descartes anteriores, sem correlação temporal com o relato.
- Contadores globais: `UdpRcvbufErrors=12637`, `UdpInErrors=12638` e
  `UdpSndbufErrors=19`, também estáveis nas consultas. São do sistema inteiro, não apenas
  do SFU. A interface de rede mostrava zero descartes/erros; isso não exclui descarte no
  socket. `net.core.rmem_default=212992`, `rmem_max=4194304`.
- Logs recentes confirmam vídeo VP8. Os presets no cliente servido pela VM continuam em
  5,5 Mbps para 1080p60 e 8,5 Mbps para 1440p60; esses valores são tetos de vídeo.

### Limitações encontradas no código

1. **Buffer UDP pequeno para rajadas.** `setupWebRTC` abre um socket compartilhado com
   `net.ListenUDP` sem chamar `SetReadBuffer`. Todas as salas/faixas UDP passam por ele.
   Quadros grandes e várias transmissões podem gerar rajadas. Os 208 KiB não são todos
   aproveitáveis como mídia: o kernel também contabiliza estruturas dos pacotes. Aumentar
   o buffer é uma mitigação prioritária a testar, não uma confirmação da causa.
2. **Sem adaptação ao caminho SFU → espectador.** Cada publicação usa uma única faixa
   de vídeo; não há simulcast, seleção de camadas ou ajuste de bitrate a partir da banda
   dos espectadores. `readViewerRTCP` trata PLI/FIR; os interceptors padrão recuperam
   perdas por NACK e geram relatórios, mas não instalam um controlador de banda/pacer
   para a saída. Gerar extensões TWCC também não instala esse controlador. Assim, a
   adaptação WebRTC do emissor considera seu trecho até o SFU; um espectador com caminho
   pior continua recebendo a mesma faixa. Repassar TWCC bruto ao host seria incorreto:
   cada conexão tem sua própria sequência de transporte.
3. **Somente VP8 no SFU.** Não há opção H.264/VP9/AV1. Isso limita a escolha de encoder,
   mas não prova encoding por CPU: depende do dispositivo e do Chromium. Medir
   `encoderImplementation`, `powerEfficientEncoder`, tempo de encoding e
   `qualityLimitationReason` antes de atribuir o problema ao codec ou prometer aceleração.
   Em pixels por segundo, 1080p60 exige 4,5 vezes o trabalho de 720p30; 1440p60, 8 vezes.
   Esses números não são uma previsão linear de CPU.
4. **Recuperação de perdas usa janelas fixas.** Pion interceptor v0.1.49 usa 512 pacotes
   no gerador NACK, intervalo de 100 ms e cache de 1.024 pacotes no respondedor. Quanto
   maior a taxa, menor o tempo coberto por esses números. Avaliar RTT e retransmissões
   antes de alterar; não há evidência de esgotamento dessas janelas neste incidente.

### Ordem recomendada para corrigir e medir

- Primeiro testar um buffer UDP de recepção maior (por exemplo, solicitar 4 MiB e
  verificar o valor efetivo em `ss`), preservando a correção local anterior das extensões
  RTP. Comparar o delta de descartes numa transmissão real em alta resolução. Isso exige
  mudança no SFU e deploy autorizado; nada foi aplicado à VM nesta análise.
- Medir simultaneamente emissor e espectador pelo painel **Configurações → Transmissão
  → Diagnóstico**. Registrar resolução/FPS reais, bitrate, perda, RTT, congelamentos e
  motivo de limitação durante o problema, comparando 1080p30, 1080p60 e 1440p60.
  Emissor com FPS baixo/limitação de CPU aponta para captura/encoding. Emissor estável
  e espectador com perda/congelamentos aponta para repasse/rede/recepção; ainda é preciso
  separar rede de decode no receptor. Prévia lisa sozinha não elimina encoding lento.
- Depois tratar adaptação à banda de recepção. Um pacer sozinho não resolve quando o
  bitrate sustentado excede a capacidade do espectador; exige política de qualidade,
  feedback agregado seguro ou camadas alternativas. Avaliar codecs adicionais conforme
  as máquinas afetadas, mantendo compatibilidade.

Verificação do estado local: `npm test` (62/62),
`node --test tests/transmission-diagnostics.test.js` (2/2) e
`~/.local/go/bin/go test -race ./sfu` passaram. Essas suítes não reproduzem uma sessão
1080p60/1440p60 na rede dos amigos; não foi realizado teste visual novo nesta análise.

Fontes: [interceptors padrão do Pion 4.2.24](https://github.com/pion/webrtc/blob/v4.2.24/interceptor.go),
[gerador NACK 0.1.49](https://github.com/pion/interceptor/blob/v0.1.49/pkg/nack/generator_interceptor.go),
[respondedor NACK 0.1.49](https://github.com/pion/interceptor/blob/v0.1.49/pkg/nack/responder_interceptor.go)
e [estatísticas WebRTC da W3C](https://www.w3.org/TR/webrtc-stats/).

## Aumento do buffer preparado (11/11/2026, local)

A pedido do dono, `setupWebRTC` agora solicita 4 MiB de buffer UDP de recepção antes de
iniciar o mux compartilhado. A VM tem `rmem_max=4194304`, suficiente para a solicitação,
sem alteração global do kernel. O ajuste afeta apenas o socket de mídia do SFU e mantém
os limites existentes do serviço. Se falhar, há aviso e o SFU continua com o padrão do
sistema. O log de sucesso descreve o tamanho solicitado: o kernel pode limitá-lo.

Teste com o SFU compilado e portas locais temporárias: `/health` saudável e `ss -uanmp`
confirmou `rb8388608`, ou 8 MiB na contabilização do Linux, que dobra o valor de
`SO_RCVBUF`. O valor anterior observado na VM era `rb212992` (208 KiB); o novo limite
contabilizado é aproximadamente 39 vezes maior, compartilhado por todas as salas.
Isso não adiciona espera deliberada nem exige encher o buffer para entregar pacotes.
Também não resolve excesso sustentado de tráfego ou limitação de decode/encoding.

Referências: [Go, UDPConn.SetReadBuffer](https://pkg.go.dev/net#UDPConn.SetReadBuffer)
e [Linux, SO_RCVBUF e rmem_max](https://man7.org/linux/man-pages/man7/socket.7.html).
Aplicação na sala oficial depende de deploy explicitamente solicitado. Nesta etapa,
nenhuma alteração foi aplicada à VM.

Validação do ajuste: `npm test` (62/62), `go test -race -count=1 ./sfu` e
`TEST_SFU=1 /usr/lib/electron42/electron tests/stream-window-browser.cjs` passaram.
Conferida a captura de tela cheia do player com vídeo sintético; reprodução, temas e
fechar/reabrir funcionaram com SFU real. Ainda não reproduz a rede nem a carga de uma
transmissão real em 1080p60/1440p60.

## Aplicado à VM (11/11/2026, 15:58 de Brasília)

Deploy explicitamente autorizado, direcionado ao SFU com substituição atômica do binário
`linux/arm64` e reinício apenas de `telinha-sfu`. Inclui o aumento de buffer e a correção
anterior de repasse RTP/TWCC. As outras alterações locais não foram publicadas.
Backup de dados íntegro em `~/Teletela-backups/teletela-dados-2026-11-11_15-58-18.tar.gz`;
binário anterior guardado em `/opt/telinha/bin/telinha-sfu.rollback.B562tm`.

`ss` na VM confirmou `rb8388608`, com `d0` nas consultas iniciais após o reinício.
O contador zerou porque o socket foi recriado; comparar seu crescimento durante vídeo
em alta resolução. Saúde pública Node/SFU OK, serviços ativos e cinco salas reconectadas
com áudio recebido nos logs. Não havia transmissão de vídeo nos registros consultados
após o deploy; o efeito em 1080p60/1440p60 ainda precisa ser avaliado durante o uso.


## Resolução recebida de 960 × 540 com qualidade 1080p (12/11/2026)

O print do espectador mostra 960 × 540, cerca de 58 FPS e 2.240 kb/s, com 0% de perda
no intervalo e RTT de 13 ms. Isso confirma a resolução recebida naquele momento, mas
não mede a captura ou o motivo da adaptação no PC de quem transmite. A perda e o RTT
via SFU descrevem o trecho servidor → espectador; não descartam limitações no emissor.

O código mantém `degradationPreference = 'maintain-framerate'`, e os presets de 60 FPS
usam `contentHint = 'motion'`: há preferência por fluidez, permitindo redução de resolução.
960 × 540 é metade de 1920 × 1080 em cada dimensão, compatível com essa adaptação;
sem estatísticas do emissor, ela continua sendo hipótese, não causa confirmada. A captura
também pode já estar abaixo do preset, pois usa constraints ideais. Não há redimensionamento
ou recodificação no SFU.

Melhoria local do painel: o emissor passa a ver resolução da captura (`media-source`)
separada da enviada. O receptor vê “Resolução recebida” e orientação para conferir a
limitação no PC de quem transmite. Não foi alterada a política de qualidade. Conferência
de sintaxe apenas; testes e abertura do Teletela adiados a pedido do dono.


## Qualidade ruim desde o início por mais de um minuto (12/11/2026)

Novos prints mostram 274 × 148 nos dois lados. Quem transmite informa 60 FPS,
188 kb/s, RTT de 8 ms, 0% de perda informada e `qualityLimitationReason=bandwidth`.
O espectador informa 2 FPS, 31 kb/s, RTT de 15 ms e três congelamentos no intervalo.
As capturas não demonstram simultaneidade, então não se deve comparar as taxas como
se fossem pacotes do mesmo intervalo. O dono confirmou que já começa ruim e leva
mais de um minuto para normalizar.

Isso confirma que o emissor está limitando pela estimativa de banda naquele momento,
mas não prova falta de capacidade da internet. No código, só se definia `maxBitrate`;
isso é teto, não taxa inicial. Uma estimativa inicial baixa com subida lenta é compatível
com o relato. Os congelamentos no receptor ainda exigem medição própria; corrigir a
partida não garante resolver a diferença de FPS.

Mitigação local: `public/stream-start-bitrate.js` indica `x-google-start-bitrate` na oferta
inicial de vídeo em SFU/P2P. Usa metade do teto, até 2 Mbps para tela e 600 kbps para
câmera, com redução para redes identificadas como 3G e sem dica para 2G. A negociação
volta à oferta original se a dica for rejeitada antes de mudar o estado. Não impõe mínimo,
não aumenta o teto e não reinicia a estimativa periodicamente. É uma dica específica do
Chromium, que outros navegadores podem ignorar. O resultado depende de rede/encoder.
Não foi alterado o SFU nem aplicado deploy ou release.

O diagnóstico passa a mostrar meta atual de vídeo (`targetBitrate`), estimativa de banda
na conexão (`availableOutgoingBitrate`, compartilhada com o áudio), quando fornecidas,
e protocolo UDP/TCP. O texto diferencia a estimativa de banda de um teste de velocidade.

Validação nesta etapa: conferência de sintaxe e diff apenas. Testes e abertura do Teletela
continuam suspensos a pedido do dono. Comparar o início de uma nova transmissão antes/
depois, com estatísticas dos dois lados; ainda não há evidência de melhora na rede real.

Referências: [LiveKit, indicação de bitrate inicial e subida lenta no WebRTC](https://github.com/livekit/client-sdk-js/blob/main/src/room/PCTransport.ts)
e [W3C, motivo de limitação de qualidade](https://www.w3.org/TR/webrtc-stats/#dom-rtcoutboundrtpstreamstats-qualitylimitationreason).


### Validação autorizada posteriormente (12/11/2026)

- `npm test`: 62/62. Suítes selecionadas de áudio/câmera/WebRTC/diagnóstico: 36/36.
- `node --test tests/stream-start-bitrate.test.js tests/transmission-diagnostics.test.js`:
  8/8 (dois casos do diagnóstico já estão nos 36 acima). Inclui preservação de Opus/RTX,
  indicação em redes lentas, oferta alternativa e identificação da banda por transporte.
- SFU local recompilado antes do teste final. `TEST_SFU=1 npm run test:stream:ui`:
  indicação inicial aceita pelo Chromium, popup/retorno, volume/mute/restauração,
  fullscreen, temas e diagnóstico funcionando. Fonte sintética 1920 × 1080 a 60 FPS:
  primeiro quadro em 700 ms; receptor em 1920 × 1080 após 2,5 s.
- `npm run test:stream:ui` (P2P): primeiro quadro em 454 ms; receptor em 640 × 360 após
  2,5 s, apesar da captura 1080p e da indicação aceita. O teste funcional passou; esse
  resultado mostra que aceitar a indicação não garante subir imediatamente para 1080p.
- Uma execução P2P anterior teve timeout na checagem da ocultação dos controles; passou
  na repetição. A causa não foi confirmada. O teste agora registra eventos de ponteiro/
  foco durante essa espera se falhar novamente.

Capturas conferidas nos três temas e nos painéis de envio/recepção. As medições acima são
locais e não comparam antes/depois; não confirmam resolver a espera de mais de um minuto
na rede do amigo. Nenhum release ou deploy nesta validação.
