/**
 * Velvet Mobile — SheetShell.
 *
 * The whole mobile experience: Foundry's chrome and canvas disappear and the
 * client becomes a phone app around the character sheet.
 *
 * The layout is two pieces of persistent chrome around a navigation stack:
 *
 *  - StatusBar (top): portrait, name and hit points, always readable. Tapping
 *    it opens the character sheet; its buttons reach the roster and settings.
 *  - CommandBar (bottom): the actions of play, one tap each, with anything
 *    past the fourth in an overflow menu.
 *  - NavStack (between): every screen that covers the home view — sheet,
 *    chat, encounter, targets, roster — enters from the right and leaves by
 *    the back chevron or a drag from the left edge. One mechanic, not three.
 *  - Home: the scene's artwork under a vignette, behind all of it.
 *
 * Incoming chat does not push a screen; it raises a toast that fades on its
 * own, so a roll never takes the display away from what you were doing.
 *
 * Everything reverses cleanly on disable().
 *
 * @module shell/sheet-shell
 */

import { CLS, DEVICES, HOOKS, L10N, MODULE_ID, ROOT_ATTRS } from "../core/constants.mjs";
import { Logger } from "../core/logger.mjs";
import { services } from "../core/services.mjs";
import { Settings } from "../core/settings.mjs";
import { VelvetComponent } from "../components/component.mjs";
import { NavStack } from "../components/nav-stack.mjs";
import { Joystick } from "../components/joystick.mjs";
import { stepToken, resetFootsteps } from "../canvas/token-mover.mjs";
import { Motion, DURATION } from "../motion/animation-engine.mjs";
import { modelFor } from "../sheet/adapters.mjs";
import { hpOf } from "../sheet/adapters/shared.mjs";
import { MobileSheet } from "../sheet/mobile-sheet.mjs";
import { ChromeHider } from "./chrome-hider.mjs";
import { MobileSettings } from "./mobile-settings.mjs";
import { StatusBar } from "./status-bar.mjs";
import { CommandBar } from "./command-bar.mjs";

/** Class marking a Foundry sheet pinned fullscreen (CSS contract). */
const PINNED_CLS = "vm-pinned";

/** Dice offered by the roller, in display order. */
const DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];

/** How long a chat toast stays up before fading, in ms. */
const TOAST_MS = 4500;

/**
 * Back-gesture geometry for the pinned Foundry sheet, mirroring the NavStack
 * so the fallback presentation leaves exactly the way our own screens do.
 */
const BACK_EDGE = 30;
const BACK_FRACTION = 0.35;
const BACK_VELOCITY = 0.45;

/** Stack view ids, so a screen can be found or replaced without a field each. */
const VIEW = Object.freeze({
  SHEET: "sheet",
  ROSTER: "roster",
  CHAT: "chat",
  COMBAT: "combat",
  TARGET: "target"
});

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

  /** @type {(() => void)[]} Gesture unsubscribers tied to the pinned sheet. */
  #drawerGestures = [];

  /** @type {number} X of the last pointer-down on the pinned sheet, for the tab swipe. */
  #pinnedSwipeStartX = Infinity;

  /** @type {HTMLElement|null} Home screen (background + vignette). */
  #home = null;

  /** @type {NavStack|null} Every screen that covers the home view. */
  #nav = null;

  /** @type {StatusBar|null} Persistent top chrome. */
  #status = null;

  /** @type {CommandBar|null} Persistent bottom chrome. */
  #commands = null;

  /** @type {HTMLElement|null} Expandable dice bar. */
  #diceBar = null;

  /** @type {Record<string, number>} Selected dice counts. */
  #dice = {};

  /** @type {HTMLElement|null} "No actor" overlay. */
  #empty = null;

  /** @type {Joystick|null} Token-movement stick (toggled from the command bar). */
  #joystick = null;

  /** @type {HTMLElement|null} Zoom ± buttons, shown alongside the joystick. */
  #zoom = null;

  /** @type {number} Throttles the "no token" warning. */
  #lastTokenWarn = 0;

  /** @type {import("../components/nav-stack.mjs").NavView|null} Open encounter screen. */
  #combatView = null;

  /** @type {[string, number][]} Hook handles tied to the open encounter screen. */
  #combatHooks = [];

  /** @type {MobileSettings|null} Mobile settings screen. */
  #settings = null;

  /** @type {import("../components/nav-stack.mjs").NavView|null} Open chat screen. */
  #chatView = null;

  /** @type {{parent: HTMLElement, next: Node|null}|null} Original chat placement. */
  #chatHome = null;

  /** @type {AbortController|null} Listeners tied to the open chat screen. */
  #chatAbort = null;

  /** @type {HTMLElement|null} Transient incoming-message toast. */
  #toast = null;

  /** @type {number|null} Fade timer for the toast. */
  #toastTimer = null;

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
    this.#buildChrome();

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
      this.#refreshRoster();
      // Vision on fogged scenes needs a controlled token; players cannot
      // click one without a desktop UI, so take care of it for them.
      this.#controlToken();
    });
    this.#hook("createToken", () => this.#refreshRoster());
    this.#hook("deleteToken", () => this.#refreshRoster());
    this.#hook("updateActor", (actor) => this.#onActorUpdate(actor));
    // Item changes (equip, quantity, new loot…) refresh the open mobile sheet.
    const onItemChange = (item) => {
      if (this.#msheet && item?.actor?.id === this.#msheet.actor?.id) this.#msheet.refresh();
    };
    this.#hook("updateItem", onItemChange);
    this.#hook("createItem", onItemChange);
    this.#hook("deleteItem", onItemChange);
    // Core status effects are ActiveEffects, not Items, so condition chips
    // would otherwise stay stale until something else redrew the sheet. An
    // effect's parent is the actor, or the item the effect rides on.
    const onEffectChange = (effect) => {
      const actor = effect?.parent?.documentName === "Actor" ? effect.parent : effect?.parent?.actor;
      if (actor && this.#msheet && actor.id === this.#msheet.actor?.id) this.#msheet.refresh();
    };
    this.#hook("createActiveEffect", onEffectChange);
    this.#hook("updateActiveEffect", onEffectChange);
    this.#hook("deleteActiveEffect", onEffectChange);
    // Effect durations count down against world time, so advancing the clock
    // (or ending a turn) changes what the sheet should say without any
    // document being touched. refresh() coalesces, so a burst costs one redraw.
    this.#hook("updateWorldTime", () => this.#msheet?.refresh());
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

    // AppV2 re-renders in place and keeps its root element, so the hook fires
    // again on the same node — bind once per element rather than once per
    // render. (AppV1 builds a fresh element, which correctly rebinds.)
    if (root.dataset.vmAutoclose) return;
    root.dataset.vmAutoclose = "1";

    // Deliberately not `{ once: true }`: that spent the listener on the first
    // click anywhere in the prompt — scrolling the list, tapping a label —
    // leaving the window unable to close itself once a choice was finally made.
    root.addEventListener("click", (event) => {
      if (!event.target.closest?.("button")) return;
      setTimeout(() => {
        try {
          app.close?.();
        } catch { /* already gone */ }
      }, 200);
    });
  }

  disable() {
    this.#active = false;
    for (const [name, id] of this.#hooks) Hooks.off(name, id);
    this.#hooks.length = 0;

    // Hand Foundry's chat log back before the stack tears its host down, or
    // the log leaves with it and the sidebar comes back empty.
    this.#onChatDismissed();
    this.#stopCombatHooks();
    this.#collapseDiceBar();
    this.#hideJoystick();
    this.#dismissToast();
    // destroy() rather than popAll(): teardown must not wait on exit
    // animations for screens that are about to be removed anyway.
    this.#nav?.destroy();
    this.#status?.destroy();
    this.#commands?.destroy();
    this.#nav = this.#status = this.#commands = null;
    this.#chatView = this.#combatView = null;
    for (const el of [this.#home, this.#empty]) el?.remove();
    this.#home = this.#empty = null;
    this.#msheet?.destroy();
    this.#msheet = null;
    // destroy() rather than dismiss(): teardown must not wait on an exit
    // animation, and a reload prompt while the module is switching off would
    // be asking about a screen that no longer exists.
    this.#settings?.destroy();
    this.#settings = null;
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
      this.#refreshRoster();
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

  /** Close the sheet back to the home screen. */
  closeSheet() {
    const view = this.#nav?.find(VIEW.SHEET);
    if (view) return void view.pop();
    this.#app?.close();
  }

  /**
   * Present our native mobile sheet as a stack view.
   *
   * The sheet draws its own header (portrait, hit points, tabs), so the view
   * carries no nav bar of its own — but it is still a stack view, so the back
   * drag works on it exactly as it does everywhere else.
   * @param {Actor} actor
   */
  #openMobileSheet(actor) {
    // Guarded before the try below, which treats a throw as "this actor's
    // mobile sheet is broken" — a missing stack is a shell problem, and
    // blaming the actor for it would permanently demote them to the
    // system's own sheet.
    if (!this.#nav) return void Logger.warn("No navigation stack — cannot present the mobile sheet");

    const open = this.#nav.find(VIEW.SHEET);
    if (open && this.#msheet?.actor?.id === actor.id) {
      // Already open for this actor. Selecting them again — from the roster,
      // from a chat link — should surface that sheet, not stack a second one.
      return void this.#nav.reveal(open);
    }

    try {
      // Constructed before pushing: an actor the adapters cannot model throws
      // here, and must not leave an empty view animating in behind the error.
      const sheet = new MobileSheet({
        actor,
        buildModel: modelFor,
        onBack: () => this.closeSheet()
      });
      const view = this.#nav.push({
        id: VIEW.SHEET,
        className: `${CLS}-sheet-view`,
        chrome: false,
        onPop: () => {
          if (this.#msheet === sheet) this.#msheet = null;
          // Only when nothing replaced it: swapping character pushes the new
          // sheet before retiring this one, and the command must stay lit.
          if (!this.#nav?.find(VIEW.SHEET)) this.#commands?.setActive("sheet", false);
          sheet.destroy();
        }
      });
      sheet.mount(view.body);
      this.#msheet = sheet;
      this.#commands?.setActive("sheet", true);
      // Retired only once the replacement is up, so switching character never
      // flashes the home screen between the two sheets.
      if (open) this.#nav.remove(open);
    } catch (err) {
      // The mobile sheet is broken for this actor: remember it and fall
      // back to the system's own sheet so play can continue.
      Logger.error(`Mobile sheet failed for "${actor.name}" — using the native sheet`, err);
      ui.notifications?.warn(`Velvet Mobile: ${err?.message ?? err}`);
      this.#msheetFailed.add(actor.id);
      this.#nav?.find(VIEW.SHEET)?.pop();
      this.#msheet = null;
      actor.sheet?.render(true);
    }
  }

  /** @param {object} app */
  #onRenderSheet(app) {
    if (!this.#active || !app.actor) return;
    // Supported actors always present through our mobile sheet — intercept
    // any Foundry sheet render (chat links, macros…). Actors whose mobile
    // sheet crashed are exempt, or this would loop forever.
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
    this.#commands?.setActive("sheet", true);
    // Neutralize self-positioning so nothing fights the fullscreen CSS.
    if (!this.#unpinApp) {
      const original = app.setPosition;
      app.setPosition = () => app.position;
      this.#unpinApp = () => {
        app.setPosition = original;
        SheetShell.#elementOf(app)?.classList.remove(PINNED_CLS);
      };
    }
    this.#injectBackBar(element);
    this.#slideIn(element);
    const off = services.gestures?.on(element, "swipe", (g) => this.#onTabSwipe(g));
    if (off) this.#drawerGestures.push(off);
  }

  /** @param {object} app */
  #onCloseSheet(app) {
    if (app !== this.#app) return;
    this.#undecorate();
  }

  /** Reverse every per-app modification. */
  #undecorate() {
    for (const off of this.#drawerGestures) off();
    this.#drawerGestures.length = 0;
    SheetShell.#elementOf(this.#app)?.querySelector(`.${CLS}-pinned-bar`)?.remove();
    this.#unpinApp?.();
    this.#unpinApp = null;
    this.#app = null;
    this.#commands?.setActive("sheet", false);
    // Only the pinned app owned this attribute if no stack view is up; the
    // NavStack sets and clears it for its own screens.
    if (!this.#nav?.depth) document.documentElement.removeAttribute(ROOT_ATTRS.DRAWER);
  }

  /** Enter from the right, matching every stack view. @param {HTMLElement} element */
  #slideIn(element) {
    Motion.slide(element, "translateX(100%)", "translateX(0)").then(() => {
      element.style.transform = "";
    });
  }

  /**
   * Back bar across the top of a pinned Foundry sheet.
   *
   * This element belongs to Foundry, not to us, so it cannot live inside the
   * NavStack — but it still has to leave the way everything else does. The
   * bar gives it the same back chevron, and a left-edge drag gives it the
   * same gesture.
   * @param {HTMLElement} element
   */
  #injectBackBar(element) {
    const el = VelvetComponent.el;
    const dismiss = () => {
      SheetShell.#haptic();
      Motion.slide(element, element.style.transform || "translateX(0)", "translateX(100%)", { duration: DURATION.FAST })
        .then(() => this.closeSheet());
    };

    const back = el("button", {
      cls: `${CLS}-nav-back`,
      attrs: { type: "button", "aria-label": game.i18n.localize(`${L10N}.Shell.Back`) },
      children: [VelvetComponent.icon("fa-solid fa-chevron-left")]
    });
    // A plain button guarantees the sheet can always be closed, even if
    // pointer gestures misbehave on some browser.
    back.addEventListener("click", dismiss);

    const bar = el("header", {
      cls: `${CLS}-nav-bar ${CLS}-pinned-bar`,
      children: [
        back,
        el("h2", { cls: `${CLS}-nav-title`, text: this.actor?.name ?? "" }),
        el("div", { cls: `${CLS}-nav-actions` })
      ]
    });
    element.prepend(bar);

    // Where a drag started decides who owns it: the left edge goes back, and
    // anywhere else is free to change tabs. Without this, dragging back also
    // skipped a tab on the way out.
    const onDown = (event) => { this.#pinnedSwipeStartX = event.clientX; };
    element.addEventListener("pointerdown", onDown, { capture: true });
    this.#drawerGestures.push(() => element.removeEventListener("pointerdown", onDown, { capture: true }));

    let dragging = false;
    const off = services.gestures?.on(element, "pan", (g) => {
      if (g.phase === "began") {
        dragging = (g.x - g.dx) <= BACK_EDGE;
        return;
      }
      if (!dragging) return;
      if (g.phase === "changed") {
        element.style.transform = `translateX(${Math.max(0, g.dx)}px)`;
        return;
      }
      if (g.phase !== "ended" && g.phase !== "cancelled") return;
      dragging = false;
      const dx = Math.max(0, g.dx ?? 0);
      const width = element.getBoundingClientRect().width || window.innerWidth;
      if (dx > width * BACK_FRACTION || (g.vx ?? 0) > BACK_VELOCITY) return void dismiss();
      Motion.slide(element, `translateX(${dx}px)`, "translateX(0)", { duration: DURATION.FAST })
        .then(() => { element.style.transform = ""; });
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
    // The left edge belongs to the back gesture (see #injectBackBar).
    if (this.#pinnedSwipeStartX <= BACK_EDGE) return;
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
    // File paths are user-supplied and may legitimately contain quotes or
    // backslashes, which would terminate the CSS string early and break the
    // declaration (or, on a crafted path, smuggle another one in).
    const escaped = src ? src.replaceAll("\\", "\\\\").replaceAll('"', '\\"') : "";
    bg.style.backgroundImage = escaped ? `url("${escaped}")` : "";
  }

  /* -- Persistent chrome ---------------------------------------------------------- */

  /** Status bar, navigation stack and command bar, in painting order. */
  #buildChrome() {
    const t = (key) => game.i18n.localize(`${L10N}.Shell.${key}`);

    this.#status = new StatusBar({
      onOpenSheet: () => this.openSheet(),
      onOpenRoster: () => this.#toggleRoster(),
      onOpenSettings: () => this.openSettings()
    }).mount();

    this.#nav = new NavStack().mount();

    // Priority order: the first five get a slot, the rest go to the overflow
    // menu. Targeting and movement only exist where there is a map to use
    // them on, so a canvas-less table gets a shorter — and complete — bar.
    const actions = [
      { name: "sheet", icon: "fa-solid fa-user", label: t("Sheet"), onTap: () => this.openSheet() },
      Settings.map
        ? { name: "move", icon: "fa-solid fa-gamepad", label: t("Move"), onTap: () => this.#toggleJoystick() }
        : null,
      { name: "chat", icon: "fa-solid fa-comments", label: t("Chat"), onTap: () => this.toggleChat() },
      { name: "combat", icon: "fa-solid fa-swords", label: t("Combat"), onTap: () => this.toggleCombat() },
      Settings.map
        ? { name: "target", icon: "fa-solid fa-crosshairs", label: t("Target"), onTap: () => this.#toggleTargetPicker() }
        : null,
      // Dice Tray already puts a dice bar inside the chat panel, and most
      // tables that want dice buttons have it. Two rows of the same dice is
      // wasted thumb space, so ours steps aside when it is present.
      SheetShell.#hasDiceTray()
        ? null
        : { name: "dice", icon: "fa-solid fa-dice-d20", label: t("Dice"), onTap: () => this.#toggleDiceBar() }
    ].filter(Boolean);

    this.#commands = new CommandBar({ actions }).mount();
    this.#refreshRoster();
  }

  /* -- Roster --------------------------------------------------------------------- */

  /**
   * Re-read who is available, keep the status bar honest, and redraw the
   * roster if it happens to be open.
   */
  #refreshRoster() {
    const available = this.#availableActors();
    if (!available.length) {
      this.#status?.setActor(null);
      if (!this.#app) this.#showEmptyState();
      return;
    }
    this.#hideEmptyState();
    if (!available.some((a) => a.id === this.#actorId)) this.#actorId = available[0].id;
    this.#status?.setActor(this.actor);

    const view = this.#nav?.find(VIEW.ROSTER);
    if (view) this.#fillRoster(view);
  }

  #toggleRoster() {
    const open = this.#nav?.find(VIEW.ROSTER);
    if (open) return void open.pop();
    if (!this.#nav) return;
    const view = this.#nav.push({
      id: VIEW.ROSTER,
      title: game.i18n.localize(`${L10N}.Shell.Roster`),
      className: `${CLS}-roster`
    });
    this.#fillRoster(view);
  }

  /**
   * A grid of character cards. A grid rather than a horizontal strip because
   * a party of eight should be one glance, not eight swipes.
   * @param {import("../components/nav-stack.mjs").NavView} view
   */
  #fillRoster(view) {
    const el = VelvetComponent.el;
    const cards = this.#availableActors().map((actor) => this.#buildRosterCard(actor));
    view.body.replaceChildren(el("div", { cls: `${CLS}-roster-grid`, children: cards }));
  }

  /** @param {Actor} actor @returns {HTMLElement} */
  #buildRosterCard(actor) {
    const el = VelvetComponent.el;
    const hp = hpOf(actor);
    const children = [
      el("img", {
        cls: `${CLS}-roster-portrait`,
        attrs: { src: actor.img || "icons/svg/mystery-man.svg", alt: "", loading: "lazy" }
      }),
      el("span", { cls: `${CLS}-roster-name`, text: actor.name })
    ];

    if (hp) {
      const fill = el("span", { cls: `${CLS}-roster-hp-fill`, attrs: { style: `width: ${hp.pct}%` } });
      SheetShell.#applyHpTone(fill, hp.pct);
      children.push(el("span", {
        cls: `${CLS}-roster-hp`,
        children: [fill, el("span", { cls: `${CLS}-roster-hp-text`, text: `${hp.value} / ${hp.max}` })]
      }));
    }

    const card = el("button", {
      cls: `${CLS}-roster-card ${actor.id === this.#actorId ? `${CLS}-selected` : ""}`.trim(),
      attrs: { type: "button", "data-actor-id": actor.id },
      children
    });
    card.addEventListener("click", () => this.selectActor(actor.id));
    return card;
  }

  /** Live HP + name updates for the status bar, the roster and the open sheet. @param {Actor} actor */
  #onActorUpdate(actor) {
    if (this.#msheet?.actor?.id === actor.id) this.#msheet.refresh();
    if (actor.id === this.#actorId) this.#status?.refresh();

    const card = this.#nav?.find(VIEW.ROSTER)?.body.querySelector(`[data-actor-id="${actor.id}"]`);
    if (!card) return;
    const hp = hpOf(actor);
    const fill = card.querySelector(`.${CLS}-roster-hp-fill`);
    if (fill && hp) {
      fill.style.width = `${hp.pct}%`;
      SheetShell.#applyHpTone(fill, hp.pct);
      card.querySelector(`.${CLS}-roster-hp-text`).textContent = `${hp.value} / ${hp.max}`;
    }
    card.querySelector("img")?.setAttribute("src", actor.img || "icons/svg/mystery-man.svg");
    card.querySelector(`.${CLS}-roster-name`).textContent = actor.name;
  }

  /** @param {HTMLElement} fill @param {number} pct */
  static #applyHpTone(fill, pct) {
    fill.classList.toggle(`${CLS}-critical`, pct <= 25);
    fill.classList.toggle(`${CLS}-low`, pct > 25 && pct <= 50);
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
    this.#commands?.setActive("dice", true);
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
    this.#commands?.setActive("dice", false);
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
    // Every walk starts on the same foot, so short hops sound deliberate.
    resetFootsteps();
    this.#joystick = new Joystick({
      onStep: (dx, dy) => this.#moveToken(dx, dy),
      onClose: () => this.#hideJoystick()
    }).mount();
    this.#commands?.setActive("move", true);
    // Moving means watching the map: reveal it, own the token, center on
    // it, and offer zoom buttons (pinch is unreliable over PIXI).
    if (Settings.map) {
      this.closeSheet();
      this.#controlToken();
      this.#panToToken({ animate: false });
      this.#buildZoom();
    }
    // Hand the top of the screen over to the map while the player is driving.
    // Tied to the joystick rather than to panning: a timer that restored the
    // bar a second after each step would flicker on every square walked.
    this.#setChromeHidden(true);
  }

  #hideJoystick() {
    this.#joystick?.destroy();
    this.#joystick = null;
    this.#zoom?.remove();
    this.#zoom = null;
    this.#commands?.setActive("move", false);
    this.#setChromeHidden(false);
  }

  /**
   * Slide the status bar off-screen and back, for modes that want the map.
   *
   * Deliberately only the top bar. The command bar holds the control that
   * turns movement off again, and hiding the way out of a mode traps the
   * player in it — which is exactly what it did.
   * @param {boolean} hidden
   */
  #setChromeHidden(hidden) {
    this.#status?.setHidden(hidden);
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
   * Step the selected actor's token one grid square, through the same
   * movement API the core's own arrow keys use — so it replicates to the GM
   * and every other client, respects walls and terrain, and records movement
   * history the way desktop movement does. See canvas/token-mover.mjs for
   * the grid maths and the step animation.
   * @param {number} dx @param {number} dy  Each in {-1, 0, 1}.
   */
  async #moveToken(dx, dy) {
    const tokenDoc = this.#tokenDoc();
    if (!tokenDoc) return void this.#warnNoToken();
    try {
      // A refused step is not a failure: walls, illegal diagonals and scene
      // bounds all legitimately answer "no". Only throwing is a problem.
      const moved = await stepToken(tokenDoc, dx, dy);
      // Follow only when the token nears the edge, so a framing the player
      // chose by panning survives their next step.
      if (moved) this.#keepTokenInView();
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
    const centre = this.#tokenCentre();
    if (!centre) return;
    const { x, y } = centre;
    try {
      if (animate) canvas.animatePan({ x, y, duration: 150 });
      else canvas.pan({ x, y });
    } catch (err) {
      Logger.debug("Camera pan failed", err);
    }
  }

  /**
   * Follow the token only once it nears the edge of the view.
   *
   * Recentring on every step pins the camera to the token, so a player who
   * pans sideways to look at something loses the framing on their next step
   * and the map appears to snap back. Chasing only when the token leaves the
   * middle of the screen keeps a deliberate framing intact while still never
   * letting the token walk off-screen.
   *
   * @param {number} [margin] Fraction of the half-viewport the token may
   *   wander into before the camera follows. 0.6 leaves a comfortable
   *   dead zone without letting the token reach the edge.
   */
  #keepTokenInView(margin = 0.6) {
    if (!Settings.map || !canvas?.ready) return;
    const centre = this.#tokenCentre();
    if (!centre) return;
    try {
      const scale = canvas.stage?.scale?.x || 1;
      const pivot = canvas.stage?.pivot;
      const screen = canvas.app?.screen;
      const width = screen?.width || window.innerWidth;
      const height = screen?.height || window.innerHeight;
      if (!pivot) return void this.#panToToken();
      // Half the visible map, in world units.
      const halfW = width / 2 / scale;
      const halfH = height / 2 / scale;
      const outside = Math.abs(centre.x - pivot.x) > halfW * margin
        || Math.abs(centre.y - pivot.y) > halfH * margin;
      if (outside) this.#panToToken();
    } catch (err) {
      Logger.debug("Viewport check failed — recentring", err);
      this.#panToToken();
    }
  }

  /** @returns {{x:number, y:number}|null} The selected token's centre, in world units. */
  #tokenCentre() {
    const tokenDoc = this.#tokenDoc();
    if (!tokenDoc) return null;
    const size = tokenDoc.parent?.grid?.size ?? 100;
    return {
      x: tokenDoc.x + ((tokenDoc.width ?? 1) * size) / 2,
      y: tokenDoc.y + ((tokenDoc.height ?? 1) * size) / 2
    };
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
    const open = this.#nav?.find(VIEW.TARGET);
    if (open) return void open.pop();
    this.#openTargetPicker();
  }

  /**
   * A list of the scene's tokens (hostiles first) — tap one to target it for
   * the next attack. Far more reliable on touch than tapping tiny tokens on
   * the PIXI canvas.
   */
  #openTargetPicker() {
    const t = (key) => game.i18n.localize(`${L10N}.Shell.${key}`);
    if (!canvas?.ready) return void ui.notifications?.warn(t("NoTargets"));
    if (!this.#nav) return;

    const mineId = this.#tokenDoc()?.id;
    const tokens = canvas.tokens.placeables
      .filter((tok) => tok.actor && !tok.document.hidden && tok.id !== mineId && (game.user.isGM || tok.visible))
      .sort((a, b) =>
        (a.document.disposition ?? 0) - (b.document.disposition ?? 0)
        || a.document.name.localeCompare(b.document.name));

    const view = this.#nav.push({
      id: VIEW.TARGET,
      title: t("Target"),
      className: `${CLS}-targets`
    });
    const body = view.body;
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
        view.pop();
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
        view.pop();
      });
      body.append(row);
    }
  }

  /** Keep the crosshair command lit while something is targeted. */
  #refreshTargetState() {
    this.#commands?.setActive("target", game.user.targets.size > 0);
  }

  /* -- Encounter tracker ------------------------------------------------------- */

  toggleCombat() {
    this.#combatView ? this.closeCombat() : this.openCombat();
  }

  /**
   * The encounter's turn order, as a stack screen.
   *
   * Foundry's own tracker is a dense desktop widget that takes its height and
   * scrolling from sidebar-scoped rules, so borrowing the element the way the
   * chat panel does gave a panel that was populated but collapsed. This
   * follows the same rule as the character sheet instead: never squeeze the
   * desktop UI onto a phone, draw a phone UI over the same data.
   *
   * Full-width rows rather than the old narrow rail: with the round in the
   * title bar there is room to show each combatant's name outright, instead
   * of hiding it in a tooltip a touch device cannot open.
   */
  openCombat() {
    if (this.#combatView || !this.#active || !this.#nav) return;
    if (!SheetShell.#visibleTurns().length) {
      return void ui.notifications?.info(game.i18n.localize(`${L10N}.Shell.NoEncounter`));
    }

    this.#combatView = this.#nav.push({
      id: VIEW.COMBAT,
      title: game.i18n.localize(`${L10N}.Shell.Combat`),
      className: `${CLS}-combat`,
      onPop: () => {
        this.#combatView = null;
        this.#stopCombatHooks();
        this.#commands?.setActive("combat", false);
      }
    });
    this.#commands?.setActive("combat", true);
    this.#renderCombat();

    // Follow the encounter live: turns advance, combatants join and die.
    for (const name of ["updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant"]) {
      this.#combatHooks.push([name, Hooks.on(name, () => this.#renderCombat())]);
    }
  }

  async closeCombat() {
    // The view's onPop clears the field and the hooks; going through it keeps
    // closing by back-gesture and closing by command on the same path.
    await this.#combatView?.pop();
  }

  /** Drop the live-encounter hooks. Safe to call when none are registered. */
  #stopCombatHooks() {
    for (const [name, id] of this.#combatHooks) Hooks.off(name, id);
    this.#combatHooks.length = 0;
  }

  /** @returns {Combatant[]} Turn order this user is allowed to see. */
  static #visibleTurns() {
    // `visible` already hides what this user has no business knowing about.
    return (game.combat?.turns ?? []).filter((combatant) => combatant?.visible);
  }

  /** Draw (or redraw) the turn order into the encounter screen. */
  #renderCombat() {
    const view = this.#combatView;
    if (!view) return;
    const combat = game.combat;
    const turns = SheetShell.#visibleTurns();
    // The encounter ended while the screen was open: nothing left to track.
    if (!turns.length) return void this.closeCombat();

    const t = (key) => game.i18n.localize(`${L10N}.Shell.${key}`);
    view.title = `${t("Combat")} · ${t("Round")} ${combat.round ?? 0}`;

    view.body.replaceChildren(...turns.map((combatant) => this.#buildCombatantRow(combatant, combat)));
    view.body.querySelector(".vm-combat-active")?.scrollIntoView({ block: "nearest" });
  }

  /**
   * One combatant as a full-width row: portrait, name, initiative.
   * @param {Combatant} combatant @param {Combat} combat @returns {HTMLElement}
   */
  #buildCombatantRow(combatant, combat) {
    const el = VelvetComponent.el;
    const initiative = combatant.initiative;
    const children = [
      el("img", {
        cls: "vm-combat-portrait",
        attrs: { src: combatant.img || combatant.actor?.img || "icons/svg/mystery-man.svg", alt: "", loading: "lazy" }
      }),
      el("span", { cls: "vm-combat-name", text: combatant.name })
    ];
    if (initiative !== null && initiative !== undefined) {
      children.push(el("span", { cls: "vm-combat-init", text: String(initiative) }));
    }

    const classes = ["vm-combat-row"];
    if (combat.combatant?.id === combatant.id) classes.push("vm-combat-active");
    if (combatant.isDefeated) classes.push("vm-combat-defeated");
    if (combatant.hidden) classes.push("vm-combat-hidden");

    const row = el("button", {
      cls: classes.join(" "),
      attrs: { type: "button", "data-combatant-id": combatant.id, "aria-label": combatant.name },
      children
    });
    row.addEventListener("click", () => this.#onCombatantTap(combatant));
    return row;
  }

  /** Centre the camera on whoever was tapped, when there is a map to pan. */
  #onCombatantTap(combatant) {
    SheetShell.#haptic();
    if (!Settings.map || !canvas?.ready) return;
    const token = combatant.token?.object;
    if (!token) return;
    try {
      canvas.animatePan({ x: token.center?.x ?? token.x, y: token.center?.y ?? token.y, duration: 200 });
    } catch (err) {
      Logger.debug("Could not pan to the combatant", err);
    }
  }

  /* -- Settings ------------------------------------------------------------------ */

  /**
   * Open the mobile settings screen.
   *
   * Foundry's own dialog is two columns of desktop chrome that a phone cannot
   * show — the category list takes the width and the controls are pushed
   * off-screen — so this draws the same registry as a phone screen instead.
   */
  openSettings() {
    if (this.#settings) return;
    try {
      this.#settings = new MobileSettings({ onDismiss: () => { this.#settings = null; } }).open();
    } catch (err) {
      // Never strand the user without a way into settings: the desktop
      // dialog is cramped but it is better than nothing.
      Logger.error("Mobile settings failed to open — falling back to Foundry's dialog", err);
      this.#settings = null;
      game.settings.sheet.render(true);
    }
  }

  /* -- Chat screen --------------------------------------------------------------- */

  toggleChat() {
    this.#chatView ? this.closeChat() : this.openChat();
  }

  /**
   * Host Foundry's real chat log in a stack screen.
   *
   * Everything here runs guarded. Anything this throws would otherwise become
   * an unhandled rejection that nobody sees: the button would simply stop
   * working, with Foundry's chat log left orphaned inside a screen that never
   * finished opening.
   */
  async openChat() {
    if (this.#chatView || !this.#active || !this.#nav) return;
    const chat = SheetShell.#chatElement();
    if (!chat) return void Logger.warn("Chat element not found");

    try {
      this.#dismissToast();
      this.#chatView = this.#nav.push({
        id: VIEW.CHAT,
        title: game.i18n.localize(`${L10N}.Shell.Chat`),
        className: `${CLS}-chat`,
        onPop: () => this.#onChatDismissed()
      });

      // Re-parent before scrolling: the log has to be inside the screen for
      // the scroll container to have its final height when we scroll it.
      this.#chatHome = { parent: chat.parentElement, next: chat.nextSibling };
      this.#chatView.body.append(chat);
      chat.classList.add("vm-chat-hosted");
      this.#commands?.setBadge("chat", false);
      this.#commands?.setActive("chat", true);

      this.#chatAbort = new AbortController();
      // Acting on a chat card (Attack, Damage, Save…) opens a roll prompt
      // that the screen would cover, so step aside once the click is through.
      chat.addEventListener("click", (event) => this.#onChatCardAction(event), { signal: this.#chatAbort.signal });

      // The screen slides in over ~250ms. Scrolling before it lands measures a
      // container that is still growing, lands short, and leaves the newest
      // roll — the reason the chat was opened at all — below the fold.
      this.#scrollChatToBottom();
    } catch (err) {
      Logger.error("Chat screen failed to open", err);
      ui.notifications?.error(`Velvet Mobile: ${err?.message ?? err}`);
      // Hand Foundry's chat log back where it came from before giving up.
      await this.closeChat();
    }
  }

  /**
   * Close the chat screen when the user triggers an action from a message,
   * clearing the way for the prompt it opens. Reading the log — expanding a
   * card, following a link, scrolling — leaves the screen alone.
   * @param {MouseEvent} event
   */
  #onChatCardAction(event) {
    const button = event.target.closest?.("button");
    if (!button || !button.closest(".chat-message, .message, .chat-card")) return;
    // Collapse/expand toggles are reading aids, not actions.
    if (button.closest(".message-header") || button.matches("[data-action='expand'], [data-action='collapse'], .collapser")) return;
    setTimeout(() => this.closeChat(), 120);
  }

  async closeChat() {
    await this.#chatView?.pop();
    // Nothing on the stack to pop — a failed open, or teardown. Hand the log
    // back anyway; leaving it in a detached screen loses it from the sidebar.
    if (this.#chatHome) this.#onChatDismissed();
  }

  /** Return the chat log to its original home in the sidebar. */
  #onChatDismissed() {
    // Drop the listeners bound to the hosted chat before handing it back.
    this.#chatAbort?.abort();
    this.#chatAbort = null;
    this.#chatView = null;
    this.#commands?.setActive("chat", false);
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
    if (this.#chatView) {
      // An open screen does not scroll itself: Foundry appends the message and
      // leaves it below the fold, so a roll made with the chat already up was
      // invisible until you scrolled by hand.
      this.#scrollChatToBottom();
      return;
    }
    const mode = Settings.chatOnMessage;
    const shouldAnnounce = mode === "all" || (mode === "rolls" && message?.isRoll);
    // Never interrupt while the user is typing.
    if (shouldAnnounce && !services.keyboard?.isOpen) this.#showToast(message);
    this.#commands?.setBadge("chat", true);
  }

  /* -- Chat toast ----------------------------------------------------------------- */

  /**
   * Announce an incoming message without taking the screen.
   *
   * The old behaviour pushed the whole chat panel up over whatever you were
   * doing on every roll, which is far too much interruption for a line of
   * text. A toast says the same thing in a strip, fades on its own, and opens
   * the full log if it turns out to be worth reading.
   * @param {ChatMessage} message
   */
  #showToast(message) {
    this.#dismissToast();
    const el = VelvetComponent.el;

    // Roll totals are the reason most messages arrive; show the number rather
    // than the markup that draws it. Everything else falls back to its text.
    const total = message?.rolls?.[0]?.total;
    const body = total !== undefined && total !== null
      ? `${message.flavor || message.alias || ""} ${total}`.trim()
      : SheetShell.#plainText(message);
    if (!body) return;

    this.#toast = el("button", {
      cls: `${CLS}-toast`,
      attrs: { type: "button" },
      children: [
        el("span", { cls: `${CLS}-toast-who`, text: message.alias ?? "" }),
        el("span", { cls: `${CLS}-toast-body`, text: body })
      ]
    });
    this.#toast.addEventListener("click", () => {
      this.#dismissToast();
      this.openChat();
    });
    document.body.append(this.#toast);

    // The auto-hide setting keeps its meaning: how long an unattended
    // announcement stays up. Zero means the user asked for no auto-hide, so
    // the toast waits for a tap.
    const seconds = Settings.chatAutoHide;
    if (seconds === 0) return;
    this.#toastTimer = setTimeout(() => {
      this.#toastTimer = null;
      this.#dismissToast();
    }, seconds ? seconds * 1000 : TOAST_MS);
  }

  #dismissToast() {
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.#toastTimer = null;
    const toast = this.#toast;
    this.#toast = null;
    if (!toast) return;
    Motion.fade(toast, 1, 0).then(() => toast.remove());
  }

  /**
   * A chat message as a single line of plain text, with Foundry's markup and
   * any inline roll formatting stripped out.
   * @param {ChatMessage} message
   * @returns {string}
   */
  static #plainText(message) {
    const raw = message?.content ?? "";
    if (!raw) return "";
    const holder = document.createElement("div");
    // The content is authored HTML from another user. It is never inserted
    // into the live document — this element stays detached and only its
    // textContent is read — so no script in it can run.
    holder.innerHTML = raw;
    return (holder.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
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
  /**
   * Pin the chat log to its newest message.
   *
   * Deferred by two frames on purpose: `createChatMessage` fires when the
   * document is created, before Foundry has appended the card, and the panel
   * finishes settling in the same window. Scrolling earlier measures a
   * container that does not yet contain the message we want to reveal.
   *
   * `ui.chat.scrollBottom()` is the supported route and is tried first; the
   * direct assignment is a backstop for when the log is reparented into our
   * panel and core's own lookup comes back empty.
   */
  #scrollChatToBottom() {
    if (!this.#chatView) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!this.#chatView) return;
      try {
        ui.chat?.scrollBottom?.({ waitImages: false });
      } catch (err) {
        Logger.debug("Core chat scroll refused", err);
      }
      const chat = SheetShell.#chatElement();
      const log = chat?.querySelector(".chat-log, #chat-log, ol.chat-log") ?? chat;
      if (log instanceof HTMLElement && log.scrollHeight > log.clientHeight) {
        log.scrollTop = log.scrollHeight;
      }
    }));
  }

  /**
   * Whether Dice Tray is installed and active. Its module id is
   * `dice-calculator` rather than anything resembling its title, so this is
   * the one place that mapping is written down.
   * @returns {boolean}
   */
  static #hasDiceTray() {
    return game.modules?.get("dice-calculator")?.active === true;
  }

  static #chatElement() {
    const element = ui.chat?.element;
    if (element instanceof HTMLElement) return element;
    return element?.[0] ?? document.getElementById("chat");
  }

}
