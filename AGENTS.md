# Guia pra agentes de IA (Claude Code, Antigravity, etc.)

Teletela (antigo Telinha): app de voz e transmissão de tela entre amigos. Electron + interface
em JS puro (`public/`), servidor Node/Socket.IO (`server.js`) e SFU em Go (`sfu/`), rodando numa
VM da Oracle em https://colheitafartus.duckdns.org.

**Documentação completa: [docs/PROJETO.md](docs/PROJETO.md).** Leia antes de mudar algo grande.
Lá tem a arquitetura, onde fica cada funcionalidade, os eventos do Socket.IO, os dados salvos,
como fazer release/deploy e as armadilhas conhecidas.

## Regras que não podem ser esquecidas

- Fale e escreva **em português** (interface, comentários, commits). O dono fala informal.
- **Commits:** `git add -A -- . ':!public/sounds'`. A pasta `public/sounds/` (vozes dos amigos)
  **nunca** vai pro git, porque o repositório é público, mas tem que continuar no disco
  (vai dentro do instalador).
- **Release e deploy só quando o dono pedir explicitamente** (`npm run release`,
  `npm run deploy:oracle`). Eles publicam pra todo mundo e o deploy reinicia o servidor.
- Mudou `public/`? Precisa de **release** (a interface vem instalada no app). Mudou só
  `server.js` ou `sfu/`? Só **deploy**. Tabela completa em docs/PROJETO.md §6.
- Antes de release: aumentar `version` no `package.json` e atualizar o popup de novidades
  (`WHATS_NEW_VERSION` em `app.js` + `#modal-whats-new` no `index.html`).
- **Nunca rode `dnf` na VM** (1 GB de RAM, trava).
- A senha de admin e os segredos ficam só em `/etc/telinha/telinha.env` na VM. Nunca escreva
  no repositório.
- Não renomeie `appId`, a pasta de dados "Telinha", o repositório nem os nomes de artefato
  (quebra a atualização automática). Lista em docs/PROJETO.md §13.
- Siga o estilo do código ao redor: comentários curtos explicando o porquê, ícones SVG
  (`icon-svg`), cores por tokens CSS (funciona nos 3 temas).

## Comandos

```bash
npm run app                 # app desktop (Electron do SISTEMA; não use npx electron)
npm start                   # servidor em http://localhost:8080
PORT=3999 ADMIN_KEY=segredo1 TELINHA_DATA_DIR=/tmp/teletela-data node server.js   # servidor de teste completo
npm test                    # 62 testes (todos passam)
node --test tests/m1-*.test.js tests/m2-*.test.js tests/m3-*.test.js   # o M2.3 já falhava antes
node tests/m4-channels-admin.test.js                                   # integração do servidor
npm run release             # publica versão nova (só se o dono pedir)
npm run deploy:oracle       # atualiza a VM (só se o dono pedir; precisa de ~/.ssh/oracle_telinha)
```

## Ao terminar uma mudança

Rode os testes, confira na tela, e atualize o README (se o usuário vê a mudança) e o
docs/PROJETO.md (se mudou arquitetura, dados, deploy ou apareceu uma armadilha nova).
