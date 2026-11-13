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
