/**
 * Velvet Mobile — central constants.
 * Every setting key, hook name, attribute and magic value lives here.
 * No other file may declare a string identifier of its own.
 * @module core/constants
 */

/** Module identifier. Must match the module folder name and module.json id. */
export const MODULE_ID = "velvet-mobile";

/** Human-readable title used in log prefixes. */
export const MODULE_TITLE = "Velvet Mobile";

/** Localization key prefix. */
export const L10N = "VELVETMOBILE";

/** Setting keys (registered under MODULE_ID). */
export const SETTINGS = Object.freeze({
  MODE: "mode",
  THEME: "theme",
  MAP: "map",
  WORLD_LICENSED: "worldLicensed",
  LICENSE_MENU: "licenseMenu",
  UI_SCALE: "uiScale",
  CHAT_ON_MESSAGE: "chatOnMessage",
  CHAT_AUTO_HIDE: "chatAutoHide",
  MOVE_STYLE: "moveStyle",
  STEP_SOUND: "stepSound",
  STEP_SOUND_ALT: "stepSoundAlt",
  STEP_VOLUME: "stepVolume",
  MANAGED_NOCANVAS: "managedNoCanvas",
  DEBUG: "debug"
});

/** Values for the `moveStyle` setting — how a joystick step is animated. */
export const MOVE_STYLES = Object.freeze({
  /** Lift, slide, land: each tile is a deliberate move, like a chess piece. */
  WEIGHTED: "weighted",
  /** Straight to the next tile, with only the core's own movement animation. */
  DIRECT: "direct"
});

/**
 * Footstep samples shipped with the module, as paths from the Foundry data
 * root. Empty until samples worth shipping exist: the setting is a file
 * picker either way, so an empty default is silent rather than broken, and
 * filling these in is the only change needed to give the joystick a voice.
 *
 * Whatever lands here should not be a matched pair. Two identical samples
 * alternating read as a loop rather than as walking; roughly 5 dB and 15 ms
 * of tail between them is enough, with their transients landing at the same
 * offset so the cadence stays even.
 */
export const STEP_SOUNDS = Object.freeze({
  FIRST: "",
  SECOND: ""
});

/** Peak lift of a weighted step, as a fraction of the token's own size. */
export const STEP_LIFT = 0.16;

/** Share of a step spent rising; the remainder is the landing. */
export const STEP_RISE_SHARE = 0.45;

/** Bounds (ms) for the lift/land pair, so a step reads at any movement speed. */
export const STEP_LIFT_MIN_MS = 90;
export const STEP_LIFT_MAX_MS = 260;

/** Values for the `chatOnMessage` setting. */
export const CHAT_MODES = Object.freeze({
  NONE: "none",
  ROLLS: "rolls",
  ALL: "all"
});

/**
 * Visual themes. Each one carries the design language of one of the desktop
 * sheet modules onto the phone, so a table that plays with a themed sheet
 * gets the same sheet on mobile rather than a second, unrelated look.
 *
 * `AUTO` is not a theme — it is the instruction to work one out (see
 * core/theme.mjs). Every other value is also the `data-vm-theme` attribute
 * value and the CSS block name in styles/themes.css.
 */
export const THEMES = Object.freeze({
  AUTO: "auto",
  /** The module's own look: purple accent on neutral dark chrome. */
  VELVET: "velvet",
  /** AAA D&D Character Sheet — gold on black, Cinzel. */
  AAA: "aaa",
  /** SF2e / PF2e Cyberpunk UI — cyan on navy, Rajdhani. */
  CYBER: "cyber",
  /** Hopefinder Survivor Sheet — olive and amber, Barlow Condensed. */
  HOPEFINDER: "hopefinder",
  /** Velvet PF2e Sheet — gold on void, Cinzel Decorative. */
  VELVET_PF2E: "velvet-pf2e"
});

/**
 * Companion sheet modules, by module id. When one of these is active its
 * theme wins over the system default: three of them serve pf2e, so the
 * system alone cannot say which look the table actually plays with.
 *
 * Order matters — the first active match wins.
 */
export const THEME_MODULES = Object.freeze([
  Object.freeze({ id: "aaa-dnd-sheet", theme: THEMES.AAA }),
  Object.freeze({ id: "dnd-velvet-sheets", theme: THEMES.AAA }),
  Object.freeze({ id: "sf2e-cyber-sheet", theme: THEMES.CYBER }),
  Object.freeze({ id: "hopefinder-sheet", theme: THEMES.HOPEFINDER }),
  Object.freeze({ id: "pf2e-velvet-sheet", theme: THEMES.VELVET_PF2E })
]);

/** Fallback theme per game system, when no companion module is installed. */
export const THEME_SYSTEMS = Object.freeze({
  dnd5e: THEMES.AAA,
  sf2e: THEMES.CYBER,
  starfinder2e: THEMES.CYBER,
  pf2e: THEMES.VELVET_PF2E,
  hopefinder: THEMES.HOPEFINDER
});

/** Values for the `mode` setting. */
export const MODES = Object.freeze({
  AUTO: "auto",
  PHONE: "phone",
  TABLET: "tablet",
  OFF: "off"
});

/** Device classifications produced by the DeviceProfiler. */
export const DEVICES = Object.freeze({
  PHONE: "phone",
  TABLET: "tablet",
  DESKTOP: "desktop"
});

/** Input classifications produced by the DeviceProfiler. */
export const INPUTS = Object.freeze({
  TOUCH: "touch",
  MOUSE: "mouse",
  HYBRID: "hybrid"
});

/** Orientation values. */
export const ORIENTATIONS = Object.freeze({
  PORTRAIT: "portrait",
  LANDSCAPE: "landscape"
});

/**
 * Width breakpoints (content-based, not device-based).
 * A viewport belongs to the first bucket whose `max` exceeds its width.
 */
export const SIZE_BUCKETS = Object.freeze([
  Object.freeze({ id: "xs", max: 380 }),
  Object.freeze({ id: "sm", max: 600 }),
  Object.freeze({ id: "md", max: 900 }),
  Object.freeze({ id: "lg", max: 1200 }),
  Object.freeze({ id: "xl", max: Infinity })
]);

/** Minimum viewport dimension below which a touch device is a phone, not a tablet. */
export const PHONE_MAX_MIN_DIMENSION = 600;

/** Public hooks fired by this module. */
export const HOOKS = Object.freeze({
  READY: "velvetMobile.ready",
  DEVICE_CHANGED: "velvetMobile.deviceChanged",
  ACTOR_CHANGED: "velvetMobile.actorChanged"
});

/** Attributes applied to <html> — the single JS→CSS contract. */
export const ROOT_ATTRS = Object.freeze({
  ACTIVE: "data-vm-active",
  DEVICE: "data-vm-device",
  INPUT: "data-vm-input",
  ORIENTATION: "data-vm-orientation",
  SIZE: "data-vm-size",
  KEYBOARD: "data-vm-keyboard",
  SHEET_ONLY: "data-vm-sheet-only",
  DRAWER: "data-vm-drawer",
  MAP: "data-vm-map",
  THEME: "data-vm-theme",
  /** The raw system id, so a theme can still special-case one system. */
  SYSTEM: "data-vm-system"
});

/** CSS custom properties written by JS onto <html> (inline, so they win over tokens.css defaults). */
export const CSS_VARS = Object.freeze({
  VISUAL_HEIGHT: "--vm-vvh",
  KEYBOARD_INSET: "--vm-kb",
  SCALE: "--vm-scale"
});

/** Class name prefix for every DOM element the component library creates. */
export const CLS = "vm";

/** Debounce applied to viewport/media re-evaluation, in milliseconds. */
export const REFRESH_DEBOUNCE_MS = 100;

/** Keyboard is considered open when the visual viewport shrinks more than this (px). */
export const KEYBOARD_MIN_INSET = 80;
