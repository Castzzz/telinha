# Pendências atuais

Atualizado em 09/11/2026. Última versão publicada registrada: **4.3.3**.
Esta lista contém trabalho pendente; registros antigos ficam no [histórico](historico/PENDENCIAS.md).

## Em teste local, sem publicação

Branch `prototipo/presenca-e-atividades`, baseada na `main`, com as alterações locais anteriores preservadas:

- [x] Microfone mono com RNNoise, corrigindo o canal vazio e a perda de volume.
- [x] Sons de entrada/saída audíveis ao ensurdecer, respeitando preferências e volume geral.
- [x] Presença por aparelho: Online, Ausente, Não perturbe e Offline, com cores próprias.
- [x] Ausente automático após cinco minutos ou no canal de Ausentes; seleção manual preservada.
- [x] Não perturbe silencia avisos e menções; Offline oculta presença/atividade e preserva call.
- [x] Abertura com nome Colheita Fartus e imagem do servidor personalizável por quem gerencia.
- [x] Remover as faixas/bordas cinzas das configurações.
- [x] Anotar para depois os dois servidores extras, ID/senha e capacidade de até oito pessoas.
- [x] Atividades prontas sem descrição: estudar, trabalhar, assistir, ouvir e jogar;
  texto livre somente em “Outra atividade…”.
- [x] Troca rápida pelo próprio perfil no rodapé; no celular, pela página Você.
- [x] Todos os seletores da sala com lista aberta no tema do app, incluindo áudio/canais/cargos.
- [x] Redesenhar lateral de canais e configurações, com explicações recolhidas.
- [x] Novo início do desktop com prévia autenticada dos amigos online e avatares.
- [x] Retirar a hospedagem no PC e o código de túnel do desktop.
- [x] Evitar reconstruir a atividade quando a detecção retorna o mesmo jogo.
- [x] Separar pendências atuais dos registros históricos e corrigir ideias já publicadas.
- [ ] Validar o protótipo com o dono e a amiga antes de decidir uma publicação.
- [ ] Ouvir a correção de volume/RNNoise nos microfones reais do grupo, Windows e Android.

## Revisão de código desta retomada

- Consultas idênticas de jogos preservam o HTML da atividade; o relógio atualiza só o texto.
- `public/app.js` concentra interface, sinalização e mídia. Extrair módulos por funcionalidade
  pode facilitar manutenção, mas fica fora deste protótipo para reduzir regressões.
- Não foi identificada evidência para remover módulos de áudio, contas ou transmissão nesta
  revisão. Os documentos duplicavam principalmente estados históricos já concluídos.
- Verificações locais: runner 62/62 e 93 regressões de servidor/mídia/contas/presença,
  incluindo imagem do servidor. Interface nos três temas/celular, upload e restauração da
  imagem, menções silenciosas em Não perturbe e retorno da notificação em Online passaram.
  Os testes simulados de áudio não substituem a escuta em aparelhos físicos.


## Android e distribuição

- [ ] Conferir PiP em aparelho físico: trocar de app, fechar a janela do sistema, bloquear
  a tela e usar fone/Bluetooth.
- [ ] Conferir captura de tela/áudio com apps reais, inclusive os que bloqueiam captura.
- [ ] Validar troca de rede, áudio em segundo plano, CPU e consumo de bateria em aparelho físico.
- [ ] Definir distribuição/atualização dos APKs; hoje é manual. Preservar a assinatura existente.

## Para publicar, quando o dono pedir

O protótipo muda cliente e servidor: precisa de release e deploy em conjunto para funcionar
nos apps instalados. Atualizar versão e novidades somente ao preparar a publicação autorizada.
Não há release ou deploy autorizado nesta retomada.

O filtro experimental GTCRN foi revertido; o pendente de escuta atual é RNNoise/volume mono.
Ideias sem implementação ficam em [IDEIAS-FUTURAS.md](IDEIAS-FUTURAS.md).
