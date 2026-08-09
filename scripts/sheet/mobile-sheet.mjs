/**
 * Velvet Mobile — MobileSheet.
 *
 * A native mobile character sheet, rendered by us from a system adapter's
 * view model (see sheet/adapters.mjs). Never squeeze the desktop sheet into
 * a phone; draw a phone UI instead.
 *
 * Structure (the content of a NavStack view):
 *   ┌───────────────────────────┐
 *   │ ‹  name          AC · HP  │  back chevron, identity, vitals
 *   │ portrait  subtitle        │
 *   │ HP bar (tap → damage/heal)│
 *   ├───────────────────────────┤
 *   │ Actions · Items · Spells  │  segmented tabs, scrolled horizontally
 *   ├───────────────────────────┤
 *   │ scrolling tab content     │  swipe left/right to change tab
 *   └───────────────────────────┘
 *
 * Tabs sit above the content, not below it: the bottom of the screen belongs
 * to the shell's command bar, and two stacked bars down there would leave the
 * player guessing which row they were tapping.
 *
 * Presentation — entering, leaving, the back gesture — belongs to the
 * NavStack that hosts this sheet. It only draws itself.
 *
 * @module sheet/mobile-sheet
 */

import { L10N } from "../core/constants.mjs";
import { Logger } from "../core/logger.mjs";
import { Theme } from "../core/theme.mjs";
import { VelvetComponent } from "../components/component.mjs";
import { rendererFor, rowRole } from "./system-renderers.mjs";

/**
 * Pointer-down within this many px of the left edge belongs to the stack's
 * back gesture, so the tab swipe stays out of its way.
 */
const BACK_EDGE = 30;

export class MobileSheet extends VelvetComponent {
  /** @type {Actor} */
  actor;

  /** @type {(actor: Actor) => object|null} */
  #buildModel;

  /** @type {(() => void)|null} */
  #onBack;

  /** @type {number} X of the last pointer-down on the body, for the tab swipe. */
  #swipeStartX = Infinity;

  /** @type {object} Current view model. */
  #model;

  /** @type {string} Active tab id. */
  #tabId;

  /**
   * Whether the conditions cloud is showing the inactive chips too. Held on
   * the sheet rather than in the DOM so a refresh() — an HP tick, a toggled
   * condition — does not fold the list back up under the player's thumb.
   * @type {boolean}
   */
  #conditionsOpen = false;

  /** @type {number|null} Coalesces refresh() bursts into one re-render. */
  #refreshTimer = null;

  /**
   * Listener/gesture scopes for the two parts that get rebuilt.
   * Without them every HP tick would leave the previous header, tab bar and
   * row subtree registered — and therefore alive — for as long as the sheet
   * stayed open.
   * @type {{listen: Function, gesture: Function, dispose: () => void}|null}
   */
  #chromeScope = null;

  /** @type {{listen: Function, gesture: Function, dispose: () => void}|null} */
  #contentScope = null;

  /**
   * @param {object} options
   * @param {Actor} options.actor
   * @param {(actor: Actor) => object|null} options.buildModel
   * @param {() => void} [options.onBack]  Invoked by the header's back chevron.
   */
  constructor({ actor, buildModel, onBack = null }) {
    super();
    this.actor = actor;
    this.#buildModel = buildModel;
    this.#onBack = onBack;
    this.#model = buildModel(actor);
    // Refuse to present an empty shell: throwing here routes the shell to
    // the system's own sheet, which always has something to show.
    if (!this.#model?.tabs?.length) {
      throw new Error(`No mobile sheet data available for "${actor?.name ?? "?"}"`);
    }
    this.#tabId = this.#model.tabs[0].id;
  }

  /* -- Lifecycle ---------------------------------------------------------- */

  /** Rebuild the model and re-render (coalesced across rapid updates). */
  refresh() {
    if (this.#refreshTimer) return;
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null;
      if (!this.element) return;
      try {
        this.#model = this.#buildModel(this.actor) ?? this.#model;
      } catch (err) {
        return void Logger.error("Mobile sheet refresh failed", err);
      }
      // Tabs can appear/disappear (first spell learned…), keep the bar honest.
      if (!this.#model.tabs.some((tab) => tab.id === this.#tabId)) {
        this.#tabId = this.#model.tabs[0]?.id ?? "";
      }
      this.#resetChromeScope();
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

  /** Retire the previous header/tab-bar scope and open a fresh one. */
  #resetChromeScope() {
    this.#chromeScope?.dispose();
    this.#chromeScope = this.scope();
  }

  /** Retire the previous tab-content scope and open a fresh one. */
  #resetContentScope() {
    this.#contentScope?.dispose();
    this.#contentScope = this.scope();
  }

  /** @override @returns {HTMLElement} */
  build() {
    const el = VelvetComponent.el;
    this.#resetChromeScope();
    const body = el("div", { cls: "vm-ms-body" });
    const root = el("section", {
      cls: this.#rootClass(),
      children: [this.#buildHeader(), this.#buildTabBar(), body]
    });

    // Swipe between tabs anywhere on the body — except from the left edge,
    // which the stack claims for the back gesture. Without this, dragging
    // back also skipped a tab on the way out.
    this.listen(body, "pointerdown", (event) => { this.#swipeStartX = event.clientX; }, { capture: true });
    this.gesture(body, "swipe", (g) => {
      if (g.direction !== "left" && g.direction !== "right") return;
      if (this.#swipeStartX <= BACK_EDGE) return;
      const tabs = this.#model.tabs;
      const index = tabs.findIndex((tab) => tab.id === this.#tabId);
      const next = tabs[index + (g.direction === "left" ? 1 : -1)];
      if (next) this.#selectTab(next.id);
    });

    // Deferred so #renderTab can query inside the built root.
    queueMicrotask(() => this.#renderTab(this.#tabId));
    this.listen(document, "velvet-mobile:theme-changed", () => this.#rerenderVisuals());
    return root;
  }

  /** Rebuild only DOM composition after a visual-style change. */
  #rerenderVisuals() {
    if (!this.element) return;
    this.#resetChromeScope();
    this.element.className = this.#rootClass();
    this.element.querySelector(".vm-ms-header")?.replaceWith(this.#buildHeader());
    this.element.querySelector(".vm-ms-tabs")?.replaceWith(this.#buildTabBar());
    this.#renderTab(this.#tabId);
  }

  /** @returns {object} */
  #renderer() {
    return rendererFor(Theme.current, game.system?.id ?? "");
  }

  /** @returns {string} */
  #rootClass() {
    return `vm-msheet vm-msheet-${this.#renderer().id}`;
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
      if (stat.onTap) this.#chromeScope.listen(chip, "click", () => stat.onTap());
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

    /* Temporary hit points, at the end of the chip row.
       Shown even at zero, and only where the system models them at all: a
       shield you have to remember to go looking for is a shield you forget
       to spend, and the chip is also how you grant one. */
    if (m.applyTempHp) {
      const temp = m.hp?.temp ?? 0;
      const chip = el("button", {
        cls: `vm-ms-stat vm-tappable vm-ms-temp ${temp > 0 ? "vm-on" : ""}`.trim(),
        attrs: { type: "button", "aria-label": `${t("TempHP")} ${temp}` },
        children: [
          el("span", { cls: "vm-ms-stat-value", text: temp > 0 ? `+${temp}` : "—" }),
          el("span", { cls: "vm-ms-stat-label", text: t("TempHP") })
        ]
      });
      this.#chromeScope.listen(chip, "click", () => this.#promptTempHp());
      stats.push(chip);
    }

    const hp = m.hp ? this.#buildHpBar(m.hp) : el("div", { cls: "vm-ms-hp vm-ms-hp-none" });

    const back = el("button", {
      cls: "vm-nav-back",
      attrs: { type: "button", "aria-label": game.i18n.localize(`${L10N}.Shell.Back`) },
      children: [VelvetComponent.icon("fa-solid fa-chevron-left")]
    });
    this.#chromeScope.listen(back, "click", () => this.#onBack?.());

    return el("header", {
      cls: "vm-ms-header",
      children: [
        el("div", {
          cls: "vm-ms-identity",
          children: [
            back,
            el("img", { cls: "vm-ms-portrait", attrs: { src: this.actor.img || "icons/svg/mystery-man.svg", alt: "" } }),
            el("div", {
              cls: "vm-ms-title",
              children: [
                el("h1", { text: this.actor.name }),
                el("span", { cls: "vm-ms-subtitle", text: m.subtitle ?? "" })
              ]
            })
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
    const t = (key) => game.i18n.localize(`${L10N}.Sheet.${key}`);
    let tone = "";
    if (hp.pct <= 25) tone = "vm-critical";
    else if (hp.pct <= 50) tone = "vm-low";

    const children = [
      el("span", { cls: `vm-ms-hp-fill ${tone}`.trim(), attrs: { style: `width: ${hp.pct}%` } })
    ];
    // The shield rides on top of real hit points, which is how it is spent.
    if (hp.tempPct > 0) {
      children.push(el("span", {
        cls: "vm-ms-hp-temp",
        attrs: { style: `left: ${hp.pct}%; width: ${hp.tempPct}%` }
      }));
    }

    const label = [
      `${hp.value} / ${hp.max}`,
      hp.temp ? `+${hp.temp}` : "",
      // A changed maximum is easy to miss and changes what "full" means.
      hp.bonus ? `(${hp.bonus > 0 ? "+" : ""}${hp.bonus} ${t("MaxShort")})` : ""
    ].filter(Boolean);

    children.push(el("span", {
      cls: "vm-ms-hp-text",
      children: [
        el("span", { text: label[0] }),
        hp.temp ? el("span", { cls: "vm-ms-hp-tempval", text: label[1] }) : "",
        hp.bonus ? el("span", { cls: "vm-ms-hp-bonus", text: label[label.length - 1] }) : ""
      ].filter(Boolean)
    }));

    const aria = [
      `${t("HP")} ${hp.value}/${hp.max}`,
      hp.temp ? `${t("TempHP")} ${hp.temp}` : ""
    ].filter(Boolean).join(", ");

    const bar = el("button", { cls: "vm-ms-hp", attrs: { type: "button", "aria-label": aria }, children });
    this.#chromeScope.listen(bar, "click", () => this.#promptHp());
    return bar;
  }

  /**
   * Damage / heal / temporary prompt, applied through the adapter. Damage and
   * healing are a delta; temporary hit points are a value that replaces
   * whatever is there, so the three cannot share one number.
   */
  async #promptHp() {
    const t = (key) => game.i18n.localize(`${L10N}.Sheet.${key}`);
    const read = (button) => Math.abs(button.form?.elements["vm-amount"]?.valueAsNumber || 0);
    const applyTempHp = this.#model.applyTempHp;

    const buttons = [
      { action: "damage", label: t("Damage"), icon: "fa-solid fa-heart-crack", callback: (_e, b) => ({ kind: "delta", amount: -read(b) }) },
      { action: "heal", label: t("Heal"), icon: "fa-solid fa-heart-pulse", default: true, callback: (_e, b) => ({ kind: "delta", amount: read(b) }) }
    ];
    // Only where the system models them — see makeApplyTempHp.
    if (applyTempHp) {
      buttons.push({ action: "temp", label: t("TempHP"), icon: "fa-solid fa-shield-heart", callback: (_e, b) => ({ kind: "temp", amount: read(b) }) });
    }

    let result = null;
    try {
      result = await foundry.applications.api.DialogV2.wait({
        window: { title: this.actor.name },
        position: { width: 300 },
        content: `<input type="number" name="vm-amount" value="1" min="0" step="1" inputmode="numeric" autofocus
                   style="width: 100%; font-size: 16px; text-align: center;">`,
        buttons,
        rejectClose: false
      });
    } catch (err) {
      Logger.debug("HP dialog unavailable", err);
    }

    if (result?.kind === "temp") await applyTempHp?.(result.amount);
    // Zero damage and zero healing are both no-ops; zero temporary hit points
    // is a real instruction — it clears them.
    else if (result?.kind === "delta" && result.amount !== 0) await this.#model.applyHp?.(result.amount);
  }

  /**
   * Grant or clear temporary hit points.
   *
   * Its own prompt rather than the damage/heal one: reaching temporary hit
   * points from a chip labelled *Temp HP* should not make you pick out of
   * three buttons, and the field wants to start at what you already have so
   * a granted shield can be corrected rather than retyped.
   */
  async #promptTempHp() {
    const t = (key) => game.i18n.localize(`${L10N}.Sheet.${key}`);
    const current = this.#model.hp?.temp ?? 0;
    const read = (button) => Math.abs(button.form?.elements["vm-temp"]?.valueAsNumber || 0);
    let value = null;
    try {
      value = await foundry.applications.api.DialogV2.wait({
        window: { title: t("TempHP") },
        position: { width: 300 },
        content: `<input type="number" name="vm-temp" value="${current}" min="0" step="1" inputmode="numeric" autofocus
                   style="width: 100%; font-size: 16px; text-align: center;">`,
        buttons: [
          { action: "clear", label: t("Clear"), icon: "fa-solid fa-xmark", callback: () => 0 },
          { action: "set", label: t("Set"), icon: "fa-solid fa-shield-heart", default: true, callback: (_e, b) => read(b) }
        ],
        rejectClose: false
      });
    } catch (err) {
      Logger.debug("Temp HP dialog unavailable", err);
    }
    // Zero is a real instruction here — it clears the shield — so only a
    // dismissed dialog (null) is a no-op.
    if (typeof value === "number") await this.#model.applyTempHp?.(value);
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
      this.#chromeScope.listen(btn, "click", () => this.#selectTab(tab.id));
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
    this.#resetContentScope();
    body.replaceChildren();
    body.scrollTop = 0;
    for (const section of tab.sections ?? []) {
      // One broken section must never take the whole sheet down.
      try {
        body.append(this.#buildBySection(section, tab));
      } catch (err) {
        Logger.error(`Mobile sheet: section "${section.title ?? section.type}" failed to render`, err);
      }
    }
  }

  /** @param {object} section @returns {HTMLElement} */
  #buildBySection(section, tab) {
    if (section.type === "abilities") return this.#buildAbilities(section);
    if (section.type === "conditions") return this.#buildConditions(section);
    return this.#buildSection(section, tab);
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
      if (ability.onTap) this.#contentScope.listen(cell, "click", () => ability.onTap());
      if (ability.onLong) {
        this.#contentScope.gesture(cell, "longpress", (g) => {
          if (g.phase === "ended") ability.onLong();
        });
        this.#contentScope.listen(cell, "contextmenu", (e) => {
          e.preventDefault();
          ability.onLong();
        });
      }
      grid.append(cell);
    }
    return grid;
  }

  /**
   * Sticky section heading, or null when the section is untitled.
   * @param {object} section
   * @returns {HTMLElement|null}
   */
  #buildSectionHead(section) {
    const el = VelvetComponent.el;
    if (!section.title) return null;
    return el("div", {
      cls: "vm-ms-section-head",
      children: [
        el("h2", { text: section.title }),
        section.badge ? el("span", { cls: "vm-ms-section-badge", text: section.badge }) : ""
      ].filter(Boolean)
    });
  }

  /**
   * One condition chip. Conditions that carry a value get a −/+ stepper, but
   * only while they are on — an off condition has no value to step, and the
   * buttons would just be dead weight under a thumb.
   * @param {object} condition
   * @returns {HTMLElement}
   */
  #buildConditionChip(condition) {
    const el = VelvetComponent.el;
    const hasValue = condition.active && condition.value !== null && condition.value !== undefined;

    const main = el("button", {
      cls: "vm-ms-condition-main",
      attrs: { type: "button", "aria-pressed": String(Boolean(condition.active)) },
      children: [
        condition.img
          ? el("img", { cls: "vm-ms-condition-img", attrs: { src: condition.img, alt: "", loading: "lazy" } })
          : "",
        el("span", { cls: "vm-ms-condition-label", text: condition.label }),
        hasValue ? el("span", { cls: "vm-ms-condition-value", text: String(condition.value) }) : ""
      ].filter(Boolean)
    });
    if (condition.onTap) this.#contentScope.listen(main, "click", () => condition.onTap());

    const steppers = [];
    const stepping = condition.active
      ? [["onDecrease", "fa-solid fa-minus", "−"], ["onIncrease", "fa-solid fa-plus", "+"]]
      : [];
    for (const [key, icon, sign] of stepping) {
      if (!condition[key]) continue;
      const btn = el("button", {
        cls: "vm-ms-condition-step",
        attrs: { type: "button", "aria-label": `${condition.label} ${sign}` },
        children: [VelvetComponent.icon(icon)]
      });
      this.#contentScope.listen(btn, "click", (e) => {
        e.stopPropagation();
        condition[key]();
      });
      steppers.push(btn);
    }

    const chip = el("div", {
      cls: `vm-ms-condition ${condition.active ? "vm-on" : ""}`.trim(),
      children: [main, ...steppers]
    });
    if (!condition.active) chip.dataset.off = "1";
    return chip;
  }

  /**
   * Condition chips: a wrapped cloud of toggles, the ones currently on first
   * so a player never has to hunt through forty greyed-out chips to see what
   * is actually affecting them.
   * @param {object} section
   * @returns {HTMLElement}
   */
  #buildConditions(section) {
    const el = VelvetComponent.el;
    const cloud = el("div", { cls: "vm-ms-conditions" });
    for (const condition of section.conditions ?? []) cloud.append(this.#buildConditionChip(condition));

    const children = [this.#buildSectionHead(section), cloud].filter(Boolean);
    const all = section.conditions ?? [];
    if (!all.length) {
      children.push(el("p", { cls: "vm-ms-empty", text: game.i18n.localize(`${L10N}.Sheet.Empty`) }));
    }

    /* A system's full status list runs to forty entries, which is ten rows of
       chips sitting on top of whatever the player actually opened the tab for.
       Collapsed, the section costs only the conditions currently in effect. */
    const off = all.filter((condition) => !condition.active).length;
    if (off) {
      const more = el("button", {
        cls: "vm-ms-condition-more",
        attrs: {
          type: "button",
          "aria-expanded": String(this.#conditionsOpen),
          "aria-label": game.i18n.localize(`${L10N}.Sheet.ConditionsShowAll`)
        },
        children: [el("span", { text: `+${off}` }), VelvetComponent.icon("fa-solid fa-chevron-down")]
      });
      this.#contentScope.listen(more, "click", () => {
        this.#conditionsOpen = !this.#conditionsOpen;
        this.#applyConditionsCollapse(cloud, more);
      });
      cloud.append(more);
      this.#applyConditionsCollapse(cloud, more);
    }
    return el("section", { cls: "vm-ms-section", children });
  }

  /**
   * Show or hide the inactive chips. Kept as a DOM toggle rather than a
   * re-render so expanding does not cost a model rebuild, and so the state
   * survives the HP ticks that call refresh() mid-combat.
   * @param {HTMLElement} cloud
   * @param {HTMLElement} more
   */
  #applyConditionsCollapse(cloud, more) {
    const open = this.#conditionsOpen;
    for (const chip of cloud.querySelectorAll('[data-off="1"]')) chip.hidden = !open;
    more.setAttribute("aria-expanded", String(open));
    more.classList.toggle("vm-open", open);
  }

  /** @param {object} section @returns {HTMLElement} */
  #buildSection(section, tab) {
    const el = VelvetComponent.el;
    const children = [this.#buildSectionHead(section)].filter(Boolean);
    const rows = section.rows ?? [];
    if (!rows.length) {
      children.push(el("p", { cls: "vm-ms-empty", text: game.i18n.localize(`${L10N}.Sheet.Empty`) }));
    }
    for (const row of rows) {
      try {
        children.push(this.#buildRow(row, section, tab));
      } catch (err) {
        Logger.error(`Mobile sheet: row "${row?.label}" failed to render`, err);
      }
    }
    return el("section", { cls: "vm-ms-section", children });
  }

  /** @param {object} row @returns {HTMLElement} */
  #buildRow(row, section, tab) {
    const el = VelvetComponent.el;
    const renderer = this.#renderer();
    const role = rowRole(tab, section, row);
    const defaultRenderer = renderer.id === "default";

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
            defaultRenderer && row.sub ? el("span", { cls: "vm-ms-row-sub", text: row.sub }) : ""
          ].filter(Boolean)
        }),
        defaultRenderer && row.badge ? el("span", { cls: "vm-ms-row-badge", text: row.badge }) : ""
      ].filter(Boolean)
    });
    if (row.onTap) this.#contentScope.listen(main, "click", () => row.onTap());
    // Secondary action: long press, or right-click for anyone testing on a
    // desktop with mobile mode forced on. A row with a menu opens it; a row
    // with one specific secondary action (a MAP variant, a carry change)
    // keeps that, because a menu of one is a worse version of the action.
    const onLong = row.menu?.length
      ? () => this.#promptRowMenu(row)
      : row.onLong;
    if (onLong) {
      this.#contentScope.gesture(main, "longpress", (g) => {
        if (g.phase === "ended") onLong();
      });
      this.#contentScope.listen(main, "contextmenu", (e) => {
        e.preventDefault();
        onLong();
      });
    }

    const trailing = (row.actions ?? []).map((action) => {
      const btn = el("button", {
        cls: `vm-ms-row-action ${action.active ? "vm-on" : ""}`.trim(),
        attrs: {
          type: "button",
          "aria-label": action.label,
          "data-tooltip": action.label,
          // A toggle rather than a command: say so, and say which way it is.
          ...(action.active === undefined ? {} : { "aria-pressed": String(Boolean(action.active)) })
        },
        children: [
          VelvetComponent.icon(action.icon),
          el("span", { cls: "vm-ms-row-action-label", text: action.label })
        ]
      });
      this.#contentScope.listen(btn, "click", (e) => {
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
        children: [
          VelvetComponent.icon("fa-solid fa-circle-info"),
          el("span", { cls: "vm-ms-row-action-label", text: "Info" })
        ]
      });
      this.#contentScope.listen(detailBtn, "click", async (e) => {
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

    // Every renderer composes the line itself (see rowLine in
    // system-renderers.mjs), so this hands over the pieces, not a layout.
    return renderer.row({
      el,
      row,
      section,
      tab,
      role,
      main,
      actions: [...trailing, detailBtn].filter(Boolean),
      detail,
      icon: VelvetComponent.icon
    });
  }

  /**
   * The long-press menu for a row: send to chat, edit, and whatever else the
   * adapter offers for that kind of item. This is the mobile stand-in for the
   * desktop's right-click menu, which a finger has no way to reach.
   * @param {object} row
   */
  async #promptRowMenu(row) {
    const entries = row.menu ?? [];
    if (!entries.length) return;
    try {
      navigator.vibrate?.(8);
    } catch { /* no haptics */ }
    let picked = null;
    try {
      picked = await foundry.applications.api.DialogV2.wait({
        window: { title: row.label },
        position: { width: 320 },
        buttons: entries.map((entry, index) => ({
          action: entry.id ?? `menu${index}`,
          label: entry.label,
          icon: entry.icon,
          default: index === 0,
          callback: () => index
        })),
        rejectClose: false
      });
    } catch (err) {
      Logger.debug("Row menu unavailable", err);
    }
    if (typeof picked === "number") await entries[picked]?.onTap?.();
  }

}
