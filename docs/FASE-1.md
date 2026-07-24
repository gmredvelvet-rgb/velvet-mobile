# Fase 1 — Fundación

> **Estado:** implementada, pendiente de validación manual
> **Alcance:** núcleo del módulo, motor responsive, fixes invisibles de viewport. **Cero rediseño visual** (eso empieza en Fase 2).

## Qué se construyó

| Pieza | Archivo | Descripción |
|---|---|---|
| Manifiesto | `module.json` | v13, ESM único (`main.mjs`), 2 hojas CSS, en/es |
| Constantes | `scripts/core/constants.mjs` | Todos los identificadores del módulo en un solo lugar |
| Logger | `scripts/core/logger.mjs` | Niveles, prefijo con estilo, debug conmutable en caliente |
| Settings | `scripts/core/settings.mjs` | `mode` (auto/phone/tablet/off), `uiScale` (0.8–1.4), `debug` — todos `client` |
| Registry | `scripts/core/registry.mjs` | Ciclo de vida de servicios: `shouldEnable/enable/disable` simétricos |
| DeviceProfiler | `scripts/responsive/device-profiler.mjs` | Perfil inmutable multi-señal; listeners con `AbortController`; debounce 100ms |
| UIState | `scripts/responsive/ui-state.mjs` | Único escritor de `data-vm-*` y custom properties en `<html>` |
| ViewportService | `scripts/responsive/viewport.mjs` | `viewport-fit=cover` reversible (safe areas de notch) |
| API pública | `scripts/core/api.mjs` | `api.device.profile`, `api.device.is()`, `api.state.active`, congelada |
| Entry point | `scripts/main.mjs` | Controlador de ciclo de vida; on↔off en vivo sin recargar |
| Tokens | `styles/tokens.css` | Design tokens en `@layer velvet-mobile.tokens` |
| Base | `styles/base.css` | Anti double-tap-zoom, anti pull-to-refresh, anti auto-zoom iOS, scrollbars táctiles |

## Decisiones de arquitectura materializadas

1. **JS clasifica, CSS presenta.** El único contrato JS→CSS son los atributos `data-vm-active/device/input/orientation/size` y las variables `--vm-vvh/--vm-kb/--vm-scale` en `<html>`.
2. **`--vm-vvh`** se sincroniza con `window.visualViewport` — es la solución estructural al problema del `100vh` roto (teclado en pantalla, barras del navegador). Las fases siguientes anclan a esta variable, nunca a `vh`.
3. **Clasificación estable ante rotación:** el tipo de dispositivo usa la dimensión *menor* del viewport, así rotar un teléfono nunca lo convierte en tablet.
4. **`@layer velvet-mobile`:** ganamos al core (que vive en layers) sin inflar especificidad, y cedemos ante CSS sin layer de otros módulos (buena ciudadanía).
5. **Apagado real:** con `mode: off` no queda ningún listener, atributo, variable ni meta modificada (todo `enable()` tiene su `disable()`).

## Checklist de validación (manual, en Foundry v13)

Prerequisito: renombrar la carpeta del módulo a `velvet-mobile` y activarlo en el mundo.

**A. Desktop, modo `auto` (default):**
1. La consola muestra `Velvet Mobile | Active — device: desktop, input: mouse`.
2. `document.documentElement.attributes` incluye `data-vm-device="desktop"` y **no** incluye `data-vm-active`.
3. Diff visual cero: la UI se ve idéntica a vanilla.

**B. Desktop, modo `Force Phone`:**
4. Al cambiar el setting (sin recargar): `data-vm-active` y `data-vm-device="phone"` aparecen en `<html>`.
5. `game.modules.get("velvet-mobile").api.device.is("phone")` → `true`.

**C. Emulación móvil (DevTools → iPhone SE):**
6. Tras recargar: `data-vm-device="phone"`, `data-vm-input="touch"`, `data-vm-orientation` correcto.
7. Rotar el dispositivo emulado: `data-vm-orientation` cambia; `data-vm-device` NO cambia.
8. `getComputedStyle(document.documentElement).getPropertyValue("--vm-vvh")` ≈ altura del viewport en px.
9. Doble tap sobre la sidebar no hace zoom.

**D. Modo `Off`:**
10. Al seleccionarlo: consola `Disabled on this client (mode: off)`; `<html>` queda sin ningún atributo `data-vm-*` ni variable `--vm-*` inline.

**E. Smoke test:**
11. Abrir/cerrar hoja de personaje, chat, settings — cero errores de consola.
12. Hook de integración: `Hooks.on("velvetMobile.deviceChanged", console.log)` dispara al rotar/redimensionar.

## Deuda registrada

- `TODO(fase-2)`: supresión controlada del aviso de resolución mínima del core (P16) — pertenece al Window Manager.
- `TODO(fase-6)`: `--vm-scale` está expuesto pero ningún estilo lo consume aún; se conecta cuando existan componentes visuales propios.
