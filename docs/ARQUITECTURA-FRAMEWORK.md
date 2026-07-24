# Velvet Mobile — Arquitectura de Framework (v2, alcance elevado)

> Reemplaza la visión "responsive" del plan original. Velvet Mobile no adapta Foundry al
> teléfono: **rediseña cómo funciona Foundry en el teléfono**. En desktop no toca nada.
> El plan original (`PLAN-DE-DESARROLLO.md`) sigue vigente para auditoría, riesgos,
> pruebas y compatibilidad; este documento manda sobre arquitectura y roadmap.

## Filosofía por dispositivo

| | Teléfono | Tablet | Desktop |
|---|---|---|---|
| Ventanas flotantes | **JAMÁS** | Sí, contenidas + side panels | Intactas |
| Presentación de apps | Bottom Sheets / Fullscreen | Flotante clamped / Panel lateral | Sin cambios |
| Navegación | Bottom Navigation + gestos + pila de vistas | Sidebar mejorado + Dock | Vanilla |
| Acciones rápidas | FAB (speed dial) + Dock | Dock | — |

## Subsistemas (motores)

```
                    ┌───────────────────────────────────────────┐
                    │            AdapterRegistry                │
                    │  (PF2e, dnd5e, módulos externos declaran  │
                    │   cómo quieren presentarse en móvil)      │
                    └───────────────┬───────────────────────────┘
                                    │ hints
 DeviceProfiler ──▶ perfil ──▶ ┌────▼─────────┐   decisión    ┌───────────────┐
 (fase 1)                      │ LayoutEngine │──────────────▶│ WindowManager │
                               └──────────────┘  (floating /  └──────┬────────┘
                                                  fullscreen /       │ hospeda apps en
                                                  bottom-sheet /     ▼
                                                  side-panel)  Component Library
                                                               (BottomSheet, NavBar,
 GestureEngine ◀── Pointer Events                               Dock, FAB, VirtualList…)
   │ tap · doubleTap · longPress · swipe · pan                        ▲
   │ pinch(+rotate) · edgeSwipe · velocity                            │ usa
   ▼                                                                  │
 NavigationEngine (Bottom Nav, pila de vistas, back por gesto) ───────┘

 Transversales: ThemeEngine (densidades/skins) · Motion (AnimationEngine)
                KeyboardManager (anti-teclado) · PerformanceEngine (virtualización, lazy)
```

### 1. LayoutEngine (`scripts/layout/`)
Cerebro de presentación. Para cada `Application` que Foundry renderiza produce una
**LayoutDecision**: `{ mode: untouched | floating | fullscreen | bottom-sheet | side-panel, snapPoints, dismissible, … }`.
Reglas por defecto (teléfono: diálogos → bottom-sheet media altura; hojas de documento →
fullscreen deslizable; tablet: diálogos → flotante clamped; hojas → side-panel derecho),
**siempre** consultando antes al AdapterRegistry por si un sistema/módulo declaró algo mejor.

### 2. WindowManager (`scripts/windows/`)
Ejecuta la decisión. En teléfono **no existen ventanas flotantes**: re-aloja el elemento de
la app dentro de un `BottomSheet` (AppSheetHost), neutraliza `setPosition` a nivel de
instancia (reversible, nunca prototipos) y devuelve todo a su sitio al cerrar. Soporta
AppV1 y AppV2 vía `AppInfo` (normalizador).

### 3. NavigationEngine (`scripts/navigation/`)
Navegación tipo Android: **Bottom Navigation** (Home · Chat · Combate · Actores · Diario),
sidebar de Foundry presentado como sheet, **pila de vistas** con "atrás" por edge-swipe,
FAB y Dock personalizables por API.

### 4. GestureEngine (`scripts/gestures/`)
Motor real de reconocimiento, no listeners sueltos: `GestureRecognizer` con máquina de
estados (possible → began → changed → ended/cancelled/failed), árbitro de conflictos
(un reconocedor puede reclamar exclusividad y hacer fallar al resto), tracking de
velocidad por ventana de muestras. Reconocedores: tap, doubleTap, longPress, swipe,
pan (con velocity para momentum), pinch (escala + **rotación** + centro), edgeSwipe.
Construido sobre Pointer Events; limpieza por `AbortController`.

### 5. Component Library (`scripts/components/`)
Componentes reutilizables por otros módulos vía API: `VelvetComponent` (base con ciclo
de vida y listeners auto-limpiables), `BottomSheet` (snap points, arrastre con
velocidad, backdrop), `NavBar`, `Dock`, `FAB` (speed dial), `VirtualList`
(virtualización). CSS en `styles/components.css` bajo `@layer velvet-mobile`.

### 6. ThemeEngine (`scripts/theme/`)
Densidades (`compact` / `cozy` / `touch`) proyectadas como `data-vm-density` + tokens;
hereda claro/oscuro del core; preparado para skins.

### 7. KeyboardManager (`scripts/keyboard/`)
Anti-teclado: detecta apertura real (delta de `visualViewport` + `focusin`), publica
`data-vm-keyboard="open"`, garantiza el input enfocado visible, oculta chrome móvil
(navbar/FAB) mientras se escribe y ancla los sheets a `--vm-vvh`.

### 8. PerformanceEngine (`scripts/performance/`)
`VirtualList` (windowing con reciclado) para chats/compendios/inventarios enormes;
lazy rendering (`content-visibility` en mensajes/páginas; pestañas ocultas sin coste);
expuesto por API para que otros módulos virtualicen sus listas.

### 9. Motion (`scripts/motion/`)
`AnimationEngine` sobre Web Animations API: duraciones y curvas tokenizadas, prioridades,
`prefers-reduced-motion` respetado globalmente. Ningún componente anima por su cuenta.

### 10. AdapterRegistry (`scripts/adapters/`)
Registro público: `vm.adapters.register({ id, priority, match(appInfo), layout(appInfo, profile), decorate(app, host) })`.
Los sistemas (PF2e, dnd5e…) y módulos externos declaran cómo adaptarse **sin que Velvet
Mobile los conozca**. Incluye adaptadores integrados: diálogos core y PF2e.

## Roadmap revisado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Fundación (perfil, settings, viewport) | ✅ |
| **2 — Framework Core** | GestureEngine, Motion, Component Library (BottomSheet/NavBar/Dock/FAB/VirtualList), LayoutEngine, WindowManager, NavigationEngine, KeyboardManager, ThemeEngine, AdapterRegistry, API ampliada | ✅ implementada — pendiente validación |
| 3 | Chat móvil profundo + sidebar por pestañas nativo + virtualización aplicada al chat | ⏳ |
| 4 | Canvas táctil (HUD, selección, medición, plantillas) + DnD táctil | ⏳ |
| 5 | Sheet reflow profundo + adaptador PF2e completo (integración velvet-sheet) + journals | ⏳ |
| 6 | Performance modes (FPS cap, canvas freeze, keep-awake) + diagnóstico de conflictos | ⏳ |
| 7 | Panel de configuración, overrides por usuario del GM, docs de API, release 1.0 | ⏳ |

## Reglas inalterables

1. Teléfono = cero ventanas flotantes. 2. JS clasifica y orquesta; CSS presenta.
3. Solo hooks oficiales; overrides solo a nivel de instancia y reversibles.
4. Todo `enable()` tiene `disable()` simétrico. 5. `mode: off` = módulo inerte total.
6. Toda animación pasa por Motion. 7. Todo identificador vive en `constants.mjs`.
