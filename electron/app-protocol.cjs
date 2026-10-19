// telinha://app/... serve a interface da sala (public/) instalada junto com o app.
// Assim cada um vê a interface da própria versão do app, mesmo entrando na sala de
// um amigo com versão antiga: do servidor da sala só vem a conexão (Socket.IO).
const { net, protocol } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const SCHEME = 'telinha';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Precisa rodar antes do app ficar pronto. "secure" faz a página valer como https
// (microfone, AudioWorklet do RNNoise e localStorage fixo funcionam).
function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
  ]);
}

function handleAppProtocol(ses) {
  const handler = (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
    // Nada fora de public/ (ex: telinha://app/../../segredo)
    if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  };
  (ses ? ses.protocol : protocol).handle(SCHEME, handler);
}

// Página da sala usando a interface do app, conectada ao servidor `origin`
function roomUrl(origin) {
  return `${SCHEME}://app/index.html?server=${encodeURIComponent(origin)}`;
}

// De volta: o servidor da sala a partir da URL atual da janela (ou null)
function serverFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === `${SCHEME}:`) return parsed.searchParams.get('server');
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin;
  } catch {}
  return null;
}

module.exports = { registerAppScheme, handleAppProtocol, roomUrl, serverFromUrl };
