# Onde está a sala da nuvem. Os scripts deploy/backup/restore leem daqui.
# VM nova (docs/RECUPERAR-SERVIDOR.md)? Troque o IP só aqui. Dá pra sobrescrever na hora:
#   VM=ubuntu@1.2.3.4 SSH_KEY=~/.ssh/outra_chave npm run deploy:oracle
VM="${VM:-ubuntu@144.22.225.236}"
DOMAIN="${DOMAIN:-colheitafartus.duckdns.org}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/oracle_telinha_ampere}"
