// tests/helpers/server-fixture.js
// Ephemeral server test fixture and HTTP/WebSocket utilities

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const SERVER_SCRIPT = path.join(ROOT_DIR, 'server.js');

let testServerProcess = null;
let testServerPort = 18080;

export function getTestServerPort() {
  return testServerPort;
}

/**
 * Starts an ephemeral server process on a dedicated test port
 * @param {number} port 
 * @returns {Promise<{ port: number, url: string, stop: () => Promise<void> }>}
 */
export async function startTestServer(port = 18080) {
  testServerPort = port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return new Promise((resolve, reject) => {
    testServerProcess = spawn('node', [SERVER_SCRIPT], {
      cwd: ROOT_DIR,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        stopTestServer();
        reject(new Error(`Test server failed to start within 5000ms on port ${port}`));
      }
    }, 5000);

    testServerProcess.stdout.on('data', (chunk) => {
      const output = chunk.toString();
      if (output.includes('Telinha') || output.includes(String(port))) {
        if (!started) {
          started = true;
          clearTimeout(timeout);
          resolve({
            port,
            url: baseUrl,
            stop: stopTestServer
          });
        }
      }
    });

    testServerProcess.stderr.on('data', (chunk) => {
      // Ignore routine warnings
    });

    testServerProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    testServerProcess.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Server exited prematurely with code ${code}`));
      }
    });
  });
}

/**
 * Stops the running test server process if any
 */
export async function stopTestServer() {
  if (testServerProcess) {
    try {
      testServerProcess.kill('SIGTERM');
    } catch {
      // process might have already exited
    }
    testServerProcess = null;
  }
}

/**
 * Performs an HTTP request against the test server
 * @param {string} pathname 
 * @param {object} options 
 * @returns {Promise<{ status: number, headers: Headers, text: () => Promise<string>, json: () => Promise<any> }>}
 */
export async function fetchServer(pathname, options = {}) {
  const url = `http://127.0.0.1:${testServerPort}${pathname.startsWith('/') ? pathname : '/' + pathname}`;
  const res = await fetch(url, options);
  return {
    status: res.status,
    headers: res.headers,
    text: () => res.text(),
    json: () => res.json()
  };
}
