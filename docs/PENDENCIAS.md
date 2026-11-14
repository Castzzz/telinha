# Pendências atuais

Atualizado em 14/11/2026. Última versão publicada: **4.6.0**.
Esta lista contém trabalho pendente; registros antigos ficam no [histórico](historico/PENDENCIAS.md).

## Assistir juntos — experimental, 4.6.0

- [x] Implementar sessão por call, guia transferível, extensão Chrome/Edge/Brave para
  YouTube/Netflix, código individual e revogação ao sair da call; pacote ZIP e documentação.
- [ ] Validar dois navegadores reais, play/pausa/avanços, troca de vídeo/episódio,
  reconexão, anúncios YouTube, autoplay, Netflix e limites de acesso entre calls.
  Painel, pareamento, autenticação, sincronização HTTP e ZIP conferidos localmente
  na preparação da release. Netflix permanece experimental; planos com anúncios
  ainda não são suportados.
- [x] Release 4.6.0 e deploy Oracle concluídos em 14/11/2026. Download público do ZIP conferido.

## Incluído na 4.5.0

Publicação e deploy concluídos com autorização do dono; verificações anteriores aproveitadas, sem repetir testes.

- [x] **Miniatura da transmissão arrastável e ajuste do chat de texto:** ao assistir uma transmissão dentro de um canal de texto (`.text-with-stream #stage-section`), a janelinha pode ser arrastada para qualquer canto da tela (duplo clique na barra **Transmissão** restaura a posição padrão). Removido o espaço vazio de `246px` no final de `#chat-messages` (`public/redesign.css`, `public/server-members.css`, `public/mobile.css`, `public/app.js`).
- [x] **Comandos de mensagem `/t` e `/w` (`/whisper`) nos chats (call e texto):**
  - `/t <segundos> <mensagem>`: duração configurável de `1` a `600` segundos (máximo de 10 minutos), selo com contagem regressiva (`⏱️ Xs`), remoção automática ao expirar, bloqueio de fixação e sem gravação em disco.
  - `/w @pessoa ... <mensagem>` ou `/whisper @pessoa ... <mensagem>`: mensagem privada para uma ou mais pessoas marcadas (inclusive nomes compostos), visível só para o remetente e destinatários marcados (`🔒 Privada para ...`), sem indicador de "digitando…" e sem vazar no arquivo em disco, histórico, busca, contexto, mensagens fixadas, citações públicas de resposta ou texto de notificação do sistema.
- [x] **Fotos dos amigos na tela inicial e na aba Amigos:** resolução de avatar pelo ID estável da conta/membro no servidor (`resolveFriendAvatar` em `server.js`, consultando socket ativo, `account.profile.avatar` e `MemberAvatarStore` em disco), preservando a foto ao entrar em call e suportando imagens WebP, GIF, PNG e JPEG com recorte (`avatarCrop`) em `electron/connect.html` (`/api/launcher/friend-avatar/:accountId`) e em `public/friends.js` (`/api/friend-avatar/:accountId`).
- [x] **Revisão das marcações e fotos:** sugestões com foto/iniciais sem juntar homônimos; escolha privada com identificador curto e recusa de nomes ambíguos; `/t ... /w` sem aviso de digitação; recorte e zoom aplicados na aba Amigos.
- Verificação desta revisão: 62/62 testes básicos, 80/80 de M1–M3, 14/14 de contas/amigos/abertura/privadas e dois cenários Electron (marcações e amigos/controles), com capturas nos três temas. A integração antiga `m4-channels-admin` ficou parada antes dos casos novos e não foi validada completa; os cenários novos cobrem o isolamento em call e canal de texto.
- [x] Publicação desktop, Android/código 15, Flatpak e deploy com backup concluídos. Nove arquivos e metadados de atualização conferidos; servidor saudável.

## Incluído na 4.4.0

Branch `prototipo/presenca-e-atividades`, baseada na `main`, com as alterações locais anteriores preservadas:

- [x] Microfone mono com RNNoise, corrigindo o canal vazio e a perda de volume.
- [x] Sons de entrada/saída audíveis ao ensurdecer, respeitando preferências e volume geral.
- [x] Presença por aparelho: Online, Ausente, Não perturbe e Offline, com cores próprias.
- [x] Ausente automático após cinco minutos ou no canal de Ausentes; seleção manual preservada.
- [x] Não perturbe silencia avisos e menções; Offline oculta presença/atividade e preserva call.
- [x] Abertura com nome Colheita Fartus e imagem do servidor personalizável por quem gerencia.
- [x] Remover as faixas/bordas cinzas das configurações.
- [x] Foto/GIF dos autores no histórico, com identidade estável e cópia persistente da última imagem.
- [x] Teste de microfone com gravação/reprodução local, fora da call e sem alterar o mute.
- [x] Membros com largura ajustável, persistência, teclado e restauração por duplo clique.
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
- [x] Publicação autorizada pelo dono após a revisão do protótipo.
- [ ] Ouvir a correção de volume/RNNoise nos microfones reais do grupo, Windows e Android.

## Revisão de código desta retomada

- Consultas idênticas de jogos preservam o HTML da atividade; o relógio atualiza só o texto.
- `public/app.js` concentra interface, sinalização e mídia. Extrair módulos por funcionalidade
  pode facilitar manutenção, mas fica fora deste protótipo para reduzir regressões.
- Não foi identificada evidência para remover módulos de áudio, contas ou transmissão nesta
  revisão. Os documentos duplicavam principalmente estados históricos já concluídos.
- Verificações locais: runner 62/62 e 95 regressões de servidor/mídia/contas/presença/avatares,
  incluindo imagem do servidor. Interface nos três temas/celular, upload e restauração da
  imagem, menções silenciosas em Não perturbe e retorno da notificação em Online passaram.
  Os testes simulados de áudio não substituem a escuta em aparelhos físicos.


## Android e distribuição

- [ ] Conferir PiP em aparelho físico: trocar de app, fechar a janela do sistema, bloquear
  a tela e usar fone/Bluetooth.
- [ ] Conferir captura de tela/áudio com apps reais, inclusive os que bloqueiam captura.
- [ ] Validar troca de rede, áudio em segundo plano, CPU e consumo de bateria em aparelho físico.
- [ ] Definir distribuição/atualização dos APKs; hoje é manual. Preservar a assinatura existente.

## Publicação concluída

Release 4.4.0 publicada e servidor atualizado em 09/11/2026, com autorização do dono.
Windows, AppImage, tar.gz, Flatpak e APK Android/código 14 disponíveis no GitHub.
Backup anterior ao deploy preservado; serviços e saúde pública conferidos. Os testes
já concluídos foram aproveitados, sem nova execução, conforme pedido.

O filtro experimental GTCRN foi revertido; o pendente de escuta atual é RNNoise/volume mono.
Ideias sem implementação ficam em [IDEIAS-FUTURAS.md](IDEIAS-FUTURAS.md).
