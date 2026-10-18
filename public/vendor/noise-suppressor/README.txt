Cancelamento de ruído do microfone (RNNoise) usado pelo Telinha.

Copiado de @sapphi-red/web-noise-suppressor 0.4.1 (MIT, ver LICENSE):
  index.js, rnnoise/workletProcessor.js, rnnoise.wasm, rnnoise_simd.wasm
O workletProcessor.js embute o @shiguredo/rnnoise-wasm (Apache-2.0),
que compila o RNNoise da Xiph.Org/Mozilla (BSD-3-Clause).

Pra atualizar: npm install -D @sapphi-red/web-noise-suppressor@<versão>
e copie os mesmos arquivos de node_modules/@sapphi-red/web-noise-suppressor/dist/.
