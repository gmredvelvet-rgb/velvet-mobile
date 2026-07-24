# Fase 2 — Framework Core (alcance elevado)

> **Estado:** implementada, pendiente de validación manual
> **Contexto:** tras la revisión del cliente, el proyecto se elevó de "módulo responsive" a
> **framework de interfaz móvil** (ver `ARQUITECTURA-FRAMEWORK.md`). Esta fase construye
> todos los motores.

## Qué se construyó

| Subsistema | Archivos | Qué hace |
|---|---|---|
| **GestureEngine** | `gestures/recognizer.mjs`, `controller.mjs`, `recognizers.mjs`, `engine.mjs` | Máquina de estados por reconocedor (possible→began→changed→ended/cancelled/failed), árbitro de exclusividad, velocity tracking. Reconocedores: tap, doubleTap, longPress, swipe, edgeSwipe, pan (velocity para momentum), pinch (escala+rotación+centro) |
| **Motion** | `motion/animation-engine.mjs` | WAAPI; duraciones/curvas canónicas; `prefers-reduced-motion` global |
| **Component Library** | `components/` | `VelvetComponent` (base auto-limpiable), `BottomSheet` (snaps, drag con fling, backdrop), `NavBar`, `Dock`, `FAB` (speed dial), `VirtualList` (windowing con reciclado) |
| **LayoutEngine** | `layout/layout-engine.mjs` | Decisión por app: untouched / floating / fullscreen / bottom-sheet / side-panel. Teléfono: **cero ventanas flotantes** |
| **AdapterRegistry** | `adapters/registry.mjs`, `builtin.mjs` | Sistemas/módulos declaran su presentación móvil; integrados: PF2e (hojas fullscreen) y ventanas de configuración |
| **WindowManager** | `windows/window-manager.mjs`, `app-adapter.mjs`, `app-sheet-host.mjs` | Ejecuta la decisión: hospeda apps en BottomSheets (reparenting + guard reversible de `setPosition` a nivel de instancia), side panels en tablet, clamping de flotantes. Pila de vistas para "atrás" |
| **NavigationEngine** | `navigation/navigation-engine.mjs` | Bottom Navigation (Inicio·Chat·Combate·Actores·Diario), sidebar como sheet, atrás por edge-swipe izquierdo, Dock y FAB con acciones por defecto y registro por API |
| **KeyboardManager** | `keyboard/keyboard-manager.mjs` | Teclado = inset grande de visualViewport **y** foco en editable; publica `data-vm-keyboard`, garantiza input visible, oculta shell al escribir |
| **ThemeEngine** | `theme/theme-engine.mjs` | Densidades compact/cozy/touch → `data-vm-density` + tokens; hereda claro/oscuro del core |
| **CSS** | `components.css`, `shell.css`, `tokens.css` ampliado | Sheets, navbar, dock, FAB, side panels, sidebar-como-sheet, ergonomía táctil de controles core |

## Settings nuevos (todos `client`)

`density` (auto/compact/cozy/touch) · `navBar` · `dock` · `fab` — los tres últimos reconstruyen el shell en vivo.

## API pública ampliada

```js
const vm = game.modules.get("velvet-mobile").api;
vm.gestures.on(el, "pan", handler, opts)   // → unsubscribe
vm.adapters.register({ id, priority, match, layout, decorate })
vm.windows.exclude("MiVentana"); vm.windows.closeTop(); vm.windows.closeAll();
vm.dock.register({ id, icon, label, onTap, visible })
vm.fab.register({ id, icon, label, onTap, visible })
vm.components.BottomSheet / VirtualList / VelvetComponent
// Hooks nuevos: velvetMobile.layoutDecided, .sheetOpened, .sheetClosed
```

## Checklist de validación (Foundry v13, mundo PF2e)

Prerequisito: carpeta renombrada a `velvet-mobile`, módulo activo.

**A. Teléfono (DevTools iPhone SE o `Force Phone`):**
1. Aparecen navbar inferior (5 destinos), FAB (+) y dock (⏸/🎯 según rol).
2. Abrir una hoja de actor → se presenta **fullscreen como sheet** (sin ventana flotante), con header propio y cierre por botón y por swipe-down desde el handle/header.
3. Abrir un diálogo (p. ej. borrar un item) → bottom sheet a media altura; arrastrar arriba → snap a 92%; fling abajo → se cierra y el diálogo se cierra de verdad (sin app huérfana).
4. Navbar → Chat: el sidebar aparece como sheet sobre la navbar con la pestaña de chat activa. Home lo cierra todo y vuelve al canvas.
5. Edge-swipe desde el borde izquierdo → cierra la vista superior (hoja abierta, luego sidebar).
6. FAB → "Tirar d20" postea una tirada al chat; "Mi personaje" abre tu hoja (en sheet).
7. Con un input enfocado y teclado abierto: navbar/FAB/dock desaparecen; al cerrar el teclado vuelven.
8. `mode: off` → desaparece TODO (navbar, fab, dock, atributos) y las ventanas vuelven a ser vanilla.

**B. Tablet (iPad emulado o `Force Tablet`):**
9. Hoja de actor en landscape → panel lateral derecho a toda altura; en portrait → fullscreen (adaptador PF2e).
10. Diálogos → flotantes pero siempre dentro del viewport (clamping).
11. Dock vertical en el borde derecho; FAB abajo a la derecha; sin navbar.

**C. Regresión desktop:** con `mode: auto` en desktop, diff visual cero y ninguna ventana tocada.

**D. Fugas:** abrir/cerrar 10 hojas y alternar `mode` off→auto 3 veces → sin errores de consola y sin nodos `.vm-*` residuales en el DOM.

## Riesgos conocidos de esta fase (a vigilar en la validación)

- **Reparenting de apps AppV2**: si algún sistema guarda referencias posicionales absolutas, su hoja podría comportarse raro dentro del sheet → el AdapterRegistry permite excluirla (`vm.windows.exclude`) mientras se escribe su adaptador.
- **Selectores del sidebar v13** (`#sidebar nav`): verificar contra el DOM real; están escritos de forma estructural, no interna.
- **`ui.sidebar.changeTab`**: se usa con fallback a `activateTab`; confirmar cuál responde en v13.

## Deuda registrada

- `TODO(fase-3)`: chat profundo (input flotante, virtualización del log con `VirtualList`, burbujas).
- `TODO(fase-4)`: long-press → context menu nativo y DnD táctil (el motor de gestos ya lo soporta).
- `TODO(fase-2-validación)`: supresión del aviso de resolución mínima del core.
