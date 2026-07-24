/**
 * Velvet Mobile — service lifecycle registry.
 *
 * Every feature of the module is a service implementing the {@link VMService}
 * contract. The registry owns enabling/disabling them as the device profile
 * changes, guaranteeing the symmetric enable()/disable() rule that keeps the
 * module leak-free and zero-cost when inactive.
 *
 * @module core/registry
 */

import { Logger } from "./logger.mjs";

/**
 * @typedef {object} VMService
 * @property {string} name                                    Unique service name (diagnostics).
 * @property {(profile: object) => boolean} shouldEnable      Whether the service applies to a profile.
 * @property {() => void} enable                              Install listeners / DOM changes.
 * @property {() => void} disable                             Remove everything enable() installed.
 */

export class ServiceRegistry {
  /** @type {Map<string, {service: VMService, enabled: boolean}>} */
  #entries = new Map();

  /**
   * Register a service. Registration does not enable it.
   * @param {VMService} service
   */
  add(service) {
    if (this.#entries.has(service.name)) {
      throw new Error(`Service "${service.name}" is already registered`);
    }
    this.#entries.set(service.name, { service, enabled: false });
  }

  /**
   * Reconcile every service against a device profile: enable those that
   * apply, disable those that no longer do. Idempotent.
   * @param {object} profile  Current device profile.
   */
  reconcile(profile) {
    for (const entry of this.#entries.values()) {
      const wanted = entry.service.shouldEnable(profile);
      if (wanted === entry.enabled) continue;
      try {
        wanted ? entry.service.enable() : entry.service.disable();
        entry.enabled = wanted;
        Logger.debug(`Service "${entry.service.name}" ${wanted ? "enabled" : "disabled"}`);
      } catch (err) {
        Logger.error(`Service "${entry.service.name}" failed to ${wanted ? "enable" : "disable"}`, err);
      }
    }
  }

  /**
   * Disable a service and immediately re-reconcile it against a profile —
   * the safe way to rebuild a service whose configuration changed.
   * @param {string} name
   * @param {object} profile
   */
  restart(name, profile) {
    const entry = this.#entries.get(name);
    if (!entry) return;
    if (entry.enabled) {
      try {
        entry.service.disable();
      } catch (err) {
        Logger.error(`Service "${name}" failed to disable during restart`, err);
      }
      entry.enabled = false;
    }
    this.reconcile(profile);
  }

  /**
   * @param {string} name
   * @returns {boolean} Whether that service is currently enabled.
   */
  isEnabled(name) {
    return this.#entries.get(name)?.enabled ?? false;
  }

  /** Disable every enabled service. Used when the module is switched off. */
  disableAll() {
    for (const entry of this.#entries.values()) {
      if (!entry.enabled) continue;
      try {
        entry.service.disable();
      } catch (err) {
        Logger.error(`Service "${entry.service.name}" failed to disable`, err);
      }
      entry.enabled = false;
    }
  }
}
