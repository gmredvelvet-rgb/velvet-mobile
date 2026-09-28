# Mobile controls verification

Date: 2026-09-28

## Reproduce

Run `node --test tests/core-lifecycle.test.mjs` for the four lifecycle tests.

Start the component fixture from the module directory:

```powershell
node tests/preview-server.mjs 30147 'M:\Foudnryv14\Foundry Virtual Tabletop\resources\app\public'
```

Open http://127.0.0.1:30147/tests/ui-preview.html. Supply your own Foundry
public directory if it differs. Foundry CSS and fonts are served locally,
not copied into this module. The server binds only to loopback.

## Observed Results

- Real CommandBar and MobileSettings components, Spanish translations,
  module styles, and Foundry v14 base CSS loaded in the in-app browser.
- Modern RPG at 320x740 and 390x844: no horizontal overflow in settings.
- Velvet at 820x1180: two-column rows, no horizontal overflow.
- Scale 1.4 at 320px: no overflowing settings rows.
- Scale 0.8: close control and slider retain 44px targets; command buttons
  retain 57px height and full 13px label boxes.
- More preserves active Target and unread Dice states when opened.
- ArrowDown moves focus from Target to Dice; Escape closes More and
  restores focus to its button. Selecting Dice executes its callback.
- Settings search filters to the matching scale control. Escape dismisses
  settings and restores focus to the opening button.
- Debug setting saves and remains checked after reopening settings.
- Simulated failed Debug save restores the prior checked value, clears
  the busy state, and re-enables its control.
- Theme selection applies Velvet; scale slider writes 0.8 and 1.4.
- Browser error log contains only the deliberately simulated save failure.
- All four lifecycle tests, script syntax checks, and git diff whitespace
  checks passed.

## Limits

This fixture mocks game.settings and does not replace live-world testing.
Real server persistence, reload confirmation, file picking, third-party
settings menus, game-system interactions, and physical touch devices remain
to be tested inside Foundry. The lifecycle tests are not UI regression tests.
