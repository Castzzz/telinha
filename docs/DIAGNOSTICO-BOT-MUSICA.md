# Bloqueio do YouTube no bot de música — 29/10/2026

Investigação na `main`, após o dono relatar que todas as músicas que tentou falhavam com
“O YouTube bloqueou temporariamente a leitura desta faixa no servidor”. Não houve deploy,
release nem reinício do servidor da sala ou do SFU. Houve uma troca autorizada de perfil
WARP, revertida após falhar na validação; apenas `telinha-warp` foi reiniciado.
O trabalho do Magic foi guardado em `experimento/magic-no-teletela`, commit `aeebdbb`.

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

## Conta separada do bot — validação concluída, ativação pendente

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

O suporte novo é opcional. O segredo persistente deverá ficar em `MUSIC_COOKIES_BASE64`
somente no `/etc/telinha/telinha.env`; base64 é codificação, não criptografia. Cada processo
yt-dlp recebe uma cópia temporária `0600`, em diretório `0700`, removida ao terminar.
O conteúdo não aparece nos argumentos; o cache distingue sessões por hash. Não existem
cookies reais no repositório. Os testes exercitam preparação, download, cache, permissões,
limpeza em sucesso/falha e rejeição de sessão inválida sem expor seu conteúdo.

Validação local: **18/18** testes de música e **62/62** gerais. Código preparado e testado
isoladamente na VM; **ainda não ativado na sala**. Para ativar, precisa guardar a sessão
no ambiente, atualizar `music/source.mjs` e reiniciar somente `telinha-server`, com
autorização. Não precisa release do desktop, mudança de `public/` ou reinício do SFU/WARP.

A sessão pode expirar e exigir novo login manual. O yt-dlp alerta que usar uma conta pode
causar restrições ou banimento; usar somente a conta dedicada e evitar repetição de
requisições sem necessidade. O resultado atual não garante ausência de bloqueios futuros.

Referências oficiais consultadas:

- [Versão estável 2026.10.26](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26)
- [Extrator YouTube e cookies](https://github.com/yt-dlp/yt-dlp/wiki/Extractors)
- [PO Tokens](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
- [Desafios JavaScript](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
- [FAQ: cookies e origem das requisições](https://github.com/yt-dlp/yt-dlp/wiki/FAQ)
