Cancelamento de ruído local do microfone usado pelo Teletela.

Copiado de @sapphi-red/web-noise-suppressor 0.4.1 (MIT, ver LICENSE):
  index.js, rnnoise/workletProcessor.js, rnnoise.wasm, rnnoise_simd.wasm
  gtcrn/workletProcessor.js, gtcrn.wasm

RNNoise: o processador embute @shiguredo/rnnoise-wasm (Apache-2.0),
que compila o RNNoise da Xiph.Org/Mozilla (BSD-3-Clause).
GTCRN: embute @sapphi-red/gtcrn-wasm 0.0.3 e o modelo de Rong Xiaobin
(MIT; ver LICENSE-gtcrn-wasm e LICENSE-GTCRN).

Adaptação do Teletela: apenas acrescentamos exports ao fim dos processadores:
  rnnoise/workletProcessor.js: Rnnoise (s), createRnnoiseProcessor (p)
  gtcrn/workletProcessor.js: loadGtcrnModule (i), createGtcrnProcessor (o)
Os símbolos entre parênteses são os nomes minificados nesta versão.
O algoritmo original permanece igual. public/noise-processor.js usa esses
núcleos e confirma ready/error para não enviar uma faixa silenciosa se a IA falhar.

Para atualizar: instale a versão desejada da dependência e copie os arquivos
correspondentes de dist/. Reaplique os exports identificando as funções no
source map da nova versão; não reutilize os nomes minificados sem conferir.
Preserve os avisos de licença e execute npm run test:microphone.
