/**
 * Velvet Mobile — licence prompts.
 *
 * The activation prompt is a persistent floating card, matching the other
 * VNE modules. This is deliberate: a dialog closes the moment any button is
 * pressed, so starting the Patreon flow would tear down the very UI holding
 * the "I have a code" fallback — leaving nowhere to paste the code that the
 * popup just produced. The card stays until activation actually succeeds.
 *
 * Only the GM ever sees this: players read the world flag the GM writes.
 *
 * @module license/license-ui
 */

import { L10N, MODULE_ID, MODULE_TITLE } from "../core/constants.mjs";
import { Logger } from "../core/logger.mjs";
import { LicenseClient } from "./license-client.mjs";

/**
 * Localize a `VELVETMOBILE.License.*` key, interpolating `data` when given.
 *
 * v14 merged `format` into `localize(key, data)` and removed `format`; v13
 * only interpolates through `format` and ignores a second argument to
 * `localize`. Neither call works on both, so ask the core which one it has.
 * @param {string} key @param {object} [data]
 */
const L = (key, data) => {
  const id = `${L10N}.License.${key}`;
  if (!data) return game.i18n.localize(id);
  return typeof game.i18n.format === "function"
    ? game.i18n.format(id, data)
    : game.i18n.localize(id, data);
};

/** Single card at a time. */
const CARD_ID = `${MODULE_ID}-license-card`;

export class LicenseUI {
  /**
   * Show the activation card. Idempotent — calling it again focuses the
   * existing card rather than stacking a second one.
   */
  static show() {
    if (!game.user?.isGM) return;
    const existing = document.getElementById(CARD_ID);
    if (existing) return void existing.scrollIntoView({ block: "nearest" });

    const client = LicenseClient.instance;
    const licensed = client.isLicensed;

    const card = document.createElement("div");
    card.id = CARD_ID;
    card.className = "vm-license-card";
    card.innerHTML = `
      <header>
        <i class="fa-solid fa-lock" aria-hidden="true"></i>
        <strong>${MODULE_TITLE}</strong>
      </header>
      <p class="vm-license-status">${licensed ? L("StatusActive", { tier: client.tier }) : L("Intro")}</p>
      <p class="vm-license-note">${licensed ? L("ReleaseHint") : L("GmOnly")}</p>
      ${licensed ? "" : LicenseUI.migrationNotice()}
      <button type="button" data-action="connect" class="vm-license-primary">
        <i class="fa-brands fa-patreon" aria-hidden="true"></i> ${L("Connect")}
      </button>
      <button type="button" data-action="code">${L("HaveCode")}</button>
      ${licensed ? `<button type="button" data-action="release">${L("Release")}</button>` : ""}
      <button type="button" data-action="dismiss" class="vm-license-dismiss">${L("Later")}</button>
    `;

    card.addEventListener("click", (event) => {
      const action = event.target.closest("button")?.dataset.action;
      if (action) LicenseUI.#onAction(action, card);
    });

    document.body.append(card);
  }

  /** @param {string} action @param {HTMLElement} card */
  static async #onAction(action, card) {
    switch (action) {
      case "connect": return void LicenseUI.#connect(card);
      case "code": return void LicenseUI.#enterCode(card);
      case "release": return void LicenseUI.#release(card);
      case "dismiss": return void card.remove();
      default: return undefined;
    }
  }

  /**
   * Run the Patreon flow. The card stays put throughout, so a blocked popup
   * or a rejected exchange still leaves the code route one tap away.
   * @param {HTMLElement} card
   */
  static async #connect(card) {
    const button = card.querySelector('[data-action="connect"]');
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = L("Opening");

    try {
      const connected = await LicenseClient.instance.startOAuth();
      if (connected) return void card.remove();
      // Popup closed without authorising — on phones this usually means it
      // was blocked, so the code route is the way through.
      ui.notifications?.info(`${MODULE_TITLE}: ${L("Cancelled")}`);
    } catch (err) {
      Logger.error("Patreon authorisation failed", err);
      ui.notifications?.error(`${MODULE_TITLE}: ${err.message}`);
      // The code is single-use and short-lived: offer it straight back
      // rather than making the user repeat the whole round trip.
      if (err.authCode) return void LicenseUI.#enterCode(card, err.authCode, err.message);
    } finally {
      if (document.body.contains(card)) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  }

  /**
   * Transitional notice for patrons whose earlier activation stopped
   * validating. Being asked to re-authorise out of the blue reads as a scam,
   * so it states what changed and — just as important — what did not: same
   * subscription, no new charge, same slots. Drop it once the migration has
   * settled.
   * @returns {string}
   */
  static migrationNotice() {
    return `
      <div style="margin-bottom:.6rem;padding:.5rem .6rem;border-radius:4px;
                  border:1px solid rgba(200,155,60,.35);background:rgba(200,155,60,.08);
                  font-size:.9em;line-height:1.45">
        <strong>${L("MigrationTitle")}</strong><br/>${L("MigrationBody")}
      </div>`;
  }

  /**
   * Manual code entry: the fallback for blocked popups and the retry path
   * for a rejected exchange.
   * @param {HTMLElement} card
   * @param {string} [prefill]
   * @param {string} [error]
   */
  static async #enterCode(card, prefill = "", error = "") {
    // Both values reach the DOM as markup: `prefill` is an auth code echoed
    // back from the popup and `error` is a message from the licence server,
    // so neither is ours to trust with raw HTML.
    const escape = (value) => foundry.utils.escapeHTML?.(String(value)) ?? String(value);
    const notice = error
      ? `<p style="color:var(--color-level-error, #d05); margin-bottom:.5rem">${escape(error)}</p>`
      : "";
    const escaped = escape(prefill);

    const code = await foundry.applications.api.DialogV2.prompt({
      window: { title: `${MODULE_TITLE} — ${L("CodeTitle")}` },
      content: `${notice}
        ${LicenseUI.migrationNotice()}
        <p style="margin-bottom:.5rem">${L("CodeHint")}</p>
        <input type="text" name="code" autocomplete="off" spellcheck="false" value="${escaped}"
               style="width:100%;font-family:monospace;font-size:16px">`,
      ok: {
        label: L("Activate"),
        icon: "fa-solid fa-key",
        callback: (_event, button) => button.form?.elements.code?.value?.trim()
      },
      rejectClose: false
    });
    if (!code) return;

    try {
      await LicenseClient.instance.activateWithCode(code);
      card.remove();
    } catch (err) {
      Logger.error("Activation failed", err);
      ui.notifications?.error(`${MODULE_TITLE}: ${err.message}`);
    }
  }

  /** @param {HTMLElement} card */
  static async #release(card) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: `${MODULE_TITLE} — ${L("Release")}` },
      content: `<p>${L("ReleaseConfirm")}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    if (await LicenseClient.instance.releaseInstallation()) {
      card.remove();
      LicenseUI.show();
    }
  }
}

/**
 * Settings-menu entry point, built on demand rather than at import time.
 *
 * Extending `foundry.applications.api.ApplicationV2` at module scope would
 * evaluate that path while the file loads: if a future release moves or
 * renames it, the *entire module* would fail to import — a total outage
 * caused by a settings button. Resolving it inside a function defers the
 * lookup to `init`, when the API is present, and lets a missing base class
 * degrade to a shim instead.
 *
 * `registerMenu` only ever constructs the class and calls `render()`.
 * @returns {Function} A class suitable for `game.settings.registerMenu`.
 */
export function licenseMenuClass() {
  const Base = foundry.applications?.api?.ApplicationV2;

  if (!Base) {
    Logger.warn("ApplicationV2 unavailable — using a minimal licence menu shim");
    return class LicenseMenuShim {
      async render() {
        LicenseUI.show();
        return this;
      }

      async close() {
        return this;
      }
    };
  }

  return class LicenseMenu extends Base {
    static DEFAULT_OPTIONS = { id: `${MODULE_ID}-license-menu` };

    /** @override — hand straight over to the card instead of drawing a form. */
    async render() {
      LicenseUI.show();
      return this;
    }

    /** @override */
    async close() {
      return this;
    }
  };
}
