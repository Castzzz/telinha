# Bloqueio do YouTube no bot de música — 29/10/2026

Investigação na `main`, após o dono relatar que todas as músicas que tentou falhavam com
“O YouTube bloqueou temporariamente a leitura desta faixa no servidor”. Não houve deploy,
release, troca de ferramentas, alteração de segredos nem reinício dos serviços oficiais.
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
2. Uma solução autônoma continua sem validação. As tentativas com PO Tokens e Firefox
   estão registradas abaixo; não liberaram a fonte bloqueada pela saída WARP.
3. Uma eventual correção deve preservar a reprodução única no servidor e ser testada
   antes de propor publicação. O pedido atual não autorizou deploy ou release.

## Tentativas adicionais e alternativa validada

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

### Ponte preparada no projeto

No PC do dono que já tem a chave SSH da Oracle:

```bash
npm run music:relay
```

`deploy/oracle/music-relay.sh` usa `VM` e `SSH_KEY` de `config.sh` e mantém uma conexão SSH
própria. `MUSIC_RELAY_PORT` troca a porta (padrão 40001); a escuta fica em loopback, as
conexões de destino ficam limitadas à porta 443 e nenhum agente SSH é encaminhado.
Ctrl+C encerra a ponte. O comando não instala um timer nem modifica o serviço da sala.

O endereço para o bot seria `MUSIC_PROXY=socks5://127.0.0.1:40001`. O exemplo revisável está
em `deploy/oracle/music-relay.env.example`: acrescentar ao arquivo de ambiente existente,
preservando os segredos e demais campos. Isso só entra em uso depois de reiniciar
`telinha-server`; depende de autorização explícita do dono. Para reverter, restaurar
`socks5://127.0.0.1:40000` e reiniciar. Não alterar rotas, firewall ou o serviço WARP.

A alternativa foi preparada, **não ativada na sala oficial**. Os componentes e sessões
anônimas temporários dos testes são descartáveis; não precisam ser instalados para a ponte.
O comando final `npm run music:relay` também foi usado para repetir a decodificação da
faixa bloqueada, com o mesmo resultado. Testes de música: 17/17; runner geral: 62/62;
`bash -n` passou e a porta inválida foi rejeitada antes de abrir SSH.
Pelo mesmo caminho, `resolveMusic` identificou o link bloqueado e a busca por título
retornou cinco versões. Ao terminar, a ponte de teste, Firefox/geckodriver, o encaminhamento
para WARP, o provedor de tokens e seus arquivos/cookies anônimos na VM foram encerrados
ou removidos. O serviço oficial manteve a saída WARP anterior.

Referências oficiais consultadas:

- [Versão estável 2026.10.26](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26)
- [Extrator YouTube e cookies](https://github.com/yt-dlp/yt-dlp/wiki/Extractors)
- [PO Tokens](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
- [Desafios JavaScript](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
- [FAQ: cookies e origem das requisições](https://github.com/yt-dlp/yt-dlp/wiki/FAQ)
