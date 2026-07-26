# Changelog

## Unreleased

### Changed — the encounter tracker is drawn, not borrowed
- **Turn order is now a rail down the right edge**, built from `game.combat`
  instead of hosting Foundry's own tracker element. Hosting worked for the
  chat log because a list of messages reads the same at any width; the
  tracker is a dense desktop widget that takes its height and scrolling from
  sidebar-scoped rules, so once moved out of the sidebar it arrived populated
  but collapsed to nothing. This follows the rule the character sheet already
  follows: never squeeze the desktop UI onto a phone, draw a phone UI over
  the same data.
- A rail rather than a bottom sheet, because turn order is something you
  glance at *while* doing something else. It stops short of the speed-dial so
  the two never fight for the corner, and closes from its own button instead
  of by reopening the dial.
- Frosted capsule so the sheet stays readable underneath; a thread between
  portraits that turns a stack of faces into a readable order; the active
  turn ringed, lit and enlarged with its initiative badge inverted to the
  accent; round labelled and given its own hierarchy; defeated greyed out,
  hidden dashed; the list fades at both ends rather than cutting portraits
  off flat. Enters and leaves through the Motion engine, so reduced-motion is
  honoured.
- Sizes are pinned with `!important`. The module lives in a CSS layer and so
  loses to any unlayered rule another module ships — which is exactly what
  blew the portraits up to full size on a heavily modded world. Losing the
  cascade on someone else's element is good citizenship; losing it on our own
  overlay is a bug.
- Reads nothing but core Foundry (`game.combat`, `Combatant`,
  `canvas.animatePan`), so it behaves identically on every game system.
  `ChromeHider` goes back to hiding `ui.combat` now that nothing borrows it.

## 0.14.2 — Encounter tracker actually shows the encounter (2026-07-25)

### Fixed
- **The encounter tracker panel opened empty.** Foundry's sidebar only builds
  the tab the user is looking at, and combat is almost never it, so the
  element existed while its turn list had never been rendered — the shell
  borrowed a shell. The tracker is now rendered where it still lives before
  being moved (an already-rendered application refreshes in place), so what
  the panel hosts arrives populated. A second tap while it renders no longer
  opens a duplicate panel, and a tracker that is still empty after all that
  now says so in the console, distinguishing "no active encounter" from
  "something broke".

## 0.14.1 — Starfinder 2e (2026-07-25)

### Added
- **Starfinder 2e uses the Pathfinder 2e sheet.** sf2e is a fork of PF2e that
  kept the data model whole — it never renamed the namespaces and still reads
  `CONFIG.PF2E` and `game.pf2e` — so the PF2e adapter serves it unchanged:
  strikes, ammunition and reloading, spells by rank, carry states and
  resources, rather than the generic adapter's best guess. Its actor types
  (`character`, `npc`) are a subset of the ones that adapter already declares.

## 0.14.0 — Pathfinder 2e, system-agnostic sheets, encounter tracker (2026-07-25)

The mobile sheet no longer requires us to have written an adapter for your
game system, and Pathfinder 2e goes from a thin port of the D&D 5e layout to
a first-class implementation built on PF2e's own `Statistic` API.

### Added — the module is now system-agnostic
- **Generic adapter** (`sheet/adapters/generic.mjs`). Systems without a
  dedicated adapter no longer fall straight through to a pinned desktop
  sheet. The generic adapter discovers hit points, a defence value, and
  ability- and skill-like blocks *by data shape* rather than by known paths,
  and groups items by their declared type. Taps route through the
  conventional entry points (`use` → `toMessage` → `roll` → chat card), so
  most systems are usable on a phone with no per-system work at all.
- **Adapter registry** (`sheet/adapters.mjs`). Adapters are registered per
  `game.system.id` and can be replaced, so a system-specific companion module
  can override our built-in support:
  `game.modules.get("velvet-mobile").api.sheet.registerAdapter(id, { model, types })`.
  Returns an unregister function; `api.sheet.systems` lists what is registered.
- **Long-press on list rows.** Rows gained an `onLong` action (with
  right-click as the desktop equivalent), used below for MAP attacks, carry
  state and resource spending.

### Added — Pathfinder 2e
- **Strikes** instead of a raw weapon list: tap attacks at full modifier,
  trailing buttons roll damage and critical damage, and a long press opens
  the multiple-attack-penalty picker so the second and third attacks of a
  turn use the right variant.
- **Ammunition and reloading.** Strikes that consume ammunition now show what
  is loaded and how much is left ("Bolts 1/1", "Empty") and gain a reload
  button. Previously a weapon with a reload time could not be fired from a
  phone at all: PF2e refuses the strike with "No ammunition is assigned…",
  and its reload control is an anchored popover that will not open without a
  desktop sheet to anchor to — only the GM could load the weapon. Reloading
  uses the system's own `attach()`, so it behaves exactly as on the desktop;
  weapons that merely expend ammunition (bows, slings) link a stack instead.
  With one compatible stack the button reloads straight away, otherwise it
  asks which. Unlike the desktop's one-round-per-click control, a tap fills
  the magazine — a repeating crossbow is not worth five taps on a phone.
- **Real spellcasting.** Spells are grouped into cantrips, spell ranks, focus
  spells and rituals, each section badged with slots actually remaining
  (summed across every spellcasting entry). Casting goes through the
  spellcasting entry's `cast()` at the correct rank, falling back to a chat
  card. Action costs show as ◆/◆◆/◆◆◆, R and F.
- **Resources you touch mid-session:** hero points, focus points and the
  dying track, tap to spend and hold to regain, with a recovery-check roll at
  the correct DC.
- **PF2e carry states.** Items are held in one or two hands, worn, carried or
  stowed — not a boolean "equipped". Changing carry goes through
  `actor.changeCarryType()`, and the current state shows on the row.
- **Currency**, invested items, class DC, every movement speed, and
  initiative rolled through `actor.initiative`.
- **Perception and saves** roll through PF2e's `Statistic` objects, honouring
  the user's own show-dialog preference rather than always skipping it.
- Familiars are now supported alongside characters and NPCs.

### Added — shell
- **Encounter tracker in the quick-actions dial.** Foundry's own tracker is
  borrowed into a bottom sheet the same way the chat log already was: the real
  element is moved out of the hidden sidebar and handed straight back on
  dismissal. Because it is the desktop tracker rather than a reimplementation,
  initiative, turn order and whatever a system adds to it behave identically.
  Opens at half height with a drag to full, and combatant rows get a
  thumb-sized minimum height.

### Changed
- An adapter that produces a *visibly empty* sheet is now rejected. Previously
  only a missing tab list triggered the native-sheet fallback, so an actor with
  a full tab bar of empty lists (a familiar with no skills, an actor whose
  derived getters threw) could present a blank mobile sheet. Content is now
  measured in rows and ability cells, and an empty model falls through to the
  generic adapter and then to the system's own sheet.
- HP damage/heal writes to whichever HP path the system actually uses instead
  of assuming `system.attributes.hp`.

### Unchanged
- **D&D 5e behaviour is byte-for-byte the same.** The adapter moved to
  `sheet/adapters/dnd5e.mjs` with only its helper imports rewritten.

### Fixed — Foundry v14 compatibility
- **`game.i18n.format()` no longer exists in v14** (14.353 merged it into
  `localize(key, data)`). Both licence helpers called it for the two
  interpolated strings, so on v14 the activation card and the "Connected as
  {tier} subscriber" notice threw `TypeError` — the GM could not reach the
  licence menu at all. Both helpers now ask the core which call it supports,
  so v13 keeps using `format` and v14 uses the merged `localize`.

## 0.13.1 — packaging & documentation polish (2026-07-24)

No functional changes to the module. Distribution stays **by manifest URL**
(Patreon-gated subscription model); this release tidies the repository and
release pipeline.

### Documentation
- **README rewritten.** Fixed the stale `License: TBD` line that contradicted
  the proprietary LICENSE, and the "v13-only" wording (the module is v13
  verified and v14-ready by audit). Added Installation (manifest URL),
  Requirements, Compatibility, FAQ, Troubleshooting, Support and developer/
  release sections.
- Added `CONTRIBUTING.md` and `SECURITY.md` (private vulnerability reporting).

### Release pipeline
- Release notes now contain **only the tagged version's** changelog section
  instead of the entire history.
- Manifest validation hardened in CI: checks the id is lowercase/hyphen and
  matches the folder, required fields are present, and the manifest/download
  URLs use `releases/latest/download`.

### Tooling
- Added GitHub issue templates (bug/feature), a pull-request template,
  `FUNDING.yml` (Patreon) and `.editorconfig` (LF/UTF-8, matching
  `.gitattributes`).

## 0.13.0 — v14 readiness audit (2026-07-24)

Full engineering audit against the released Foundry v14 API documentation.
No features changed; the module now avoids the internals most likely to move
between major versions.

### Verified against v14 documentation
- `ApplicationV1` is **not** removed in v14, so the AppV1 hooks this module
  registers (`renderActorSheet`, `renderApplication`) still fire. Core's own
  note confirms `ui.activeWindow`/`_maxZ` survive until V1 retires.
- `ApplicationV2`, `DocumentSheetV2` and `DialogV2` keep their v13 paths.
- No manifest schema changes; `compatibility`, `relationships`, `media` and
  `authors` are unchanged.

### Changed — future compatibility
- **ChromeHider replaces hardcoded DOM ids.** Hiding Foundry's interface now
  asks Foundry where it *is*, through the `ui.*` application singletons,
  instead of naming `#players`, `#ui-left`, `#sidebar`… Those ids are internal
  markup that already moved once inside v13 — the bug that left the players
  list floating over the mobile UI. The id rules remain as a harmless
  fallback. Re-applied after every application render, since core UI
  re-renders replace their own elements.
- **No file depends on a Foundry API to be importable.** The licence settings
  menu extended `foundry.applications.api.ApplicationV2` at module scope: had
  that path moved, the *entire module* would have failed to load. The class is
  now built on demand at `init`, with a shim if the base class is absent.
- **Window sweep prefers AppV2.** `foundry.applications.instances` (with a
  fallback to `ApplicationV2.instances`) runs first; the legacy `ui.windows`
  pass is fully optional-chained so its eventual removal is a no-op.

### Compatibility
- `compatibility.maximum` raised to `14`. `verified` stays at `13`: the code
  is v14-*ready* by audit, but has not been run on a v14 world.

## 0.12.2 — Persistent licence card (2026-07-10)

### Fixed
- **The activation prompt closed itself the moment it was used.** It was built
  on `DialogV2`, which dismisses on any button press — so pressing "Connect
  Patreon" destroyed the very UI holding the "I have a code" fallback, leaving
  nowhere to paste the code the popup had just produced. Replaced with the
  persistent floating card the other VNE modules use: it stays through the
  whole Patreon round trip, keeps the code route one tap away, and only
  disappears when activation actually succeeds.
- While connecting, the button shows progress and disables instead of
  vanishing; a blocked popup or rejected exchange restores it in place.
- When licensed, the same card doubles as the status/release panel, so the
  settings menu has one consistent entry point.

## 0.12.1 — Auth codes are no longer lost (2026-07-10)

### Fixed
- **A rejected exchange threw the auth code away.** Codes are single-use and
  short-lived, so a failed activation left nothing to retry with and forced the
  whole Patreon round trip — by which time the code had expired. The code now
  travels with the failure: the entry dialog reopens **pre-filled**, showing
  the server's reason, so it can be retried or corrected immediately.
- The popup-closed watchdog waits 1.5s before declaring the flow cancelled, so
  an auth message still in flight when the popup closes is not missed.

### Added
- `LICENSE_MODULE_ID` constant at the top of the licence client. The server
  registers each module separately and rejects codes issued for an id it does
  not know — which is what "Invalid or expired auth code" means here. Point it
  at whatever name the worker has registered for this module.

## 0.12.0 — Patreon licensing (2026-07-10)

Velvet Mobile now requires an active licence, using the same server and
subscription as VND Enhanced and the Velvet sheets.

### Added
- **Patreon OAuth activation**, matching the other VNE modules: signed RS256
  tokens, device fingerprinting, refresh-token rotation and a 15-minute
  heartbeat. Each module keeps its **own** installation id and token slots —
  sharing them would clobber the other modules' token rotation on the server.
- **Only the GM authorises.** Their client verifies the subscription and writes
  a world-scoped `worldLicensed` flag; every other client reads it. Players
  never see a prompt and cannot switch the module on themselves.
- **Live unlock**: authorising mid-session activates the module on every
  connected client, and releasing the slot switches it off, with no reloads.
- **Manage licence** entry in the module settings (GM only): connect,
  re-authorise, paste an auth code, or release the installation slot.
- Manual **auth-code** route for phones, where popups are often blocked.
- The gate is checked on every activation path, not only at startup, so no
  setting change can bypass it.

### Notes
- A transient outage never destroys stored credentials: the heartbeat recovers
  within a minute. Only a definitive server rejection or an explicit release
  clears them, and the world flag is revoked only by a heartbeat failure past
  its grace period or by releasing the slot.
- The public API object is still exposed when unlicensed so other modules can
  query state; nothing activates.

## 0.11.3 — Dialogs really are centred now (2026-07-10)

### Fixed
- **The damage prompt still sat in the lower half.** Centring relied on
  `translate: -50% -50%` without `!important`, and this module's rules live in
  a CSS layer — layered declarations lose to Foundry's unlayered styles. Only
  `top: 50%` survived, so the box hung *below* the midpoint rather than
  centred on it. Centring now uses `inset: 0` with automatic margins, which
  needs no transform and cannot be overridden the same way.

### Changed
- Dialog footer buttons (Normal / Critical Hit / Advantage…) are given a full
  touch target height — they are the most-tapped controls in play.
- Tall dialogs scroll inside their capped height instead of overflowing.

## 0.11.2 — Chat steps aside when you act (2026-07-10)

### Added
- **The chat panel closes itself when you act on a message.** Tapping Attack,
  Damage or a save on a chat card opens a roll prompt that the half-screen
  panel was covering. The panel now steps aside as soon as the click is
  through, leaving the prompt in the clear; reopen it from the speed-dial.
  Reading the log is untouched — expanding a card, following a link, tapping
  the message header or scrolling all leave the panel open.
- Listeners bound to the hosted chat log are dropped before it is handed back
  to the sidebar, so nothing survives the panel.

## 0.11.1 — Window stacking done right (2026-07-10)

0.11.0 raised Foundry's windows by forcing a single high z-index on all of
them. That flattened Foundry's own ordering: `bringToFront()` had nothing left
to raise, so the damage prompt stayed stuck behind the attack prompt and
windows could not be brought forward. Corrected by inverting the approach.

### Fixed
- **Foundry's window ordering restored.** Every Velvet surface now lives below
  z-index 100, leaving Foundry's whole window band untouched — it raises the
  focused window itself, exactly as on desktop, while our UI still stays out of
  the way underneath.
- **Roll prompts auto-close after a choice.** An attack prompt that lingered
  left the damage prompt buried behind it. Prompts are recognised by their
  choices (advantage / disadvantage / normal / critical) rather than class
  names, so this holds across systems and versions; closing is a no-op when the
  system already handled it.

### Changed
- Dialogs are **centred** rather than anchored to the bottom, where they
  collided with the joystick and the speed-dial.

## 0.11.0 — Roll dialogs come to the front (2026-07-10)

### Fixed
- **Attack and damage dialogs opened behind the mobile sheet.** Foundry gives
  its windows a z-index around 100, below the fullscreen mobile sheet, so a
  roll prompt was buried and windows became impossible to navigate. Every
  non-pinned Foundry window is now raised above all Velvet surfaces (below
  notifications only).

### Changed
- Those windows are also **anchored to the bottom of the screen**, full-width
  up to 560px and capped at 80% of the viewport height with internal scroll.
  Their buttons land in thumb reach instead of floating mid-screen, and they
  can no longer be dragged off the edge. Headers stay for closing.

## 0.10.4 — Foundry chrome actually hidden (2026-07-10)

### Fixed
- **Foundry's chrome survived the takeover.** The takeover rule only reached
  *direct* children of `#interface`, but v13 nests much of its UI a level
  deeper (`aside#players`, `nav#scene-navigation`, `#ui-left`…). Those elements
  kept rendering on top of the mobile interface — the stray player card that
  looked like a broken sheet. The known chrome is now hidden by id as well,
  independent of DOM nesting.

## 0.10.3 — Device detection (2026-07-10)

### Fixed
- **Phones with a stylus were classified as desktops.** Detection required
  *pure* touch input, but any device exposing a secondary fine pointer (an
  active pen, some Samsung/Motorola builds) reports `any-pointer: fine` and
  fell through to "desktop", leaving the mobile UI inactive. The gate is now
  the *primary* pointer (`pointer: coarse`): stylus phones are mobile again,
  while touch-capable laptops keep a fine primary pointer and correctly stay
  desktop. Verified against six device profiles.
- **The status notification no longer cries wolf on desktops**, where being
  inactive is the correct outcome. It now appears only on touch-capable
  devices, or whenever startup genuinely failed.

## 0.10.2 — GMs get characters, not monsters (2026-07-10)

### Fixed
- **The carousel offered NPCs to the GM.** A GM owns every actor, so the
  "owned + on this scene" rule handed them whichever NPC sorted first — the
  mobile client opened on a random monster instead of a character. Player
  characters (`type: "character"`) now win outright; other actor types are
  only offered when the user owns no character at all. Affects every system.
- **An empty mobile sheet can no longer be presented.** If a system adapter
  produces a model with no tabs, it is rejected up front and the actor's own
  sheet is pinned fullscreen instead — a blank drawer is strictly worse than
  the desktop sheet.

## 0.10.1 — Self-diagnosis (2026-07-10)

A phone has no console, so a module that fails to activate is indistinguishable
from one that is not installed. It now says so on the device.

### Added
- **Startup status report**: if the mobile interface does not take over on a
  client, a permanent notification states the reason — Mobile Mode is Off, the
  client was classified as desktop, or the exact startup error. Silent when
  everything works.

### Fixed
- A shell that failed to build and reverted itself was still recorded as
  "enabled" by the service registry. The failure now propagates, so the module's
  reported state matches reality.

## 0.10.0 — Zoom buttons and targeting (2026-07-10)

### Added
- **Zoom ± buttons**: pinch-to-zoom over the PIXI canvas is unreliable on many phones, so explicit buttons now appear next to the joystick and share its toggle — turn the stick off and they go with it. Each tap zooms a step (clamped, animated) with a light haptic tick.
- **Target picker** (map mode): a new crosshair action in the speed-dial opens a bottom sheet listing the scene's tokens — hostiles first, then neutrals, then allies, each with a coloured disposition stripe and portrait. Tap to target for your next attack, tap again (or "Clear target") to release. Far more reliable than trying to hit a small token on the canvas with a fingertip. The crosshair button stays lit while anything is targeted, and only your own token is excluded from the list; players only see tokens they can actually see.

### Changed
- The joystick sits higher above the bottom edge so it no longer collides with other modules' corner buttons (vnd-enhanced).

## 0.9.5 — Players see the map and their moves (2026-07-10)

Both modes are now fully playable for players:
**sheets-only** (map off — zero canvas, blind joystick moves that replicate
to the GM) and **live map** (map on — see the board and watch yourself move).

### Added
- **Automatic token control**: on scene load, on actor switch and when the shell activates, the selected actor's token is controlled for the player. Without this, fogged/vision scenes rendered as pure darkness on mobile (players had no way to click their token).
- **Camera follows the joystick**: every joystick step pans the camera to the token, so the player watches their own movement.
- **Toggling the joystick on reveals the map**: it dismisses the sheet drawer (map mode only), controls the token and snaps the camera onto it — "I want to move" is now one tap.

## 0.9.4 — PF2e hardening (2026-07-10)

PF2e worlds crashed where dnd5e worked: the PF2e adapter had no per-section
fault isolation (only dnd5e got it in 0.7.0) and a mobile-sheet failure had
no escape route. Three layers now guarantee both systems always play:

### Fixed
- **PF2e adapter fault-isolated per section** (saves, skills, strikes, inventory, spells, feats, stats): a broken entry empties that section instead of nulling the model. Defensive access for the PF2e statistics API (`slug`/`label`/`mod`/`rank` guards, `roll`/`damage` type checks), class name from `actor.class`, initiative from the statistic chain.
- **Renderer skips broken content**: a section or row that throws while rendering is logged and skipped; the rest of the sheet renders.
- **Automatic fallback without loops**: if the mobile sheet itself crashes for an actor, the error is shown, the actor is remembered as failed for the session, and their native sheet opens pinned fullscreen instead — the render interception exempts them, so it cannot ping-pong.

## 0.9.3 — Hard page guard (2026-07-10)

### Fixed
- The module is now a **complete no-op outside `/game`**: the controller is never even constructed on the join/setup/auth/stream pages (guarded at import time by URL, plus the existing `game.view` checks). Audited every file for import-time side effects: none remain.
- `init` logs the running version to the console, so a stale-cache client can be identified at a glance.

### Note
- Foundry cache-busts module scripts with the version it read **at server boot**. After updating files, the Foundry server must be restarted (or the world relaunched from Setup) and the phone hard-refreshed — otherwise clients keep executing the previous code, which is how "already fixed" bugs keep reappearing.

## 0.9.2 — Boot veil removed (2026-07-10)

### Removed
- **The boot veil is gone.** The branded overlay that covered Foundry while the world loaded could stay stuck on screen if anything delayed or interrupted startup, hiding the game behind a black page with a "Velvet Mobile" wordmark. A cosmetic flourish is not worth a class of screen-blanking failures: the shell now simply takes over once it is built, with nothing covering the screen beforehand.

### Added
- Foundry's "requires 1024x768 window" warning is suppressed on mobile — permanently true on a phone, and it buried every other notification. Only that specific banner is dropped; all other notifications are untouched.
- Startup failures now also raise a permanent error notification, so a problem is visible instead of silent.

## 0.9.1 — Join screen fix (2026-07-10)

### Fixed
- **The module took over Foundry's join/setup screens.** Foundry loads modules on those pages too, where there is no world, no actors and no canvas: the shell painted its backdrop over the login form and then threw on the missing data, leaving a black page you could not log in from. This was the real cause of the "black screen" — the game itself was never reached. The controller now exits immediately unless `game.view === "game"`.
- World-data access in the shell is defensive throughout, so a missing collection degrades instead of throwing.

## 0.9.0 — Live map + no more black screens (2026-07-10)

### Fixed
- **Black screen on load.** The shell hid Foundry's interface *before* building its own, so any failure during startup left nothing on screen. Startup now builds every surface first and only then takes over; if anything throws, it fully reverts to the desktop interface and reports the error instead of going dark. Opening the character sheet is a separate step, so a system-adapter failure can no longer cost you the whole shell.

### Added
- **Show map** setting (client, on by default): keeps the game canvas live behind the mobile UI instead of the artwork backdrop. Turning it off restores the previous zero-canvas mode, where `core.noCanvas` means the map is never even loaded (the memory/battery win on phones). Changing it prompts a reload.
- **CanvasController**: touch navigation for the map — one finger drags to pan, two fingers pinch to zoom, clamped to sane scale limits and re-attached on every scene change. Foundry ships no touch canvas navigation, so this is what makes the map usable on a phone — and it means the movement joystick now moves a token you can actually watch.

## 0.8.0 — Movement joystick (2026-07-10)

### Added
- **Token joystick**: a mobile-game analog stick (bottom-left) that steps the selected actor's token one grid square in 8 directions — the touch equivalent of desktop arrow-key movement. The knob follows the finger (clamped to the base), repeats while held (faster the harder you push, with a dead zone), snaps back on release, and buzzes on direction changes.
  - Toggled from the speed-dial's new **Move** action, so it never steals screen space when unused.
  - Moves the `TokenDocument` directly, so it works with the canvas disabled (the mobile default) and replicates to the GM and every other client. Square grids re-snap; other grid types step by grid size.
  - Warns (throttled) if the selected actor has no owned token on the active scene.

## 0.7.0 — Speed-dial + hardening (2026-07-10)

### Changed
- **Floating buttons collapsed into one speed-dial**: a single small (+) button that fans out dice / chat / settings on tap, anchored above the mobile sheet's tab bar so it never covers the Features tab. The unread-chat dot lives on the trigger.

### Fixed
- **No more floating desktop windows, ever**: any actor sheet render is now intercepted — supported actors open the native mobile sheet (whoever they belong to), everything else is pinned fullscreen. Previously only the selected actor was pinned and other sheets floated clipped (the bug in the screenshot).
- On activation the shell sweeps and closes any leftover open windows (AppV1 windows and AppV2 document sheets; core UI untouched).
- Adapter extraction is now fault-isolated per section: a broken weapon or spell entry degrades that section instead of silently reverting the whole sheet to the desktop fallback.
- Refreshes (HP ticks, item updates) no longer reset the list scroll position, and the tab bar rebuilds when tabs appear/disappear (first spell learned).

### Added
- Adaptive layout: compact single-row header in landscape, two reading columns on wide screens/tablets, centered content column above 760px, sticky section headers on phones.

## 0.6.0 — Native mobile sheet (2026-07-10)

The desktop sheet squeezed into the drawer was unusable on phones (clipped
columns, broken scrolling). Like Swipe, Velvet Mobile now renders its **own
mobile character sheet** from actor data — a phone UI, not a resized window.

### Added
- **MobileSheet**: fullscreen drawer with portrait/name/class header, tappable stat chips (Initiative rolls, AC, Speed, Proficiency), an HP bar that opens a Damage/Heal dialog, bottom tab bar and swipeable tabs, per-row expandable descriptions (enriched), and its own smooth scrolling.
- **D&D 5e adapter**: abilities grid (tap = check, long-press = save), full skill list with proficiency dots (tap to roll), weapons with to-hit/damage labels (tap to use), inventory with quantities and equip toggle, spells grouped by level with slot counters (tap to cast), features (tap to post to chat).
- **PF2e adapter**: abilities, Perception + saves, full skill list (tap to roll), strikes with damage button, inventory, spells and feats.
- Foundry sheet renders for supported actors are intercepted and redirected to the mobile sheet (chat portrait links included). Unsupported systems/actor types still fall back to the pinned native sheet.
- Live refresh: actor and item changes (HP, equip, quantities…) re-render the open mobile sheet, coalesced.

## 0.5.1 — Functional audit (2026-07-10)

### Fixed
- **Motion engine**: WAAPI animations kept a live `fill: both` effect after finishing, which silently overrode every later `style.transform` write — drawer dragging and bottom-sheet snapping would freeze after their first animation. Animations now commit their final frame and cancel.
- **Gestures with a mouse**: the gesture engine only enabled on touch input, so testing with *Force Phone* from a desktop left the drawer impossible to drag-dismiss and disabled swipes. Recognizers are Pointer-Events-based and now always enable.
- **Boot veil is failure-proof**: `ready()` now removes the veil in a `finally` block — a startup error can no longer leave a black screen.
- **Chat return guard**: returning the chat log to the sidebar no longer throws if its neighbouring node was re-rendered away while hosted.
- Sheets wider than the phone can now pan horizontally inside the drawer instead of being cut off.
- AppV1 windows (like the Velvet sheet) were missing the double-tap-zoom suppression applied to AppV2 windows.

### Changed
- **The sheet opens immediately on login** — the app *is* the character sheet; the home screen (artwork + carousel) only appears if you dismiss the drawer. The first-run hint moved to that moment.
- The drawer grip now includes an explicit close (chevron) button, so dismissing never depends on gesture support.

## 0.5.0 — Premium polish (2026-07-10)

### Added
- **Boot veil**: from init, mobile clients see a pulsing "Velvet Mobile" wordmark instead of Foundry's desktop chrome flashing by while the world loads.
- **Carousel, upgraded**: Swipe-style proximity effect (avatars grow/saturate near the center), the selected actor's name in a floating pill, and a live HP bar under each portrait (green/amber/red by threshold, updates on actor changes).
- **Haptic feedback** (where the platform supports it): selecting an actor, adding dice, rolling, dismissing the drawer.
- **Dice roller, upgraded**: the Roll button shows the live formula ("2d6 + 1d20"), disables when the pool is empty, and long-pressing a die clears it from the pool.
- **First-run hint**: a floating "swipe up or tap your portrait" pill on the home screen, once per session.
- **Motion polish**: ambient Ken Burns drift on the home artwork (paused under the drawer, disabled with reduced motion), entrance animations for the carousel and button stack, pop-in for the dice bar, glow on the selected avatar, softer shadows and rounded corners on floating dialogs.

## 0.4.0 — Swipe-style shell (2026-07-10)

Reworked the shell to follow the UX model of the Swipe VTT module's
sheets-only mode.

### Added
- **Home screen**: scene artwork (or gradient) under a vignette instead of a black void.
- **Avatar carousel** (bottom center): owned actors with a token in the scene plus the assigned character; tap to open that actor's sheet.
- **Sheet as a drawer**: slides up fullscreen; a grip at the top drags down to dismiss back to home; swipe up from the bottom edge reopens it. No longer force-reopens on close.
- **Floating button stack** (bottom right, always on top — even over the sheet): dice roller with multi-die picker (d4–d100 with counts, combined roll), chat toggle with unread dot, settings escape hatch.
- **Chat auto-open**: new messages can open the chat panel automatically (setting: rolls only / all / never) at half height, with an auto-hide timer (setting, touch cancels).
- **`core.noCanvas` management** (the Swipe approach): when mobile mode will activate, the game canvas is disabled at init so it never even gets created — huge memory/battery win. Reverted automatically (only if we set it) when mobile mode turns off, with a reload prompt.

### Removed
- The bottom bar from 0.3.0 (replaced by carousel + button stack).
- The "sheet can never be closed" rule (the drawer model replaces it).

## 0.3.0 — Sheet Only rewrite (2026-07-10)

Complete pivot after playtesting 0.2.0: the generic mobile framework (bottom
navigation, dock, FAB, window hosting) produced a cluttered, hard-to-use UI.
Velvet Mobile is now a **sheet-only shell**: on phones and tablets Foundry
disappears entirely and the client becomes the character sheet.

### Changed
- **SheetShell** replaces LayoutEngine + WindowManager + NavigationEngine + ThemeEngine:
  - All Foundry chrome and the canvas are hidden (notifications stay); the PIXI ticker stops to save battery.
  - The user's character sheet is pinned fullscreen, chromeless, and reopens automatically if anything closes it.
  - Slim bottom bar: actor switcher (when the user owns several characters), quick d20 roll, chat panel toggle with unread dot, settings escape hatch.
  - Chat opens as a bottom sheet hosting Foundry's real chat log (messages, rolls and input all work) and returns to the sidebar on close.
  - Horizontal swipe on the sheet moves between its tabs (Velvet sheet nav and standard Foundry tab navs).
  - Dialogs and item sheets still float on top, clamped to the viewport.
- Settings reduced to `mode`, `uiScale`, `debug`.
- Public API reduced to `device`, `state`, `gestures`, `sheet` (actor, open, openChat, closeChat), `components` (BottomSheet); new hook `velvetMobile.actorChanged`.

### Removed
- NavBar, Dock, FAB, VirtualList, LayoutEngine, WindowManager, AppSheetHost, NavigationEngine, ThemeEngine, AdapterRegistry, density system, and their settings/styles/hooks.

## 0.2.0 — Phase 2: Framework Core (2026-07-10)

Scope elevated from "responsive module" to **mobile UI framework** (see `docs/ARQUITECTURA-FRAMEWORK.md`).

### Added
- **GestureEngine**: state-machine recognizers (tap, doubleTap, longPress, swipe, edgeSwipe, pan with velocity, pinch with scale+rotation+center), exclusivity arbitration, AbortController cleanup.
- **Motion**: WAAPI animation engine with canonical durations/easings and global reduced-motion support.
- **Component Library**: `VelvetComponent`, `BottomSheet` (snap points, fling-aware dragging), `NavBar`, `Dock`, `FAB` speed dial, `VirtualList` windowing virtualizer.
- **LayoutEngine**: per-app presentation decisions (untouched / floating / fullscreen / bottom-sheet / side-panel). Phones never get floating windows.
- **WindowManager**: hosts AppV1/AppV2 applications inside bottom sheets (reversible instance-level `setPosition` guard), tablet side panels and viewport clamping, view stack with `closeTop`/`closeAll`.
- **NavigationEngine**: bottom navigation (Home/Chat/Combat/Actors/Journal), sidebar-as-sheet, left-edge-swipe back navigation, Dock and FAB with default actions.
- **KeyboardManager**: dual-signal keyboard detection (`visualViewport` inset + editable focus), `data-vm-keyboard` attribute, focused-input visibility, shell auto-hide.
- **ThemeEngine**: density system (compact/cozy/touch) via `data-vm-density`.
- **AdapterRegistry** + built-in adapters (PF2e actor sheets, core config windows); public `vm.adapters.register`.
- Settings: `density`, `navBar`, `dock`, `fab` (all client, live-rebuilding).
- Public API: `gestures`, `adapters`, `windows`, `dock`, `fab`, `components`; hooks `velvetMobile.layoutDecided/sheetOpened/sheetClosed`.
- Styles: `components.css`, `shell.css`; expanded tokens (densities, surfaces, shell geometry, z-scale).

## 0.1.0 — Phase 1: Foundation (2026-07-10)

### Added
- Module scaffold for Foundry VTT v13 (ESM, no build step, en/es localization).
- `DeviceProfiler`: multi-signal device profiling (pointer/hover media features, `maxTouchPoints`, `visualViewport`, orientation, foldable viewport segments, DPR) with debounced reactive updates and `AbortController`-based cleanup.
- `UIState`: `data-vm-*` attributes and `--vm-vvh` / `--vm-kb` / `--vm-scale` custom properties on `<html>` — the single JS→CSS contract.
- `ViewportService`: reversible `viewport-fit=cover` patch for notch safe areas.
- Client settings: `mode` (auto / force phone / force tablet / off, live-switchable), `uiScale`, `debug`.
- Base CSS (`@layer velvet-mobile`): double-tap-zoom prevention, pull-to-refresh suppression, iOS input auto-zoom fix, touch-sized scrollbars. No visual redesign.
- Public API (`game.modules.get("velvet-mobile").api`) + hooks `velvetMobile.ready`, `velvetMobile.deviceChanged`.
- Documentation: full development plan (`docs/PLAN-DE-DESARROLLO.md`), phase report with manual test checklist (`docs/FASE-1.md`).
