# Volume baixo do microfone

Investigação na branch `teste/contas-amigos-e-canais-com-senha`, em 25/10/2026.
O relato é de precisar aumentar tanto o microfone quanto o volume de quem está ouvindo.

## Causa reproduzida

O grafo anterior usava RNNoise com `maxChannels: 1`, mas mantinha a configuração padrão
de canais do AudioWorklet e do destino. A saída ficava estéreo com voz em apenas um lado.
Ao virar mono para o Opus, a amplitude caía pela metade, aproximadamente 6 dB. A regra
de conversão é `(L + R) / 2`, conforme a
[especificação Web Audio](https://www.w3.org/TR/webaudio/#down-mixing).

Comparação real no Electron 42/Linux, alimentando o grafo antigo e o novo com a mesma
vogal sintética, aproximadamente −30 dBFS RMS e sem reforço:

| Medida | RMS aproximado |
|---|---:|
| Entrada | −30,6 dBFS |
| Grafo antigo com RNNoise | −36,5 dBFS |
| Grafo antigo recebido por WebRTC | −36,6 dBFS |
| Grafo novo com RNNoise, reforço desligado | −28,9 dBFS |

Há também cerca de 1 dB de compensação dos compressores nativos, além de variação pela
janela de medição e pelo filtro. A comparação confirma uma perda evitável; não prova que
ela explique todos os dispositivos da turma. A captura continua sem AGC do Chromium:
ele já havia interferido no volume do sistema e abaixado o microfone.

## Correção nesta branch

`public/microphone.js` cria a faixa enviada:

```text
captura → mono explícito → RNNoise opcional → compressor de voz
        → ganho manual → compressor de picos → teto digital → destino mono
```

- O compressor de voz é o `DynamicsCompressorNode` do navegador, com limiar de −30 dBFS,
  proporção 4:1, ataque de 5 ms e soltura de 250 ms. A compensação nativa reforça entradas
  baixas; sinais fortes sofrem compressão. Não é um nivelador que tenta atingir um alvo
  de volume em cada sílaba, nem depende de um novo AudioWorklet próprio.
- **Reforçar vozes baixas** vem ligado, salvo por perfil em `prefs.micVoiceBoost`.
  Desligar usa proporção 1:1. A mudança ocorre na mesma faixa, sem renegociar a chamada.
  A tentativa da 3.6.1, revertida por relatos de flicker e problemas no filtro, não foi
  reaplicada; a interface continua usando o medidor VAD existente.
- RNNoise recebe a captura antes do reforço. O filtro básico continua na captura do
  Chromium. Desligar o filtro mantém o reforço e o volume manual independentes.
- O ganho manual de 0–300% fica depois do compressor de voz. A proteção final comprime
  picos e limita amostras a ±0,95. Ela não recupera áudio já distorcido no dispositivo.
- Todos os modos saem em mono. O mesmo stream alimenta VAD, P2P e SFU. O áudio das telas
  fica no caminho separado de sempre, sem esse processamento.
- Parar a faixa libera a captura e o AudioContext; perda da captura encerra a saída.
  Mudar filtro/dispositivo enquanto mutado também atualiza a captura e preserva o mute.

Em outro sinal de referência, de −38 dBFS RMS, o reforço em 100% produziu aproximadamente
−26 dBFS, preservados no receptor Opus local em 100%. O ganho manual em 200% acrescentou
aproximadamente 6 dB. São medições de sinais sintéticos, não uma promessa de volume igual
ao Discord/Meet em qualquer microfone.

O reforço também aumenta ruído residual que sobreviva ao filtro. O teste de ventilação
sintética mostrou forte atenuação com RNNoise; ruído branco não teve a mesma redução.
Quem prefere o volume original pode desligar o reforço. Começar em 100% no emissor e
receptor evita somar os aumentos antigos ao novo processamento.

## Validação

- `npm run test:microphone`: Electron do sistema, Web Audio/RNNoise reais e chamada Opus
  local; confere mono, reforço, ganho manual, 0%, picos, mute, voz sintética, ruído grave
  e encerramento da captura. Não grava nem utiliza vozes dos amigos.
- `npm test`: 62 testes; M1/M2/M3: 82 testes; integrações de canais/admin e contas/amigos.
- Interface conferida nos três temas pelo protocolo instalado `telinha://app`; troca
  de filtros IA/básico/desligado, mute e controles sem substituir a faixa para ajustar ganho.
- A execução foi no Electron 42/Linux, sem mexer na VM. Ainda é necessário ouvir com os
  microfones reais, inclusive no Windows. A mudança está local nesta branch; exige release
  para chegar aos apps instalados e deploy para quem usa pelo navegador.
