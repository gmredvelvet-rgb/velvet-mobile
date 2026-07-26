/**
 * Velvet Mobile — MobileSheet.
 *
 * A native mobile character sheet, rendered by us from a system adapter's
 * view model (see sheet/adapters.mjs) — the Swipe approach: never squeeze
 * the desktop sheet into a phone; draw a phone UI instead.
 *
 * Structure (a fullscreen drawer):
 *   ┌───────────────────────────┐
 *   │ grip · close              │  drag down / tap to dismiss
 *   │ portrait  name            │
 *   │ subtitle  AC · stats      │
 *   │ HP bar (tap → damage/heal)│
 *   ├───────────────────────────┤
 *   │ scrolling tab content     │  swipe left/right to change tab
 *   ├───────────────────────────┤
 *   │ tab bar                   │
 *   └───────────────────────────┘
 *
 * @module sheet/mobile-sheet
 */

import { L10N } from "../core/constants.mjs";
import { Logger } from "../core/logger.mjs";
import { VelvetComponent } from "../components/component.mjs";
import { Motion, DURATION } from "../motion/animation-engine.mjs";

/** Drag distance (fraction of height) or velocity (px/ms) that dismisses. */
const DISMISS_FRACTION = 0.28;
const DISMISS_VELOCITY = 0.5;

export class MobileSheet extends VelvetComponent {
  /** @type {Actor} */
  actor;

  /** @type {(actor: Actor) => object|null} */
  #buildModel;

  /** @type {(() => void)|null} */
  #onDismiss;

  /** @type {object} Current view model. */
  #model;

  /** @type {string} Active tab id. */
  #tabId;

  /** @type {boolean} */
  #dismissed = false;

  /** @type {number|null} Coalesces refresh() bursts into one re-render. */
  #refreshTimer = null;

  /**
   * @param {object} options
   * @param {Actor} options.actor
   * @param {(actor: Actor) => object|null} options.buildModel
   * @param {() => void} [options.onDismiss]
   */
  constructor({ actor, buildModel, onDismiss = null }) {
    super();
    this.actor = actor;
    this.#buildModel = buildModel;
    this.#onDismiss = onDismiss;
    this.#model = buildModel(actor);
    // Refuse to present an empty shell: throwing here routes the shell to
    // the system's own sheet, which always has something to show.
    if (!this.#model?.tabs?.length) {
      throw new Error(`No mobile sheet data available for "${actor?.name ?? "?"}"`);
    }
    this.#tabId = this.#model.tabs[0].id;
  }

  /* -- Lifecycle ---------------------------------------------------------- */

  /** Mount fullscreen and slide in. @returns {this} */
  open() {
    this.mount();
    Motion.slide(this.element, "translateY(100%)", "translateY(0)").then(() => {
      if (this.element) this.element.style.transform = "";
    });
    return this;
  }

  /** Animate out, then destroy. Safe to call repeatedly. */
  async dismiss() {
    if (this.#dismissed) return;
    this.#dismissed = true;
    await Motion.slide(this.element, this.element?.style.transform || "translateY(0)", "translateY(100%)", { duration: DURATION.FAST });
    const callback = this.#onDismiss;
    this.#onDismiss = null;
    this.destroy();
    callback?.();
  }

  /** Rebuild the model and re-render (coalesced across rapid updates). */
  refresh() {
    if (this.#refreshTimer) return;
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null;
      if (!this.element || this.#dismissed) return;
      try {
        this.#model = this.#buildModel(this.actor) ?? this.#model;
      } catch (err) {
        return void Logger.error("Mobile sheet refresh failed", err);
      }
      // Tabs can appear/disappear (first spell learned…), keep the bar honest.
      if (!this.#model.tabs.some((tab) => tab.id === this.#tabId)) {
        this.#tabId = this.#model.tabs[0]?.id ?? "";
      }
      this.element.querySelector(".vm-ms-header")?.replaceWith(this.#buildHeader());
      this.element.querySelector(".vm-ms-tabs")?.replaceWith(this.#buildTabBar());
      // Keep the reading position: a mid-combat HP tick must not yank the
      // list back to the top.
      const body = this.element.querySelector(".vm-ms-body");
      const scrollTop = body?.scrollTop ?? 0;
      this.#renderTab(this.#tabId);
      if (body) body.scrollTop = scrollTop;
    }, 50);
  }

  /** @override */
  destroy() {
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer);
    this.#refreshTimer = null;
    super.destroy();
  }

  /* -- Build -------------------------------------------------------------- */

  /** @override @returns {HTMLElement} */
  build() {
    const el = VelvetComponent.el;
    const root = el("section", {
      cls: "vm-msheet",
      attrs: { role: "dialog", "aria-label": this.actor.name },
      children: [this.#buildHandle(), this.#buildHeader(), el("div", { cls: "vm-ms-body" }), this.#buildTabBar()]
    });

    // Swipe between tabs anywhere on the body.
    this.gesture(root.querySelector(".vm-ms-body"), "swipe", (g) => {
      if (g.direction !== "left" && g.direction !== "right") return;
      const tabs = this.#model.tabs;
      const index = tabs.findIndex((tab) => tab.id === this.#tabId);
      const next = tabs[index + (g.direction === "left" ? 1 : -1)];
      if (next) this.#selectTab(next.id);
    });

    // Deferred so #renderTab can query inside the built root.
    queueMicrotask(() => this.#renderTab(this.#tabId));
    return root;
  }

  /** @returns {HTMLElement} */
  #buildHandle() {
    const el = VelvetComponent.el;
    const close = el("button", {
      cls: "vm-ms-close",
      attrs: { type: "button", "aria-label": game.i18n?.localize("Close") ?? "Close" },
      children: [VelvetComponent.icon("fa-solid fa-chevron-down")]
    });
    this.listen(close, "click", () => this.dismiss());

    const handle = el("div", { cls: "vm-ms-handle", children: [el("span", { cls: "vm-ms-grip" }), close] });
    this.gesture(handle, "pan", (g) => this.#onHandlePan(g));
    return handle;
  }

  /** @returns {HTMLElement} */
  #buildHeader() {
    const el = VelvetComponent.el;
    const m = this.#model;
    const t = (key) => game.i18n.localize(`${L10N}.Sheet.${key}`);

    const stats = (m.stats ?? []).map((stat) => {
      const chip = el("button", {
        cls: `vm-ms-stat ${stat.onTap ? "vm-tappable" : ""}`.trim(),
        attrs: { type: "button" },
        children: [
          el("span", { cls: "vm-ms-stat-value", text: String(stat.value) }),
          el("span", { cls: "vm-ms-stat-label", text: stat.label })
        ]
      });
      if (stat.onTap) this.listen(chip, "click", () => stat.onTap());
      return chip;
    });

    if (m.ac !== null && m.ac !== undefined) {
      stats.unshift(el("div", {
        cls: "vm-ms-stat vm-ms-ac",
        children: [
          el("span", { cls: "vm-ms-stat-value", text: String(m.ac) }),
          el("span", { cls: "vm-ms-stat-label", text: t("AC") })
        ]
      }));
    }

    const hp = m.hp ? this.#buildHpBar(m.hp) : el("div", { cls: "vm-ms-hp vm-ms-hp-none" });

    return el("header", {
      cls: "vm-ms-header",
      children: [
        el("img", { cls: "vm-ms-portrait", attrs: { src: this.actor.img || "icons/svg/mystery-man.svg", alt: this.actor.name } }),
        el("div", {
          cls: "vm-ms-title",
          children: [
            el("h1", { text: this.actor.name }),
            el("span", { cls: "vm-ms-subtitle", text: m.subtitle ?? "" })
          ]
        }),
        el("div", { cls: "vm-ms-stats", children: stats }),
        hp
      ]
    });
  }

  /** @param {object} hp @returns {HTMLElement} */
  #buildHpBar(hp) {
    const el = VelvetComponent.el;
    const hpLabel = game.i18n.localize(`${L10N}.Sheet.HP`);
    let tone = "";
    if (hp.pct <= 25) tone = "vm-critical";
    else if (hp.pct <= 50) tone = "vm-low";
    const temp = hp.temp ? ` (+${hp.temp})` : "";
    const bar = el("button", {
      cls: "vm-ms-hp",
      attrs: { type: "button", "aria-label": `${hpLabel} ${hp.value}/${hp.max}` },
      children: [
        el("span", {
          cls: `vm-ms-hp-fill ${tone}`.trim(),
          attrs: { style: `width: ${hp.pct}%` }
        }),
        el("span", { cls: "vm-ms-hp-text", text: `${hp.value} / ${hp.max}${temp}` })
      ]
    });
    this.listen(bar, "click", () => this.#promptHp());
    return bar;
  }

  /** Damage / heal prompt, applied through the adapter. */
  async #promptHp() {
    const t = (key) => game.i18n.localize(`${L10N}.Sheet.${key}`);
    const read = (button) => Math.abs(button.form?.elements["vm-amount"]?.valueAsNumber || 0);
    let delta = null;
    try {
      delta = await foundry.applications.api.DialogV2.wait({
        window: { title: this.actor.name },
        position: { width: 300 },
        content: `<input type="number" name="vm-amount" value="1" min="0" step="1" inputmode="numeric" autofocus
                   style="width: 100%; font-size: 16px; text-align: center;">`,
        buttons: [
          { action: "damage", label: t("Damage"), icon: "fa-solid fa-heart-crack", callback: (_e, b) => -read(b) },
          { action: "heal", label: t("Heal"), icon: "fa-solid fa-heart-pulse", default: true, callback: (_e, b) => read(b) }
        ],
        rejectClose: false
      });
    } catch (err) {
      Logger.debug("HP dialog unavailable", err);
    }
    if (typeof delta === "number" && delta !== 0) {
      await this.#model.applyHp?.(delta);
    }
  }

  /** @returns {HTMLElement} */
  #buildTabBar() {
    const el = VelvetComponent.el;
    const bar = el("nav", { cls: "vm-ms-tabs" });
    for (const tab of this.#model.tabs) {
      const btn = el("button", {
        cls: `vm-ms-tab ${tab.id === this.#tabId ? "vm-active" : ""}`.trim(),
        attrs: { type: "button", "data-tab": tab.id, "aria-label": tab.label },
        children: [VelvetComponent.icon(tab.icon), el("span", { text: tab.label })]
      });
      this.listen(btn, "click", () => this.#selectTab(tab.id));
      bar.append(btn);
    }
    return bar;
  }

  /* -- Tab rendering ------------------------------------------------------- */

  /** @param {string} tabId */
  #selectTab(tabId) {
    if (tabId === this.#tabId) return;
    this.#tabId = tabId;
    try {
      navigator.vibrate?.(5);
    } catch { /* no haptics */ }
    for (const btn of this.element.querySelectorAll(".vm-ms-tab")) {
      btn.classList.toggle("vm-active", btn.dataset.tab === tabId);
    }
    this.#renderTab(tabId);
  }

  /** @param {string} tabId */
  #renderTab(tabId) {
    const body = this.element?.querySelector(".vm-ms-body");
    const tab = this.#model.tabs.find((entry) => entry.id === tabId);
    if (!body || !tab) return;
    body.replaceChildren();
    body.scrollTop = 0;
    for (const section of tab.sections ?? []) {
      // One broken section must never take the whole sheet down.
      try {
        body.append(section.type === "abilities" ? this.#buildAbilities(section) : this.#buildSection(section));
      } catch (err) {
        Logger.error(`Mobile sheet: section "${section.title ?? section.type}" failed to render`, err);
      }
    }
  }

  /** @param {object} section @returns {HTMLElement} */
  #buildAbilities(section) {
    const el = VelvetComponent.el;
    const grid = el("div", { cls: "vm-ms-abilities" });
    for (const ability of section.abilities ?? []) {
      const cell = el("button", {
        cls: `vm-ms-ability ${ability.onTap ? "vm-tappable" : ""}`.trim(),
        attrs: { type: "button" },
        children: [
          el("span", { cls: "vm-ms-ability-label", text: ability.label }),
          el("span", { cls: "vm-ms-ability-mod", text: ability.mod })
        ]
      });
      if (ability.onTap) this.listen(cell, "click", () => ability.onTap());
      if (ability.onLong) {
        this.gesture(cell, "longpress", (g) => {
          if (g.phase === "ended") ability.onLong();
        });
        this.listen(cell, "contextmenu", (e) => {
          e.preventDefault();
          ability.onLong();
        });
      }
      grid.append(cell);
    }
    return grid;
  }

  /** @param {object} section @returns {HTMLElement} */
  #buildSection(section) {
    const el = VelvetComponent.el;
    const children = [];
    if (section.title) {
      children.push(el("div", {
        cls: "vm-ms-section-head",
        children: [
          el("h2", { text: section.title }),
          section.badge ? el("span", { cls: "vm-ms-section-badge", text: section.badge }) : ""
        ].filter(Boolean)
      }));
    }
    const rows = section.rows ?? [];
    if (!rows.length) {
      children.push(el("p", { cls: "vm-ms-empty", text: game.i18n.localize(`${L10N}.Sheet.Empty`) }));
    }
    for (const row of rows) {
      try {
        children.push(this.#buildRow(row));
      } catch (err) {
        Logger.error(`Mobile sheet: row "${row?.label}" failed to render`, err);
      }
    }
    return el("section", { cls: "vm-ms-section", children });
  }

  /** @param {object} row @returns {HTMLElement} */
  #buildRow(row) {
    const el = VelvetComponent.el;

    const main = el("button", {
      cls: "vm-ms-row-main",
      attrs: { type: "button" },
      children: [
        row.img
          ? el("img", { cls: "vm-ms-row-img", attrs: { src: row.img, alt: "", loading: "lazy" } })
          : el("span", { cls: "vm-ms-row-dot", children: row.prof !== undefined ? [el("span", { cls: `vm-ms-prof ${row.prof ? "vm-on" : ""}`.trim() })] : [] }),
        el("div", {
          cls: "vm-ms-row-text",
          children: [
            el("span", { cls: "vm-ms-row-label", text: row.label }),
            row.sub ? el("span", { cls: "vm-ms-row-sub", text: row.sub }) : ""
          ].filter(Boolean)
        }),
        row.badge ? el("span", { cls: "vm-ms-row-badge", text: row.badge }) : ""
      ].filter(Boolean)
    });
    if (row.onTap) this.listen(main, "click", () => row.onTap());
    // Secondary action: long press, or right-click for anyone testing on a
    // desktop with mobile mode forced on.
    if (row.onLong) {
      this.gesture(main, "longpress", (g) => {
        if (g.phase === "ended") row.onLong();
      });
      this.listen(main, "contextmenu", (e) => {
        e.preventDefault();
        row.onLong();
      });
    }

    const trailing = (row.actions ?? []).map((action) => {
      const btn = el("button", {
        cls: "vm-ms-row-action",
        attrs: { type: "button", "aria-label": action.label, "data-tooltip": action.label },
        children: [VelvetComponent.icon(action.icon)]
      });
      this.listen(btn, "click", (e) => {
        e.stopPropagation();
        action.onTap();
      });
      return btn;
    });

    let detailBtn = "";
    let detail = null;
    if (row.description) {
      detail = el("div", { cls: "vm-ms-row-detail", attrs: { hidden: "" } });
      detailBtn = el("button", {
        cls: "vm-ms-row-action",
        attrs: { type: "button", "aria-label": "info" },
        children: [VelvetComponent.icon("fa-solid fa-circle-info")]
      });
      this.listen(detailBtn, "click", async (e) => {
        e.stopPropagation();
        if (detail.hidden) {
          if (!detail.dataset.loaded) {
            const empty = game.i18n.localize(`${L10N}.Sheet.Empty`);
            detail.innerHTML = await row.description() || `<em>${empty}</em>`;
            detail.dataset.loaded = "1";
          }
          detail.hidden = false;
        } else {
          detail.hidden = true;
        }
      });
    }

    const rowEl = el("div", {
      cls: "vm-ms-row",
      children: [el("div", { cls: "vm-ms-row-line", children: [main, ...trailing, detailBtn].filter(Boolean) }), detail].filter(Boolean)
    });
    return rowEl;
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
      try {
        navigator.vibrate?.(8);
      } catch { /* no haptics */ }
      this.dismiss();
    } else {
      Motion.slide(element, `translateY(${dy}px)`, "translateY(0)", { duration: DURATION.FAST })
        .then(() => {
          if (this.element) this.element.style.transform = "";
        });
    }
  }
}

