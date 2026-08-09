# Velvet Mobile

**Sheet-only mobile experience for Foundry VTT.** On a phone or tablet, Foundry's interface and canvas step aside and the client becomes a mobile app around your character sheet, built for the Velvet sheets. Desktop clients are untouched.

[![Foundry v13](https://img.shields.io/badge/Foundry-v13-informational)](https://foundryvtt.com/)
[![Foundry v14 ready](https://img.shields.io/badge/Foundry-v14%20ready-informational)](https://foundryvtt.com/)
[![License: Proprietary](https://img.shields.io/badge/license-Proprietary%20(Patreon)-red)](LICENSE)

> ⚠️ **Installation note:** the module folder must be named `velvet-mobile` — Foundry requires the folder name to match the module id. Installing from the manifest URL handles this automatically.

---

## Requirements

| Requirement | Detail |
|---|---|
| Foundry VTT | **v13** minimum (verified). v14-ready by audit — see [Compatibility](#compatibility). |
| Subscription | An **active, qualifying Patreon** subscription to [GM RedVelvet](https://www.patreon.com/gmredvelvet), for as long as you use the module — see [Licensing](#licensing). Only the **GM** authorises; players never see a prompt. |
| Internet | Required while playing. The licence is verified periodically against a licence server. |
| Device | A touch device (phone/tablet) for the mobile experience. Desktop is used for testing via *Force Phone/Tablet*. |

## Installation

1. In Foundry, open **Add-on Modules → Install Module**.
2. Paste the **manifest URL** into the *Manifest URL* field:
   ```
   https://github.com/gmredvelvet-rgb/velvet-mobile/releases/latest/download/module.json
   ```
3. Click **Install**, then enable **Velvet Mobile** in your world's *Manage Modules*.

The `latest/download` URLs always resolve to the newest published release, so Foundry's built-in update check keeps you current.

## Features

- **A status bar that answers the question you ask most** — portrait, name and hit points, always on screen. No opening the sheet to find out how you are doing. Tap it to open your character; the swap button opens the roster.
- **One way in, one way out** — the sheet, chat, the encounter and the target list are all screens that slide in from the right. Go back with the chevron or by dragging from the left edge. The same gesture everywhere, whatever is on screen.
- **A command bar, not a menu to open first** — the actions of play get a slot each along the bottom, one tap, no expanding step. Anything past the fifth moves into an overflow menu rather than shrinking the row.
- **The roster is a grid** — every actor you own with a token in the scene, plus your assigned character, as cards with portrait and hit points. A party of eight is one glance.
- **The sheet** — portrait, vitals and stat chips up top, tabs as a scrolling segmented row under them, content below. Drag left or right to change tabs.
- 🎲 **Dice roller** — tap dice to build a pool (2d6 + 1d20…), then Roll.
- 💬 **Chat** — Foundry's real chat log hosted in its own screen (messages, rolls and input all work), with an unread dot on the command bar.
- ⚔️ **Encounter tracker** — turn order as full-width rows: portrait, name and initiative, the active turn lit and striped, defeated struck through, the round in the title bar. Tap anyone to centre the camera on them. Updates live as turns advance.
- ⚙️ **Settings** — a settings screen built for a phone, not Foundry's two-column dialog: packages, then their settings, with a search box across the lot. Switches, sliders, pickers and a file browser; submenus open normally; world settings are badged and still respect Foundry's permissions.
- **It looks like the sheet your table already uses** — the mobile interface picks up the design language of whichever Velvet sheet module the world has active, so the phone is not a second, unrelated product:

  | Active module | System | Theme |
  |---|---|---|
  | AAA D&D Character Sheet | dnd5e | Gold on black, Cinzel |
  | Velvet PF2e Sheet | pf2e | Gilded void, Cinzel Decorative |
  | SF2e / PF2e Cyberpunk UI | sf2e | Cyan on navy, Rajdhani, hard corners |
  | Hopefinder Survivor Sheet | pf2e | Olive and amber, Barlow Condensed, mono numerals |
  | *none* | anything | Velvet Mobile's own purple |

  Three of those serve pf2e, so the *module* decides before the system does. Override it any time under **Theme** in the settings.

  A theme is not a palette swap: it reproduces the sheet's actual treatment — the gilded rule that fades out under a Velvet heading, the gold stripe down the left of a feature row, the holographic grid and scanlines behind the cyberpunk sheet, the stamped-metal cards and film grain of Hopefinder. Adapted, not transplanted: the desktop sheets set headings at 9–14px, so the *ratios* carry over (case, tracking, weight, the ornament) at sizes a phone can read, and every row keeps its 44px touch target. What a theme never changes is what is on screen or where it sits — every theme is the same interface underneath.

  Fonts come from the companion module, which self-hosts them; without it installed you get the palette, the ornaments and a generic face.
- **Conditions as chips** — apply and clear conditions with a tap, at the top of the *Combat* tab. The ones in effect sort first and the rest fold behind a *+N*; conditions that carry a value (frightened 2, clumsy 1) get a −/+ stepper. PF2e routes through its own condition items; every other system uses Foundry's status effects.
- **Long press any row for its actions** — send to chat *without spending the item*, open its sheet to edit, prepare/unprepare a 5e spell, change a PF2e carry state. The mobile stand-in for the desktop's right-click menu.
- **Effects** — what is running on you and how much longer it lasts, counted in the unit the effect was written in. Counter effects get −/+ steppers, everything gets *End effect*, expired ones are dimmed rather than hidden, and the countdown updates as the clock advances. PF2e counter effects get −/+ steppers; 5e effects switch on and off. Only temporary effects are listed — passive feature plumbing stays out of the way.
- **Rests** — short and long rest (Take a Breather and Rest for the Night on PF2e), at the top of the *Stats* tab. Each opens the system's own rest flow.
- **Spell preparation** (D&D 5e) — the list shows every spell you *know*; a bookmark on each row toggles the ones you prepared today, and what you did not prepare is dimmed. A *Preparation* section shows the daily allowance per class (*Wizard · 3 / 5*).
- **Hit points done properly** — a *Temp HP* chip in the header row (tap to set or clear), a striped band on the bar showing the shield riding on top of real hit points, damage spent through it before real hit points, and a changed maximum respected and spelled out.
- **Plays well with Dice Tray** — if you have it installed, our dice button steps aside rather than duplicating its bar.
- **Incoming rolls announce themselves** — a toast under the status bar shows the roll (or all messages, per setting) and fades on its own; tap it to open the full log. A line of text no longer takes the screen away from whatever you were doing.
- **No canvas at all** — mobile clients run with Foundry's `core.noCanvas`, so the game canvas is never created: a large memory and battery win (reverted automatically if you turn mobile mode off).
- Dialogs and item sheets still float on top, clamped to the screen. Keyboard-aware layout, notch/safe-area support, no accidental zoom or pull-to-refresh.

## Compatibility

| Foundry | Status |
|---|---|
| v13 | ✅ **Verified** — developed and tested against v13. |
| v14 | 🟡 **Ready by audit** — the code was audited against the released v14 API and no longer depends on the internals most likely to move (see [CHANGELOG](CHANGELOG.md) 0.13.0). Not yet run on a live v14 world, so `compatibility.verified` remains `13`. |

### Game systems

The shell, gestures, canvas and chat surfaces are game-system independent. The sheet layer works in three tiers:

| System | Sheet |
|---|---|
| **D&D 5e** | Dedicated adapter — abilities, skills, attacks, inventory, spells by level with slot counts and per-class preparation, rests, conditions, temporary effects, features. |
| **Pathfinder 2e** | Dedicated adapter built on PF2e's own `Statistic` API — strikes with MAP variants, ammunition and reloading, spells by rank with real slot totals, carry states, hero points, focus, the dying track, conditions with their values, and an effects list with live durations. |
| **Starfinder 2e** | Served by the Pathfinder 2e adapter. sf2e is a fork of PF2e that kept the data model whole, so it gets the same sheet. |
| **Everything else** | Generic adapter. Discovers hit points, a defence value, and ability- and skill-like blocks *by data shape*, groups items by their declared type, and offers the system's status effects as condition chips. When it finds nothing worth drawing, the system's own sheet is pinned fullscreen instead. |

Systems can be taught directly: `game.modules.get("velvet-mobile").api.sheet.registerAdapter(systemId, { model, types })` replaces the built-in adapter for that system.

## Licensing

Velvet Mobile requires an active Patreon subscription — the same one that unlocks VND Enhanced and the Velvet sheets. **Only the GM authorises:** on their first load they are prompted to connect their Patreon account, which unlocks the module for everyone in the world. Players never see a prompt.

Manage it any time from *Configure Settings → Velvet Mobile → **Manage licence***: connect, re-authorise, paste an auth code (useful on phones, where popups are often blocked), or release the installation slot to move it to another server or browser. Authorising or releasing takes effect on every connected client immediately, with no reloads.

### What happens if the subscription lapses

**Please read this before subscribing.** Velvet Mobile is a subscription, not a one-off purchase, and the module re-checks the subscription periodically against the licence server. So, plainly:

- **If the subscription lapses, the mobile interface stops working.** The module deactivates itself and stops taking over the UI.
- **Nothing else is affected.** Foundry, your world, your actors, your scenes, your journals and your settings are untouched. The phone simply falls back to Foundry's standard interface — no data is altered, withheld or lost, and no content becomes unopenable. Resubscribing turns it straight back on.
- **An internet connection is required while playing.** Verification is periodic, so a client that cannot reach the licence server deactivates the mobile interface until it can. Fully offline or air-gapped games are not supported.

If a perpetual licence is what you need, Velvet Mobile is not that today. I would rather say so here than have anyone find out mid-campaign.

See [LICENSE](LICENSE) for the full proprietary terms.

## Settings (all per-client)

| Setting | Purpose |
|---|---|
| Mobile Mode | Auto-detect / Force Phone / Force Tablet (for desktop testing) / Off |
| UI Scale | Global scale for Velvet Mobile surfaces |
| Open chat on new messages | Rolls only / All / Never |
| Auto-hide chat (seconds) | 0 keeps it open |
| Debug | Verbose console logging |

To test from desktop: *Force Phone*, reload when prompted. To leave: ⚙️ → Mobile Mode → Off (it prompts to reload and restores the canvas).

## Public API

```js
const vm = game.modules.get("velvet-mobile").api;

vm.device.profile / vm.device.is("phone")
vm.state.active
vm.gestures.on(element, "longpress", handler)   // → unsubscribe
vm.sheet.actor                              // selected actor
vm.sheet.open(actorId)                      // select + push the sheet screen
vm.sheet.openChat() / vm.sheet.closeChat()
vm.theme.current / vm.theme.refresh()       // resolved theme id
vm.components.NavStack                      // the shell's own screen stack
vm.components.BottomSheet

Hooks.on("velvetMobile.ready", (api) => {});
Hooks.on("velvetMobile.deviceChanged", (profile, old) => {});
Hooks.on("velvetMobile.actorChanged", (actor) => {});
```

## FAQ

**Does this affect my desktop players?**
No. The module only activates on devices detected as phones/tablets (or when forced). Desktop clients are untouched.

**Do players need their own Patreon subscription?**
No. Only the GM authorises, and that unlocks the world for everyone connected.

**If I stop subscribing, does the module keep working?**
No. The mobile interface deactivates itself — see [What happens if the subscription lapses](#what-happens-if-the-subscription-lapses). Your Foundry install, world and data are untouched; the phone falls back to Foundry's normal interface, and resubscribing turns it straight back on.

**Can I use it offline?**
No. The licence is verified periodically over the internet, and a client that cannot reach the licence server deactivates the mobile interface until it can.

**The mobile UI didn't appear on my phone.**
Check *Configure Settings → Velvet Mobile → Mobile Mode*. If it's on *Auto-detect* and your device wasn't recognised, set *Force Phone* and reload. Confirm the GM has authorised the licence.

**Popups are blocked on my phone during authorisation.**
Use the **auth-code** flow in *Manage licence* — connect on any device, copy the code, and paste it on the phone.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Foundry's sidebar/players list floats over the mobile UI | Update to 0.13.0+ (the ChromeHider rewrite asks Foundry where its UI is instead of guessing DOM ids). |
| Canvas still loads / battery drain | Ensure Mobile Mode is active on that client; the canvas is only suppressed when the module is active. |
| Licence prompt keeps reappearing | Confirm the Patreon subscription is active and the installation slot hasn't been released elsewhere. |
| Nothing works after a Foundry major-version upgrade | File an issue with your Foundry version — see [Support](#support). |

## Support

- **Bugs / feature requests:** [GitHub Issues](https://github.com/gmredvelvet-rgb/velvet-mobile/issues)
- **Patreon:** [GM RedVelvet](https://www.patreon.com/gmredvelvet)
- **Discord:** `gmredvelvet`
- **Email:** gmredvelvet@gmail.com

## Known issues

- `compatibility.verified` is `13`: v14 support is audited but not yet run against a live v14 world.
- Systems without a dedicated adapter get the generic one, which reads the actor by data shape. It covers most systems, but a hand-written adapter always reads better — [register your own](#game-systems) if yours deserves one.
- Pathfinder 2e does not yet expose the roll-option toggles the desktop sheet shows above its strikes (Current Form, Double Slice, Hunt Prey…), exploration activities, or the effects panel. Planned for a future release.

## Developer setup

This is a plain **ES-module** Foundry module — no build step.

```bash
git clone https://github.com/gmredvelvet-rgb/velvet-mobile.git
# Symlink or copy into {userData}/Data/modules/velvet-mobile
```

The folder **must** be named `velvet-mobile`. Source lives in `scripts/` (entry: `scripts/main.mjs`) and `styles/`; localisation in `lang/`. Architecture notes are in [`docs/`](docs/).

## Releasing

Releases are fully automated by [`.github/workflows/release.yml`](.github/workflows/release.yml):

1. Bump the version and add a `## x.y.z` section at the top of [CHANGELOG.md](CHANGELOG.md).
2. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. CI rewrites `module.json` to match the tag, validates the manifest, builds `module.zip`, and publishes a GitHub Release with `module.json` + `module.zip` as assets. The release notes are the matching CHANGELOG section.

The tag is the single source of truth for the version — a release can never ship a manifest that disagrees with it. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## License

**Proprietary.** © 2024–2026 GM RedVelvet / GM RedVelvet. All rights reserved. Use requires an active qualifying Patreon subscription. See [LICENSE](LICENSE) for full terms.

*Velvet Mobile is not affiliated with, endorsed by, or supported by Foundry Gaming LLC.*
