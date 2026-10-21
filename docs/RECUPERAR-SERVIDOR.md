# A VM sumiu: como recriar a sala

Se a Oracle apagar a VM (ou ela quebrar), dá pra subir tudo de novo numa VM nova em uns
20–30 minutos, com os mesmos canais, histórico, soundboard, senha da sala e **a mesma senha de
admin**. O app de ninguém precisa mudar: o domínio continua o mesmo.

O que você precisa ter:

- **Um backup** em `~/Teletela-backups/` (o backup automático faz um por dia; veja abaixo).
- **A chave SSH** `~/.ssh/oracle_telinha` (e a `.pub`). Perdeu? Veja o passo 1.
- **Este repositório** clonado, com Node e Go instalados (veja docs/PROJETO.md §4).
- A conta da Oracle Cloud e a conta do DuckDNS (o token do DuckDNS também está no backup).

---

## Backups

- **Automático:** `npm run backup:auto` liga um timer no seu PC (Linux) que baixa um backup
  por dia. Se o PC estiver desligado na hora, ele faz quando ligar. Desligar:
  `npm run backup:auto -- off`. Ver se está rodando:
  ```bash
  systemctl --user list-timers teletela-backup.timer
  journalctl --user -u teletela-backup -n 20
  ```
- **Na mão:** `npm run backup`. O deploy também faz um antes de mexer na VM.
- Ficam os **15 mais novos** em `~/Teletela-backups/` (só o seu usuário lê).
- Cada arquivo tem `data/` (canais, canais de texto, imagens, soundboard, senha da sala e
  chaves de membro) e `telinha/` (o `/etc/telinha` da VM: senha de admin, segredo do SFU e
  token do DuckDNS). **Tem segredos dentro: não compartilhe.**
- Os backups só existem no seu PC. De vez em quando, copie a pasta pra um pendrive ou nuvem
  sua, senão se o PC morrer junto vocês perdem tudo.

O que **não** está no backup (e tudo bem): o chat da call, quem está mutado pelo admin e as
fotos/banners/sons de perfil (cada app manda de novo ao conectar).

---

## Passo a passo

### 1. Chave SSH

Se ainda tem `~/.ssh/oracle_telinha` e `~/.ssh/oracle_telinha.pub`, pule. Se perdeu, crie uma:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/oracle_telinha -N ""
```

### 2. Criar a VM na Oracle

No console da Oracle Cloud (cloud.oracle.com):

1. **Compute → Instances → Create instance.**
2. **Image:** Oracle Linux 9. **Shape:** `VM.Standard.E2.1.Micro` (a do Always Free, x86).
   Os scripts esperam **x86_64** e **Oracle Linux 9** (usam `firewall-cmd` e baixam binários
   `linux-amd64`). Outra imagem ou ARM (A1) exigiria adaptar o `install.sh` e o `deploy.sh`.
3. **Networking:** deixe criar a VCN/sub-rede pública e **marque "Assign a public IPv4
   address"**.
4. **SSH keys:** "Paste public key" e cole o conteúdo de `~/.ssh/oracle_telinha.pub`.
5. Crie e espere ficar **Running**. Anote o **IP público**.

### 3. Abrir as portas na rede da Oracle

A VM tem firewall próprio (o `install.sh` cuida dele), mas a Oracle tem outro, na rede:
**Networking → Virtual Cloud Networks → (a VCN) → Security Lists → Default Security List →
Add Ingress Rules**, com origem `0.0.0.0/0`:

| Protocolo | Porta | Pra quê |
|---|---|---|
| TCP | 80 | certificado HTTPS (Caddy) |
| TCP | 443 | a sala |
| UDP | 50000 | voz e transmissões (SFU) |
| TCP | 50000 | voz e transmissões quando UDP não passa |

(A porta 22 já vem aberta.)

### 4. Apontar o repositório pra VM nova

Troque o IP em **`deploy/oracle/config.sh`** (linha `VM=`), por exemplo `opc@1.2.3.4`.
Teste o acesso:

```bash
ssh -i ~/.ssh/oracle_telinha opc@1.2.3.4 'echo ok'
```

### 5. Instalar tudo (deploy) já atualizando o DuckDNS

O token do DuckDNS está no backup. Pegue do mais novo e rode o deploy com ele:

```bash
BACKUP=$(ls -t ~/Teletela-backups/teletela-dados-*.tar.gz | head -1)
export DUCKDNS_TOKEN=$(tar -xzOf "$BACKUP" telinha/duckdns.env | sed -n 's/^DUCKDNS_TOKEN=//p')
npm run deploy:oracle
unset DUCKDNS_TOKEN
```

(Sem backup? O token está em duckdns.org, na sua conta.)

O deploy instala Node, Caddy, SFU e o servidor, liga o timer do DuckDNS (que aponta o domínio
pro IP novo) e mostra no fim uma senha de admin **nova** (a antiga volta no passo 6). O backup
do começo do deploy vai falhar porque a VM está vazia: é normal.

### 6. Voltar os dados

```bash
npm run restore -- "$(ls -t ~/Teletela-backups/teletela-dados-*.tar.gz | head -1)"
```

Ele pede pra digitar `SIM`, para o servidor, coloca os dados e os segredos do backup (a senha de
admin volta a ser a de antes), força a atualização do DuckDNS e sobe tudo de novo.

### 7. Conferir

- `https://colheitafartus.duckdns.org` abre? O DNS pode levar alguns minutos pra virar, e o
  Caddy tira o certificado HTTPS sozinho assim que o domínio aponta pra VM nova.
- Logs, se algo não subir:
  ```bash
  ssh -i ~/.ssh/oracle_telinha opc@IP_NOVO
  sudo systemctl status telinha-server telinha-sfu caddy
  sudo journalctl -u caddy -n 50 --no-pager      # problema de certificado/DNS
  sudo journalctl -u telinha-server -n 50 --no-pager
  ```
- Entre pelo app: canais, canais de texto e soundboard devem estar lá. Quem tinha a chave de
  membro continua entrando sem senha.
- Faça um commit com o IP novo no `deploy/oracle/config.sh`.

**Nunca rode `dnf` na VM** (1 GB de RAM: trava a máquina). O `install.sh` não precisa dele.

---

## Se não der pra usar a mesma conta/domínio

- **Domínio novo:** troque `DOMAIN` no `deploy/oracle/config.sh` **e** o `SERVER_ROOM_URL` no
  `electron/main.cjs`, e lance uma versão nova (`npm run release`). Os apps só passam a achar a
  sala nova depois de atualizar, então avise a galera pra colar o endereço novo na tela inicial
  enquanto isso.
- **Outro provedor:** qualquer VM Linux x86_64 com 1 GB de RAM serve, mas o `install.sh` foi
  feito pro Oracle Linux 9 (systemd, `firewall-cmd`, usuário `opc`). Em Ubuntu/Debian, troque o
  `firewall-cmd` por `ufw` (ou pelo firewall do provedor) e o usuário SSH no `config.sh`.
