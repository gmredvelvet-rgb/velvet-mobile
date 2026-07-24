/**
 * Velvet Mobile — leveled console logger.
 * Debug output is gated behind the `debug` client setting so production
 * consoles stay clean while troubleshooting remains one toggle away.
 * @module core/logger
 */

import { MODULE_TITLE } from "./constants.mjs";

const PREFIX = `${MODULE_TITLE} |`;
const STYLE = "color: #b06ab3; font-weight: bold;";

export class Logger {
  /** @type {boolean} Whether debug-level messages are emitted. */
  static #debugEnabled = false;

  /**
   * Enable or disable debug-level output.
   * @param {boolean} enabled
   */
  static setDebug(enabled) {
    Logger.#debugEnabled = Boolean(enabled);
  }

  /**
   * Verbose diagnostic output. Silent unless the debug setting is on.
   * @param {...*} args
   */
  static debug(...args) {
    if (Logger.#debugEnabled) console.debug(`%c${PREFIX}`, STYLE, ...args);
  }

  /**
   * Normal operational information (mode changes, service startup).
   * @param {...*} args
   */
  static info(...args) {
    console.info(`%c${PREFIX}`, STYLE, ...args);
  }

  /**
   * Recoverable problems worth the user's attention.
   * @param {...*} args
   */
  static warn(...args) {
    console.warn(`%c${PREFIX}`, STYLE, ...args);
  }

  /**
   * Failures. Never swallowed, never gated.
   * @param {...*} args
   */
  static error(...args) {
    console.error(`%c${PREFIX}`, STYLE, ...args);
  }
}
