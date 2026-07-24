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

/** @param {string} key @param {object} [data] */
const L = (key, data) => (data
  ? game.i18n.format(`${L10N}.License.${key}`, data)
  : game.i18n.localize(`${L10N}.License.${key}`));

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
   * Manual code entry: the fallback for blocked popups and the retry path
   * for a rejected exchange.
   * @param {HTMLElement} card
   * @param {string} [prefill]
   * @param {string} [error]
   */
  static async #enterCode(card, prefill = "", error = "") {
    const notice = error
      ? `<p style="color:var(--color-level-error, #d05); margin-bottom:.5rem">${error}</p>`
      : "";
    const escaped = foundry.utils.escapeHTML?.(prefill) ?? prefill;

    const code = await foundry.applications.api.DialogV2.prompt({
      window: { title: `${MODULE_TITLE} — ${L("CodeTitle")}` },
      content: `${notice}
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
 * Settings-menu entry point. Foundry instantiates and renders this class;
 * we hand straight over to the card instead of drawing a form.
 */
export class LicenseMenu extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: `${MODULE_ID}-license-menu` };

  /** @override */
  async render() {
    LicenseUI.show();
    return this;
  }

  /** @override */
  async close() {
    return this;
  }
}
