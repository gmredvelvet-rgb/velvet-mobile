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

import { L10N, MODULE_ID } from "../core/constants.mjs";
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

  #inventoryFilter = "all";

  /** @type {Map<string, object[]>} Last result of each lazy section's load(). */
  #lazyCache = new Map();

  #inventoryQuery = "";

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
    this.#tabId = this.#tabs()[0].id;
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
      const tabs = this.#tabs();
      if (!tabs.some((tab) => tab.id === this.#tabId)) {
        this.#tabId = tabs[0]?.id ?? "";
      }
      this.#resetChromeScope();
      this.element.querySelector(".vm-ms-header")?.replaceWith(this.#buildHeader());
      if (!this.#isTaleSpire()) this.element.querySelector(":scope > .vm-ms-tabs")?.replaceWith(this.#buildTabBar());
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
    const chrome = this.#isTaleSpire()
      ? [this.#buildHeader()]
      : [this.#buildHeader(), this.#buildTabBar()];
    const root = el("section", {
      cls: this.#rootClass(),
      children: [...chrome, body]
    });

    // Swipe between tabs anywhere on the body — except from the left edge,
    // which the stack claims for the back gesture. Without this, dragging
    // back also skipped a tab on the way out.
    this.listen(body, "pointerdown", (event) => { this.#swipeStartX = event.clientX; }, { capture: true });
    this.gesture(body, "swipe", (g) => {
      if (g.direction !== "left" && g.direction !== "right") return;
      if (this.#swipeStartX <= BACK_EDGE) return;
      const tabs = this.#tabs();
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
    if (!this.#tabs().some((tab) => tab.id === this.#tabId)) this.#tabId = this.#tabs()[0]?.id ?? "";
    this.element.querySelector(".vm-ms-header")?.replaceWith(this.#buildHeader());
    for (const tabs of this.element.querySelectorAll(":scope > .vm-ms-tabs")) tabs.remove();
    if (!this.#isTaleSpire()) this.element.querySelector(".vm-ms-body")?.before(this.#buildTabBar());
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

  /** @returns {boolean} */
  #isTaleSpire() {
    return this.#renderer().id === "talespire";
  }

  /** TaleSpire exposes Skills and Biography as first-class navigation tabs. */
  #tabs() {
    const source = this.#model?.tabs ?? [];
    if (!this.#isTaleSpire()) return source;
    const tabs = source.map((tab) => ({ ...tab, sections: [...(tab.sections ?? [])] }));
    const stats = tabs.find((tab) => tab.id === "stats");
    const skillSections = stats?.sections.filter((section) => section.type === "skills") ?? [];
    if (stats) stats.sections = stats.sections.filter((section) => section.type !== "skills");
    if (skillSections.length) {
      const statsIndex = tabs.indexOf(stats);
      tabs.splice(statsIndex + 1, 0, {
        id: "skills",
        icon: "fa-solid fa-person-running",
        label: "Skills",
        sections: skillSections
      });
    }
    const biography = {
      id: "biography",
      icon: "fa-solid fa-book",
      label: "Biography",
      sections: [{ title: "Biography", rows: this.#model.biography ?? [] }]
    };
    const effectsIndex = tabs.findIndex((tab) => tab.id === "effects");
    tabs.splice(effectsIndex >= 0 ? effectsIndex : tabs.length, 0, biography);
    return tabs;
  }

  /** TaleSpire's reference sheet is Spanish; this mobile variant is English. */
  #taleSpireLabel(value, id = "") {
    const tabs = {
      stats: "Attributes",
      combat: "Actions",
      inventory: "Inventory",
      spells: "Spells",
      features: "Feats",
      crafting: "Crafting",
      effects: "Effects",
      biography: "Biography",
      skills: "Skills"
    };
    if (tabs[id]) return tabs[id];
    const key = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/gu, "").trim().toLowerCase();
    return ({
      atributos: "Attributes",
      inventario: "Inventory",
      biografia: "Biography",
      habilidades: "Skills",
      conjuros: "Spells",
      efectos: "Effects",
      acciones: "Actions",
      dotes: "Feats",
      "heridas y muerte": "Wounds and Dying",
      "puntos de heroe": "Hero Points",
      sentidos: "Senses",
      clases: "Classes",
      competencias: "Proficiencies",
      "tiradas de salvacion": "Saving Throws",
      recursos: "Resources"
    })[key] ?? String(value ?? "");
  }

  /** @returns {HTMLElement} */
  #buildHeader() {
    if (this.#isTaleSpire()) return this.#buildTaleSpireHeader();
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

  /** @returns {HTMLElement} */
  #buildTaleSpireHeader() {
    const el = VelvetComponent.el;
    const m = this.#model;
    const inventoryOpen = this.#tabId === "inventory";
    const level = this.actor.system?.details?.level?.value
      ?? this.actor.system?.details?.level
      ?? this.actor.system?.level?.value
      ?? this.actor.system?.level
      ?? "";
    const abilitySection = this.#tabs()
      .flatMap((tab) => tab.sections ?? [])
      .find((section) => section.type === "abilities");
    const abilities = abilitySection?.abilities ?? [];
    const framing = this.#portraitFraming();

    const close = el("button", {
      cls: "vm-ts-window-action vm-ts-close",
      attrs: { type: "button", "aria-label": "Close" },
      children: [VelvetComponent.icon("fa-solid fa-xmark"), el("span", { text: "Close" })]
    });
    this.#chromeScope.listen(close, "click", () => this.#onBack?.());

    const abilityStrip = el("div", { cls: "vm-ts-ability-strip" });
    for (const ability of abilities) {
      const button = el("button", {
        cls: `vm-ts-ability ${ability.onTap ? "vm-tappable" : ""}`.trim(),
        attrs: { type: "button", "aria-label": `${ability.label} ${ability.mod}` },
        children: [
          el("span", { cls: "vm-ts-ability-mod", text: ability.mod }),
          el("span", { cls: "vm-ts-ability-label", text: ability.label })
        ]
      });
      if (ability.onTap) this.#chromeScope.listen(button, "click", () => ability.onTap());
      abilityStrip.append(button);
    }

    if (!abilities.length) {
      for (const stat of m.stats ?? []) {
        abilityStrip.append(el("div", {
          cls: "vm-ts-ability",
          children: [
            el("span", { cls: "vm-ts-ability-mod", text: String(stat.value) }),
            el("span", { cls: "vm-ts-ability-label", text: stat.label })
          ]
        }));
      }
    }

    const hp = m.hp ? this.#buildHpBar(m.hp) : el("div", { cls: "vm-ms-hp vm-ms-hp-none" });
    const temp = m.hp?.temp ?? 0;
    const tempHp = el("button", {
      cls: `vm-ts-temp-hp ${temp > 0 ? "vm-on" : ""}`.trim(),
      attrs: { type: "button", "aria-label": `Temp HP ${temp}`, ...(m.applyTempHp ? {} : { disabled: "" }) },
      children: [el("span", { text: "Temp HP" }), el("b", { text: String(temp) })]
    });
    if (m.applyTempHp) this.#chromeScope.listen(tempHp, "click", () => this.#promptTempHp());

    const characterType = this.actor.type === "npc" ? "Non-Player Character" : "Player Character";
    const content = [
      el("div", {
        cls: "vm-ts-windowbar",
        children: [
          el("span", { cls: "vm-ts-window-title", text: this.actor.name }),
          el("div", {
            cls: "vm-ts-window-actions",
            children: [
              el("span", { cls: "vm-ts-window-action", children: [VelvetComponent.icon("fa-solid fa-gear"), el("span", { text: "Sheet" })] }),
              el("span", { cls: "vm-ts-window-action", children: [VelvetComponent.icon("fa-solid fa-volume-high"), el("span", { text: "Sounds" })] }),
              el("span", { cls: "vm-ts-window-action", children: [VelvetComponent.icon("fa-solid fa-user-gear"), el("span", { text: "Configure" })] }),
              close
            ]
          })
        ]
      }),
      el("div", {
        cls: "vm-ts-identity",
        children: [
          el("div", { cls: "vm-ts-level", children: [el("span", { text: String(level || "—") })] }),
          el("div", {
            cls: "vm-ts-nameplate",
            children: [el("h1", { text: this.actor.name }), el("p", { text: m.subtitle ?? "" })]
          }),
          el("div", {
            cls: "vm-ts-identity-tools",
            children: ["fa-image", "fa-shield-halved", "fa-lock"].map((icon) => el("span", {
              cls: "vm-ts-tool",
              children: [VelvetComponent.icon(`fa-solid ${icon}`)]
            }))
          })
        ]
      }),
      el("div", {
        cls: "vm-ts-actor-switcher",
        children: [
          VelvetComponent.icon("fa-solid fa-users"),
          el("span", { text: `${this.actor.name} · ${characterType}` }),
          VelvetComponent.icon("fa-solid fa-chevron-down")
        ]
      }),
      this.#buildTabBar()
    ];

    if (!inventoryOpen) {
      const portraitSettings = game.user?.isGM ? el("button", {
        cls: "vm-ts-portrait-tool vm-ts-portrait-right",
        attrs: { type: "button", "aria-label": "Adjust portrait", title: "Adjust portrait" },
        children: [VelvetComponent.icon("fa-solid fa-gear")]
      }) : "";
      if (portraitSettings) this.#chromeScope.listen(portraitSettings, "click", () => this.#promptPortraitFraming());
      content.push(
        el("div", {
          cls: "vm-ts-portrait",
          children: [
            el("img", {
              attrs: {
                src: this.actor.img || "icons/svg/mystery-man.svg",
                alt: this.actor.name,
                style: `object-position:${framing.x}% ${framing.y}%;object-fit:${framing.fit};`
              }
            }),
            el("span", { cls: "vm-ts-portrait-tool vm-ts-portrait-left", children: [VelvetComponent.icon("fa-solid fa-shield-halved")] }),
            portraitSettings
          ]
        }),
        abilityStrip,
        el("div", { cls: "vm-ts-health", children: [hp, tempHp] }),
        el("div", { cls: "vm-ts-health-rule" })
      );
    }

    return el("header", {
      cls: "vm-ms-header vm-ts-header",
      // Rebuilt on every tab change, so CSS can size the portrait per tab.
      attrs: { "data-tab": this.#tabId },
      children: content
    });
  }

  #portraitFraming() {
    let saved = null;
    try {
      saved = this.actor.getFlag?.(MODULE_ID, "portraitFraming") ?? null;
    } catch { /* Actors without flag access keep the default framing. */ }
    const clamp = (value, fallback) => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : fallback));
    return {
      x: clamp(saved?.x, 50),
      y: clamp(saved?.y, 22),
      fit: saved?.fit === "contain" ? "contain" : "cover"
    };
  }

  async #promptPortraitFraming() {
    if (!game.user?.isGM) return;
    const current = this.#portraitFraming();
    const image = this.actor.img || "icons/svg/mystery-man.svg";
    const escape = (value) => {
      const span = document.createElement("span");
      span.textContent = String(value ?? "");
      return span.innerHTML;
    };
    const read = (button) => ({
      x: Number(button.form?.elements["vm-portrait-x"]?.value ?? 50),
      y: Number(button.form?.elements["vm-portrait-y"]?.value ?? 50),
      fit: button.form?.elements["vm-portrait-fit"]?.value === "contain" ? "contain" : "cover"
    });
    const syncPreview = (form) => {
      if (!form) return;
      const x = Number(form.elements["vm-portrait-x"]?.value ?? 50);
      const y = Number(form.elements["vm-portrait-y"]?.value ?? 50);
      const fit = form.elements["vm-portrait-fit"]?.value === "contain" ? "contain" : "cover";
      const preview = form.querySelector("[data-vm-portrait-preview]");
      if (preview) {
        preview.style.objectPosition = `${x}% ${y}%`;
        preview.style.objectFit = fit;
      }
      const xValue = form.querySelector("[data-vm-portrait-x-value]");
      const yValue = form.querySelector("[data-vm-portrait-y-value]");
      if (xValue) xValue.textContent = `${x}%`;
      if (yValue) yValue.textContent = `${y}%`;
    };
    const onInput = (event) => {
      if (!event.target?.matches?.('[name^="vm-portrait-"]')) return;
      syncPreview(event.target.form ?? event.target.closest("form"));
    };
    const onClick = (event) => {
      const control = event.target?.closest?.("[data-vm-portrait-command]");
      if (!control) return;
      const form = control.form ?? control.closest("form");
      if (!form) return;
      event.preventDefault();
      const command = control.dataset.vmPortraitCommand;
      if (command === "center") {
        form.elements["vm-portrait-x"].value = 50;
        form.elements["vm-portrait-y"].value = 50;
      } else if (command === "fit") {
        form.elements["vm-portrait-x"].value = 50;
        form.elements["vm-portrait-y"].value = 50;
        form.elements["vm-portrait-fit"].value = "contain";
      }
      syncPreview(form);
    };
    let result = null;
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    document.addEventListener("click", onClick, true);
    try {
      result = await foundry.applications.api.DialogV2.wait({
        window: { title: "Adjust Portrait" },
        position: { width: 360 },
        content: `
          <div style="display:grid;gap:10px">
            <div style="height:130px;overflow:hidden;background:#050403;border:1px solid #6b5a33">
              <img data-vm-portrait-preview src="${escape(image)}" alt="" style="width:100%;height:100%;object-fit:${current.fit};object-position:${current.x}% ${current.y}%;border:0">
            </div>
            <label style="display:grid;grid-template-columns:80px 1fr 38px;align-items:center;gap:8px">Horizontal
              <input type="range" name="vm-portrait-x" min="0" max="100" step="1" value="${current.x}">
              <output data-vm-portrait-x-value>${current.x}%</output>
            </label>
            <label style="display:grid;grid-template-columns:80px 1fr 38px;align-items:center;gap:8px">Vertical
              <input type="range" name="vm-portrait-y" min="0" max="100" step="1" value="${current.y}">
              <output data-vm-portrait-y-value>${current.y}%</output>
            </label>
            <label style="display:grid;grid-template-columns:80px 1fr;align-items:center;gap:8px">Display
              <select name="vm-portrait-fit">
                <option value="cover" ${current.fit === "cover" ? "selected" : ""}>Fill frame (may crop)</option>
                <option value="contain" ${current.fit === "contain" ? "selected" : ""}>Fit entire image</option>
              </select>
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              <button type="button" data-vm-portrait-command="center"><i class="fa-solid fa-crosshairs"></i> Center</button>
              <button type="button" data-vm-portrait-command="fit"><i class="fa-solid fa-expand"></i> Fit entire image</button>
            </div>
          </div>`,
        buttons: [
          { action: "save", label: "Save", icon: "fa-solid fa-check", default: true, callback: (_event, button) => read(button) }
        ],
        rejectClose: false
      });
    } catch (err) {
      Logger.debug("Portrait framing dialog unavailable", err);
    } finally {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
      document.removeEventListener("click", onClick, true);
    }
    if (!result) return;
    await this.actor.setFlag(MODULE_ID, "portraitFraming", result);
    this.refresh();
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
    for (const tab of this.#tabs()) {
      const label = this.#isTaleSpire() ? this.#taleSpireLabel(tab.label, tab.id) : tab.label;
      const btn = el("button", {
        cls: `vm-ms-tab ${tab.id === this.#tabId ? "vm-active" : ""}`.trim(),
        attrs: { type: "button", "data-tab": tab.id, "aria-label": label },
        children: [VelvetComponent.icon(tab.icon), el("span", { text: label })]
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
    if (this.#isTaleSpire()) {
      this.#resetChromeScope();
      this.element.querySelector(".vm-ms-header")?.replaceWith(this.#buildHeader());
    }
    this.#renderTab(tabId);
  }

  /** @param {string} tabId */
  #renderTab(tabId) {
    const body = this.element?.querySelector(".vm-ms-body");
    const tab = this.#tabs().find((entry) => entry.id === tabId);
    if (!body || !tab) return;
    this.#resetContentScope();
    body.replaceChildren();
    body.dataset.tab = tabId;
    body.scrollTop = 0;
    if (this.#isTaleSpire() && tab.id === "inventory" && this.#model.paperDoll) {
      body.append(this.#buildPaperDoll(this.#model.paperDoll));
      body.append(this.#buildInventoryTools(this.#model.paperDoll));
    }
    const slotted = this.#isTaleSpire() && tab.id === "inventory"
      ? new Set(this.#model.paperDoll?.slottedIds ?? [])
      : null;
    for (const section of tab.sections ?? []) {
      if (this.#isTaleSpire() && section.type === "abilities") continue;
      if (typeof section.load === "function") {
        body.append(...this.#buildLazySection(section, tab));
        continue;
      }
      const displaySection = slotted && section.rows
        ? { ...section, rows: section.rows.filter((row) => !slotted.has(row.id)) }
        : section;
      // One broken section must never take the whole sheet down.
      try {
        body.append(this.#buildBySection(displaySection, tab));
      } catch (err) {
        Logger.error(`Mobile sheet: section "${section.title ?? section.type}" failed to render`, err);
      }
    }
    if (this.#isTaleSpire() && tab.id === "inventory") this.#applyInventoryFilter();
  }

  /**
   * A section whose content needs an async lookup — PF2e resolves formulas
   * from compendium UUIDs. `load()` resolves to the sections to show. Until
   * it does, the previous result stands in (or a loading line the first
   * time), so a refresh after each tap keeps the list, and its scroll, put.
   * @param {object} section
   * @param {object} tab
   * @returns {HTMLElement[]}
   */
  #buildLazySection(section, tab) {
    const el = VelvetComponent.el;
    const key = `${this.actor.uuid}:${tab.id}:${section.title}`;
    const build = (sections) => sections.flatMap((entry) => {
      try {
        return [this.#buildBySection(entry, tab)];
      } catch (err) {
        Logger.error(`Mobile sheet: section "${entry.title ?? entry.type}" failed to render`, err);
        return [];
      }
    });
    const cached = this.#lazyCache.get(key);
    let nodes = cached ? build(cached) : [];
    if (!nodes.length) {
      nodes = [el("section", {
        cls: "vm-ms-section",
        children: [
          this.#buildSectionHead(section),
          el("p", { cls: "vm-ms-empty", text: game.i18n.localize(`${L10N}.Sheet.Loading`) })
        ].filter(Boolean)
      })];
    }
    const scope = this.#contentScope;
    section.load().then((sections) => {
      // The tab re-rendered meanwhile: that render loads its own.
      if (scope !== this.#contentScope || !nodes[0]?.isConnected) return;
      this.#lazyCache.set(key, sections ?? []);
      const fresh = build(sections ?? []);
      nodes[0].replaceWith(...fresh);
      for (const node of nodes.slice(1)) node.remove();
    }).catch((err) => {
      Logger.error(`Mobile sheet: section "${section.title}" failed to load`, err);
      const empty = nodes[0]?.querySelector?.(".vm-ms-empty");
      if (empty && !cached) empty.textContent = game.i18n.localize(`${L10N}.Sheet.Empty`);
    });
    return nodes;
  }

  /** @param {object} doll @returns {HTMLElement} */
  #buildPaperDoll(doll) {
    const el = VelvetComponent.el;
    const framing = this.#portraitFraming();
    const board = el("section", {
      cls: "vm-ts-paperdoll",
      attrs: { "aria-label": "Equipped items" },
      children: [
        doll.backdrop ? el("img", {
          cls: "vm-ts-paperdoll-backdrop",
          attrs: {
            src: doll.backdrop,
            alt: "",
            style: `object-position:${framing.x}% ${framing.y}%;object-fit:${framing.fit};`
          }
        }) : "",
        el("img", {
          cls: "vm-ts-paperdoll-tray",
          attrs: {
            src: "modules/velvet-mobile/assets/talespire/slots/frame-consumables.png",
            alt: ""
          }
        })
      ].filter(Boolean)
    });

    for (const slot of doll.slots ?? []) {
      const button = el("button", {
        cls: `vm-ts-slot ${slot.item ? "vm-filled" : ""}`.trim(),
        attrs: {
          type: "button",
          title: slot.item?.name ?? slot.label,
          "aria-label": slot.item ? `${slot.label}: ${slot.item.name}` : slot.label,
          "data-slot": slot.key,
          style: `--ts-x:${slot.x}%;--ts-y:${slot.y}%;--ts-w:${slot.w}%;--ts-h:${slot.h}%;`
        },
        children: [
          slot.frame ? el("img", { cls: "vm-ts-slot-frame", attrs: { src: slot.frame, alt: "" } }) : "",
          slot.art ? el("img", { cls: "vm-ts-slot-art", attrs: { src: slot.art, alt: "" } }) : "",
          slot.item ? el("img", { cls: "vm-ts-slot-item", attrs: { src: slot.item.img, alt: slot.item.name, loading: "lazy" } }) : "",
          slot.item?.qty ? el("span", { cls: "vm-ts-slot-qty", text: String(slot.item.qty) }) : "",
          el("span", { cls: "vm-ts-slot-label", text: slot.label })
        ].filter(Boolean)
      });
      this.#contentScope.listen(button, "click", () => this.#promptPaperDollSlot(doll, slot));
      if (slot.item) {
        this.#contentScope.gesture(button, "longpress", (gesture) => {
          if (gesture.phase === "ended") doll.openItem?.(slot.item.id);
        });
        this.#contentScope.listen(button, "contextmenu", (event) => {
          event.preventDefault();
          doll.openItem?.(slot.item.id);
        });
      }
      board.append(button);
    }
    return board;
  }

  async #promptPaperDollSlot(doll, slot) {
    const escape = (value) => {
      const span = document.createElement("span");
      span.textContent = String(value ?? "");
      return span.innerHTML;
    };
    const options = (doll.candidates ?? []).map((item) => (
      `<option value="${escape(item.id)}" ${item.id === slot.item?.id ? "selected" : ""}>${escape(item.name)} · ${escape(item.type)}</option>`
    )).join("");
    let result = null;
    try {
      result = await foundry.applications.api.DialogV2.wait({
        window: { title: slot.label },
        position: { width: 330 },
        content: `<select name="vm-paperdoll-item" style="width:100%;height:36px"><option value="">Empty</option>${options}</select>`,
        buttons: [
          { action: "clear", label: "Clear", icon: "fa-solid fa-xmark", callback: () => ({ itemId: "" }) },
          {
            action: "equip",
            label: "Assign",
            icon: "fa-solid fa-shield-halved",
            default: true,
            callback: (_event, button) => ({ itemId: button.form?.elements["vm-paperdoll-item"]?.value ?? "" })
          }
        ],
        rejectClose: false
      });
    } catch (err) {
      Logger.debug("Paper doll slot dialog unavailable", err);
    }
    if (!result) return;
    await doll.assign?.(slot.key, result.itemId);
    this.refresh();
  }

  /** @param {object} doll @returns {HTMLElement} */
  #buildInventoryTools(doll) {
    const el = VelvetComponent.el;
    const coins = el("div", {
      cls: "vm-ts-coins",
      children: (doll.currency ?? []).map((coin) => el("div", {
        cls: `vm-ts-coin vm-ts-coin-${coin.key}`,
        children: [el("b", { text: String(coin.value) }), el("span", { text: coin.key.toUpperCase() })]
      }))
    });
    const filterBar = el("div", { cls: "vm-ts-inventory-filterbar" });
    const filters = [
      ["all", "fa-border-all", "All"],
      ["weapon", "fa-sword", "Weapons"],
      ["armor", "fa-shield-halved", "Armor"],
      ["consumable", "fa-flask", "Consumables"],
      ["equipment", "fa-briefcase", "Equipment"]
    ];
    for (const [key, icon, label] of filters) {
      const button = el("button", {
        cls: `vm-ts-filter ${this.#inventoryFilter === key ? "vm-active" : ""}`.trim(),
        attrs: { type: "button", "aria-label": label, "data-filter": key },
        children: [VelvetComponent.icon(`fa-solid ${icon}`)]
      });
      this.#contentScope.listen(button, "click", () => {
        this.#inventoryFilter = key;
        for (const entry of filterBar.querySelectorAll(".vm-ts-filter")) entry.classList.toggle("vm-active", entry === button);
        this.#applyInventoryFilter();
      });
      filterBar.append(button);
    }
    const attunement = doll.attunement ?? { value: 0, max: 0 };
    filterBar.append(el("span", {
      cls: "vm-ts-attunement",
      children: [VelvetComponent.icon("fa-solid fa-sun"), el("b", { text: `${attunement.value}/${attunement.max}` })]
    }));
    const search = el("label", {
      cls: "vm-ts-inventory-search",
      children: [
        VelvetComponent.icon("fa-solid fa-magnifying-glass"),
        el("input", { attrs: { type: "search", placeholder: "Search items…", value: this.#inventoryQuery } })
      ]
    });
    const input = search.querySelector("input");
    this.#contentScope.listen(input, "input", () => {
      this.#inventoryQuery = input.value.trim().toLowerCase();
      this.#applyInventoryFilter();
    });
    return el("section", { cls: "vm-ts-inventory-tools", children: [coins, filterBar, search] });
  }

  #applyInventoryFilter() {
    const query = this.#inventoryQuery;
    const filter = this.#inventoryFilter;
    for (const row of this.element?.querySelectorAll(".vm-ts-inventory-items .vm-sys-row-talespire") ?? []) {
      const text = `${row.dataset.vmName ?? ""} ${row.dataset.vmMeta ?? ""}`;
      row.hidden = Boolean(query && !text.includes(query)) || (filter !== "all" && !text.includes(filter));
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
        el("h2", { text: this.#isTaleSpire() ? this.#taleSpireLabel(section.title) : section.title }),
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
      children.push(el("p", { cls: "vm-ms-empty", text: section.empty ?? game.i18n.localize(`${L10N}.Sheet.Empty`) }));
    }
    for (const row of rows) {
      try {
        children.push(this.#buildRow(row, section, tab));
      } catch (err) {
        Logger.error(`Mobile sheet: row "${row?.label}" failed to render`, err);
      }
    }
    const inventoryItems = this.#isTaleSpire()
      && tab?.id === "inventory"
      && this.#taleSpireLabel(section.title) !== "Currency";
    return el("section", {
      cls: `vm-ms-section ${inventoryItems ? "vm-ts-inventory-items" : ""}`.trim(),
      children
    });
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
    const { detailBtn, detail, show } = row.description ? this.#buildDetail(row, tab) : {};
    // A row with nothing to use (a passive feat, a deity) reads its
    // description on tap instead of doing nothing.
    const onTap = row.onTap ?? show;
    if (onTap) this.#contentScope.listen(main, "click", () => onTap());
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
      detail: detail ?? null,
      icon: VelvetComponent.icon
    });
  }

  /**
   * The ⓘ button for a row with a description, the block it expands in place
   * (unless it opens the inspector), and the function that shows it.
   * @param {object} row
   * @param {object} tab
   * @returns {{detailBtn: HTMLElement, detail: HTMLElement|null, show: () => void}}
   */
  #buildDetail(row, tab) {
    const el = VelvetComponent.el;
    const detailBtn = el("button", {
      cls: "vm-ms-row-action",
      attrs: { type: "button", "aria-label": "info" },
      children: [
        VelvetComponent.icon("fa-solid fa-circle-info"),
        el("span", { cls: "vm-ms-row-action-label", text: "Info" })
      ]
    });
    let detail = null;
    let show;
    // TaleSpire inventory cells are fixed-size and clip their content, so
    // there the description opens in an inspector, as in the original sheet.
    // Biography entries are prose and keep reading in place.
    if (this.#isTaleSpire() && tab?.id !== "biography") {
      show = () => this.#openInspector(row, detailBtn);
    } else {
      detail = el("div", { cls: "vm-ms-row-detail", attrs: { hidden: "" } });
      show = async () => {
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
      };
    }
    this.#contentScope.listen(detailBtn, "click", (e) => {
      e.stopPropagation();
      show();
    });
    return { detailBtn, detail, show };
  }

  /**
   * The TaleSpire item inspector: art, type and description in a modal, with
   * the row's commands underneath. Lives on the sheet root, so an actor
   * refresh behind it leaves it open and closing the sheet removes it.
   * @param {object} row
   * @param {HTMLElement} trigger  Refocused when the inspector closes.
   */
  async #openInspector(row, trigger) {
    const el = VelvetComponent.el;
    const t = (key) => game.i18n.localize(`${L10N}.Sheet.${key}`);
    this.element?.querySelector(".vm-ts-inspector")?.close();

    // Use first, then the row's own buttons, then its long-press menu —
    // minus repeats (PF2e offers Carry in both).
    const commands = [];
    const seen = new Set();
    for (const entry of [
      row.onTap ? {
        icon: row.useIcon ?? "fa-solid fa-hand-sparkles",
        label: row.useLabel ?? t("Use"),
        onTap: row.onTap
      } : null,
      ...(row.actions ?? []),
      ...(row.menu ?? [])
    ]) {
      if (!entry?.onTap || seen.has(entry.label)) continue;
      seen.add(entry.label);
      commands.push(entry);
    }

    const close = el("button", {
      cls: "vm-ts-inspector-close",
      attrs: { type: "button", "aria-label": game.i18n.localize("Close") },
      children: [VelvetComponent.icon("fa-solid fa-xmark")]
    });
    const body = el("div", { cls: "vm-ts-inspector-body", attrs: { "aria-live": "polite" }, text: t("Loading") });
    const footer = el("footer", { cls: "vm-ts-inspector-footer" });
    const dialog = el("dialog", {
      cls: "vm-ts-inspector",
      attrs: { "aria-label": row.label },
      children: [
        el("header", {
          cls: "vm-ts-inspector-header",
          children: [
            row.img ? el("img", { attrs: { src: row.img, alt: "" } }) : "",
            el("div", {
              cls: "vm-ts-inspector-title",
              children: [
                row.sub ? el("small", { text: row.sub }) : "",
                el("h2", { text: row.label }),
                row.badge ? el("span", { cls: "vm-ts-inspector-badge", text: row.badge }) : ""
              ].filter(Boolean)
            }),
            close
          ].filter(Boolean)
        }),
        body,
        commands.length ? footer : ""
      ].filter(Boolean)
    });

    for (const command of commands) {
      const button = el("button", {
        attrs: { type: "button" },
        children: [VelvetComponent.icon(command.icon), el("span", { text: command.label })]
      });
      button.addEventListener("click", () => {
        dialog.close();
        command.onTap();
      });
      footer.append(button);
    }
    close.addEventListener("click", () => dialog.close());
    // A tap on the dimmed area outside the panel lands on the dialog itself.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    // Keep Foundry's keybindings (Escape closes sheets) out of the modal.
    dialog.addEventListener("keydown", (event) => event.stopPropagation());
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (trigger.isConnected) trigger.focus();
    }, { once: true });

    this.element.append(dialog);
    dialog.showModal();
    try {
      const html = await row.description();
      if (dialog.isConnected) body.innerHTML = html || `<p><em>${t("Empty")}</em></p>`;
    } catch (err) {
      Logger.error(`Mobile sheet: description for "${row.label}" failed`, err);
      if (dialog.isConnected) body.textContent = t("Empty");
    }
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
