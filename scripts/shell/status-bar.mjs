/**
 * Velvet Mobile — StatusBar.
 *
 * The persistent top chrome: who you are and how you are doing, always on
 * screen. The previous design made the player open the sheet to read their
 * own hit points, which is the one number they need most often and the one
 * they should never have to go looking for.
 *
 * Tapping the identity block opens the character sheet; the swap button opens
 * the roster; the gear opens settings.
 *
 * @module shell/status-bar
 */

import { CLS, L10N } from "../core/constants.mjs";
import { VelvetComponent } from "../components/component.mjs";
import { hpOf } from "../sheet/adapters/shared.mjs";

/** Fallback portrait, matching what the sheet and roster use. */
const BLANK_PORTRAIT = "icons/svg/mystery-man.svg";

export class StatusBar extends VelvetComponent {
  /** @type {() => void} */
  #onOpenSheet;

  /** @type {() => void} */
  #onOpenRoster;

  /** @type {() => void} */
  #onOpenSettings;

  /** @type {Actor|null} */
  #actor = null;

  /**
   * @param {object} options
   * @param {() => void} options.onOpenSheet
   * @param {() => void} options.onOpenRoster
   * @param {() => void} options.onOpenSettings
   */
  constructor({ onOpenSheet, onOpenRoster, onOpenSettings }) {
    super();
    this.#onOpenSheet = onOpenSheet;
    this.#onOpenRoster = onOpenRoster;
    this.#onOpenSettings = onOpenSettings;
  }

  /** @override @returns {HTMLElement} */
  build() {
    const el = VelvetComponent.el;
    const t = (key) => game.i18n.localize(`${L10N}.Shell.${key}`);

    const identity = el("button", {
      cls: `${CLS}-status-id`,
      attrs: { type: "button" },
      children: [
        el("img", { cls: `${CLS}-status-portrait`, attrs: { src: BLANK_PORTRAIT, alt: "" } }),
        el("span", {
          cls: `${CLS}-status-text`,
          children: [
            el("span", { cls: `${CLS}-status-name` }),
            el("span", {
              cls: `${CLS}-status-hp`,
              children: [
                el("span", { cls: `${CLS}-status-hp-fill` }),
                el("span", { cls: `${CLS}-status-hp-text` })
              ]
            })
          ]
        })
      ]
    });
    this.listen(identity, "click", () => this.#onOpenSheet());

    const iconButton = (name, icon, label, onTap) => {
      const btn = el("button", {
        cls: `${CLS}-status-btn`,
        attrs: { type: "button", "data-action": name, "aria-label": label },
        children: [VelvetComponent.icon(icon)]
      });
      this.listen(btn, "click", onTap);
      return btn;
    };

    return el("header", {
      cls: `${CLS}-status`,
      children: [
        identity,
        el("div", {
          cls: `${CLS}-status-tools`,
          children: [
            iconButton("roster", "fa-solid fa-repeat", t("Roster"), () => this.#onOpenRoster()),
            iconButton("settings", "fa-solid fa-gear", t("Settings"), () => this.#onOpenSettings())
          ]
        })
      ]
    });
  }

  /**
   * Point the bar at an actor (or at nobody) and redraw it.
   * @param {Actor|null} actor
   */
  setActor(actor) {
    this.#actor = actor;
    this.refresh();
  }

  /** Redraw name, portrait and hit points from the current actor. */
  refresh() {
    const root = this.element;
    if (!root) return;
    const actor = this.#actor;

    root.classList.toggle(`${CLS}-empty`, !actor);
    root.querySelector(`.${CLS}-status-portrait`)?.setAttribute("src", actor?.img || BLANK_PORTRAIT);
    const name = root.querySelector(`.${CLS}-status-name`);
    if (name) name.textContent = actor?.name ?? game.i18n.localize(`${L10N}.Shell.NoActorTitle`);

    // Systems that do not model hit points get a bar with nothing in it,
    // which reads as "at zero" — hide it instead.
    const hp = actor ? hpOf(actor) : null;
    const bar = root.querySelector(`.${CLS}-status-hp`);
    if (!bar) return;
    bar.hidden = !hp;
    if (!hp) return;

    const fill = bar.querySelector(`.${CLS}-status-hp-fill`);
    fill.style.width = `${hp.pct}%`;
    fill.classList.toggle(`${CLS}-critical`, hp.pct <= 25);
    fill.classList.toggle(`${CLS}-low`, hp.pct > 25 && hp.pct <= 50);
    bar.querySelector(`.${CLS}-status-hp-text`).textContent = `${hp.value} / ${hp.max}`;
  }

  /**
   * Slide the bar out of the way (map panning) and back.
   * @param {boolean} hidden
   */
  setHidden(hidden) {
    this.element?.classList.toggle(`${CLS}-hidden`, hidden);
  }
}
