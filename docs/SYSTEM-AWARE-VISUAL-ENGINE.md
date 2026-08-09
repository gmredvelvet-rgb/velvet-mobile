# System-Aware Visual Engine

Velvet Mobile separates data from presentation:

`Foundry actor -> system adapter -> shared view model -> system renderer -> DOM`

The adapters in `scripts/sheet/adapters/` still own extraction, rolls, updates,
menus, descriptions and system compatibility. The visual layer does not call
Foundry document APIs directly.

## System Detection

`scripts/core/theme.mjs` centralizes visual selection. Automatic mode resolves
the active companion sheet module first, then `game.system.id`, then the default
Velvet style. The resolved value is written to:

- `html[data-vm-theme]`
- `html[data-vm-system]`

Manual Settings choices override automatic detection, including Hopefinder.

## Theme Selection

The client setting is registered in `scripts/core/settings.mjs` as
`SETTINGS.THEME`. Its choices are Automatic, Default Velvet, D&D, Pathfinder,
Starfinder and Hopefinder. `Theme.apply()` updates the root attributes and
dispatches `velvet-mobile:theme-changed`, allowing open sheets to rebuild their
visual composition without a Foundry restart.

## Component Factory

`scripts/sheet/system-renderers.mjs` is the component factory. Use
`rendererFor(Theme.current, game.system.id)` to get the renderer for the current
visual language. Each renderer receives the already-built row controls and
places them into a system-specific composition.

Current renderers:

- `default`: original Velvet Mobile list row.
- `dnd5e`: premium D&D card with titlebar, metadata row and action column.
- `pf2e`: activity-style entry with action-cost block and trait chips.
- `sf2e`: cyber HUD record with database label, status and command rail.
- `hopefinder`: tactical field panel with status line and rugged action rail.

## Styles

Shared structural CSS lives in `styles/sheet.css` under “System-aware row
compositions”. System material, typography and ornament live in
`styles/themes.css`.

To modify a system later:

- Change DOM composition in `scripts/sheet/system-renderers.mjs`.
- Change shared layout primitives in `styles/sheet.css`.
- Change system identity details in `styles/themes.css`.
- Change detection or settings labels in `scripts/core/theme.mjs`,
  `scripts/core/constants.mjs`, `scripts/core/settings.mjs`, and `lang/`.

## Fallback

Unknown systems keep the original default Velvet renderer and the generic
adapter fallback. They should never lose sheet access because a renderer is
missing.

## Performance

Renderers do not add observers, polling or repeated Foundry lookups. Theme
changes rebuild only the open mobile sheet DOM; ordinary model refreshes remain
coalesced by `MobileSheet.refresh()`.
