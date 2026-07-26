# Velvet Mobile

**Swipe-style, sheet-only mobile experience for Foundry VTT.** On a phone or tablet, Foundry's interface and canvas step aside and the client becomes a mobile app around your character sheet — modelled on the UX of Swipe VTT's sheets-only mode, but built for the Velvet sheets. Desktop clients are untouched.

[![Foundry v13](https://img.shields.io/badge/Foundry-v13-informational)](https://foundryvtt.com/)
[![Foundry v14 ready](https://img.shields.io/badge/Foundry-v14%20ready-informational)](https://foundryvtt.com/)
[![License: Proprietary](https://img.shields.io/badge/license-Proprietary%20(Patreon)-red)](LICENSE)

> ⚠️ **Installation note:** the module folder must be named `velvet-mobile` — Foundry requires the folder name to match the module id. Installing from the manifest URL handles this automatically.

---

## Requirements

| Requirement | Detail |
|---|---|
| Foundry VTT | **v13** minimum (verified). v14-ready by audit — see [Compatibility](#compatibility). |
| Subscription | An **active, qualifying Patreon** subscription to [The GM Studio](https://www.patreon.com/TheGMStudio). Only the **GM** authorises; players never see a prompt. |
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

- **Home screen** — the scene's artwork under a vignette, with an **avatar carousel** at the bottom (every actor you own with a token in the scene, plus your assigned character).
- **The sheet is a drawer** — tap an avatar (or swipe up from the bottom edge) and the sheet slides up fullscreen. Swipe left/right to change tabs. Drag the grip at the top down to dismiss.
- **Floating buttons** (always on top, even over the sheet):
  - 🎲 **dice roller** — tap dice to build a pool (2d6 + 1d20…), then Roll;
  - 💬 **chat** — Foundry's real chat log in a bottom sheet (messages, rolls and input all work), with an unread dot;
  - ⚙️ **settings** — the escape hatch.
- **Chat auto-open** — incoming rolls (or all messages, per setting) open the chat at half height; it hides itself after a few seconds unless you touch it.
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
| **D&D 5e** | Dedicated adapter — abilities, skills, attacks, inventory, spells by level with slot counts, features. |
| **Pathfinder 2e** | Dedicated adapter built on PF2e's own `Statistic` API — strikes with MAP variants, ammunition and reloading, spells by rank with real slot totals, carry states, hero points, focus and the dying track. |
| **Starfinder 2e** | Served by the Pathfinder 2e adapter. sf2e is a fork of PF2e that kept the data model whole, so it gets the same sheet. |
| **Everything else** | Generic adapter. Discovers hit points, a defence value, and ability- and skill-like blocks *by data shape*, and groups items by their declared type. When it finds nothing worth drawing, the system's own sheet is pinned fullscreen instead. |

Systems can be taught directly: `game.modules.get("velvet-mobile").api.sheet.registerAdapter(systemId, { model, types })` replaces the built-in adapter for that system.

## Licensing

Velvet Mobile requires an active Patreon subscription — the same one that unlocks VND Enhanced and the Velvet sheets. **Only the GM authorises:** on their first load they are prompted to connect their Patreon account, which unlocks the module for everyone in the world. Players never see a prompt.

Manage it any time from *Configure Settings → Velvet Mobile → **Manage licence***: connect, re-authorise, paste an auth code (useful on phones, where popups are often blocked), or release the installation slot to move it to another server or browser. Authorising or releasing takes effect on every connected client immediately, with no reloads.

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
vm.gestures.on(element, "swipe", handler)   // → unsubscribe
vm.sheet.actor                              // selected actor
vm.sheet.open(actorId)                      // select + open drawer
vm.sheet.openChat() / vm.sheet.closeChat()
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
- **Patreon:** [The GM Studio](https://www.patreon.com/TheGMStudio)
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

**Proprietary.** © 2024–2026 GM RedVelvet / The GM Studio. All rights reserved. Use requires an active qualifying Patreon subscription. See [LICENSE](LICENSE) for full terms.

*Velvet Mobile is not affiliated with, endorsed by, or supported by Foundry Gaming LLC.*
