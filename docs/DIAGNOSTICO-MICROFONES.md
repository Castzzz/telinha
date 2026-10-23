# Microfones baixos em Linux e Windows

Investigação de 23/10/2026. Relato: usuários precisam colocar o microfone em 300% nas
configurações e a voz dos amigos em 200%; às vezes ainda fica baixo. A correção está
separada dos experimentos de contas/servidores, preparada para a versão 3.6.1.
O processamento não altera o volume do SO.

## Falha reproduzida

O grafo anterior aplicava RNNoise com `maxChannels: 1`, mas deixava `channelCount` e
`channelCountMode` do AudioWorklet nos padrões. O destino `MediaStreamAudioDestinationNode`
também mantinha o padrão de dois canais. Em Electron 42 no Linux, o resultado real foi
uma faixa estéreo com voz no canal esquerdo e o direito completamente zerado.

Com um mesmo sinal de referência ajustado para cerca de −38 dBFS RMS, a medição mostrou:

| Grafo anterior, ganho manual 100% | Esquerdo | Direito | Faixa |
|---|---:|---:|---|
| Sem filtro de ruído | −38,3 dBFS | −38,3 dBFS | estéreo |
| RNNoise | −38,3 dBFS | silêncio digital | estéreo |

Uma chamada WebRTC local com o código anterior confirmou o efeito: a voz de aproximadamente
−38,4 dBFS no canal esquerdo chegou ao receptor mono perto de **−44,2 dBFS**, com os ganhos
em 100%. O teste foi feito carregando o `app.js` original do Git num servidor de teste,
sem substituir os arquivos da correção no diretório de trabalho.

A conversão padrão de estéreo para mono calcula `(L + R) / 2`, conforme a
[especificação Web Audio](https://www.w3.org/TR/webaudio/#down-mixing). Com R vazio,
isso reduz a amplitude pela metade (aproximadamente 6 dB). A voz usa Opus mono, então
essa combinação torna o grafo anterior inadequado para o envio. O teste reproduziu a saída
com um canal vazio e a perda no receptor; não é uma gravação dos microfones de todos os amigos
nem prova de que esse era o único motivo de todo caso relatado.

O controle manual já funcionava: 300% multiplicava a amplitude por três, cerca de 9,5 dB.
Faltava compensar entradas fracas de forma controlada e impedir os picos do ganho alto.
O AGC do Chromium permanece desligado: já havia causado redução do mic e interferência
no volume do sistema. O SFU repassa Opus sem recodificar; não foi colocado ganho na VM.

## Correção

`public/microphone.js` passa a criar o grafo:

```text
microfone → mono explícito → RNNoise opcional, mono explícito
          → equilíbrio opcional da voz + ganho manual + limitador → faixa mono
```

O destino tem `channelCount = 1`. O worklet próprio declara também `outputChannelCount: [1]`.
Isso vale para o modo com IA, básico e sem filtro de ruído. A faixa continua em 48 kHz
com `contentHint = speech`, usada tanto pelo P2P quanto pela publicação no SFU.

- **Equilibrar automaticamente o volume da voz** fica ligado por padrão, salvo em
  `prefs.micAutoVolume`. Atua somente no áudio capturado pelo app, sem mudar dispositivos
  ou o volume do Linux/Windows. Pode ser desligado durante a call, sem reconectar.
- O alvo do nivelador é cerca de −22 dBFS RMS, com ganho automático de até 12 vezes.
  Ele reage suavemente, não aumenta ganho abaixo de −55 dBFS e volta à base após pausas.
  Esse limiar é uma proteção simples contra silêncio/ruído muito baixo; não é um detector
  infalível de fala. RNNoise/filtro básico continuam responsáveis pelo ruído.
- O ganho manual de 0–300% é independente e continua funcionando na hora. A normalização
  não anula a escolha da pessoa. Recomenda-se começar em 100% no emissor e receptor.
- O limitador segura picos digitais próximos de −1 dBFS depois dos ganhos. A codificação
  Opus pode produzir pequenas variações; isso não limita o volume geral do PC nem corrige
  distorção que já ocorreu no microfone/driver antes da captura.
- A tela de Microfone mostra o nível enviado. O tooltip contém entrada após o filtro,
  saída e ganho aplicado. A interface só atualiza essa informação quando a aba está visível,
  no máximo duas vezes por segundo. O processamento continua no AudioWorklet em segundo plano.
- Se o worklet de ajuste estiver indisponível, mantém saída mono, ganho manual e proteção
  de picos via Web Audio; a interface informa que o ajuste automático não está disponível.
- Parar a faixa processada fecha a captura original, os worklets e o AudioContext. A troca
  de filtro/dispositivo continua substituindo a faixa na conexão WebRTC existente.

## Validação e limites

- `tests/m2-microphone-level.test.js`: sinais baixos, voz forte, teto do ganho, independência
  do ajuste manual, silêncio, ruído abaixo do limiar, 0%, picos e entradas inválidas.
- Medição real com Electron/Chromium e RNNoise: faixa final mono em todos os modos. Um
  sinal baixo de −38 dBFS resultou em aproximadamente −24,7 dBFS com os dois controles em
  100%; no receptor WebRTC local ficou próximo de −24,1 dBFS. Esses números dependem do
  sinal, das pausas e da janela de medição; não são um ganho fixo garantido para toda voz.
- Duas janelas Electron conectadas a Node + SFU Go locais, pela mesma arquitetura da VM:
  o receptor em 100% recebeu cerca de −24,2 dBFS. Desligar o equilíbrio voltou a −38,3 dBFS;
  colocar o ganho manual em 200% resultou em −18,2 dBFS. Trocar o filtro durante a call
  preservou a conexão e encerrou a captura anterior. Volume 0% e mute produziram silêncio
  digital no receptor. Não foi necessário alterar o SFU.
- Interface conferida nos três temas. As suítes existentes passaram: `npm test` (62),
  testes M1/M2/M3 (83, incluindo cinco novos do nivelador) e integração M4 de canais/admin.
- Os testes de reprodução usam sinal local de referência, sem tocar os arquivos originais
  e sem incluir vozes privadas no Git. Scripts de medição/prints ficam em `/tmp`.
- A implementação JS é compartilhada entre Windows/Linux; a execução de áudio desta
  investigação foi no Electron 42 do Linux. Ainda é necessário ouvir e validar com os
  dispositivos reais da turma, especialmente no Windows e em microfones já distorcidos
  ou com relação sinal/ruído ruim. Ganho digital não recupera detalhe que não foi captado.

Uma mudança em `public/` exige release; o deploy também atualiza quem usa pelo navegador.
A versão e o popup de novidades foram atualizados para 3.6.1 a pedido do dono.
Os experimentos de contas, amigos, servidores, permissões
e notificações continuam separados desta correção.
