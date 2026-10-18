// tests/helpers/test-utils.js
// Utility functions for assertions, async waiting, and console formatting

import assert from 'node:assert/strict';

export { assert };

/**
 * Delay execution for given milliseconds
 * @param {number} ms 
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a condition to become true within a timeout
 * @param {() => boolean | Promise<boolean>} predicate 
 * @param {number} timeoutMs 
 * @param {string} errorMsg 
 * @param {number} intervalMs 
 */
export async function waitFor(predicate, timeoutMs = 2000, errorMsg = 'Timeout waiting for condition', intervalMs = 25) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await delay(intervalMs);
  }
  throw new Error(`${errorMsg} (exceeded ${timeoutMs}ms)`);
}

/**
 * Wait for an event on an emitter or target
 * @param {any} target 
 * @param {string} eventName 
 * @param {number} timeoutMs 
 * @returns {Promise<any>}
 */
export function waitForEvent(target, eventName, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event '${eventName}' after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (...args) => {
      clearTimeout(timer);
      if (typeof target.removeListener === 'function') {
        target.removeListener(eventName, handler);
      } else if (typeof target.off === 'function') {
        target.off(eventName, handler);
      } else if (typeof target.removeEventListener === 'function') {
        target.removeEventListener(eventName, handler);
      }
      resolve(args.length > 1 ? args : args[0]);
    };

    if (typeof target.once === 'function') {
      target.once(eventName, handler);
    } else if (typeof target.on === 'function') {
      target.on(eventName, handler);
    } else if (typeof target.addEventListener === 'function') {
      target.addEventListener(eventName, handler, { once: true });
    } else {
      clearTimeout(timer);
      reject(new Error('Target does not support event listening'));
    }
  });
}

/**
 * Colors for terminal reporting
 */
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m'
};
