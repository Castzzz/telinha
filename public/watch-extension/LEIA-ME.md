# Teletela — Assistir juntos (experimental)

Extensão para Chrome, Edge e Brave no computador. Cada pessoa reproduz o vídeo pelo
próprio navegador e conta. Apenas link canônico, posição e comandos de reprodução
passam pelo Teletela. Senhas, cookies e áudio/vídeo dos serviços não são enviados.

1. Extraia o ZIP. Abra `chrome://extensions` (Edge: `edge://extensions`).
2. Ative **Modo do desenvolvedor**, escolha **Carregar sem compactação** e selecione
   a pasta que contém `manifest.json`. Se fixar a extensão na barra, fica mais fácil abrir.
3. Entre numa call no Teletela e abra **Assistir juntos**, pelo ícone de tela com play.
4. Crie/entre na sessão, clique em **Gerar meu código** e copie. Cada amigo gera o seu.
5. Abra a extensão, cole o código e permita a conexão com o servidor indicado.
6. Abra um vídeo no YouTube ou um episódio na Netflix e, na extensão, use **Usar esta aba**.
   Quem entrou depois também pode usar **Abrir vídeo da sessão**.
7. Quem guia controla o player normalmente. **Guiar sessão**, no Teletela, transfere
   o controle. Play, pausa, avanços e trocas de vídeo seguem essa pessoa.

Você precisa permanecer na call e com o Teletela aberto. O código vence em cinco minutos,
é de uso único e dá acesso só à sessão dessa call. Sair da call revoga a conexão;
se quem guia sair, a sessão termina. Após fechar/reabrir o navegador, conecte novamente.
Uma aba por pessoa; gerar outro código revoga a conexão anterior. Você pode desconectar
a extensão a qualquer momento. Fechar a aba não encerra a call nem a sessão.

O servidor do Teletela precisa receber a atualização antes do uso. Em desenvolvimento,
aceita HTTP apenas em localhost/127.0.0.1; salas remotas exigem HTTPS. O navegador pede
permissão apenas para o endereço da sala usado no código. Nenhuma permissão de cookies,
histórico ou senhas é solicitada. A sincronização ignora abas que você não selecionou.

## Limitações desta primeira versão

- Painel, pareamento, autenticação e download conferidos em ambiente local. A reprodução
  entre navegadores reais ainda precisa de validação; não considerar validado na Netflix.
- Netflix usa uma API interna do player, com alternativa pelo elemento de vídeo; mudanças
  no site podem exigir atualização da extensão. Cada conta precisa de acesso ao mesmo título
  e episódio. Login, escolha de perfil, idioma e legendas continuam individuais.
- Chrome pode exigir um clique no play. Use o botão do vídeo ou **Ativar reprodução**.
- Anúncios no YouTube suspendem a sincronização nessa aba. Planos com anúncios da Netflix
  ainda não são suportados; a detecção e a posição do episódio podem divergir.
- Há uma consulta por segundo enquanto a aba está selecionada; pode haver cerca de um
  segundo de diferença antes da correção. Travamentos de um amigo não pausam todos.
- Vídeos ao vivo não são suportados. Não há integração com o app nativo da Netflix,
  Firefox, celular, TV ou Chromecast nesta versão.
- O som sai pelo navegador. Volume geral/ensurdecer do Teletela não controlam esse som.
- A extensão é instalada manualmente, sem publicação na loja. Para atualizar, substitua
  os arquivos, clique em **Recarregar** nas extensões e recarregue as abas dos vídeos.
