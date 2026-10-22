# Migrar a sala para outra VM

Mantenha `colheitafartus.duckdns.org`: os apps instalados continuam funcionando sem release.
Prepare a nova antes de interromper a antiga. Não rode o deploy ou restore padrão na nova
durante a preparação: eles podem ativar o DuckDNS antes da cópia final.

## Preparar

1. Confira acesso SSH com sudo nas duas VMs, arquitetura e espaço livre. O deploy detecta
   x86_64 ou ARM64. O instalador suporta Oracle Linux/firewalld e Ubuntu com
   iptables-persistent ou ufw ativo. Preserve as regras da Oracle, especialmente SSH e iSCSI.
2. Libere TCP 80/443 e UDP/TCP 50000 na VM e na rede da Oracle.
3. Faça `npm run backup` ainda apontando para a antiga. Confira o arquivo completo, incluindo
   `data/`, `telinha/telinha.env` e `telinha/duckdns.env`. Guarde o caminho exato: o deploy e
   restore também criam backups, inclusive de uma VM nova vazia.
4. Instale na nova usando as variáveis abaixo, sem trocar o `config.sh` ainda:

   ```bash
   VM=ubuntu@IP_NOVO SSH_KEY=~/.ssh/CHAVE_NOVA ACTIVATE_DUCKDNS=0 SKIP_BACKUP=1 npm run deploy:oracle
   ```

   `NODE_VERSION` e `CADDY_VERSION` podem fixar as mesmas versões da antiga durante a migração.
   Sem elas, o deploy busca as versões atuais.
5. Restaure uma cópia preliminar com `ACTIVATE_DUCKDNS=0`, indicando o backup exato:

   ```bash
   VM=ubuntu@IP_NOVO SSH_KEY=~/.ssh/CHAVE_NOVA ACTIVATE_DUCKDNS=0 npm run restore -- /caminho/backup.tar.gz
   ```

6. Para testar HTTPS antes de mudar o DNS, copie com segurança o armazenamento do Caddy
   (`/var/lib/caddy/caddy`, sem `locks/`) da antiga para a nova, com o Caddy novo parado.
   Ajuste o dono para `caddy:caddy` e reinicie. Esses arquivos contêm chaves privadas:
   mantenha a cópia fora do repositório, com acesso só ao dono. Não é preciso copiar os
   binários x86 para ARM: o deploy compila/baixa os corretos.
7. Confira com `curl --resolve DOMINIO:443:IP_NOVO https://DOMINIO/api/health`, `/sfu/health`
   e um cliente de teste apontado à nova. Valide admin, históricos, imagens e mídia WebRTC.
   Confirme `PUBLIC_IP` novo no SFU e o DuckDNS novo ainda desativado.

## Trocar

1. Na antiga, desative e pare `duckdns.timer` e pare `duckdns.service`. Desative e pare
   `telinha-server` e `telinha-sfu`, evitando escritas e reinício acidental após reboot.
2. Faça outro backup da antiga parada. Esse é o backup final; valide-o e restaure-o na nova
   com `ACTIVATE_DUCKDNS=0`. Compare os hashes dos dados persistentes e segredos entre as VMs.
3. Na antiga, guarde `/etc/caddy/Caddyfile` e configure o Caddy para encaminhar ao HTTPS da
   nova. Assim, quem ainda tiver o IP antigo em cache também chega ao mesmo servidor:

   ```caddyfile
   colheitafartus.duckdns.org {
       reverse_proxy https://IP_NOVO {
           header_up Host colheitafartus.duckdns.org
           transport http {
               tls_server_name colheitafartus.duckdns.org
           }
       }
   }
   ```

   Valide a configuração antes de recarregar. As conexões antigas serão interrompidas; o
   app reconecta. A mídia nova usa o IP anunciado pelo SFU novo.
4. Na nova, rode `sudo systemctl enable --now duckdns.timer` e
   `sudo systemctl start duckdns.service`. Confira a resposta `OK` e a resolução pública.
5. Atualize `VM` e `SSH_KEY` no `deploy/oracle/config.sh`. O backup automático passa a usar
   a nova porque lê esse arquivo a cada execução. Faça um backup da nova e confira o timer
   local do backup.
6. Confira HTTPS, Socket.IO, admin, históricos, imagens, som e transmissão. Mantenha a antiga
   e o backup final até confirmar o uso normal. Não apague a VM antiga automaticamente.

## Limites e volta

O chat da call e a moderação temporária vivem na memória e somem na parada. Perfis e mídias
de perfil são reenviados pelos apps. Canais de texto, imagens, soundboard, senha da sala,
chaves de membro e senha de admin ficam preservados no backup.

Se precisar voltar, primeiro pare as escritas na nova e faça backup dos dados atuais dela.
Caso já tenham chegado mensagens novas, restaure esses dados na antiga antes de voltar o
tráfego. Restaure o Caddyfile antigo, reative os serviços da antiga, desligue o DuckDNS da
nova e só então atualize o domínio pela antiga. Ajuste também o `config.sh`. Não basta
reapontar o DNS para uma cópia desatualizada: isso perderia o que foi escrito depois da troca.

O `restore.sh` precisa consumir toda a listagem do tar ao validar: com `set -o pipefail`,
`grep -q` pode fechar o pipe cedo e causar SIGPIPE, rejeitando backups válidos.

## Migração de 22/10/2026

- Origem: `opc@163.176.189.41`, Oracle Linux x86_64, 1 GB de RAM.
- Destino: `ubuntu@144.22.225.236`, Ubuntu 26.04 ARM64, 2 CPUs, 12 GB de RAM, disco de 100 GB.
- Node v24.22.1 e Caddy 2.11.7 mantidos nas mesmas versões da origem; SFU recompilado para ARM64.
- Backup final, com a origem parada:
  `~/Teletela-backups/migracao-2026-10-22/teletela-dados-2026-10-22_15-02-58.tar.gz`.
  Os 10 arquivos persistentes e de configuração foram comparados por SHA-256 e ficaram idênticos.
- Certificado HTTPS preservado; DNS público apontado à nova. A antiga mantém apenas o Caddy
  encaminhando tráfego da sala à nova; Node/SFU e DuckDNS antigos desativados.
- Validados: testes do projeto (62 do runner, 68 com node:test e integração de canais/admin),
  interface no Electron, históricos/imagens, senha de admin e envio/recebimento de áudio e
  vídeo pelo SFU via UDP e TCP. Após a troca, mídia testada novamente pelo domínio normal.
- Backup diário local mantido ativo, lendo o novo destino do `config.sh`; backup manual da
  nova também concluído. Chave nova guardada em `~/.ssh/oracle_telinha_ampere` com modo 600.
