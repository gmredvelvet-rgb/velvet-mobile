/**
 * Velvet Mobile — SheetShell (Swipe-style).
 *
 * The whole mobile experience, modeled after Swipe VTT's sheets-only mode:
 * Foundry's chrome and canvas disappear and the client becomes a phone app
 * around the character sheet.
 *
 *  - Home screen: the scene's artwork (or a dark gradient) under a vignette,
 *    with an avatar carousel at the bottom. Tapping an avatar — or swiping
 *    up from the bottom edge — slides the actor's sheet up as a drawer.
 *  - The sheet drawer fills the viewport. A grip at the top can be dragged
 *    down to dismiss it back to the home screen.
 *  - A floating button stack (bottom-right) offers a dice roller (multi-die
 *    picker), the chat panel and the settings escape hatch — always on top,
 *    even while the sheet is open.
 *  - Chat opens as a bottom sheet hosting Foundry's real chat log. New
 *    messages can auto-open it (setting) and it auto-hides after a delay.
 *
 * Everything reverses cleanly on disable().
 *
 * @module shell/sheet-shell
 */

import { DEVICES, HOOKS, L10N, MODULE_ID, ROOT_ATTRS } from "../core/constants.mjs";
import { Logger } from "../core/logger.mjs";
import { services } from "../core/services.mjs";
import { Settings } from "../core/settings.mjs";
import { VelvetComponent } from "../components/component.mjs";
import { BottomSheet } from "../components/bottom-sheet.mjs";
import { Joystick } from "../components/joystick.mjs";
import { Motion, DURATION } from "../motion/animation-engine.mjs";
import { modelFor } from "../sheet/adapters.mjs";
import { MobileSheet } from "../sheet/mobile-sheet.mjs";
import { ChromeHider } from "./chrome-hider.mjs";

/** Class marking the drawer-presented sheet (CSS contract). */
const PINNED_CLS = "vm-pinned";

/** Drag distance (fraction of height) or velocity (px/ms) that dismisses the drawer. */
const DISMISS_FRACTION = 0.28;
const DISMISS_VELOCITY = 0.5;

/** Dice offered by the roller, in display order. */
const DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];

export class SheetShell {
  /** @type {string} */
  name = "shell";

  /** @type {boolean} */
  #active = false;

  /** @type {Error|null} Why the last startup attempt failed, for diagnostics. */
  #lastError = null;

  /** @type {ChromeHider} Hides Foundry's UI without depending on its markup. */
  #chrome = new ChromeHider();

  /** @returns {Error|null} */
  get lastError() {
    return this.#lastError;
  }

  /** @type {[string, number][]} Registered hook handles for symmetric teardown. */
  #hooks = [];

  /** @type {string|null} Id of the selected actor. */
  #actorId = null;

  /** @type {object|null} The drawer-presented Foundry sheet (fallback path). */
  #app = null;

  /** @type {MobileSheet|null} Our native mobile sheet (supported systems). */
  #msheet = null;

  /** @type {Set<string>} Actors whose mobile sheet crashed — use the native sheet instead. */
  #msheetFailed = new Set();

  /** @type {(() => void)|null} Restores the app's setPosition. */
  #unpinApp = null;

  /** @type {(() => void)[]} Gesture unsubscribers tied to the current drawer. */
  #drawerGestures = [];

  /** @type {(() => void)|null} Swipe-up-to-open unsubscriber. */
  #offSwipeUp = null;

  /** @type {HTMLElement|null} Home screen (background + vignette). */
  #home = null;

  /** @type {HTMLElement|null} Avatar carousel. */
  #carousel = null;

  /** @type {HTMLElement|null} Floating button stack. */
  #stack = null;

  /** @type {HTMLElement|null} Expandable dice bar. */
  #diceBar = null;

  /** @type {Record<string, number>} Selected dice counts. */
  #dice = {};

  /** @type {HTMLElement|null} Unread-chat indicator inside the stack. */
  #chatDot = null;

  /** @type {HTMLElement|null} "No actor" overlay. */
  #empty = null;

  /** @type {HTMLElement|null} First-run swipe hint pill. */
  #hint = null;

  /** @type {number|null} rAF id throttling carousel proximity updates. */
  #proxRaf = null;

  /** @type {Joystick|null} Token-movement stick (toggled from the speed-dial). */
  #joystick = null;

  /** @type {HTMLElement|null} Zoom ± buttons, shown alongside the joystick. */
  #zoom = null;

  /** @type {BottomSheet|null} Target picker panel. */
  #targetSheet = null;

  /** @type {number} Throttles the "no token" warning. */
  #lastTokenWarn = 0;

  /** @type {BottomSheet|null} */
  #combatSheet = null;

  /** @type {{parent: HTMLElement, next: Node|null}|null} Original tracker placement. */
  #combatHome = null;

  /** @type {BottomSheet|null} */
  #chatSheet = null;

  /** @type {{parent: HTMLElement, next: Node|null}|null} Original chat placement. */
  #chatHome = null;

  /** @type {number|null} Auto-hide timer for the auto-opened chat panel. */
  #chatHideTimer = null;

  /** @type {AbortController|null} Listeners tied to the open chat panel. */
  #chatAbort = null;

  /** @param {object} profile @returns {boolean} */
  shouldEnable(profile) {
    return profile.device !== DEVICES.DESKTOP;
  }

  enable() {
    this.#active = true;
    this.#lastError = null;
    try {
      this.#build();
    } catch (err) {
      // Foundry's UI is hidden only once ours exists, so a failure here
      // reveals the desktop UI instead of leaving a black screen.
      Logger.error("Shell failed to start — reverting to the desktop interface", err);
      ui.notifications?.error(`Velvet Mobile: ${err?.message ?? err}`, { permanent: true });
      this.#lastError = err;
      this.disable();
      // Rethrow so the registry records this service as disabled rather
      // than reporting a shell that silently reverted itself as running.
      throw err;
    }
    // The sheet is the last step: if a system adapter explodes, the user
    // still gets the shell (map, carousel, buttons) rather than nothing.
    try {
      if (this.actor) this.openSheet();
      else this.#showEmptyState();
    } catch (err) {
      Logger.error("Could not open the character sheet", err);
      ui.notifications?.warn(`Velvet Mobile: ${err?.message ?? err}`);
    }
  }

  /** Build every surface and take over the screen. Throws on failure. */
  #build() {
    this.#registerHooks();

    this.#actorId = this.#initialActor()?.id ?? null;
    this.#buildHome();
    this.#buildCarousel();
    this.#buildStack();

    // Our UI exists — now Foundry's can go. The attribute drives the CSS
    // rules; ChromeHider covers whatever the markup moved or renamed.
    const root = document.documentElement;
    root.setAttribute(ROOT_ATTRS.SHEET_ONLY, "");
    if (Settings.map) root.setAttribute(ROOT_ATTRS.MAP, "");
    else this.#freezeCanvas(true);
    this.#chrome.enable();
    this.#sweepOpenWindows();
    // canvasReady already fired before the shell enabled: claim the token now.
    this.#controlToken();

    // Swipe up from the bottom edge opens the selected actor's sheet.
    this.#offSwipeUp = services.gestures?.on(document.body, "edgeswipe", () => {
      if (!this.#app && !this.#msheet && !this.#chatSheet && this.actor) this.openSheet();
    }, { edge: "bottom" }) ?? null;
  }

  #registerHooks() {
    this.#hook("renderActorSheet", (app) => this.#onRenderSheet(app));
    this.#hook("renderActorSheetV2", (app) => this.#onRenderSheet(app));
    this.#hook("closeActorSheet", (app) => this.#onCloseSheet(app));
    this.#hook("closeActorSheetV2", (app) => this.#onCloseSheet(app));
    this.#hook("createChatMessage", (message) => this.#onChatMessage(message));
    this.#hook("canvasReady", () => {
      if (!Settings.map) this.#freezeCanvas(true);
      this.#refreshHome();
      this.#refreshCarousel();
      // Vision on fogged scenes needs a controlled token; players cannot
      // click one without a desktop UI, so take care of it for them.
      this.#controlToken();
    });
    this.#hook("createToken", () => this.#refreshCarousel());
    this.#hook("deleteToken", () => this.#refreshCarousel());
    this.#hook("updateActor", (actor) => this.#onActorUpdate(actor));
    // Item changes (equip, quantity, new loot…) refresh the open mobile sheet.
    const onItemChange = (item) => {
      if (this.#msheet && item?.actor?.id === this.#msheet.actor?.id) this.#msheet.refresh();
    };
    this.#hook("updateItem", onItemChange);
    this.#hook("createItem", onItemChange);
    this.#hook("deleteItem", onItemChange);
    // Light the crosshair button while anything is targeted.
    this.#hook("targetToken", () => this.#refreshTargetState());
    // Roll prompts that linger stack up and bury each other on a phone.
    this.#hook("renderApplicationV2", (app, element) => this.#autoCloseRollPrompt(app, element));
    this.#hook("renderApplication", (app, html) => this.#autoCloseRollPrompt(app, html));
  }

  /**
   * Close an attack/roll prompt once a choice is made, so the damage prompt
   * that follows is not stacked behind a dead window.
   *
   * The prompt is recognised by its choices (advantage / disadvantage /
   * normal / critical) rather than by class names, which differ per system
   * and version. `close()` is harmless if the system already closed it.
   * @param {object} app
   * @param {HTMLElement|object} element  AppV2 passes an element, AppV1 jQuery.
   */
  #autoCloseRollPrompt(app, element) {
    const root = element instanceof HTMLElement ? element : element?.[0];
    const choices = "button[data-action='advantage'], button[data-action='disadvantage'],"
      + " button[data-action='normal'], button[data-action='critical']";
    if (!root?.querySelector?.(choices)) return;

    root.addEventListener("click", (event) => {
      if (!event.target.closest("button")) return;
      setTimeout(() => {
        try {
          app.close?.();
        } catch { /* already gone */ }
      }, 200);
    }, { once: true });
  }

  disable() {
    this.#active = false;
    for (const [name, id] of this.#hooks) Hooks.off(name, id);
    this.#hooks.length = 0;

    this.closeChat();
    this.closeCombat();
    this.#collapseDiceBar();
    this.#hideJoystick();
    this.#targetSheet?.dismiss();
    this.#offSwipeUp?.();
    this.#offSwipeUp = null;
    if (this.#proxRaf) cancelAnimationFrame(this.#proxRaf);
    this.#proxRaf = null;
    for (const el of [this.#home, this.#carousel, this.#stack, this.#empty, this.#hint]) el?.remove();
    this.#home = this.#carousel = this.#stack = this.#chatDot = this.#empty = this.#hint = null;
    this.#msheet?.destroy();
    this.#msheet = null;
    this.#undecorate();

    this.#chrome.disable();
    this.#freezeCanvas(false);
    const root = document.documentElement;
    root.removeAttribute(ROOT_ATTRS.SHEET_ONLY);
    root.removeAttribute(ROOT_ATTRS.DRAWER);
    root.removeAttribute(ROOT_ATTRS.MAP);
  }

  /** @returns {Actor|null} The selected actor. */
  get actor() {
    return this.#actorId ? (game.actors?.get(this.#actorId) ?? null) : null;
  }

  /* -- Actor selection ------------------------------------------------------ */

  /**
   * Actors offered in the carousel: the ones the user owns that have a
   * token in the current scene, plus their assigned character.
   *
   * Player characters win outright. A GM owns every NPC on the map, so
   * without that preference they would be handed a random monster as
   * "their" character — which is exactly what happened before.
   * @returns {Actor[]}
   */
  #availableActors() {
    if (!game.actors || !game.user) return [];
    const primaryId = game.user.character?.id ?? null;
    const scene = game.scenes?.current ?? game.scenes?.active;
    const sceneActorIds = new Set(scene?.tokens?.map((t) => t.actorId) ?? []);
    const owned = game.actors.filter((a) =>
      a.testUserPermission(game.user, "OWNER") && (sceneActorIds.has(a.id) || a.id === primaryId)
    );
    const characters = owned.filter((a) => a.type === "character");
    const pool = characters.length ? characters : owned;
    return pool.sort((a, b) => {
      if (a.id === primaryId) return -1;
      if (b.id === primaryId) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /** @returns {Actor|null} Last selected actor if still valid, else the best default. */
  #initialActor() {
    const available = this.#availableActors();
    const stored = available.find((a) => a.id === localStorage.getItem(this.#storageKey));
    return stored ?? game.user?.character ?? available[0] ?? null;
  }

  /** @returns {string} */
  get #storageKey() {
    return `${MODULE_ID}.actor.${game.world.id}`;
  }

  /**
   * Select an actor and open its sheet drawer (carousel tap or public API).
   * @param {string} actorId
   */
  selectActor(actorId) {
    const actor = game.actors?.get(actorId);
    if (!actor?.testUserPermission(game.user, "OWNER")) {
      return void Logger.warn(`Actor "${actorId}" is not available to this user`);
    }
    const changed = actorId !== this.#actorId;
    this.#actorId = actorId;
    localStorage.setItem(this.#storageKey, actorId);
    SheetShell.#haptic();
    if (changed) {
      const old = this.#app;
      this.#undecorate();
      old?.close();
      this.#refreshCarousel();
      this.#controlToken();
      Hooks.callAll(HOOKS.ACTOR_CHANGED, actor);
    }
    this.openSheet();
  }

  /* -- Sheet drawer ----------------------------------------------------------- */

  /** Open the selected actor's sheet as a drawer. */
  openSheet() {
    if (!this.#active) return;
    const actor = this.actor;
    if (!actor) return this.#showEmptyState();
    this.#hideEmptyState();
    this.#dismissHint();
    // Supported systems get our native mobile sheet; anything else — or an
    // actor whose mobile sheet already crashed once — falls back to the
    // system's own sheet pinned fullscreen.
    if (this.#useMobileSheet(actor)) return this.#openMobileSheet(actor);
    actor.sheet?.render(true);
  }

  /** @param {Actor} actor @returns {boolean} */
  #useMobileSheet(actor) {
    return !this.#msheetFailed.has(actor.id) && Boolean(modelFor(actor));
  }

  /** Close the drawer back to the home screen. */
  closeSheet() {
    if (this.#msheet) return void this.#msheet.dismiss();
    this.#app?.close();
  }

  /**
   * Present our native mobile sheet for an actor.
   * @param {Actor} actor
   */
  #openMobileSheet(actor) {
    if (this.#msheet?.actor?.id === actor.id) return;
    const old = this.#msheet;
    this.#msheet = null;
    old?.destroy();

    try {
      document.documentElement.setAttribute(ROOT_ATTRS.DRAWER, "");
      const sheet = new MobileSheet({
        actor,
        buildModel: modelFor,
        onDismiss: () => {
          if (this.#msheet === sheet) this.#msheet = null;
          document.documentElement.removeAttribute(ROOT_ATTRS.DRAWER);
          if (this.#active) this.#showHintOnce();
        }
      });
      this.#msheet = sheet;
      sheet.open();
    } catch (err) {
      // The mobile sheet is broken for this actor: remember it and fall
      // back to the system's own sheet so play can continue.
      Logger.error(`Mobile sheet failed for "${actor.name}" — using the native sheet`, err);
      ui.notifications?.warn(`Velvet Mobile: ${err?.message ?? err}`);
      this.#msheetFailed.add(actor.id);
      this.#msheet?.destroy();
      this.#msheet = null;
      document.documentElement.removeAttribute(ROOT_ATTRS.DRAWER);
      actor.sheet?.render(true);
    }
  }

  /** @param {object} app */
  #onRenderSheet(app) {
    if (!this.#active || !app.actor) return;
    // Supported actors always present through our mobile sheet — intercept
    // any Foundry sheet render (chat links, macros…) the Swipe way. Actors
    // whose mobile sheet crashed are exempt, or this would loop forever.
    if (this.#useMobileSheet(app.actor)) {
      app.close?.({ animate: false });
      this.#openMobileSheet(app.actor);
      return;
    }
    // Everything else is pinned fullscreen: a floating desktop window is
    // never acceptable on a phone, whichever actor it belongs to.
    this.#pinApp(app);
  }

  /**
   * Pin a Foundry sheet fullscreen as the drawer (fallback presentation).
   * @param {object} app
   */
  #pinApp(app) {
    const element = SheetShell.#elementOf(app);
    if (!element) return;

    // Single drawer: a newly pinned sheet replaces the previous one.
    if (this.#app && this.#app !== app) {
      const old = this.#app;
      this.#undecorate();
      old.close?.();
    }
    this.#app = app;
    if (element.classList.contains(PINNED_CLS)) return; // re-render of the pinned app

    element.classList.add(PINNED_CLS);
    document.documentElement.setAttribute(ROOT_ATTRS.DRAWER, "");
    // Neutralize self-positioning so nothing fights the fullscreen CSS.
    if (!this.#unpinApp) {
      const original = app.setPosition;
      app.setPosition = () => app.position;
      this.#unpinApp = () => {
        app.setPosition = original;
        SheetShell.#elementOf(app)?.classList.remove(PINNED_CLS);
      };
    }
    this.#injectHandle(element);
    this.#slideIn(element);
    const off = services.gestures?.on(element, "swipe", (g) => this.#onTabSwipe(g));
    if (off) this.#drawerGestures.push(off);
  }

  /** @param {object} app */
  #onCloseSheet(app) {
    if (app !== this.#app) return;
    this.#undecorate();
    // First time the user lands on the home screen, teach the way back.
    if (this.#active) this.#showHintOnce();
  }

  /** Reverse every per-app modification. */
  #undecorate() {
    for (const off of this.#drawerGestures) off();
    this.#drawerGestures.length = 0;
    SheetShell.#elementOf(this.#app)?.querySelector(".vm-drawer-handle")?.remove();
    this.#unpinApp?.();
    this.#unpinApp = null;
    this.#app = null;
    document.documentElement.removeAttribute(ROOT_ATTRS.DRAWER);
  }

  /** Slide-up entrance for the drawer. @param {HTMLElement} element */
  #slideIn(element) {
    Motion.slide(element, "translateY(100%)", "translateY(0)").then(() => {
      element.style.transform = "";
    });
  }

  /**
   * Grip strip at the top of the drawer: drag down to dismiss.
   * @param {HTMLElement} element
   */
  #injectHandle(element) {
    const closeBtn = VelvetComponent.el("button", {
      cls: "vm-drawer-close",
      attrs: { type: "button", "aria-label": game.i18n?.localize("Close") ?? "Close" },
      children: [VelvetComponent.icon("fa-solid fa-chevron-down")]
    });
    // A plain button guarantees the drawer can always be closed, even if
    // pointer gestures misbehave on some browser.
    closeBtn.addEventListener("click", () => {
      SheetShell.#haptic();
      Motion.slide(element, "translateY(0)", "translateY(100%)", { duration: DURATION.FAST })
        .then(() => this.closeSheet());
    });
    const handle = VelvetComponent.el("div", {
      cls: "vm-drawer-handle",
      children: [VelvetComponent.el("span", { cls: "vm-drawer-grip" }), closeBtn]
    });
    element.prepend(handle);

    const off = services.gestures?.on(handle, "pan", (g) => {
      if (g.phase === "changed") {
        element.style.transform = `translateY(${Math.max(0, g.dy)}px)`;
        return;
      }
      if (g.phase !== "ended" && g.phase !== "cancelled") return;
      const dy = Math.max(0, g.dy ?? 0);
      const height = element.getBoundingClientRect().height;
      if (dy > height * DISMISS_FRACTION || (g.vy ?? 0) > DISMISS_VELOCITY) {
        SheetShell.#haptic();
        Motion.slide(element, `translateY(${dy}px)`, "translateY(100%)", { duration: DURATION.FAST })
          .then(() => this.closeSheet());
      } else {
        Motion.slide(element, `translateY(${dy}px)`, "translateY(0)", { duration: DURATION.FAST })
          .then(() => { element.style.transform = ""; });
      }
    });
    if (off) this.#drawerGestures.push(off);
  }

  /**
   * Horizontal swipe on the sheet moves between its tabs. Works with the
   * Velvet sheet's custom nav and standard Foundry tab navs.
   * @param {object} g Swipe gesture event.
   */
  #onTabSwipe(g) {
    if (g.direction !== "left" && g.direction !== "right") return;
    const element = SheetShell.#elementOf(this.#app);
    if (!element) return;

    let tabs = [];
    for (const selector of [".nav-list [data-tab]", "nav.sheet-tabs [data-tab]", ".sheet-navigation [data-tab]", "nav.tabs [data-tab]", ".tabs [data-tab]"]) {
      tabs = [...element.querySelectorAll(selector)];
      if (tabs.length > 1) break;
    }
    if (tabs.length < 2) return;

    const current = tabs.findIndex((t) => t.classList.contains("active"));
    const next = (current === -1 ? 0 : current) + (g.direction === "left" ? 1 : -1);
    tabs[Math.max(0, Math.min(next, tabs.length - 1))]?.click();
  }

  /* -- Home screen -------------------------------------------------------------- */

  #buildHome() {
    const el = VelvetComponent.el;
    this.#home = el("div", {
      cls: "vm-home",
      children: [el("div", { cls: "vm-home-bg" }), el("div", { cls: "vm-home-vignette" })]
    });
    document.body.prepend(this.#home);
    this.#refreshHome();
  }

  /** Use the scene's artwork as the home backdrop when there is one. */
  #refreshHome() {
    const bg = this.#home?.querySelector(".vm-home-bg");
    if (!bg) return;
    const scene = game.scenes?.current ?? game.scenes?.active;
    const src = scene?.background?.src;
    bg.style.backgroundImage = src ? `url("${src}")` : "";
  }

  /* -- Avatar carousel ------------------------------------------------------------ */

  #buildCarousel() {
    const el = VelvetComponent.el;
    const track = el("div", { cls: "vm-carousel-track" });
    this.#carousel = el("nav", {
      cls: "vm-carousel",
      children: [el("div", { cls: "vm-carousel-label" }), track]
    });
    document.body.append(this.#carousel);
    // Swipe's proximity effect: avatars grow/saturate as they near the center.
    track.addEventListener("scroll", () => this.#scheduleProximity(), { passive: true });
    this.#refreshCarousel();
  }

  #refreshCarousel() {
    const track = this.#carousel?.querySelector(".vm-carousel-track");
    if (!track) return;
    const available = this.#availableActors();
    track.replaceChildren();

    if (!available.length) {
      this.#updateCarouselLabel(null);
      if (!this.#app) this.#showEmptyState();
      return;
    }
    this.#hideEmptyState();
    if (!available.some((a) => a.id === this.#actorId)) this.#actorId = available[0].id;

    for (const actor of available) {
      track.append(this.#buildAvatar(actor));
    }
    this.#updateCarouselLabel(this.actor);
    track.querySelector(".vm-selected")?.scrollIntoView({ inline: "center", block: "nearest" });
    this.#scheduleProximity();
  }

  /** @param {Actor} actor @returns {HTMLElement} */
  #buildAvatar(actor) {
    const el = VelvetComponent.el;
    const hp = SheetShell.#hpOf(actor);
    const children = [
      el("img", { attrs: { src: actor.img || "icons/svg/mystery-man.svg", alt: actor.name, loading: "lazy" } })
    ];
    if (hp !== null) {
      const fill = el("span", { cls: "vm-hp-fill", attrs: { style: `width: ${hp}%` } });
      SheetShell.#applyHpTone(fill, hp);
      children.push(el("span", { cls: "vm-hp", children: [fill] }));
    }
    const btn = el("button", {
      cls: `vm-carousel-avatar ${actor.id === this.#actorId ? "vm-selected" : ""}`.trim(),
      attrs: { type: "button", "aria-label": actor.name, "data-actor-id": actor.id },
      children
    });
    btn.addEventListener("click", () => this.selectActor(actor.id));
    return btn;
  }

  /** @param {Actor|null} actor */
  #updateCarouselLabel(actor) {
    const label = this.#carousel?.querySelector(".vm-carousel-label");
    if (!label) return;
    label.textContent = actor?.name ?? "";
    label.classList.toggle("vm-visible", Boolean(actor));
  }

  /** Live HP + name updates for carousel avatars and the open sheet. @param {Actor} actor */
  #onActorUpdate(actor) {
    if (this.#msheet?.actor?.id === actor.id) this.#msheet.refresh();
    const btn = this.#carousel?.querySelector(`[data-actor-id="${actor.id}"]`);
    if (!btn) return;
    const hp = SheetShell.#hpOf(actor);
    const fill = btn.querySelector(".vm-hp-fill");
    if (fill && hp !== null) {
      fill.style.width = `${hp}%`;
      SheetShell.#applyHpTone(fill, hp);
    }
    btn.querySelector("img")?.setAttribute("src", actor.img || "icons/svg/mystery-man.svg");
    if (actor.id === this.#actorId) this.#updateCarouselLabel(actor);
  }

  /** @param {HTMLElement} fill @param {number} hp */
  static #applyHpTone(fill, hp) {
    fill.classList.toggle("vm-critical", hp <= 25);
    fill.classList.toggle("vm-low", hp > 25 && hp <= 50);
  }

  /** @param {Actor} actor @returns {number|null} HP percentage, when the system exposes it. */
  static #hpOf(actor) {
    const hp = actor?.system?.attributes?.hp;
    if (!hp || !(hp.max > 0)) return null;
    return Math.max(0, Math.min(100, Math.round(((hp.value ?? 0) / hp.max) * 100)));
  }

  /** rAF-throttled proximity pass over the carousel avatars. */
  #scheduleProximity() {
    if (this.#proxRaf) return;
    this.#proxRaf = requestAnimationFrame(() => {
      this.#proxRaf = null;
      const track = this.#carousel?.querySelector(".vm-carousel-track");
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      for (const avatar of track.children) {
        const r = avatar.getBoundingClientRect();
        const distance = Math.abs(centerX - (r.left + r.width / 2));
        const proximity = Math.max(0, 1 - distance / (r.width * 1.6 || 1));
        avatar.style.setProperty("--p", proximity.toFixed(3));
      }
    });
  }

  /* -- Floating button stack --------------------------------------------------------- */

  #buildStack() {
    const el = VelvetComponent.el;
    const t = (key) => game.i18n.localize(`${L10N}.Shell.${key}`);
    this.#chatDot = el("span", { cls: "vm-stack-dot", attrs: { hidden: "" } });

    // Speed-dial: one small button that fans out the three actions, so the
    // stack never covers the sheet's tab bar.
    const action = (name, icon, label, onTap) => {
      const btn = el("button", {
        cls: "vm-stack-btn",
        attrs: { type: "button", "data-action": name, "aria-label": label },
        children: [VelvetComponent.icon(icon)]
      });
      btn.addEventListener("click", () => {
        this.#setDialOpen(false);
        onTap();
      });
      return btn;
    };

    const actions = [
      action("move", "fa-solid fa-gamepad", t("Move"), () => this.#toggleJoystick()),
      action("dice", "fa-solid fa-dice-d20", t("Dice"), () => this.#toggleDiceBar()),
      action("chat", "fa-solid fa-comments", t("Chat"), () => this.toggleChat()),
      action("combat", "fa-solid fa-swords", t("Combat"), () => this.toggleCombat()),
      action("settings", "fa-solid fa-gear", t("Settings"), () => game.settings.sheet.render(true))
    ];
    // Targeting reads canvas token objects, so it only exists in map mode.
    if (Settings.map) {
      actions.splice(1, 0, action("target", "fa-solid fa-crosshairs", t("Target"), () => this.#toggleTargetPicker()));
    }
    const dial = el("div", { cls: "vm-stack-dial", children: actions });

    const main = el("button", {
      cls: "vm-stack-main",
      attrs: { type: "button", "aria-label": t("Menu"), "aria-expanded": "false" },
      children: [VelvetComponent.icon("fa-solid fa-plus"), this.#chatDot]
    });
    main.addEventListener("click", () => {
      SheetShell.#haptic(5);
      this.#setDialOpen(!this.#stack.classList.contains("vm-open"));
    });

    this.#stack = el("div", { cls: "vm-stack", children: [dial, main] });
    document.body.append(this.#stack);
  }

  /** @param {boolean} open */
  #setDialOpen(open) {
    if (!this.#stack) return;
    this.#stack.classList.toggle("vm-open", open);
    this.#stack.querySelector(".vm-stack-main")?.setAttribute("aria-expanded", String(open));
    if (!open && this.#diceBar) this.#collapseDiceBar();
  }

  /* -- Dice roller ------------------------------------------------------------------- */

  #toggleDiceBar() {
    this.#diceBar ? this.#collapseDiceBar() : this.#expandDiceBar();
  }

  #expandDiceBar() {
    const el = VelvetComponent.el;
    const t = (key) => game.i18n.localize(`${L10N}.Shell.${key}`);
    this.#dice = {};

    const dieButtons = DICE.map((die) => {
      const count = el("span", { cls: "vm-die-count" });
      const btn = el("button", {
        cls: "vm-die-btn",
        attrs: { type: "button", "data-die": die, "aria-label": die },
        children: [el("span", { cls: "vm-die-label", text: die }), count]
      });
      btn.addEventListener("click", () => {
        this.#dice[die] = (this.#dice[die] ?? 0) + 1;
        SheetShell.#haptic(5);
        this.#updateDiceUI();
      });
      // Long-press (mobile contextmenu) clears that die from the pool.
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        delete this.#dice[die];
        SheetShell.#haptic();
        this.#updateDiceUI();
      });
      return btn;
    });

    const rollBtn = el("button", {
      cls: "vm-die-roll vm-disabled",
      attrs: { type: "button" },
      children: [VelvetComponent.icon("fa-solid fa-dice"), el("span", { cls: "vm-die-formula", text: t("Roll") })]
    });
    rollBtn.addEventListener("click", () => this.#executeRoll());

    this.#diceBar = el("div", { cls: "vm-dice-bar", children: [...dieButtons, rollBtn] });
    document.body.append(this.#diceBar);
    this.#stack?.querySelector('[data-action="dice"]')?.classList.add("vm-selected");
  }

  /** @returns {string} The pool as a roll formula, e.g. "2d6 + 1d20". */
  get #diceFormula() {
    return DICE.filter((die) => this.#dice[die] > 0).map((die) => `${this.#dice[die]}${die}`).join(" + ");
  }

  /** Sync counts, per-die highlight and the live formula on the Roll button. */
  #updateDiceUI() {
    if (!this.#diceBar) return;
    for (const btn of this.#diceBar.querySelectorAll(".vm-die-btn")) {
      const count = this.#dice[btn.dataset.die] ?? 0;
      btn.querySelector(".vm-die-count").textContent = count > 0 ? String(count) : "";
      btn.classList.toggle("vm-selected", count > 0);
    }
    const formula = this.#diceFormula;
    const rollBtn = this.#diceBar.querySelector(".vm-die-roll");
    rollBtn.querySelector(".vm-die-formula").textContent =
      formula || game.i18n.localize(`${L10N}.Shell.Roll`);
    rollBtn.classList.toggle("vm-disabled", !formula);
  }

  #collapseDiceBar() {
    this.#diceBar?.remove();
    this.#diceBar = null;
    this.#dice = {};
    this.#stack?.querySelector('[data-action="dice"]')?.classList.remove("vm-selected");
  }

  async #executeRoll() {
    const formula = this.#diceFormula;
    if (!formula) return;
    SheetShell.#haptic([10, 40, 15]);
    const roll = await new Roll(formula).evaluate();
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this.actor }) });
    this.#collapseDiceBar();
  }

  /* -- Token joystick ---------------------------------------------------------- */

  /** Show/hide the movement stick (speed-dial "Move" action). */
  #toggleJoystick() {
    if (this.#joystick) return void this.#hideJoystick();
    this.#joystick = new Joystick({ onStep: (dx, dy) => this.#moveToken(dx, dy) }).mount();
    this.#stack?.querySelector('[data-action="move"]')?.classList.add("vm-selected");
    // Moving means watching the map: reveal it, own the token, center on
    // it, and offer zoom buttons (pinch is unreliable over PIXI).
    if (Settings.map) {
      this.closeSheet();
      this.#controlToken();
      this.#panToToken({ animate: false });
      this.#buildZoom();
    }
  }

  #hideJoystick() {
    this.#joystick?.destroy();
    this.#joystick = null;
    this.#zoom?.remove();
    this.#zoom = null;
    this.#stack?.querySelector('[data-action="move"]')?.classList.remove("vm-selected");
  }

  /** Zoom ± column, living and dying with the joystick. */
  #buildZoom() {
    if (this.#zoom) return;
    const el = VelvetComponent.el;
    const t = (key) => game.i18n.localize(`${L10N}.Shell.${key}`);
    const button = (icon, label, factor) => {
      const btn = el("button", {
        cls: "vm-zoom-btn",
        attrs: { type: "button", "aria-label": label },
        children: [VelvetComponent.icon(icon)]
      });
      btn.addEventListener("click", () => this.#zoomCanvas(factor));
      return btn;
    };
    this.#zoom = el("div", {
      cls: "vm-zoom",
      children: [
        button("fa-solid fa-plus", t("ZoomIn"), 1.3),
        button("fa-solid fa-minus", t("ZoomOut"), 1 / 1.3)
      ]
    });
    document.body.append(this.#zoom);
  }

  /** @param {number} factor Multiplier on the current canvas scale. */
  #zoomCanvas(factor) {
    if (!canvas?.ready) return;
    try {
      const scale = Math.min(3, Math.max(0.1, (canvas.stage.scale.x || 1) * factor));
      canvas.animatePan({ scale, duration: 120 });
      SheetShell.#haptic(5);
    } catch (err) {
      Logger.debug("Zoom failed", err);
    }
  }

  /**
   * Step the selected actor's token one grid square. Updates the
   * TokenDocument directly, so it works with the canvas disabled and
   * replicates to the GM and every other client — the same net effect as
   * arrow-key movement on desktop.
   * @param {number} dx @param {number} dy  Each in {-1, 0, 1}.
   */
  async #moveToken(dx, dy) {
    const tokenDoc = this.#tokenDoc();
    if (!tokenDoc) return void this.#warnNoToken();
    const scene = tokenDoc.parent;
    const size = scene?.grid?.size ?? 100;
    const type = scene?.grid?.type ?? 1;

    let x = tokenDoc.x + dx * size;
    let y = tokenDoc.y + dy * size;
    // Snap square grids so a token that drifted off-grid re-aligns.
    if (type === 1) {
      x = Math.round(x / size) * size;
      y = Math.round(y / size) * size;
    }
    x = Math.max(0, x);
    y = Math.max(0, y);
    if (x === tokenDoc.x && y === tokenDoc.y) return;

    try {
      await tokenDoc.update({ x, y });
      // Keep the camera on the token so the player watches themselves move.
      this.#panToToken();
    } catch (err) {
      Logger.error("Token move failed", err);
      this.#warnNoToken();
    }
  }

  /**
   * Control the selected actor's token (vision + selection), if the canvas
   * is live. Harmless without a canvas.
   */
  #controlToken() {
    if (!Settings.map) return;
    try {
      const object = this.#tokenDoc()?.object;
      if (object && object.isOwner && !object.controlled) object.control({ releaseOthers: true });
    } catch (err) {
      Logger.debug("Token control failed", err);
    }
  }

  /**
   * Center the camera on the selected actor's token.
   * @param {object} [options]
   * @param {boolean} [options.animate]
   */
  #panToToken({ animate = true } = {}) {
    if (!Settings.map || !canvas?.ready) return;
    const tokenDoc = this.#tokenDoc();
    if (!tokenDoc) return;
    const size = tokenDoc.parent?.grid?.size ?? 100;
    const x = tokenDoc.x + ((tokenDoc.width ?? 1) * size) / 2;
    const y = tokenDoc.y + ((tokenDoc.height ?? 1) * size) / 2;
    try {
      if (animate) canvas.animatePan({ x, y, duration: 150 });
      else canvas.pan({ x, y });
    } catch (err) {
      Logger.debug("Camera pan failed", err);
    }
  }

  /** @returns {TokenDocument|null} The best owned token for the selected actor. */
  #tokenDoc() {
    const actor = this.actor;
    const scene = game.scenes?.current ?? game.scenes?.active;
    if (!actor || !scene) return null;
    const tokens = scene.tokens?.filter((tkn) => tkn.actorId === actor.id) ?? [];
    return tokens.find((tkn) => tkn.isOwner) ?? tokens[0] ?? null;
  }

  #warnNoToken() {
    const now = Date.now();
    if (now - this.#lastTokenWarn < 3000) return;
    this.#lastTokenWarn = now;
    ui.notifications?.warn(game.i18n.localize(`${L10N}.Shell.NoToken`));
  }

  /* -- Target picker ------------------------------------------------------------ */

  #toggleTargetPicker() {
    if (this.#targetSheet) return void this.#targetSheet.dismiss();
    this.#openTargetPicker();
  }

  /**
   * Bottom sheet listing the scene's tokens (hostiles first) — tap one to
   * target it for the next attack. Far more reliable on touch than tapping
   * tiny tokens on the PIXI canvas.
   */
  #openTargetPicker() {
    const t = (key) => game.i18n.localize(`${L10N}.Shell.${key}`);
    if (!canvas?.ready) return void ui.notifications?.warn(t("NoTargets"));

    const mineId = this.#tokenDoc()?.id;
    const tokens = canvas.tokens.placeables
      .filter((tok) => tok.actor && !tok.document.hidden && tok.id !== mineId && (game.user.isGM || tok.visible))
      .sort((a, b) =>
        (a.document.disposition ?? 0) - (b.document.disposition ?? 0)
        || a.document.name.localeCompare(b.document.name));

    this.#targetSheet = new BottomSheet({
      title: t("Target"),
      snapPoints: [0.6],
      className: "vm-target-panel",
      onDismiss: () => {
        this.#targetSheet = null;
      }
    });
    this.#targetSheet.open();
    const body = this.#targetSheet.body;
    const el = VelvetComponent.el;

    if (game.user.targets.size) {
      const clear = el("button", {
        cls: "vm-target-row vm-target-clear",
        attrs: { type: "button" },
        children: [VelvetComponent.icon("fa-solid fa-ban"), el("span", { cls: "vm-target-name", text: t("TargetClear") })]
      });
      clear.addEventListener("click", () => {
        game.user.updateTokenTargets([]);
        SheetShell.#haptic();
        this.#targetSheet?.dismiss();
      });
      body.append(clear);
    }

    if (!tokens.length) {
      body.append(el("p", { cls: "vm-target-empty", text: t("NoTargets") }));
      return;
    }

    const DISPOSITION_CLS = { "-1": "vm-hostile", "0": "vm-neutral", "1": "vm-friendly" };
    for (const token of tokens) {
      const targeted = game.user.targets.has(token);
      const row = el("button", {
        cls: `vm-target-row ${DISPOSITION_CLS[String(token.document.disposition)] ?? ""} ${targeted ? "vm-targeted" : ""}`.trim(),
        attrs: { type: "button" },
        children: [
          el("img", { attrs: { src: token.document.texture?.src ?? token.actor.img, alt: "", loading: "lazy" } }),
          el("span", { cls: "vm-target-name", text: token.document.name }),
          targeted ? VelvetComponent.icon("fa-solid fa-crosshairs") : ""
        ].filter(Boolean)
      });
      row.addEventListener("click", () => {
        try {
          token.setTarget(!targeted, { releaseOthers: true });
          SheetShell.#haptic();
        } catch (err) {
          Logger.error("Targeting failed", err);
        }
        this.#targetSheet?.dismiss();
      });
      body.append(row);
    }
  }

  /** Keep the crosshair dial button lit while something is targeted. */
  #refreshTargetState() {
    this.#stack?.querySelector('[data-action="target"]')
      ?.classList.toggle("vm-selected", game.user.targets.size > 0);
  }

  /* -- Encounter tracker ------------------------------------------------------- */

  toggleCombat() {
    this.#combatSheet ? this.closeCombat() : this.openCombat();
  }

  /**
   * Present Foundry's own encounter tracker in a bottom sheet, the same way
   * the chat panel borrows the real chat log: the tracker is moved out of
   * the hidden sidebar and handed straight back on dismissal. Borrowing the
   * real thing means initiative, turn order and every system's tracker
   * additions behave exactly as they do on the desktop.
   */
  openCombat() {
    if (this.#combatSheet || !this.#active) return;
    const tracker = SheetShell.#combatElement();
    if (!tracker) return void Logger.warn("Encounter tracker element not found");

    this.#combatSheet = new BottomSheet({
      title: game.i18n.localize(`${L10N}.Shell.Combat`),
      snapPoints: [0.5, 0.9],
      className: "vm-combat-panel",
      onDismiss: () => this.#onCombatDismissed()
    });
    this.#combatSheet.open();

    this.#combatHome = { parent: tracker.parentElement, next: tracker.nextSibling };
    this.#combatSheet.body.append(tracker);
    tracker.classList.add("vm-combat-hosted");
    this.#stack?.querySelector('[data-action="combat"]')?.classList.add("vm-selected");
  }

  closeCombat() {
    this.#combatSheet?.dismiss();
  }

  /** Return the tracker to its original home in the sidebar. */
  #onCombatDismissed() {
    this.#combatSheet = null;
    this.#stack?.querySelector('[data-action="combat"]')?.classList.remove("vm-selected");
    const tracker = document.querySelector(".vm-combat-hosted");
    const home = this.#combatHome;
    if (tracker && home?.parent) {
      tracker.classList.remove("vm-combat-hosted");
      // The sibling may have been re-rendered away while we hosted it.
      if (home.next && home.next.parentNode === home.parent) home.parent.insertBefore(tracker, home.next);
      else home.parent.append(tracker);
    }
    this.#combatHome = null;
  }

  /* -- Chat panel -------------------------------------------------------------- */

  toggleChat() {
    this.#chatSheet ? this.closeChat() : this.openChat();
  }

  /** @param {boolean} [auto] True when opened by an incoming message. */
  openChat(auto = false) {
    if (this.#chatSheet || !this.#active) return;
    const chat = SheetShell.#chatElement();
    if (!chat) return void Logger.warn("Chat element not found");

    this.#chatSheet = new BottomSheet({
      title: game.i18n.localize(`${L10N}.Shell.Chat`),
      snapPoints: auto ? [0.5, 0.9] : [0.9],
      className: "vm-chat-panel",
      backdrop: !auto,
      onDismiss: () => this.#onChatDismissed()
    });
    this.#chatSheet.open();

    this.#chatHome = { parent: chat.parentElement, next: chat.nextSibling };
    this.#chatSheet.body.append(chat);
    chat.classList.add("vm-chat-hosted");
    this.#chatDot?.setAttribute("hidden", "");
    this.#stack?.querySelector('[data-action="chat"]')?.classList.add("vm-selected");
    ui.chat?.scrollBottom?.({ waitImages: false });

    if (auto) this.#scheduleChatHide();
    // Any interaction with the panel cancels the auto-hide.
    this.#chatAbort = new AbortController();
    const { signal } = this.#chatAbort;
    this.#chatSheet.element?.addEventListener("pointerdown", () => this.#cancelChatHide(), { capture: true, signal });
    // Acting on a chat card (Attack, Damage, Save…) opens a roll prompt
    // that the panel would cover, so step aside once the click is through.
    chat.addEventListener("click", (event) => this.#onChatCardAction(event), { signal });
  }

  /**
   * Close the chat panel when the user triggers an action from a message,
   * clearing the way for the prompt it opens. Reading the log — expanding a
   * card, following a link, scrolling — leaves the panel alone.
   * @param {MouseEvent} event
   */
  #onChatCardAction(event) {
    const button = event.target.closest?.("button");
    if (!button || !button.closest(".chat-message, .message, .chat-card")) return;
    // Collapse/expand toggles are reading aids, not actions.
    if (button.closest(".message-header") || button.matches("[data-action='expand'], [data-action='collapse'], .collapser")) return;
    setTimeout(() => this.closeChat(), 120);
  }

  closeChat() {
    this.#cancelChatHide();
    this.#chatSheet?.dismiss();
  }

  #scheduleChatHide() {
    const seconds = Settings.chatAutoHide;
    if (!seconds) return;
    this.#cancelChatHide();
    this.#chatHideTimer = setTimeout(() => {
      this.#chatHideTimer = null;
      this.#chatSheet?.dismiss();
    }, seconds * 1000);
  }

  #cancelChatHide() {
    if (this.#chatHideTimer) clearTimeout(this.#chatHideTimer);
    this.#chatHideTimer = null;
  }

  /** Return the chat log to its original home in the sidebar. */
  #onChatDismissed() {
    this.#cancelChatHide();
    // Drop the listeners bound to the hosted chat before handing it back.
    this.#chatAbort?.abort();
    this.#chatAbort = null;
    this.#chatSheet = null;
    this.#stack?.querySelector('[data-action="chat"]')?.classList.remove("vm-selected");
    const chat = document.querySelector(".vm-chat-hosted");
    const home = this.#chatHome;
    if (chat && home?.parent) {
      chat.classList.remove("vm-chat-hosted");
      // The sibling may have been re-rendered away while we hosted the chat.
      if (home.next && home.next.parentNode === home.parent) home.parent.insertBefore(chat, home.next);
      else home.parent.append(chat);
    }
    this.#chatHome = null;
  }

  /** @param {ChatMessage} message */
  #onChatMessage(message) {
    if (this.#chatSheet) {
      if (this.#chatHideTimer) this.#scheduleChatHide();
      return;
    }
    const mode = Settings.chatOnMessage;
    const shouldOpen = mode === "all" || (mode === "rolls" && message?.isRoll);
    // Never steal the screen while the user is typing.
    if (shouldOpen && !services.keyboard?.isOpen) return void this.openChat(true);
    this.#chatDot?.removeAttribute("hidden");
  }

  /* -- Empty state (no actor) --------------------------------------------------- */

  #showEmptyState() {
    if (this.#empty) return;
    const el = VelvetComponent.el;
    const t = (key) => game.i18n.localize(`${L10N}.Shell.${key}`);
    this.#empty = el("div", {
      cls: "vm-empty",
      children: [
        el("div", {
          cls: "vm-empty-card",
          children: [
            VelvetComponent.icon("fa-solid fa-user-slash"),
            el("h2", { text: t("NoActorTitle") }),
            el("p", { text: game.user.isGM ? t("NoActorGMHint") : t("NoActorHint") })
          ]
        })
      ]
    });
    document.body.append(this.#empty);
  }

  #hideEmptyState() {
    this.#empty?.remove();
    this.#empty = null;
  }

  /* -- First-run hint ---------------------------------------------------------- */

  /** Floating "swipe up" pill, shown once per session on the home screen. */
  #showHintOnce() {
    if (sessionStorage.getItem(`${MODULE_ID}.hint`) || !this.actor) return;
    const el = VelvetComponent.el;
    this.#hint = el("div", {
      cls: "vm-hint",
      children: [
        VelvetComponent.icon("fa-solid fa-chevron-up"),
        el("span", { text: game.i18n.localize(`${L10N}.Shell.SwipeHint`) })
      ]
    });
    document.body.append(this.#hint);
    setTimeout(() => this.#dismissHint(), 7000);
  }

  #dismissHint() {
    if (!this.#hint) return;
    sessionStorage.setItem(`${MODULE_ID}.hint`, "1");
    const hint = this.#hint;
    this.#hint = null;
    hint.classList.add("vm-out");
    setTimeout(() => hint.remove(), 400);
  }

  /* -- Helpers -------------------------------------------------------------------- */

  /** @param {string} name @param {Function} fn */
  #hook(name, fn) {
    this.#hooks.push([name, Hooks.on(name, fn)]);
  }

  /**
   * Close every window that was already open when the shell activated —
   * leftover desktop windows have no place in the mobile experience.
   */
  #sweepOpenWindows() {
    // AppV2 first — the forward-looking path. Only document sheets are
    // closed; core UI singletons are ApplicationV2 too and must survive.
    try {
      const api = foundry.applications?.api;
      const DocumentSheetV2 = api?.DocumentSheetV2;
      const registry = foundry.applications?.instances ?? api?.ApplicationV2?.instances;
      const open = typeof registry === "function" ? registry() : registry?.values?.();
      if (DocumentSheetV2 && open) {
        for (const app of open) {
          if (app instanceof DocumentSheetV2) app.close?.({ animate: false });
        }
      }
    } catch (err) {
      Logger.debug("AppV2 window sweep skipped", err);
    }

    // AppV1 legacy path. Still shipped in v14 but slated for removal once
    // ApplicationV1 is retired; every access is optional so its
    // disappearance degrades to a no-op instead of throwing.
    try {
      for (const app of Object.values(globalThis.ui?.windows ?? {})) app.close?.();
    } catch (err) {
      Logger.debug("AppV1 window sweep skipped", err);
    }
  }

  /**
   * Tactile feedback where the platform offers it; silently a no-op elsewhere.
   * @param {number|number[]} [pattern]
   */
  static #haptic(pattern = 8) {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* not available (iOS Safari) — visual feedback carries the interaction */
    }
  }

  /**
   * With `core.noCanvas` managed by main.mjs the canvas usually never
   * exists here; on the first session (before the reload that applies
   * noCanvas) it does, so stop its ticker to save the battery it would
   * burn rendering an invisible scene.
   * @param {boolean} freeze
   */
  #freezeCanvas(freeze) {
    try {
      const ticker = canvas?.app?.ticker;
      if (!ticker) return;
      if (freeze && ticker.started) ticker.stop();
      else if (!freeze && !ticker.started) ticker.start();
    } catch (err) {
      Logger.debug("Could not toggle canvas ticker", err);
    }
  }

  /**
   * AppV1 exposes a jQuery element; AppV2 a plain HTMLElement.
   * @param {object|null} app
   * @returns {HTMLElement|null}
   */
  static #elementOf(app) {
    const element = app?.element;
    if (!element) return null;
    return element instanceof HTMLElement ? element : (element[0] ?? null);
  }

  /** @returns {HTMLElement|null} Foundry's chat log element across versions. */
  static #chatElement() {
    const element = ui.chat?.element;
    if (element instanceof HTMLElement) return element;
    return element?.[0] ?? document.getElementById("chat");
  }

  /** @returns {HTMLElement|null} Foundry's encounter tracker element across versions. */
  static #combatElement() {
    const element = ui.combat?.element;
    if (element instanceof HTMLElement) return element;
    return element?.[0] ?? document.getElementById("combat");
  }
}
