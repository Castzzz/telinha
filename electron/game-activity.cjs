const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);

// Só executáveis do jogo: abrir Steam, Riot ou outro launcher não conta como jogar.
const GAMES = [
  ['cs2', 'Counter-Strike 2', ['cs2', 'cs2.exe']],
  ['lol', 'League of Legends', ['league of legends.exe']],
  ['valorant', 'VALORANT', ['valorant-win64-shipping.exe']],
  ['dota2', 'Dota 2', ['dota2', 'dota2.exe']],
  ['gta5', 'Grand Theft Auto V', ['gta5.exe', 'gta5_enhanced.exe']],
  ['rocket-league', 'Rocket League', ['rocketleague.exe']],
  ['fortnite', 'Fortnite', ['fortniteclient-win64-shipping.exe']],
  ['apex', 'Apex Legends', ['r5apex.exe', 'r5apex_dx12.exe']],
  ['overwatch2', 'Overwatch 2', ['overwatch.exe']],
  ['deadlock', 'Deadlock', ['deadlock', 'deadlock.exe']],
  ['terraria', 'Terraria', ['terraria', 'terraria.exe', 'terraria.bin.x86_64']],
  ['stardew', 'Stardew Valley', ['stardew valley', 'stardew valley.exe']],
  ['elden-ring', 'ELDEN RING', ['eldenring.exe']],
  ['helldivers2', 'HELLDIVERS 2', ['helldivers2.exe']],
  ['baldurs-gate3', "Baldur's Gate 3", ['bg3.exe', 'bg3_dx11.exe']],
  ['lethal-company', 'Lethal Company', ['lethal company.exe']],
  ['minecraft', 'Minecraft', ['minecraft.windows.exe']],
];

function executableName(value) {
  return String(value || '').replace(/\\/g, '/').split('/').pop().replace(/ \(deleted\)$/, '').toLowerCase();
}

function customGameList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).filter((g) => g && typeof g.name === 'string'
    && g.name.trim() && g.name.length <= 80 && typeof g.executable === 'string'
    && g.executable.trim() && /^[\p{L}\p{N}_. ()-]{1,100}$/u.test(g.executable)).map((g) => ({
    name: g.name.trim(), executable: g.executable.trim().toLowerCase()
  }));
}

function detectGames(processes, customGames = []) {
  const catalog = [
    ...customGameList(customGames).map((g, i) => [`custom-${i}`, g.name, [g.executable]]),
    ...GAMES
  ];
  const found = [];
  for (const proc of processes) {
    const names = [executableName(proc.exe), executableName(proc.argv?.[0])];
    let game = catalog.find(([, , executables]) => executables.some((exe) => names.includes(exe)));
    if (!game && names.some((n) => /^(javaw?|javaw?\.exe)$/.test(n))
      && /(?:net\.minecraft\.client\.main\.Main|net\.fabricmc\.loader\.(?:impl\.)?launch\.knot\.KnotClient|--launchTarget\s+(?:forge|neoForge)client)(?:\s|$)/.test((proc.argv || []).join(' '))) {
      game = ['minecraft', 'Minecraft'];
    }
    if (game) found.push({ id: game[0], name: game[1], pid: String(proc.pid) });
  }
  return found;
}

function parseTasklist(csv) {
  return csv.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^"((?:[^"]|"")*)","(\d+)"/);
    return match ? [{ exe: match[1].replace(/""/g, '"'), pid: match[2] }] : [];
  });
}

async function runningProcesses(platform = process.platform) {
  if (platform === 'win32') {
    const { stdout } = await runFile('tasklist.exe', ['/fo', 'csv', '/nh'], {
      windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024
    });
    const list = parseTasklist(stdout);
    // A JVM sozinha também pode ser um launcher; só reconhece a classe do cliente.
    if (list.some((p) => /^javaw?\.exe$/i.test(p.exe))) {
      const script = 'Get-CimInstance Win32_Process -Filter "Name = \'javaw.exe\' OR Name = \'java.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
      try {
        const result = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
          windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024
        });
        const data = JSON.parse(result.stdout || 'null');
        for (const java of (Array.isArray(data) ? data : [data])) {
          const proc = list.find((p) => p.pid === String(java?.ProcessId));
          if (proc) proc.argv = [proc.exe, java.CommandLine || ''];
        }
      } catch { /* Os outros jogos continuam detectáveis se o WMI estiver indisponível. */ }
    }
    return list;
  }
  if (platform !== 'linux') return [];
  const pids = (await fs.readdir('/proc')).filter((p) => /^\d+$/.test(p));
  const list = [];
  // Limita o trabalho simultâneo e ignora processos encerrados durante a leitura.
  let index = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (index < pids.length) {
      const pid = pids[index++];
      try {
        const dir = path.join('/proc', pid);
        if ((await fs.stat(dir)).uid !== process.getuid()) continue;
        const [exe, cmd] = await Promise.all([fs.readlink(path.join(dir, 'exe')), fs.readFile(path.join(dir, 'cmdline'), 'utf8')]);
        list.push({ pid, exe, argv: cmd.split('\0').filter(Boolean) });
      } catch { /* Sem acesso ou processo já encerrado. */ }
    }
  }));
  return list;
}

function createActivityTracker({ collect = runningProcesses, now = Date.now } = {}) {
  let current = null;
  let lastSample = 0;
  let pending = null;
  let generation = 0;
  return {
    reset() { generation++; current = null; lastSample = 0; },
    async sample(customGames = []) {
      if (pending) return pending;
      const run = generation;
      pending = (async () => {
        const games = detectGames(await collect(), customGames);
        if (run !== generation) return null;
        const time = now();
        const same = games.find((g) => g.id === current?.id && g.pid === current?.pid && g.name === current?.name);
        const selected = same || games[0];
        current = selected ? { ...selected, startedAt: same && time - lastSample < 45000 ? current.startedAt : time } : null;
        lastSample = time;
        // PID e argumentos nunca atravessam a ponte para a interface ou a rede.
        return current ? { id: current.id, name: current.name, startedAt: current.startedAt } : null;
      })();
      try { return await pending; } finally { pending = null; }
    }
  };
}

module.exports = { GAMES, customGameList, detectGames, parseTasklist, runningProcesses, createActivityTracker };
