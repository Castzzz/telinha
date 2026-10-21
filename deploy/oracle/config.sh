# Onde está a sala da nuvem. Os scripts deploy/backup/restore leem daqui.
# VM nova (docs/RECUPERAR-SERVIDOR.md)? Troque o IP só aqui. Dá pra sobrescrever na hora:
#   VM=opc@1.2.3.4 npm run deploy:oracle
VM="${VM:-opc@163.176.189.41}"
DOMAIN="${DOMAIN:-colheitafartus.duckdns.org}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/oracle_telinha}"
