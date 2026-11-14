# Bloqueio do YouTube no bot de música

## Correção gratuita aplicada — 13/11/2026, após a pesquisa

O dono autorizou seguir nas alternativas, desde que todas fossem gratuitas.
A primeira alternativa funcionou, sem instalar provedores, contratar serviços ou
pedir outro login: excluir `web_embedded` da seleção automática de clientes.

- Um processo isolado, como `telinha`, usando o ambiente oficial e
  `youtube:player_client=default,-web_embedded`, obteve/decodificou cinco segundos de
  `djV11Xbc914`: média −21,0 dB, pico 0,0 dB. O extrator usou `tv samsung`/`TVHTML5`.
- A mudança foi preparada em `music/source.mjs`, nos argumentos
  comuns, para valer tanto na extração quanto no download/pré-carregamento.
- Uma cópia candidata fora da pasta instalada na VM repetiu o fluxo real
  `prepareStream` → `startMusicDownload` → FFmpeg, com o ambiente do processo oficial.
  `djV11Xbc914` e `dQw4w9WgXcQ` entregaram cinco segundos de áudio, formato 251 e
  cliente `TVHTML5`, sem 403. Na segunda: média −18,9 dB, pico −1,5 dB.
- Durante a validação da candidata, o código instalado, as credenciais e os serviços
  da sala foram preservados. Não houve nova reprodução em call/SFU nem execução das
  suítes, conforme o pedido anterior do dono. A sintaxe da fonte local foi conferida.
- Backup dos dados/ambiente baixado para
  `~/Teletela-backups/teletela-dados-2026-11-13_22-04-11.tar.gz`, sem apagar cópias antigas.

O dono autorizou aplicar: em **14/11/2026 às 01:14 UTC (13/11 às 22:14 em Brasília)**,
foi atualizado somente `/opt/telinha/app/music/source.mjs` e reiniciado somente
`telinha-server`. O SHA-256 instalado coincide com o local e a candidata validada:
`ba95281a05787d47c39ca2cd48e8b2d0c8a92d6ceec4afca9e1a2c42ed2ff223`.
Node passou do PID `255362` para `260621`; SFU `255289` e WARP `255099` preservados,
assim como `/etc/telinha/telinha.env`. Sem release desktop ou publicação do protótipo
de Assistir juntos/mudanças de volume.

Antes de aplicar, novo backup completo baixado para
`~/Teletela-backups/teletela-dados-2026-11-13_22-13-43.tar.gz`. A fonte anterior ficou
em `/opt/telinha/backup-fonte-musica-20261114-011423/source.mjs`, em diretório root `0700`.
Para reversão pontual, restaurar apenas essa fonte e reiniciar somente Node, com
autorização do dono; não restaurar os dados da sala para desfazer esta mudança de código.

Depois da aplicação, o módulo instalado e o ambiente do novo processo oficial repetiram
`prepareStream` → `startMusicDownload` → FFmpeg para `djV11Xbc914`: cinco segundos,
média −21,0 dB, pico 0,0 dB, sem 403. A saúde pública respondeu `ok`, três canais e
quatro clientes reconectados. Diretório da candidata e script local de diagnóstico
removidos. **Correção aplicada e obtenção/decodificação confirmadas; escuta na call
ainda depende da conferência do grupo.** Não há garantia contra bloqueios futuros.

Referência do caminho escolhido: [issue #17989, comentários de 06/11](https://github.com/yt-dlp/yt-dlp/issues/17989).

## Recorrência em 13/11/2026 — HTTP 403 na leitura das músicas

O dono relatou falha em qualquer música, com `unable to download video data: HTTP Error
403: Forbidden`. Conferência de diagnóstico, sem inserir música na call, reiniciar
serviços, fazer deploy/release ou rodar a suíte de testes:

- Node, SFU e WARP ativos. yt-dlp instalado `2026.10.26`, também a versão estável mais
  recente informada pela API oficial do projeto nessa consulta.
- A sessão dedicada continua no ambiente do processo oficial; os 29 cookies lidos não
  estavam vencidos pela data gravada. Isso não prova que o YouTube ainda aceite a sessão.
  Nenhum valor foi mostrado, copiado ao repositório ou alterado.
- Um processo isolado, como `telinha`, com o ambiente e os módulos instalados na VM,
  obteve metadados e os primeiros bytes de `jNQXAC9IVRw`. A música `djV11Xbc914`
  resolveu metadados/formato 251, mas a leitura retornou 403.
- Extrair e baixar a música num único processo yt-dlp, sem reaproveitar metadados,
  também retornou 403. Renovar apenas o cache não é uma correção demonstrada.
- A tentativa HLS com `web_safari` não ofereceu formato utilizável. Sem cookies, a
  mesma música exigiu confirmação de que não é robô. Não repetir essas alternativas
  em cascata nem atribuir a falha à interface/volume do app.

O dono concluiu o login em Firefox com perfil temporário exclusivo e encaminhamento
SSH local para o WARP oficial. Foram exportados somente os 25 cookies de YouTube
desse perfil, sem mostrar valores, e transferidos para uma pasta root `0700` em `/run`.
O túnel foi encerrado antes da conferência, e o perfil/cookies temporários removidos
deste PC. Não foi acessado o perfil pessoal nem automatizada senha/verificação.

**A sessão renovada também não resolveu.** Na Oracle, o módulo instalado resolveu
metadados de `djV11Xbc914`, mas o download retornou 403 e o FFmpeg não recebeu áudio
para decodificar. A mesma sessão também falhou com 403 na leitura sem o WARP e no
formato AAC/M4A alternativo. O cliente público `android_vr`, sem cookies, exigiu
confirmação de que não é robô. Não houve reprodução na call nem execução das suítes.
O nightly mais recente consultado (`2026.11.04.232659`) não listava alterações do
extrator YouTube/desafios no intervalo desde a estável; não foi instalado.

A candidata temporária na VM foi descartada após falhar. A sessão persistente e o
ambiente oficial foram preservados, sem reiniciar Node/SFU/WARP. **Naquele ponto, a
recuperação continuava pendente, sem correção validada para o novo bloqueio.** Repetir login,
reiniciar o bot ou renovar WARP não são soluções demonstradas. Qualquer substituição
da sessão persistente ou reinício do Node exige autorização explícita depois de
preparar e conferir uma candidata que realmente entregue áudio.

Referências: [versão estável atual](https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest),
[cookies do YouTube](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies)
e [restrições de formatos/PO Tokens](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide).

## Pesquisa posterior solicitada pelo dono — 13/11/2026

Somente pesquisa, sem novos diagnósticos na VM, instalação ou alteração da sala.
A issue [#17989](https://github.com/yt-dlp/yt-dlp/issues/17989), aberta em 03/11/2026,
descreve 403 com cookies, inclusive após atualizar o extrator/runtime e refazer login.
Nos comentários de 06/11, um colaborador relaciona parte dos casos ao experimento
do YouTube que exige PO Token de GVS para `web_embedded`. Isso é uma hipótese útil,
**ainda não confirmada no nosso caso**; não confundir com o bloqueio anônimo por IP.

Ordem proposta para uma próxima investigação isolada:

1. Conferir o cliente efetivo nos metadados/logs e tentar
   `--extractor-args youtube:player_client=default,-web_embedded`.
   Há relatos de sucesso e falha na mesma issue; fontes de TV podem ter restrições.
2. Se insuficiente, usar provedor de PO Token realmente carregado e conferir geração
   de **GVS**, para a leitura do áudio, com a sessão dedicada. A tentativa de outubro
   registrada acima gerou token de **player**, sem login, e não liberou a fonte; isso
   não demonstra que o fluxo autenticado com token GVS funcione ou falhe.
   O guia oficial recomenda `mweb` com provedor automático. A issue também relata
   `youtube:fetch_pot=always` com provedor, evitando depender da detecção automática
   dessa exigência experimental.
3. Como alternativa ao BgUtils, o guia indica
   [yt-dlp-getpot-wpc](https://github.com/coletdjnz/yt-dlp-getpot-wpc), experimental,
   que usa Chrome/Chromium para gerar tokens GVS/player, com ou sem sessão autenticada.
   Não equivale ao teste antigo de Firefox/extração de cookies nem exige usar o PC
   do dono se preparado na VM. Compatibilidade e consumo na ARM64 ainda não conferidos.

O código atual passa `--no-plugin-dirs`; instalar um provedor por si só não garante
que seja usado. Uma candidata precisa habilitar o diretório específico e comprovar
no diagnóstico que o provedor e o token pretendidos foram carregados. Tokens não
garantem resolver confirmação de robô/bloqueio por IP, como o próprio
[BgUtils ressalta](https://github.com/Brainicism/bgutil-ytdlp-pot-provider).
[Guia oficial de PO Tokens](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide).

## Investigação anterior — 29/10/2026

Investigação na `main`, após o dono relatar que todas as músicas que tentou falhavam com
“O YouTube bloqueou temporariamente a leitura desta faixa no servidor”. Não houve deploy,
release nem reinício do servidor da sala ou do SFU. Houve uma troca autorizada de perfil
WARP, revertida após falhar na validação; apenas `telinha-warp` foi reiniciado.

## O que foi confirmado

- `telinha-server`, `telinha-sfu` e `telinha-warp` ativos na Oracle.
- O processo do servidor recebeu `TELINHA_MUSIC=1`, o extrator esperado e o proxy SOCKS5
  local esperado. Conferidos somente esses campos; nenhum segredo foi exibido.
- A saída do proxy informou `warp=on`; o serviço não estava simplesmente desligado.
- yt-dlp `2026.10.26`, também a versão estável mais recente no GitHub nesta investigação;
  Node da VM `v24.22.1`. O hash de `music/source.mjs` na VM coincidiu com a `main` local.
- `jNQXAC9IVRw` (“Me at the zoo”) recebeu a exigência de confirmar que não é robô na VM,
  tanto direto quanto pelo WARP. O mesmo vídeo foi resolvido neste PC. Selecionar apenas
  o cliente `web_embedded` no teste isolado da VM também não resolveu.
- `dQw4w9WgXcQ` foi resolvido pelo WARP. Um processo separado, executado como `telinha`,
  importou `prepareStream` e `startMusicDownload` do código instalado e decodificou cinco
  segundos via FFmpeg: volume médio −18,9 dB e pico −1,5 dB. Nenhuma reprodução foi
  enviada às calls; isso valida a obtenção/decodificação daquela fonte, não a escuta por SFU.

O bloqueio do YouTube foi reproduzido, mas **não há evidência de bloqueio universal de
todas as faixas**: uma fonte entregou áudio na mesma VM. Os links que falharam para o dono
não foram informados. Não atribuir a falha ao Chromium da interface, ao mixer ou ao SFU.
Também não prometer que atualizar o extrator, repetir a busca ou reiniciar resolverá.

## Navegador e autenticação

O app desktop usa Electron/Chromium para a interface e reprodução WebRTC. O bot da VM
não navega no YouTube usando Chromium: Node chama yt-dlp (Python), que obtém o áudio;
FFmpeg o codifica e a ponte Go o envia ao SFU. O Node configurado em `--js-runtimes`
executa desafios JavaScript do extrator, sem abrir uma janela de navegador.

Exportar cookies do Firefox é uma forma de fornecer uma sessão ao yt-dlp; não transforma
o extrator em Firefox nem comprova menor detecção. Não importar cookies de contas
automaticamente. Não existe uma correção com Firefox comprovada nesta investigação.
A FAQ do yt-dlp menciona melhores resultados com Firefox num procedimento específico
de cookies/User-Agent para bloqueios HTTP 403 de sites protegidos pelo Cloudflare.
Esse relato não demonstra uma solução para a exigência de confirmação de robô do YouTube
observada aqui; não confundir essa proteção de sites com o proxy Cloudflare WARP usado na VM.

## Continuação

1. Reproduzir com os links específicos usados pelo grupo, quando disponíveis, separando
   busca/metadados, download/decodificação e recepção pelo SFU.
2. As tentativas com PO Tokens e Firefox estão registradas abaixo; não liberaram a fonte
   bloqueada pela saída WARP antiga. A sessão nova entregou áudio inicialmente, mas depois
   voltou a falhar, inclusive em teste isolado. A configuração anterior foi restaurada.
3. Uma eventual correção deve preservar a reprodução única no servidor e ser testada
   antes de propor publicação. O pedido atual não autorizou deploy ou release.

## Tentativas adicionais e saída pelo PC

O dono pediu para tentar resolver o bloqueio. Todos os testes abaixo foram isolados,
sem alterar o processo da sala, usar uma conta Google ou enviar áudio às calls:

- Executável oficial ARM64 do mesmo yt-dlp `2026.10.26`, SHA-256 conferido, com
  `curl_cffi` e `--impersonate firefox`: a faixa bloqueada continuou em `LOGIN_REQUIRED`.
- BgUtils POT Provider `2.0.2`, com servidor só em `127.0.0.1:4416` e plugin oficial
  conferido pelo SHA-256 publicado: gerou um **player PO Token** para o cliente `mweb`,
  mas o YouTube ainda pediu confirmação de robô. Também falhou combinando com a
  assinatura de rede do Firefox. A instalação de teste ficou em `/tmp`, fora do app.
- Cliente `android_vr` isolado também falhou para a mesma fonte.
- **Firefox real 158.0.1**, perfil temporário sem login e saída pelo WARP da VM:
  o player retornou `LOGIN_REQUIRED` e não reproduziu. Na conexão direta deste PC,
  outro perfil novo recebeu `OK` e reproduziu cerca de sete segundos.
- Cookies exclusivamente anônimos desse perfil novo, testados pelo WARP com a
  assinatura Firefox, também não resolveram. Nenhum perfil/cookie pessoal foi usado.

**Funcionou usar a conexão deste PC como saída do bot.** Um túnel SSH reverso dinâmico
abriu um proxy SOCKS5 somente em `127.0.0.1:40001` na VM. Sem trocar o yt-dlp instalado,
`prepareStream` e `startMusicDownload` da sala conseguiram obter e decodificar cinco
segundos de `jNQXAC9IVRw` (média −25,1 dB, pico −9,1 dB) e de `djV11Xbc914` (“Take On Me”;
média −21,0 dB, pico 0,0 dB). O FFmpeg rodou na Oracle. Isso confirma a alternativa de
obtenção/decodificação, sem afirmar uma validação nova de ouvintes pelo SFU.

É uma alternativa dependente do PC: o servidor continua codificando e distribuindo uma
única reprodução, mas a busca e o download saem pela conexão deste PC. O PC precisa
ficar ligado, com internet e a ponte aberta, e recebe/reenvia o tráfego das fontes. Não
é uma solução autônoma na Oracle nem uma garantia contra bloqueios futuros do YouTube.

Essa alternativa não foi ativada na sala. O dono descartou a dependência do PC ligado;
o comando auxiliar e o exemplo de configuração adicionados no commit `7465581` foram
retirados do estado atual do projeto. A ponte, Firefox/geckodriver e o provedor de tokens
de teste foram encerrados; os cookies anônimos foram removidos. Nesse estágio, os testes
de música passaram 17/17 e o runner geral 62/62.

## Sessão independente na Oracle — sem depender do PC

Foi registrado um dispositivo WARP novo, com chave própria, em diretório temporário
privado na VM. Um segundo wireproxy escutou somente em `127.0.0.1:40002`; o perfil
oficial e o serviço existente não foram modificados. Não reutilizar simultaneamente a
mesma chave WireGuard em dois processos: o teste usou outra identidade.

- A nova saída resolveu e entregou cinco segundos de áudio das duas fontes
  (`jNQXAC9IVRw` e `djV11Xbc914`), usando os módulos e o yt-dlp já instalados na Oracle.
  Os volumes medidos coincidiram com o teste pela ponte do PC.
- Na rodada de controle feita no mesmo período, a saída antiga em `40000` ainda retornou
  confirmação de robô para `jNQXAC9IVRw`.
- A ponte do PC já estava encerrada e a porta `40001` fechada. A obtenção e a decodificação
  aconteceram inteiramente na Oracle. Não foi usada conta Google.
- Ambas as conexões informaram WARP ativo. O endereço mostrado pelo trace do Cloudflare
  foi igual; isso não permite atribuir o resultado apenas a uma troca de IP público.
  O resultado comprovado é que a sessão nova recebeu áudio e a antiga falhou no controle.

O dono autorizou aplicar o perfil. A configuração candidata substituiu a oficial e
somente `telinha-warp` foi reiniciado. Na validação em `40000`, **as duas fontes voltaram
a receber a exigência de confirmar que não é robô**. O backup foi restaurado imediatamente
e somente WARP reiniciado outra vez. Um novo controle isolado, como usuário `telinha` em
`40002`, também falhou: o resultado positivo foi temporário, sem correção sustentada.

Confirmado depois da reversão: configuração oficial idêntica ao backup privado
`/opt/telinha/data/warp.conf.backup-20261029-174827`, serviços ativos e processos do
servidor (`102279`) e SFU (`102273`) preservados. O registro WARP criado exclusivamente
para o teste foi revogado (HTTP 204); candidato, chaves e diretórios temporários removidos.
As portas de teste `40001`/`40002` ficaram fechadas. Nenhuma chave/token foi para o git.

**Renovar WARP não resolveu o bloqueio.** Não automatizar registros em massa nem
considerar o candidato anterior pronto para ativação.

## Conta separada do bot — correção ativa na Oracle

Após a reversão, o dono escolheu testar uma conta Google separada. Foi aberto um Firefox
com perfil exclusivo e sem automação de login, usando um encaminhamento SSH local para
o WARP oficial da Oracle. O dono faz o login e qualquer verificação diretamente na janela;
senha, códigos e cookies não devem passar pelo chat nem pelo repositório. Não acessar o
perfil pessoal do navegador. O dono concluiu o login e fechou a janela; foram exportados
somente cookies de `youtube.com` desse perfil, transferidos por SSH para um diretório
temporário `0700` na VM, com arquivo `0600`. Nenhum valor de cookie foi exibido.

Esse encaminhamento serviu apenas ao login inicial. Foi encerrado antes de testar o código
novo. Com a saída WARP oficial e os executáveis instalados na Oracle:

- O código atual, com `--cookies` num extrator de teste, obteve e decodificou cinco segundos
  de `jNQXAC9IVRw` e `djV11Xbc914`.
- O código candidato com `MUSIC_COOKIES_BASE64` repetiu o resultado: média −25,1 dB/pico
  −9,1 dB na primeira e média −21,0 dB/pico 0,0 dB na segunda.
- A busca por “a-ha Take On Me” retornou cinco candidatos.
- Tudo ocorreu na Oracle, com o túnel do PC já encerrado. Não foi enviada música às calls;
  esses testes validam obtenção/decodificação, sem afirmar escuta real pelo SFU nesta etapa.

O suporte novo é opcional. O segredo persistente ficou em `MUSIC_COOKIES_BASE64`
somente no `/etc/telinha/telinha.env`; base64 é codificação, não criptografia. Cada processo
yt-dlp recebe uma cópia temporária `0600`, em diretório `0700`, removida ao terminar.
O conteúdo não aparece nos argumentos; o cache distingue sessões por hash. Não existem
cookies reais no repositório. Os testes exercitam preparação, download, cache, permissões,
limpeza em sucesso/falha e rejeição de sessão inválida sem expor seu conteúdo.

Validação local: **18/18** testes de música e **62/62** gerais. O dono autorizou a ativação:
em **29/10/2026, às 20:46 UTC**, foram atualizados apenas `music/source.mjs` e o ambiente
privado na VM, com reinício somente de `telinha-server`. Sem release do desktop, mudança
de `public/` ou reinício de SFU/WARP. O hash instalado coincide com o código local.

Depois da ativação, a sessão foi confirmada no ambiente do processo oficial, sem exibir
seu conteúdo. Um processo separado, como `telinha`, usando esse ambiente e o módulo já
instalado, repetiu busca com cinco candidatos e cinco segundos de áudio das duas fontes,
com os mesmos volumes anteriores. Isso valida a fonte na configuração em produção;
não foi inserida música em nenhuma call para afirmar nova escuta de ouvintes pelo SFU.
`/api/health` público respondeu `ok`, com três canais visíveis e quatro clientes reconectados.

Backup anterior: `~/Teletela-backups/teletela-dados-2026-10-29_17-45-14.tar.gz`.
Para reversão pontual, fonte e ambiente anteriores foram guardados em diretório root `0700`
`/etc/telinha/backup-musica-20261029-204643`, com arquivos `0600`. Restaurar os dois juntos
e reiniciar somente `telinha-server` se houver necessidade. Nenhum segredo foi para o git.
Diretório de teste na VM, cookies intermediários, túnel e perfil exclusivo do Firefox no PC
foram removidos/encerrados após a validação. A sessão persistente fica no `telinha.env`.

A sessão pode expirar e exigir novo login manual. O yt-dlp alerta que usar uma conta pode
causar restrições ou banimento; usar somente a conta dedicada e evitar repetição de
requisições sem necessidade. O resultado atual não garante ausência de bloqueios futuros.

Referências oficiais consultadas:

- [Versão estável 2026.10.26](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26)
- [Extrator YouTube e cookies](https://github.com/yt-dlp/yt-dlp/wiki/Extractors)
- [PO Tokens](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
- [Desafios JavaScript](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
- [FAQ: cookies e origem das requisições](https://github.com/yt-dlp/yt-dlp/wiki/FAQ)
