# Velvet Mobile

**Swipe-style, sheet-only mobile experience for Foundry VTT v13.** On a phone or tablet, Foundry's interface and canvas disappear completely and the client becomes a mobile app around your character sheet — modeled on the UX of Swipe VTT's sheets-only mode, but built for the Velvet sheets. Desktop clients are untouched.

> ⚠️ **Installation note:** the module folder must be named `velvet-mobile` (Foundry requires the folder name to match the module id).

## What players get

- **Home screen**: the scene's artwork under a vignette, with an **avatar carousel** at the bottom (every actor you own with a token in the scene, plus your assigned character).
- **The sheet is a drawer**: tap an avatar (or swipe up from the bottom edge) and the sheet slides up fullscreen. Swipe left/right to change tabs. Drag the grip at the top down to dismiss it.
- **Floating buttons** (always on top, even over the sheet):
  - 🎲 dice roller — tap dice to build a pool (2d6 + 1d20…), then Roll;
  - 💬 chat — Foundry's real chat log in a bottom sheet (messages, rolls and input all work), with an unread dot;
  - ⚙️ settings — the escape hatch.
- **Chat auto-open**: incoming rolls (or all messages, per setting) open the chat at half height and it hides itself after a few seconds unless you touch it.
- **No canvas at all**: mobile clients run with Foundry's `core.noCanvas`, so the game canvas is never created — a huge memory and battery win (reverted automatically if you turn mobile mode off).
- Dialogs and item sheets still float on top, clamped to the screen. Keyboard-aware layout, notch/safe-area support, no accidental zoom or pull-to-refresh.

## Licence

Velvet Mobile requires an active Patreon subscription — the same one that
unlocks VND Enhanced and the Velvet sheets. **Only the GM authorises**: on
their first load they are prompted to connect their Patreon account, and that
unlocks the module for everyone in the world. Players never see a prompt.

Manage it any time from *Configure Settings → Velvet Mobile → **Manage licence***:
connect, re-authorise, paste an auth code (useful on phones, where popups are
often blocked), or release the installation slot to move it to another server
or browser. Authorising or releasing takes effect on every connected client
immediately, with no reloads.

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

## License

TBD.
