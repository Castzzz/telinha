# Auditoria local de segurança e proteção dos dados — 10/11/2026

Revisão inicial do código no commit `c40d20b`, versão 4.5.0. As evidências abaixo descrevem
o estado antes das correções. Após pedido do dono, as cinco falhas receberam correções
locais, ainda sem publicação; veja o registro de correções ao final.
Nenhum release, deploy, commit, acesso SSH ou requisição ao servidor oficial foi feito.
Os achados descrevem este código; a configuração e os arquivos instalados na VM não foram
conferidos. Este relatório não é uma certificação de segurança nem evidência de invasão anterior.

## Método e limites

- Leitura de autenticação, contas, permissões, mensagens, arquivos, Electron, SFU e backup.
- Reprodução com três perfis fictícios e servidor ligado somente em `127.0.0.1`, porta
  aleatória, pasta temporária exclusiva e segredos fictícios. Clientes sem reconexão automática.
- Nenhum teste de carga, tentativa de derrubar processo, força bruta ou exploração na internet.
- Consulta ao registro npm e ao aviso público da dependência, sem enviar dados dos usuários.
- Somente dados fictícios foram alterados. Conexões e servidor de reprodução foram encerrados;
  a pasta de dados de reprodução foi removida. Sons pessoais foram preservados.
- O SFU foi revisado e seus testes executados. Não houve transmissão/captura real de áudio,
  câmera ou tela. A interface gráfica, Android e firewall/TLS da VM não foram auditados.
- O início do servidor chama a configuração de loopback de áudio do próprio projeto;
  esse comportamento ocorreu no PC local, sem relação com a VM.

## Achados e prioridade

As gravidades abaixo são avaliações do contexto do app, sem pontuação CVSS calculada.

| ID | Gravidade | Resultado | Confirmação |
| --- | --- | --- | --- |
| SEG-01 | Alta | Copiar o perfil público de visitante permite editar/apagar mensagens dele | Reproduzido localmente |
| SEG-02 | Alta | Copiar o perfil público de visitante permite ler sussurros alheios | Reproduzido localmente |
| SEG-03 | Alta | Link de anexo de canal comum ignora a senha da sala | Reproduzido localmente |
| SEG-04 | Alta | Bloqueio de áudio pela moderação não impede emissão de tokens de mídia | Emissão reproduzida; mídia real não testada |
| SEG-05 | Alta no aviso externo | `body-parser` instalado está em faixa vulnerável | Versão e aviso conferidos; exploração não executada |

### SEG-01 — Autoria de mensagem depende de identificador público

**Locais:** `server.js`, funções `safeProfileId`, `applyProfile`, eventos `message-edit`
e `message-delete`. Há mensagens novas com `authorMemberId`, mas a autorização dessas
operações continua comparando `msg.profileId` com `user.profileId`.

**Condição:** atacante já admitido na sala e com acesso ao canal; vítima usando perfil
sem conta. O identificador aparece nos dados públicos das mensagens. `safeProfileId`
protege IDs vinculados a contas, mas aceita o ID de outro visitante.

**Reprodução:** Alice enviou uma mensagem fictícia. Bob tentou editá-la com seu próprio
perfil e recebeu `success: false`. Depois enviou `update-profile` com o `profileId` público
de Alice, mantendo sua identidade de permissões distinta. A edição retornou
`success: true`; a exclusão da mesma mensagem também retornou `success: true`.

**Impacto:** perda de integridade e possibilidade de apagar conteúdo de visitantes.
Não foi necessário obter senha da conta ou token de permissões da vítima. Isso não
demonstrou tomada de uma conta nem promoção ao cargo de dono.

**Correção sugerida:** autorizar mensagens novas por `authorMemberId === user.accessId`.
Para conteúdo legado, exigir vínculo comprovado no servidor; ID público informado pelo
cliente não deve autorizar migração, edição ou exclusão. Revisar também autoria de canais,
reações e moderação que ainda usem `profileId`.

### SEG-02 — Sussurros aceitam identidade pública como autorização

**Local:** `server.js`, função `canSeeChatMessage`. Ela aceita o `profileId` do autor ou
destinatário como alternativa ao `accessId` autenticado.

**Condição:** terceiro admitido na sala, com acesso ao mesmo canal; remetente ou destinatário
com perfil sem conta. A mensagem precisa continuar na memória do servidor.

**Reprodução:** Alice enviou `/w @DonoTeste segredo-ficticio-auditoria`. O histórico solicitado
por Bob inicialmente não trouxe o segredo. Após copiar o `profileId` de Alice por
`update-profile`, o mesmo `text-history` devolveu a mensagem privada a Bob.

**Impacto:** quebra da confidencialidade dos sussurros envolvendo visitantes. Não persistir
em disco não impede esse acesso enquanto a mensagem está na memória. A transmissão de
novos eventos usa a mesma função de autorização e também precisa ser corrigida.

**Correção sugerida:** usar exclusivamente identidades autenticadas do servidor para autor
e destinatários. Não usar `profileId` público como alternativa. Acrescentar regressões para
histórico, eventos ao vivo, reconexão e perfis que compartilham IDs públicos.

### SEG-03 — Anexos de canais comuns ficam acessíveis sem entrar na sala

**Local:** `server.js`, função `canReadAsset` e rotas de imagens/arquivos de texto e call.
Se o canal não possui `access.private`, a função retorna `true` antes de procurar uma
sessão válida ou conferir a proteção da sala.

**Reprodução:** Alice enviou um arquivo fictício a um canal comum. O dono definiu uma senha
na sala. Uma requisição HTTP sem credenciais recebeu `401` em `/api/channels`, mas recebeu
`200` e os bytes completos ao abrir o link do arquivo sem parâmetro `access`.

**Impacto:** quem obtiver um link consegue baixar o arquivo sem autorização da sala.
Os nomes são UUIDs e o teste não demonstrou listagem nem adivinhação viável. Ainda assim,
um link compartilhado ou anteriormente conhecido funciona como credencial permanente
enquanto o arquivo continuar indexado, inclusive após colocar senha na sala.

**Correção sugerida:** exigir conexão/sessão válida antes de servir mídia de uma sala
protegida, inclusive para canais comuns, e depois verificar a permissão do canal.
Se compartilhar arquivos externamente for desejado, criar uma ação explícita com link
temporário e revogável. Testar também revogação, logout e encerramento da conexão.

### SEG-04 — Tokens do SFU ignoram mute/deafen da moderação

**Locais:** `server.js`, evento `sfu-token` e função `moderate`; `sfu/main.go`,
`authorized` e `handleSocket`.

**Reprodução:** o dono mutou Alice pelo servidor; o estado interno confirmou
`serverMuted: true`. Alice ainda recebeu `ok: true` e token de host para `kind: 'voice'`.
Depois de ensurdecer Alice pelo servidor, ela ainda recebeu token de viewer para a voz
do dono no mesmo canal. Os valores dos tokens não foram incluídos neste relatório.

**Impacto:** cliente modificado pode obter autorização criptográfica para publicar voz
mutado ou ouvir ensurdecido. A interface oficial obedece ao bloqueio, mas isso não substitui
a autorização do servidor. A exceção de bloqueio no canal de Ausentes já existe.
Não foi executado tráfego de mídia para demonstrar a reprodução audível.

**Correção sugerida:** negar host de voz se `serverMuted`/`serverDeafened`; negar viewer de
voz se `serverDeafened`. Ao aplicar moderação, revogar conexões de mídia já autorizadas,
renovar a identidade de mídia de forma consistente e testar tokens emitidos antes do
bloqueio. Preservar a política deliberada para áudio de tela separado da voz.

### SEG-05 — Dependência de produção com aviso de indisponibilidade

`npm ls` identificou `express@4.22.3` → `body-parser@1.20.8`.
`npm audit --omit=dev --json` apontou um pacote de produção com gravidade alta.

O [aviso GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)
descreve exceção não tratada após corpo HTTP comprimido com bytes adicionais;
a correção da linha 1.x começa em `1.20.9`. As rotas `/api/account/*` usam
`express.json`, que processa corpos comprimidos por padrão e roda antes da autenticação.

**Limite da conclusão:** o app registra `uncaughtException`, portanto não foi demonstrado
que o processo deste app terminaria como no caso padrão do aviso. A presença desse
tratador não corrige a dependência nem garante estado consistente depois de uma exceção.
Não foi enviado o conteúdo malformado, nem mesmo ao servidor oficial.

**Correção sugerida:** atualizar a resolução da dependência e conferir o lockfile. Caso
compressão nos pedidos de conta não seja necessária, avaliar também `inflate: false`.
Executar regressões de contas antes de qualquer deploy.

## Proteção dos dados: o que foi observado

| Dado | Proteção atual observada | Limite / ação recomendada |
| --- | --- | --- |
| Senhas de conta | scrypt assíncrono com salt; `N=65536`, `r=8`, `p=1`; limite de dois cálculos simultâneos | Manter; os testes de login/recuperação passaram |
| Sessões de conta no servidor | Token aleatório de 32 bytes; apenas SHA-256 salvo; validade de 30 dias | Token no cliente continua sendo credencial de acesso |
| Recuperação de conta | Código aleatório de 24 bytes, hash em disco; troca do código e revogação das sessões | Guardar o código fora de locais compartilhados |
| Identidade e cargos | HMAC/prova de chave; identidade de permissões distinta do perfil público | Aplicar essa identidade também a SEG-01 e SEG-02 |
| Arquivos de conta/permissões | Gravação atômica e modo `0600` no código | Não houve inspeção das permissões reais da VM |
| Histórico, anexos e fotos | Persistência local no servidor; canais privados verificam autorização | Conteúdo legível pelo processo/operador e backups; SEG-03 afeta canais comuns |
| Sussurros e temporárias | Fluxo novo em memória, sem gravação normal no histórico de texto | Não são criptografia ponta a ponta nem promessa de apagar cópias/screenshots; SEG-02 quebra acesso |
| Preferências no desktop | Arquivos `prefs.json`/`identities.json` com modo `0600` | Sessões e credenciais persistem sem cofre do sistema; revisar acesso IPC |
| Transporte de mídia | WebRTC com término no SFU, conforme arquitetura | Não há evidência de criptografia ponta a ponta contra o próprio SFU |
| Backup | Script local usa `umask 077`, diretório `0700` e mantém 15 arquivos | O `.tar.gz` inclui dados e `/etc/telinha`, inclusive segredos; gzip não cifra o backup |

O servidor precisa ler mensagens e arquivos para as funções atuais. Criptografia de disco
ou de backup protege cópias roubadas em repouso, mas não resolve falhas de autorização
nem protege de um processo do servidor comprometido.

## Riscos adicionais encontrados na leitura, sem exploração completa

- **Electron — isolamento de origens:** vários IPCs, incluindo `prefs-get`, `prefs-set` e
  captura, não validam o remetente como `localSettings` faz para autostart. As permissões
  de mídia são concedidas pela sessão sem conferir a origem. A janela principal não tem
  a restrição `will-navigate` presente no player. Caso conteúdo remoto consiga navegar
  nessa janela ou executar no contexto confiável, há risco de ler sessões salvas e pedir
  captura. Não foi demonstrada uma cadeia remota que chegue a esse ponto. Restringir
  navegação, remetente IPC e permissões às páginas locais exatas.
- **Resistência a abuso:** a senha da sala usa `scryptSync` no handshake sem limite prévio
  por endereço; as tentativas de senha de canal são limitadas por socket e reiniciam ao
  reconectar. `/ws` legado limita cada frame, mas acumula fragmentos sem limite total nem
  autenticação. Corrigir os limites antes de fazer qualquer teste de volume. Não houve
  tentativa de esgotar CPU, memória ou disco.
- **Defesa no navegador:** a resposta local do HTML não trouxe `Content-Security-Policy`.
  Os pontos amostrados do chat escapam HTML e restringem links a HTTP(S), sem XSS
  reproduzido nesta revisão. Planejar CSP compatível com os scripts atuais e proteção
  contra enquadramento; isso não substitui validar conteúdo nem corrigir autorização.
- **Dependências de desenvolvimento:** `npm audit` completo contou oito pacotes afetados,
  um alto e sete moderados, incluindo propagação pela cadeia do `electron-builder`.
  Não são oito falhas independentes de produção. Revisar a cadeia de build sem aplicar
  automaticamente a sugestão de downgrade/alteração maior do npm.

## Verificações concluídas

- Reprodução local: edição/exclusão alheias, leitura de sussurro por terceiro, download
  anônimo com sala protegida e emissão de tokens de voz após moderação.
- Controle negativo local: leitura de canal privado por visitante sem acesso foi negada.
- `npm test`: **62/62**, suíte existente de smoke/cenários; passar nela não cobre os achados.
- `node --test --test-concurrency=1 tests/accounts.test.js tests/accounts-server.test.js
  tests/m4-permissions.test.js tests/chat-mentions.test.js tests/message-avatars.test.js`:
  **34/34**, incluindo subtestes, com persistência de contas, revogação, canais privados,
  permissões, mensagens e fotos. Isso também não cobre os cenários novos vulneráveis.
- `/home/castzin/.local/go/bin/go test ./sfu`: **passou**.
- Servidor de reprodução respondeu saudável ao final.

Evidências de trabalho nesta máquina, somente com dados fictícios: script
`/tmp/teletela-auditoria-local.mjs` e logs `/tmp/teletela-auditoria-local.log`,
`/tmp/teletela-auditoria-regressao.log`, `/tmp/teletela-auditoria-protecoes.log`,
`/tmp/teletela-auditoria-dependencias.json`. São temporários e podem desaparecer;
o registro durável dos resultados é este documento. Não foram publicados scripts de exploração.

## Ordem sugerida de correção

1. Corrigir a identidade usada para autoria e sussurros (SEG-01 e SEG-02).
2. Exigir autorização para arquivos de sala protegida (SEG-03).
3. Aplicar moderação no SFU, inclusive revogação de mídia já aberta (SEG-04).
4. Atualizar `body-parser` e conferir o lockfile (SEG-05).
5. Endurecer Electron, limites de abuso e proteção de backups.

Cada correção deve ganhar teste de regressão que espere a operação indevida ser negada.
Release e deploy continuam dependendo de pedido explícito do dono.

## Correções locais após a auditoria — 10/11/2026

As cinco falhas confirmadas foram tratadas no código local, sem acessar a sala oficial.

| ID | Alteração | Verificação |
| --- | --- | --- |
| SEG-01 | Editar/apagar usa `authorMemberId === accessId`, nunca o ID público | Cópia de perfil negada; autor legítimo em outro aparelho autorizado; legado sem prova negado |
| SEG-02 | Autor/destinatários de sussurro são autorizados só por `accessId` | Terceiro com ID copiado não recebe evento, histórico, edição ou reação |
| SEG-03 | Sala com senha exige chave de conexão válida para mídia; call com senha exige estar na call | Acesso anônimo/chave falsa negados, acesso legítimo preservado, desconexão invalida a chave |
| SEG-04 | Tokens de voz obedecem mute/deafen; conexões anteriores são revogadas por identidades de mídia separadas | IDs anteriores enviados a `/revoke`, novos tokens negados durante bloqueio; desbloqueio funciona; tela preservada |
| SEG-05 | Lockfile atualizado para `body-parser@1.20.9`; JSON de contas rejeita compressão | Corpo gzip rejeitado, servidor saudável, auditoria de produção sem alertas |

A revisão da mesma causa também protegeu exclusão de canais e sons e alteração de reações.
Moderação usa o membro autenticado e alcança seus aparelhos conectados. Trocar o ID
público não remove o bloqueio. Não há promessa de identificar uma pessoa que descarte
todas as credenciais e crie uma nova identidade de visitante.

**Compatibilidade dos dados:** canais novos gravam `createdByMemberId`, sons novos gravam
`ownerMemberId` e reações novas gravam `m`. Os campos antigos são mantidos. Não há migração
automática de propriedade baseada em ID público. Canais/sons antigos sem prova ficam
sob exclusão por gerenciamento/moderação; mensagens sem `authorMemberId` não podem ser
editadas e só a moderação pode apagá-las. Reações antigas continuam no histórico, sem
permitir que um perfil público copiado as reivindique. Nada foi apagado dos dados oficiais.

**Validação:** testes novos em `tests/security-regressions.test.js` (seis cenários e teste
principal) cobrem as tentativas indevidas e os caminhos legítimos. A integração antiga de
canais/admin passou a restaurar o token real nas reconexões, em vez de usar só ID público.
Passaram `npm test` (62/62), as regressões selecionadas de contas, permissões, identidade,
privacidade, fotos, canais e segurança (51/51), a integração m4 e `go test ./sfu`.
O Electron do sistema confirmou edição disponível só ao autor, carregamento autenticado
de imagem com sala protegida, bloqueio/restauração das sessões de voz, três temas e
largura móvel; também passou a interface existente de marcações/sussurros.
As capturas locais `/tmp/teletela-seguranca-*.png` usam somente dados fictícios.
O teste visual bloqueia a conexão ao SFU e usa dispositivos fictícios: verifica as sessões
da interface, sem afirmar que fez uma chamada audível completa. O teste Go existente
verifica encerramento real de WebSocket e recusa de reutilização de identidade revogada.

**Limites restantes:** os riscos adicionais de Electron, abuso de recursos, CSP e backups
da seção anterior ainda pedem trabalho próprio. Dependências de desenvolvimento não foram
atualizadas indiscriminadamente. Revogação de mídia depende da comunicação Node → SFU;
o mecanismo existente tenta três vezes e registra erro se falhar. Nenhuma mudança foi
instalada no servidor oficial e não houve release. Por alterar a interface instalada e o
servidor, a publicação futura exige release e deploy autorizados.
