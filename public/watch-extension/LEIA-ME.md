# Teletela — Assistir juntos (experimental)

Extensão para Firefox (140 ou mais novo), Chrome (121 ou mais novo), Edge e Brave
no computador. Cada pessoa reproduz o vídeo pelo
próprio navegador e conta. Apenas link canônico, posição e comandos de reprodução
passam pelo Teletela. Senhas, cookies e áudio/vídeo dos serviços não são enviados.

## Instalar no Firefox (Linux ou Windows)

1. Use o pacote 0.2.0 ou mais novo e extraia o ZIP.
2. Abra `about:debugging#/runtime/this-firefox` na barra de endereço.
3. Clique em **Carregar extensão temporária…** e selecione o `manifest.json` da pasta extraída.
4. Abra a extensão pelo botão de extensões (peça de quebra-cabeça); se quiser, fixe na barra.

Essa instalação dura até fechar/reiniciar o Firefox. Ao abrir de novo, carregue a extensão
novamente e gere outro código no Teletela. A instalação permanente exige um pacote assinado
pela Mozilla; esta versão ainda não tem assinatura nem publicação na loja. Não precisa
desativar proteções do navegador. O ZIP antigo 0.1.0 não funciona no Firefox.

## Instalar no Chrome, Edge ou Brave

1. Extraia o ZIP. Abra `chrome://extensions` (Edge: `edge://extensions`).
2. Ative **Modo do desenvolvedor**, escolha **Carregar sem compactação** e selecione
   a pasta que contém `manifest.json`. Se fixar a extensão na barra, fica mais fácil abrir.

## Conectar à call

1. Entre numa call no Teletela e abra **Assistir juntos**, pelo ícone de tela com play.
2. Crie/entre na sessão, clique em **Gerar meu código** e copie. Cada amigo gera o seu.
3. Abra a extensão, cole o código e permita a conexão com o servidor indicado.
4. Abra um vídeo no YouTube ou um episódio na Netflix e, na extensão, use **Usar esta aba**.
   Quem entrou depois também pode usar **Abrir vídeo da sessão**.
5. Quem guia controla o player normalmente. **Guiar sessão**, no Teletela, transfere
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
- O navegador pode exigir um clique no play. Use o botão do vídeo ou **Ativar reprodução**.
- Anúncios no YouTube suspendem a sincronização nessa aba. Planos com anúncios da Netflix
  ainda não são suportados; a detecção e a posição do episódio podem divergir.
- Há uma consulta por segundo enquanto a aba está selecionada; pode haver cerca de um
  segundo de diferença antes da correção. Travamentos de um amigo não pausam todos.
- Vídeos ao vivo não são suportados. Não há integração com o app nativo da Netflix,
  celular, TV ou Chromecast nesta versão.
- O som sai pelo navegador. Volume geral/ensurdecer do Teletela não controlam esse som.
- A extensão é instalada manualmente, sem publicação na loja. Para atualizar, substitua
  os arquivos, clique em **Recarregar** nas extensões e recarregue as abas dos vídeos.
