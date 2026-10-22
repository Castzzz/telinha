# Imagem congelada e quedas de qualidade

Análise de 22/10/2026, após o relato de problemas na VM antiga de 1 GB. As mudanças abaixo
estão na branch de teste; a inspeção das VMs foi somente leitura, sem reiniciar a sala.

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

## Falha encontrada e corrigida na branch

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
