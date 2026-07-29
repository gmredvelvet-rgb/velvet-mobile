/**
 * Velvet Mobile — MobileSettings.
 *
 * Foundry's own settings dialog is two columns of desktop chrome: on a phone
 * the category list eats the width and the panel that holds the actual
 * controls is pushed off-screen, so most settings simply cannot be reached.
 * This is the same registry drawn as a phone screen — a list of packages, a
 * list of settings inside each, and a search box across the lot.
 *
 * Changes are written as you make them rather than batched behind a Save
 * button: there is no room for a button bar, and a half-filled form that
 * loses everything when the drawer is dismissed is worse than immediate
 * writes. Settings that need a reload are collected and asked about once,
 * when the screen closes.
 *
 * @module shell/mobile-settings
 */

import { L10N } from "../core/constants.mjs";
import { Logger } from "../core/logger.mjs";
import { VelvetComponent } from "../components/component.mjs";
import { Motion, DURATION } from "../motion/animation-engine.mjs";
import { CONTROL, searchSettings, settingsCategories } from "./settings-model.mjs";

/** Drag distance (fraction of height) or velocity (px/ms) that dismisses. */
const DISMISS_FRACTION = 0.28;
const DISMISS_VELOCITY = 0.5;

export class MobileSettings extends VelvetComponent {
  /** @type {Array<object>} */
  #categories = [];

  /** @type {string|null} Open category id, or null at the top level. */
  #categoryId = null;

  /** @type {string} Current search query. */
  #query = "";

  /** @type {boolean} */
  #dismissed = false;

  /** @type {{client: boolean, world: boolean}} Pending reload requirements. */
  #reload = { client: false, world: false };

  /** @type {(() => void)|null} */
  #onDismiss;

  /** @type {{listen: Function, gesture: Function, dispose: () => void}|null} */
  #bodyScope = null;

  /** @param {object} [options] @param {() => void} [options.onDismiss] */
  constructor({ onDismiss = null } = {}) {
    super();
    this.#onDismiss = onDismiss;
    this.#categories = settingsCategories();
  }

  /* -- Lifecycle ---------------------------------------------------------- */

  /** @returns {this} */
  open() {
    this.mount();
    Motion.slide(this.element, "translateY(100%)", "translateY(0)").then(() => {
      if (this.element) this.element.style.transform = "";
    });
    return this;
  }

  /** Animate out, ask about any pending reload, then destroy. */
  async dismiss() {
    if (this.#dismissed) return;
    this.#dismissed = true;
    await Motion.slide(this.element, this.element?.style.transform || "translateY(0)", "translateY(100%)", { duration: DURATION.FAST });
    const callback = this.#onDismiss;
    this.#onDismiss = null;
    this.destroy();
    callback?.();
    await this.#confirmReload();
  }

  /**
   * Ask once, on the way out, rather than after every toggle. Routed through
   * core's own confirmation so a world reload still warns every client.
   */
  async #confirmReload() {
    const { client, world } = this.#reload;
    if (!client && !world) return;
    this.#reload = { client: false, world: false };
    try {
      await foundry.applications.settings.SettingsConfig.reloadConfirm({ world });
    } catch (err) {
      Logger.debug("Reload confirmation unavailable", err);
    }
  }

  /* -- Build -------------------------------------------------------------- */

  /** @override @returns {HTMLElement} */
  build() {
    const el = VelvetComponent.el;
    const root = el("section", {
      cls: "vm-settings",
      attrs: { role: "dialog", "aria-label": game.i18n.localize(`${L10N}.Shell.Settings`) },
      children: [this.#buildHandle(), this.#buildHeader(), el("div", { cls: "vm-set-body" })]
    });
    queueMicrotask(() => this.#render());
    return root;
  }

  /** @returns {HTMLElement} */
  #buildHandle() {
    const el = VelvetComponent.el;
    const handle = el("div", { cls: "vm-set-handle", children: [el("span", { cls: "vm-set-grip" })] });
    this.gesture(handle, "pan", (g) => this.#onHandlePan(g));
    return handle;
  }

  /** @returns {HTMLElement} */
  #buildHeader() {
    const el = VelvetComponent.el;
    const t = (key) => game.i18n.localize(`${L10N}.Settings.${key}`);

    const back = el("button", {
      cls: "vm-set-back",
      attrs: { type: "button", "aria-label": t("Back"), hidden: "" },
      children: [VelvetComponent.icon("fa-solid fa-chevron-left")]
    });
    this.listen(back, "click", () => {
      this.#categoryId = null;
      this.#render();
    });

    const title = el("h1", { cls: "vm-set-title", text: game.i18n.localize(`${L10N}.Shell.Settings`) });

    const close = el("button", {
      cls: "vm-set-close",
      attrs: { type: "button", "aria-label": game.i18n.localize("Close") },
      children: [VelvetComponent.icon("fa-solid fa-xmark")]
    });
    this.listen(close, "click", () => this.dismiss());

    const search = el("input", {
      cls: "vm-set-search",
      attrs: {
        type: "search", inputmode: "search", placeholder: t("Search"),
        "aria-label": t("Search"), autocomplete: "off"
      }
    });
    this.listen(search, "input", () => {
      this.#query = search.value;
      this.#render({ keepScroll: true });
    });

    return el("header", {
      cls: "vm-set-header",
      children: [
        el("div", { cls: "vm-set-bar", children: [back, title, close] }),
        search
      ]
    });
  }

  /* -- Rendering ----------------------------------------------------------- */

  /**
   * Redraw the body. The header — and so the search box the user may be
   * typing into — is built once and never replaced, so focus takes care of
   * itself; `keepScroll` is only about not yanking the list back to the top
   * on every keystroke.
   * @param {object} [options] @param {boolean} [options.keepScroll]
   */
  #render({ keepScroll = false } = {}) {
    const body = this.element?.querySelector(".vm-set-body");
    if (!body) return;
    this.#bodyScope?.dispose();
    this.#bodyScope = this.scope();
    body.replaceChildren();

    const back = this.element.querySelector(".vm-set-back");
    const searching = Boolean(this.#query.trim());
    // Search is a view of everything, so "back" would have nowhere to go.
    if (back) back.hidden = searching || !this.#categoryId;

    if (searching) this.#renderSearch(body);
    else if (this.#categoryId) this.#renderCategory(body);
    else this.#renderCategoryList(body);

    if (!keepScroll) body.scrollTop = 0;
  }

  /** @param {HTMLElement} body */
  #renderCategoryList(body) {
    const el = VelvetComponent.el;
    if (!this.#categories.length) return void body.append(this.#emptyNote());
    for (const category of this.#categories) {
      const row = el("button", {
        cls: "vm-set-cat",
        attrs: { type: "button" },
        children: [
          el("span", { cls: "vm-set-cat-label", text: category.label }),
          el("span", { cls: "vm-set-cat-count", text: String(category.entries.length) }),
          VelvetComponent.icon("fa-solid fa-chevron-right")
        ]
      });
      this.#bodyScope.listen(row, "click", () => {
        this.#categoryId = category.id;
        this.#render();
      });
      body.append(row);
    }
  }

  /** @param {HTMLElement} body */
  #renderCategory(body) {
    const el = VelvetComponent.el;
    const category = this.#categories.find((entry) => entry.id === this.#categoryId);
    if (!category) return void body.append(this.#emptyNote());
    body.append(el("h2", { cls: "vm-set-group", text: category.label }));
    for (const entry of category.entries) body.append(this.#buildEntry(entry));
  }

  /** @param {HTMLElement} body */
  #renderSearch(body) {
    const el = VelvetComponent.el;
    const hits = searchSettings(this.#categories, this.#query);
    if (!hits.length) return void body.append(this.#emptyNote());
    let lastCategory = null;
    for (const hit of hits) {
      if (hit.category !== lastCategory) {
        body.append(el("h2", { cls: "vm-set-group", text: hit.category }));
        lastCategory = hit.category;
      }
      body.append(this.#buildEntry(hit.entry));
    }
  }

  /** @returns {HTMLElement} */
  #emptyNote() {
    return VelvetComponent.el("p", {
      cls: "vm-set-empty",
      text: game.i18n.localize(`${L10N}.Settings.NoResults`)
    });
  }

  /* -- Entries -------------------------------------------------------------- */

  /** @param {object} entry @returns {HTMLElement} */
  #buildEntry(entry) {
    const el = VelvetComponent.el;
    const children = [
      el("div", {
        cls: "vm-set-text",
        children: [
          el("span", { cls: "vm-set-label", text: entry.label }),
          entry.hint ? el("span", { cls: "vm-set-hint", text: entry.hint }) : ""
        ].filter(Boolean)
      })
    ];

    let control;
    try {
      control = entry.kind === "menu" ? this.#buildMenuButton(entry) : this.#buildControl(entry);
    } catch (err) {
      Logger.error(`Settings: control for "${entry.id}" failed to build`, err);
      control = el("span", { cls: "vm-set-note", text: game.i18n.localize(`${L10N}.Settings.Unsupported`) });
    }
    children.push(control);

    // World settings change the game for everyone; say so rather than let a
    // GM discover it by watching their table reload.
    if (entry.scope === "world") {
      children[0].append(el("span", {
        cls: "vm-set-scope",
        text: game.i18n.localize(`${L10N}.Settings.WorldScope`)
      }));
    }

    return el("div", { cls: `vm-set-row vm-set-${entry.control ?? "menu"}`, children });
  }

  /** @param {object} entry @returns {HTMLElement} */
  #buildMenuButton(entry) {
    const el = VelvetComponent.el;
    const btn = el("button", {
      cls: "vm-set-menu-btn",
      attrs: { type: "button" },
      children: [
        entry.icon ? VelvetComponent.icon(entry.icon) : "",
        el("span", { text: entry.buttonText || entry.label })
      ].filter(Boolean)
    });
    this.#bodyScope.listen(btn, "click", () => this.#openMenu(entry));
    return btn;
  }

  /**
   * Open a registered submenu. Its application is desktop chrome, so step out
   * of its way — the drawer would cover it, and it is clamped to the screen
   * by the ChromeHider anyway.
   * @param {object} entry
   */
  async #openMenu(entry) {
    const menu = game.settings.menus.get(entry.id);
    if (!menu?.type) return;
    await this.dismiss();
    try {
      await new menu.type().render(true);
    } catch (err) {
      Logger.error(`Settings menu "${entry.id}" failed to open`, err);
      ui.notifications?.error(err.message ?? String(err));
    }
  }

  /** @param {object} entry @returns {HTMLElement} */
  #buildControl(entry) {
    switch (entry.control) {
      case CONTROL.TOGGLE: return this.#buildToggle(entry);
      case CONTROL.SELECT: return this.#buildSelect(entry);
      case CONTROL.SLIDER: return this.#buildSlider(entry);
      case CONTROL.NUMBER: return this.#buildInput(entry, "number");
      case CONTROL.FILE: return this.#buildFile(entry);
      case CONTROL.TEXT: return this.#buildInput(entry, "text");
      default:
        return VelvetComponent.el("span", {
          cls: "vm-set-note",
          text: game.i18n.localize(`${L10N}.Settings.Unsupported`)
        });
    }
  }

  /** @param {object} entry @returns {HTMLElement} */
  #buildToggle(entry) {
    const el = VelvetComponent.el;
    const on = Boolean(entry.value);
    const btn = el("button", {
      cls: `vm-set-toggle ${on ? "vm-on" : ""}`.trim(),
      attrs: { type: "button", role: "switch", "aria-checked": String(on), "aria-label": entry.label },
      children: [el("span", { cls: "vm-set-knob" })]
    });
    this.#bodyScope.listen(btn, "click", async () => {
      const next = btn.getAttribute("aria-checked") !== "true";
      btn.setAttribute("aria-checked", String(next));
      btn.classList.toggle("vm-on", next);
      await this.#write(entry, next, () => {
        btn.setAttribute("aria-checked", String(!next));
        btn.classList.toggle("vm-on", !next);
      });
    });
    return btn;
  }

  /** @param {object} entry @returns {HTMLElement} */
  #buildSelect(entry) {
    const el = VelvetComponent.el;
    const select = el("select", { cls: "vm-set-select", attrs: { "aria-label": entry.label } });
    for (const [value, text] of Object.entries(entry.choices ?? {})) {
      const option = el("option", { attrs: { value }, text });
      if (String(entry.value) === value) option.selected = true;
      select.append(option);
    }
    this.#bodyScope.listen(select, "change", () => {
      // Numeric settings keep numeric values; option values are always strings.
      const raw = select.value;
      const next = typeof entry.value === "number" && raw !== "" && Number.isFinite(Number(raw))
        ? Number(raw)
        : raw;
      this.#write(entry, next);
    });
    return select;
  }

  /** @param {object} entry @returns {HTMLElement} */
  #buildSlider(entry) {
    const el = VelvetComponent.el;
    const { min, max, step } = entry.range;
    const input = el("input", {
      cls: "vm-set-range",
      attrs: { type: "range", min: String(min), max: String(max), step: String(step), "aria-label": entry.label }
    });
    input.value = String(entry.value ?? min);
    const readout = el("span", { cls: "vm-set-readout", text: String(input.value) });
    // `input` tracks the thumb, `change` fires once on release — one write
    // per drag rather than one per pixel.
    this.#bodyScope.listen(input, "input", () => {
      readout.textContent = input.value;
    });
    this.#bodyScope.listen(input, "change", () => this.#write(entry, Number(input.value)));
    return el("div", { cls: "vm-set-slider", children: [input, readout] });
  }

  /** @param {object} entry @param {"text"|"number"} type @returns {HTMLElement} */
  #buildInput(entry, type) {
    const el = VelvetComponent.el;
    const input = el("input", {
      cls: "vm-set-input",
      attrs: { type, "aria-label": entry.label, ...(type === "number" ? { inputmode: "decimal" } : {}) }
    });
    input.value = entry.value ?? "";
    // `change` rather than `input`: one write when the field is committed,
    // not one per keystroke against the server.
    this.#bodyScope.listen(input, "change", () => {
      const raw = input.value;
      this.#write(entry, type === "number" ? Number(raw) : raw);
    });
    return input;
  }

  /** @param {object} entry @returns {HTMLElement} */
  #buildFile(entry) {
    const el = VelvetComponent.el;
    const input = el("input", { cls: "vm-set-input", attrs: { type: "text", "aria-label": entry.label } });
    input.value = entry.value ?? "";
    this.#bodyScope.listen(input, "change", () => this.#write(entry, input.value));

    const browse = el("button", {
      cls: "vm-set-browse",
      attrs: { type: "button", "aria-label": game.i18n.localize(`${L10N}.Settings.Browse`) },
      children: [VelvetComponent.icon("fa-solid fa-folder-open")]
    });
    this.#bodyScope.listen(browse, "click", async () => {
      try {
        const Picker = foundry.applications.apps.FilePicker?.implementation ?? FilePicker;
        await new Picker({
          type: entry.filePicker === true ? "any" : entry.filePicker,
          current: input.value,
          callback: (path) => {
            input.value = path;
            this.#write(entry, path);
          }
        }).browse();
      } catch (err) {
        Logger.error("File picker failed to open", err);
      }
    });
    return el("div", { cls: "vm-set-file", children: [input, browse] });
  }

  /**
   * Persist one setting, remembering whether it needs a reload.
   * @param {object} entry
   * @param {*} value
   * @param {() => void} [revert]  Undo the optimistic UI if the write fails.
   */
  async #write(entry, value, revert) {
    try {
      await game.settings.set(entry.namespace, entry.key, value);
      entry.value = value;
      if (entry.requiresReload) {
        if (entry.scope === "world") this.#reload.world = true;
        else this.#reload.client = true;
      }
    } catch (err) {
      Logger.error(`Could not save setting ${entry.id}`, err);
      ui.notifications?.error(err.message ?? String(err));
      revert?.();
    }
  }

  /* -- Drag to dismiss ------------------------------------------------------ */

  /** @param {object} g Pan gesture. */
  #onHandlePan(g) {
    const element = this.element;
    if (!element) return;
    if (g.phase === "changed") {
      element.style.transform = `translateY(${Math.max(0, g.dy)}px)`;
      return;
    }
    if (g.phase !== "ended" && g.phase !== "cancelled") return;
    const dy = Math.max(0, g.dy ?? 0);
    const height = element.getBoundingClientRect().height;
    if (dy > height * DISMISS_FRACTION || (g.vy ?? 0) > DISMISS_VELOCITY) {
      this.dismiss();
    } else {
      Motion.slide(element, `translateY(${dy}px)`, "translateY(0)", { duration: DURATION.FAST })
        .then(() => {
          if (this.element) this.element.style.transform = "";
        });
    }
  }
}
