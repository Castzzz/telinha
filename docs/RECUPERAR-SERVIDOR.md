# A VM sumiu: como recriar a sala

Se a Oracle apagar a VM (ou ela quebrar), dá pra subir tudo de novo numa VM nova em uns
20–30 minutos, com os mesmos canais, histórico, soundboard, senha da sala e **a mesma senha de
admin**. O app de ninguém precisa mudar: o domínio continua o mesmo.

O que você precisa ter:

- **Um backup** em `~/Teletela-backups/` (o backup automático faz um por dia; veja abaixo).
- **A chave SSH** indicada em `deploy/oracle/config.sh` (hoje `~/.ssh/oracle_telinha_ampere`).
  Perdeu? Veja o passo 1.
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

Se a VM antiga ainda funciona, siga [Migrar sem perder dados](MIGRAR-SERVIDOR.md): instalar
e restaurar com os padrões abaixo ativa o DuckDNS, então não faça isso nas duas VMs ao mesmo
tempo.

### 1. Chave SSH

Se ainda tem a chave indicada no `config.sh`, pule. Se perdeu, crie uma e ajuste `SSH_KEY`
no `config.sh`:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/oracle_telinha_ampere -N ""
```

### 2. Criar a VM na Oracle

No console da Oracle Cloud (cloud.oracle.com):

1. **Compute → Instances → Create instance.**
2. Os scripts suportam **Oracle Linux com firewalld** ou **Ubuntu com iptables-persistent
   (imagem da Oracle) ou ufw ativo**, tanto **x86_64** quanto **ARM64/Ampere A1**. A instalação
   atual usa Ubuntu 26.04 LTS e `VM.Standard.A1.Flex` (2 CPUs, 12 GB de RAM, disco de 100 GB).
   A arquitetura é detectada pelo SSH; Node, Caddy e SFU usam os binários correspondentes.
3. **Networking:** deixe criar a VCN/sub-rede pública e **marque "Assign a public IPv4
   address"**.
4. **SSH keys:** "Paste public key" e cole a chave pública correspondente à sua chave privada.
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

Troque o IP em **`deploy/oracle/config.sh`** (linha `VM=`): `ubuntu@IP` no Ubuntu ou `opc@IP`
no Oracle Linux. Confira também o caminho de `SSH_KEY`.
Teste o acesso:

```bash
ssh -i ~/.ssh/oracle_telinha_ampere ubuntu@1.2.3.4 'echo ok'
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
pro IP novo) e gera uma senha de admin **nova** (a antiga volta no passo 6). Os segredos não
são exibidos no log do deploy. O backup
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
  ssh -i ~/.ssh/oracle_telinha_ampere ubuntu@IP_NOVO
  sudo systemctl status telinha-server telinha-sfu caddy
  sudo journalctl -u caddy -n 50 --no-pager      # problema de certificado/DNS
  sudo journalctl -u telinha-server -n 50 --no-pager
  ```
- Entre pelo app: canais, canais de texto e soundboard devem estar lá. Quem tinha a chave de
  membro continua entrando sem senha.
- Faça um commit com o IP novo no `deploy/oracle/config.sh`.

**Nunca rode `dnf` na VM antiga de 1 GB**: trava a máquina. A atual usa Ubuntu e o
`install.sh` não precisa de gerenciador de pacotes para instalar Node/Caddy.

---

## Se não der pra usar a mesma conta/domínio

- **Domínio novo:** troque `DOMAIN` no `deploy/oracle/config.sh` **e** o `SERVER_ROOM_URL` no
  `electron/main.cjs`, e lance uma versão nova (`npm run release`). Os apps só passam a achar a
  sala nova depois de atualizar, então avise a galera pra colar o endereço novo na tela inicial
  enquanto isso.
- **Outro provedor:** confira systemd, arquitetura x86_64/ARM64, firewall suportado e o
  usuário SSH no `config.sh`. As portas também precisam estar liberadas na rede do provedor.
