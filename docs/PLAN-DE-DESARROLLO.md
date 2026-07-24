# Velvet Mobile — Análisis y Plan de Desarrollo

> **Módulo:** `velvet-mobile` · **Objetivo:** Foundry VTT v13 con experiencia Mobile-First de calidad nativa
> **Fecha:** 2026-07-10 · **Estado:** Fase 0 (Análisis) — COMPLETA
> **Autor del análisis:** Arquitectura Velvet

---

## 1. Auditoría completa

### 1.1 Entorno del proyecto

| Elemento | Valor |
|---|---|
| Foundry VTT | v13 (UI ApplicationV2, CSS `@layer`, temas claro/oscuro, PixiJS 7.x) |
| Sistema principal | Pathfinder 2e (con Starfinder 2e como secundario) |
| Ecosistema propio | `pf2e-velvet-sheet` (hoja custom, ESM, sin build step) |
| Módulo de referencia | `swipe-vtt` v1.22.3 (estudiado solo a nivel de ideas) |

### 1.2 Auditoría del módulo de referencia (swipe-vtt)

Se estudió **exclusivamente** la arquitectura conceptual. No se copia código. Se **excluye por completo** todo lo relacionado con Patreon/premium, OAuth, QR-connect, invite URLs y standalone-auth.

**Ideas arquitectónicas valiosas identificadas:**

1. **Detección multi-señal de dispositivo** — combina `navigator.maxTouchPoints`, `matchMedia("(pointer: coarse)")`, `userAgent`, `devicePixelRatio` y dimensiones de pantalla. Ninguna señal aislada es fiable; la combinación sí.
2. **Estrategia CSS por clase raíz** — todo el CSS vive bajo `body.swipe-vtt`, garantizando cero impacto cuando el modo móvil está inactivo. *Lección aprendida:* usa 1139 selectores bajo una clase de body, lo que crea guerras de especificidad. Nosotros usaremos **atributos `data-*` en `<html>` + CSS custom properties**, apoyándonos en que en v13 el core vive en `@layer` (los estilos de módulo, sin layer, ganan sin necesidad de especificidad artificial).
3. **Modos de rendimiento escalonados** (Minimal / Balanced / Aggressive / Sheet-Only) con auto-escalado si el FPS cae — excelente patrón de UX de rendimiento.
4. **Canvas freeze** — pausar el render tras inactividad con triggers de descongelado (combate, movimiento de token, tirada). Gran ahorro de batería.
5. **Interruptor maestro por cliente** — el módulo puede desactivarse totalmente en un cliente sin desinstalarlo (setting `client`).
6. **Overrides por usuario desde el GM** — el GM puede forzar modo móvil/desktop por jugador.
7. **Diagnóstico de conflictos** — detecta módulos pesados (FXMaster, Token Magic, Dice So Nice, animaciones) y ofrece desactivarlos por dispositivo.
8. **Optimización de imágenes de escena** (versiones WebP ≤4096px solo para móvil) — idea potente, se difiere a mejoras futuras.
9. **Uso correcto de hooks v13** — `renderChatMessageHTML` (no el deprecado `renderChatMessage`), `renderDocumentSheetV2`, `foundry.applications.api.DialogV2`.
10. **Gestos con Pointer/Touch events delegados** — con limpieza de listeners (`Hooks.off` simétricos) para evitar leaks.

**Anti-patrones detectados que evitaremos:**

- Bundle monolítico de 530 KB en un solo archivo → nosotros: ESM nativo multi-archivo, sin build step obligatorio.
- Especificidad CSS masiva → nosotros: `@layer` propio + tokens.
- Mezcla de `touchstart/touchend` y `pointerdown/up` → nosotros: **solo Pointer Events**, unificados y con `passive` donde aplique.
- Dependencia dura de `socketlib` → nosotros: sin dependencias en el núcleo; sockets nativos (`game.socket`) solo si una fase lo exige.

### 1.3 Auditoría de Foundry v13 para móvil

**APIs y superficies relevantes:**

- **ApplicationV2 / DocumentSheetV2 / DialogV2** (`foundry.applications.api`) — toda ventana nueva del core es AppV2. Posicionamiento vía `Application#setPosition({left, top, width, height})` y `#position`. Hooks genéricos `renderApplicationV2` / `closeApplicationV2` + hooks por clase.
- **AppV1 legado** — sistemas como PF2e aún renderizan hojas con AppV1 (`renderActorSheet`, jQuery). Debemos soportar **ambas generaciones**.
- **Sidebar v13** — `#sidebar` es AppV2 con pestañas (Chat, Combat, Scenes, Actors, …); hooks `renderSidebar`, `collapseSidebar`, `changeSidebarTab`.
- **Scene Controls v13** — reestructurados (herramientas como objetos, no arrays); hook `getSceneControlButtons`, `renderSceneControls`.
- **HUDs v13** — TokenHUD y compañía migrados a AppV2 (`renderTokenHUD`).
- **Canvas** — PixiJS 7.x, eventos federados de PIXI; el core ya trae pan táctil y pinch-zoom básicos y emulación de long-press → clic derecho vía `MouseInteractionManager`. Nuestro trabajo es **mejorarlos**, no reemplazarlos.
- **Settings** — `game.settings.register` con scope `world`/`client`; menús con `registerMenu` + AppV2.
- **Temas** — v13 introduce tema claro/oscuro con custom properties del core: debemos heredar tokens del core, no inventar colores paralelos.

**Limitaciones del core en móvil (verificadas):**

- Foundry muestra advertencia de **resolución mínima** (~1024×700) en pantallas pequeñas.
- Las ventanas usan `position: absolute` con `top/left/width/height` inline → se salen del viewport con facilidad.
- `100vh` en iOS/Android no descuenta barras del navegador ni teclado → el chat input queda oculto; solución: `visualViewport` + unidades `dvh` + variable `--vm-vvh`.
- Inputs con `font-size < 16px` provocan auto-zoom en iOS.
- Tooltips y context-menus dependen de `hover` y clic derecho.
- El drag & drop usa HTML5 DnD, que **no funciona con touch** sin ayuda.
- iOS Safari: límite duro de memoria (crashes con texturas grandes), vídeos transparentes con fondo negro, `wake lock` limitado.

### 1.4 Auditoría del punto de partida local

- La carpeta de trabajo `Mobile Sheets velvet` está vacía (solo un archivo residual `sadd`). Partimos de cero: ideal para arquitectura limpia.
- **Restricción de Foundry:** el nombre de la carpeta del módulo **debe** coincidir con su `id` (sin espacios). La carpeta deberá renombrarse a `velvet-mobile` antes de activarlo.

---

## 2. Problemas detectados (catálogo completo)

| # | Problema | Área | Impacto móvil |
|---|---|---|---|
| P01 | Ventanas más grandes que el viewport, sin clamping | Windows | Crítico |
| P02 | Diálogos/popups fuera de pantalla o inaccesibles | Windows | Crítico |
| P03 | Hojas de personaje ilegibles/inoperables (multi-columna densa) | Sheets | Crítico |
| P04 | Touch targets < 44px (botones de header, controles, sidebar) | Global | Crítico |
| P05 | `100vh` roto (teclado/barras del navegador tapan el chat input) | Layout | Crítico |
| P06 | Zoom accidental (double-tap, pinch sobre UI, auto-zoom de inputs iOS) | Touch | Crítico |
| P07 | Sidebar diseñado para mouse: pestañas diminutas, sin gestos | Sidebar | Alto |
| P08 | Chat: entrada incómoda, scroll conflictivo, mensajes densos | Chat | Alto |
| P09 | Context menus solo con clic derecho | Interacción | Alto |
| P10 | Tooltips solo con hover | Interacción | Alto |
| P11 | Drag & drop HTML5 inoperante con touch (inventario, hotbar) | Interacción | Alto |
| P12 | Token HUD con botones pequeños y mal posicionado en pantallas chicas | Canvas/HUD | Alto |
| P13 | Scene controls (barra izquierda) diminutos y siempre expandidos | Canvas | Alto |
| P14 | Selección/movimiento de tokens impreciso con dedo | Canvas | Alto |
| P15 | Rendimiento: FPS sin límite, animaciones de luz, DPR alto → calor/batería | Performance | Alto |
| P16 | Advertencia de resolución mínima del core | Core | Medio |
| P17 | Journals: imágenes desbordadas, texto pequeño, TOC inusable | Journals | Medio |
| P18 | Compendios: listas densas, búsqueda incómoda | Compendiums | Medio |
| P19 | Hotbar de macros inaccesible/superpuesta | Macros | Medio |
| P20 | Medición y plantillas requieren precisión de mouse | Canvas | Medio |
| P21 | Foldables: cambio de viewport en caliente (plegado/desplegado) | Responsive | Medio |
| P22 | Suspensión del navegador al apagar pantalla → desconexión | Plataforma | Medio |
| P23 | Ventanas “recordadas” fuera de pantalla tras rotar el dispositivo | Windows | Medio |
| P24 | Scrollbars de escritorio (finas) difíciles de usar | Global | Bajo |
| P25 | Configuración del módulo/core inusable en móvil | Settings | Bajo |

---

## 3. Lista priorizada

**P0 — Fundación (sin esto nada funciona):** motor responsive + detección de dispositivo, fixes de viewport (P05, P06, P16), arquitectura de settings, API interna.

**P1 — Usabilidad crítica:** Window Manager (P01, P02, P23), touch targets globales (P04), sheets fullscreen en teléfono (P03).

**P2 — Interacción diaria:** sidebar móvil (P07), chat móvil (P08), gestos (P09, P10, P11), HUD/controles de canvas (P12, P13, P14).

**P3 — Excelencia:** rendimiento (P15, P22), journals/compendiums (P17, P18), macros (P19), medición (P20), foldables (P21), pulido (P24, P25).

---

## 4. Arquitectura

### 4.1 Principios

1. **CSS-first:** JavaScript *clasifica* (atributos `data-vm-*` y custom properties en `<html>`); CSS *presenta*. Cero manipulación de estilos inline salvo en el Window Manager.
2. **Cero coste cuando está inactivo:** si el perfil es desktop y el usuario no fuerza el modo móvil, el módulo no instala listeners, observers ni CSS activo.
3. **Servicios con ciclo de vida:** cada subsistema es una clase-servicio con `init()`, `ready()`, `enable()`, `disable()`, `dispose()`. El núcleo los orquesta. Nada de código suelto a nivel de módulo.
4. **Hooks oficiales primero:** monkey-patching prohibido salvo necesidad demostrada; si ocurre, vía `libWrapper` (dependencia *opcional*) y documentado en `docs/WRAPPERS.md`.
5. **Soporte dual AppV1/AppV2:** una capa de adaptación (`AppAdapter`) normaliza ambas generaciones para el Window Manager.
6. **Progressive enhancement por dispositivo:** teléfono ⊂ tablet ⊂ desktop; cada capa añade, nunca bifurca lógica duplicada.

### 4.2 Diagrama de capas

```
┌─────────────────────────────────────────────────────────┐
│  API pública (game.modules.get("velvet-mobile").api)    │
├─────────────────────────────────────────────────────────┤
│  Features:  windowManager │ sidebar │ chat │ canvas     │
│             sheets │ journals │ hud │ macros            │
├─────────────────────────────────────────────────────────┤
│  Servicios: GestureEngine │ Compatibility │ Performance │
├─────────────────────────────────────────────────────────┤
│  Núcleo responsive: DeviceProfiler → UIState (data-vm-*)│
├─────────────────────────────────────────────────────────┤
│  Base: constants │ logger │ settings │ ServiceRegistry  │
└─────────────────────────────────────────────────────────┘
```

### 4.3 Sistema responsive (motor inteligente)

`DeviceProfiler` produce un **perfil inmutable** recalculado ante cambios:

```js
{
  device:      "phone" | "tablet" | "desktop",   // clasificación final
  input:       "touch" | "mouse" | "hybrid",     // pointer + hover + maxTouchPoints
  orientation: "portrait" | "landscape",
  size:        "xs" | "sm" | "md" | "lg" | "xl", // ancho efectivo
  foldable:    boolean,                          // viewport-segments / cambio brusco de aspecto
  dpr:         number,
  viewport:    { width, height, visualHeight }   // visualHeight = visualViewport (teclado)
}
```

**Señales combinadas:** `matchMedia("(pointer: coarse)")`, `(hover: none)`, `maxTouchPoints`, `visualViewport`, `screen.orientation`, ancho/alto, DPR, y media queries de segmentos de viewport para foldables. Escucha `change` de cada `MediaQueryList` (no polling), `visualViewport.resize` (debounced) y `orientationchange`.

**Salida:** atributos en `<html>` (`data-vm-device`, `data-vm-input`, `data-vm-orientation`, `data-vm-size`) + custom properties (`--vm-vvh`, `--vm-scale`, `--vm-touch-target`, `--vm-safe-top/right/bottom/left`) + hook `velvetMobile.deviceChanged`.

**Breakpoints** (contenido, no dispositivos): xs <380, sm 380–599, md 600–899, lg 900–1199, xl ≥1200. La clasificación `device` pondera input + tamaño, no solo ancho (una tablet con teclado+mouse ≠ teléfono grande).

### 4.4 Window Manager

- Intercepta `renderApplicationV2`/`renderApplication` (captura) y `closeApplicationV2`/`closeApplication` (limpieza).
- **Clamping:** ninguna ventana puede exceder `min(--vm-vvh, 100dvh)` ni salir del viewport; re-clamp en rotación/resize.
- **Modo teléfono:** las ventanas de documento se abren **fullscreen** (patrón app nativa) con barra superior propia (cerrar/minimizar); las demás se centran.
- **Modo tablet:** ventanas grandes se ajustan a un máximo cómodo; snap a mitades de pantalla.
- **Maximizar/minimizar:** botones táctiles inyectados en el header; minimizados van a una bandeja inferior.
- **Memoria de posición:** por `id` de app en un setting `client`, con validación al restaurar (si quedó fuera de pantalla → recentrar, resuelve P23).
- **Gestión multi-ventana:** en teléfono, política "una ventana de documento visible a la vez" (pila con navegación atrás); configurable.

### 4.5 GestureEngine

- **Solo Pointer Events**, delegados en 2 raíces (`document.body` para UI; `canvas.app.view` observado sin capturar, para no pelear con PIXI).
- Reconocedores: `tap`, `doubleTap`, `longPress`, `swipe(dir)`, `pinch`, `pan`. Máquina de estados por puntero; multi-touch para pinch.
- Listeners `passive: true` salvo donde se necesite `preventDefault` (documentado caso por caso).
- Emite hooks `velvetMobile.gesture` y expone `gestures.on(target, recognizer, handler)` en la API para otros módulos.
- Long-press → abre el context menu nativo de Foundry del elemento (resuelve P09); tap sostenido sobre elemento con tooltip → muestra `game.tooltip` (P10).
- Puente táctil para drag & drop (P11): long-press + arrastre sintetiza la secuencia DnD de Foundry (fase 4; el core v13 ya cubre parte).

### 4.6 Flujo de datos

Ver §5.

---

## 5. Flujo de datos

```
 eventos del navegador                 hooks de Foundry
 (matchMedia, visualViewport,         (init, ready, render*, canvas*)
  orientation, pointer)                        │
        │                                      │
        ▼                                      ▼
 ┌──────────────┐   perfil    ┌────────────────────────────┐
 │DeviceProfiler│────────────▶│ UIState                    │
 └──────────────┘             │ · data-vm-* en <html>      │
        │                     │ · custom properties        │
        │ hook                └──────────┬─────────────────┘
        ▼                                │
 velvetMobile.deviceChanged              ▼
        │                     ┌────────────────────────────┐
        ├────────────────────▶│ Features (WM, sidebar,     │
        │                     │ chat, canvas, sheets…)     │
        ▼                     │ enable()/disable() según   │
   otros módulos              │ perfil + settings          │
   (API pública)              └──────────┬─────────────────┘
                                         ▼
                              CSS (@layer velvet-mobile)
                              reacciona a data-vm-* — la
                              presentación NUNCA vive en JS
```

**Regla de oro:** el estado fluye en una sola dirección (Profiler → UIState → Features/CSS). Las features nunca escriben en el perfil; los settings son la única otra entrada.

---

## 6. Componentes

| Componente | Carpeta | Responsabilidad | Fase |
|---|---|---|---|
| `constants` | `core/` | ID, flags, nombres de settings/hooks | 1 |
| `Logger` | `core/` | Log con niveles, prefijo, modo debug | 1 |
| `SettingsManager` | `core/` | Registro y acceso tipado a settings | 1 |
| `ServiceRegistry` | `core/` | Ciclo de vida de servicios | 1 |
| `PublicAPI` | `core/` | Superficie pública + hooks propios | 1 |
| `DeviceProfiler` | `responsive/` | Perfil de dispositivo reactivo | 1 |
| `UIState` | `responsive/` | data-attrs + custom properties | 1 |
| `ViewportService` | `responsive/` | dvh/teclado/safe-area/anti-zoom | 1 |
| `WindowManager` | `windows/` | Clamp, fullscreen, snap, memoria | 2 |
| `AppAdapter` | `windows/` | Normaliza AppV1/AppV2 | 2 |
| `MobileSidebar` | `sidebar/` | Navegación inferior + drawer | 3 |
| `MobileChat` | `chat/` | Input flotante, scroll, burbujas | 3 |
| `GestureEngine` | `gestures/` | Reconocedores pointer-based | 4 |
| `CanvasTouch` | `canvas/` | Selección, HUD, controles, medición | 4 |
| `SheetReflow` | `sheets/` | Reflow genérico + adaptador PF2e | 5 |
| `JournalReflow` | `sheets/` | Journals/compendiums responsive | 5 |
| `PerformanceService` | `performance/` | FPS cap, freeze, keep-awake, modos | 6 |
| `CompatibilityService` | `compat/` | Detección de conflictos, avisos | 6 |
| `SettingsUI` | `ui/` | Panel de configuración AppV2 | 7 |

---

## 7. Hooks

### 7.1 Hooks de Foundry consumidos

| Hook | Uso |
|---|---|
| `init` | Registrar settings, exponer API temprana |
| `i18nInit` | Strings localizados para settings |
| `setup` / `ready` | Arrancar Profiler y servicios según perfil |
| `renderApplicationV2` / `closeApplicationV2` | Window Manager (AppV2) |
| `renderApplication` / `closeApplication` | Window Manager (AppV1 legado, hojas PF2e) |
| `renderActorSheet` / `renderDocumentSheetV2` | SheetReflow |
| `renderSidebar` / `changeSidebarTab` / `collapseSidebar` | MobileSidebar |
| `renderChatLog` / `renderChatMessageHTML` | MobileChat (nunca el deprecado `renderChatMessage`) |
| `renderSceneControls` / `getSceneControlButtons` | Controles táctiles |
| `renderTokenHUD` | HUD táctil |
| `canvasInit` / `canvasReady` | CanvasTouch + PerformanceService |
| `renderJournalSheet` / `renderJournalPageSheet` | JournalReflow |
| `renderHotbar` | Macros móviles |
| `updateCombat` / `createChatMessage` | Triggers de descongelado de canvas |

### 7.2 Hooks propios expuestos (namespace `velvetMobile.`)

| Hook | Payload | Cuándo |
|---|---|---|
| `velvetMobile.ready` | `api` | API lista (en `ready`) |
| `velvetMobile.deviceChanged` | `profile, oldProfile` | Cambio de perfil |
| `velvetMobile.windowManaged` | `app, decision` | WM procesó una ventana |
| `velvetMobile.gesture` | `{type, target, detail}` | Gesto reconocido |
| `velvetMobile.performanceModeChanged` | `mode` | Cambio de modo de rendimiento |

---

## 8. APIs

### 8.1 API pública

```js
const vm = game.modules.get("velvet-mobile").api;

vm.version                       // string
vm.device.profile                // perfil actual (inmutable, congelado)
vm.device.is("phone"|"tablet"|"touch")  // helpers booleanos
vm.state.active                  // ¿modo móvil activo?

// Fases posteriores:
vm.windows.exclude(appIdOrClass) // opt-out del Window Manager
vm.windows.maximize(app) / .restore(app)
vm.gestures.on(element, "swipe", handler)  // → unsubscribe fn
vm.sheets.registerAdapter(systemId, adapter) // reflow por sistema
vm.performance.mode / .setMode(mode)
```

- Todo objeto expuesto es de solo lectura (`Object.freeze`) salvo los métodos documentados.
- Contrato semver: cambios breaking solo en versión mayor.
- Documentación en `docs/API.md` con ejemplos por caso de uso.

### 8.2 Settings (diseño)

| Setting | Scope | Tipo | Fase |
|---|---|---|---|
| `mode` (auto/phone/tablet/off) | client | choice | 1 |
| `uiScale` (0.8–1.4) | client | range | 1 |
| `debug` | client | boolean | 1 |
| `windowMemory`, `phoneFullscreenSheets` | client | — | 2 |
| `sidebarStyle`, `chatAutoShow`, `chatAutoHideSeconds` | client | — | 3 |
| `gesturesEnabled`, `longPressMs`, `touchTargetSize` | client | — | 4 |
| `performanceMode`, `fpsLimit`, `canvasFreeze*`, `keepAwake` | client | — | 6 |
| `userOverrides` (GM fuerza modo por jugador) | world | object | 7 |
| `animationsEnabled` | client | boolean | 6 |

---

## 9. Organización de carpetas

```
velvet-mobile/
├── module.json
├── README.md
├── docs/
│   ├── PLAN-DE-DESARROLLO.md   (este documento)
│   ├── API.md                  (fase 7)
│   ├── WRAPPERS.md             (si algún wrap fuese necesario)
│   └── FASE-N.md               (informe + checklist de prueba por fase)
├── lang/
│   ├── en.json
│   └── es.json
├── scripts/
│   ├── main.mjs                (único entry point; orquestación)
│   ├── core/
│   │   ├── constants.mjs
│   │   ├── logger.mjs
│   │   ├── settings.mjs
│   │   ├── registry.mjs
│   │   └── api.mjs
│   ├── responsive/
│   │   ├── device-profiler.mjs
│   │   ├── ui-state.mjs
│   │   └── viewport.mjs
│   ├── windows/        (fase 2)
│   ├── sidebar/        (fase 3)
│   ├── chat/           (fase 3)
│   ├── gestures/       (fase 4)
│   ├── canvas/         (fase 4)
│   ├── sheets/         (fase 5)
│   ├── performance/    (fase 6)
│   ├── compat/         (fase 6)
│   └── ui/             (fase 7)
├── styles/
│   ├── tokens.css              (custom properties / design tokens)
│   ├── base.css                (fixes globales de viewport/touch)
│   └── components/             (un archivo por feature, por fase)
│   › Nota: cada hoja se lista en module.json (no @import) para respetar
│     el cache-busting por versión de Foundry; todas viven en @layer velvet-mobile.
└── templates/                  (plantillas .hbs, por fase)
```

Sin build step: ESM nativo + `@import` de CSS. Si el proyecto crece hasta justificarlo, se añade Vite **sin cambiar la estructura de src**.

---

## 10. Roadmap

| Fase | Contenido | Criterio de salida (validación) |
|---|---|---|
| **F0** | Este análisis | Documento aprobado |
| **F1 — Fundación** | Scaffold, settings, Logger, Registry, DeviceProfiler, UIState, ViewportService, API base, CSS tokens+base | Carga sin errores en v13; `data-vm-*` correctos en teléfono/tablet/desktop y al rotar; sin efecto alguno en modo `off` |
| **F2 — Window Manager** | Clamp, fullscreen en teléfono, max/min, snap tablet, memoria de posición, AppAdapter | Ninguna ventana (core, PF2e, DialogV2) puede quedar inaccesible en 360×640 |
| **F3 — Sidebar + Chat** | Navegación inferior, drawer con gestos, chat input flotante keyboard-safe, auto-show configurable | Flujo completo de chat y navegación con una mano en teléfono |
| **F4 — Gestos + Canvas** | GestureEngine, long-press→context menu, tooltips táctiles, HUD/controles grandes, selección de tokens, DnD táctil | Sesión de combate jugable solo con touch |
| **F5 — Sheets + Journals** | SheetReflow genérico 1-columna, tabs deslizables, adaptador PF2e, journals/compendiums | Hoja PF2e usable de punta a punta en teléfono |
| **F6 — Rendimiento + Compat** | Modos de rendimiento, FPS cap, canvas freeze, keep-awake, detección de conflictos, accesibilidad (contraste/escala) | 30+ FPS estables en gama media; sin leaks (heap estable en sesión de 1h) |
| **F7 — Config + API + Release** | Panel de configuración AppV2, overrides por usuario, `API.md`, i18n completo, QA final | Checklist de release completo; documentación publicable |

Cada fase produce `docs/FASE-N.md` con: qué se hizo, decisiones, checklist de prueba manual y resultados.

---

## 11. Riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Cambios de API v13→v14 (AppV2, scene controls) | Alta | Alto | Capa `AppAdapter`; acceso a APIs core centralizado en `core/`; gates por `game.release.generation` |
| Hojas PF2e complejas (AppV1 + DOM masivo) resisten el reflow genérico | Alta | Alto | Adaptador por sistema (patrón strategy); fallback: reflow genérico conservador |
| Conflictos con módulos táctiles (TouchVTT, Mobile Improvements, swipe-vtt) | Media | Alto | `CompatibilityService`: detectar y avisar en `ready`; nunca activarse junto a un competidor sin confirmación |
| iOS Safari: memoria, `100vh`, wake lock, vídeos | Alta | Medio | Presupuesto de texturas, `visualViewport` como fuente de verdad, Wake Lock API con fallback documentado |
| Guerra de especificidad con temas/sistemas | Media | Medio | `@layer velvet-mobile` + data-attrs en `<html>`; prohibido `!important` salvo excepciones documentadas |
| Leaks de listeners/observers en render loops | Media | Alto | Regla: todo `enable()` tiene `disable()` simétrico; `AbortController` por servicio; revisión por fase |
| Bloqueo del main thread por observers (MutationObserver) | Media | Medio | Preferir hooks de render; observers solo acotados y con `disconnect()` agresivo |
| El core mejora soporte móvil y nos solapa | Baja | Medio | Feature-flags por subsistema: cualquier feature puede apagarse individualmente |

---

## 12. Estrategia de pruebas

1. **Matriz de dispositivos:**
   - Emulación (cada fase): Chrome DevTools — iPhone SE (375×667), iPhone 14 Pro Max, Pixel 8, Galaxy Fold plegado/desplegado, iPad Mini, iPad Pro, táctil+desktop híbrido.
   - Real (antes de cerrar cada fase): al menos un Android físico y un iPad/iPhone si está disponible.
2. **Setting `mode: phone|tablet` en desktop** = harness de pruebas integrado (idea validada en el módulo de referencia).
3. **Checklist por fase** en `docs/FASE-N.md`: pasos manuales reproducibles + resultado esperado.
4. **Smoke test estándar** (toda fase): cargar mundo, abrir/cerrar 10 ventanas, rotar dispositivo, abrir teclado en chat, cambiar de escena, F5 — cero errores de consola, cero elementos inaccesibles.
5. **Presupuestos de rendimiento:** FPS ≥ 30 en gama media; heap estable (±10%) en 1 h; sin listeners huérfanos (verificación con `getEventListeners` en DevTools).
6. **Regresión desktop:** con `mode: off`, diff visual cero contra Foundry vanilla.
7. **Validación estática:** `node --check` sobre cada `.mjs` y validación JSON de manifiestos/lang en cada fase.

---

## 13. Estrategia de compatibilidad

- **Con el core:** solo hooks documentados; nada de parchear prototipos. Si un caso lo exige (se prevé como mucho 1–2 en WM/canvas), `libWrapper` como dependencia *opcional* con fallback y registro en `docs/WRAPPERS.md`.
- **Con sistemas:** el reflow genérico usa selectores estructurales de Foundry (`.window-app`, `.application`, `form.sheet`), nunca selectores internos de un sistema; lo específico vive en adaptadores (`sheets/adapters/pf2e.mjs`).
- **Con otros módulos:**
  - Lista de conflictos conocidos (TouchVTT, Mobile Improvements, swipe-vtt) → aviso al GM con opción de continuar.
  - API pública para integración (`vm.windows.exclude`, `vm.sheets.registerAdapter`).
  - CSS íntegro bajo `@layer` y condicionado a `html[data-vm-device]` → inactivo = invisible para el resto.
- **Con `pf2e-velvet-sheet`:** integración de primera clase vía el adaptador PF2e; la hoja Velvet podrá declarar sus propios breakpoints a través de la API.
- **Versiones:** `compatibility.minimum: 13`; acceso a APIs con riesgo de cambio encapsulado en `core/foundry-compat.mjs` (single point of change para v14).

---

## 14. Estrategia de mantenimiento

- **Convenciones:** ESM, JSDoc en cada clase/método público, nombres de settings/hooks/flags centralizados en `constants.mjs` (cero strings mágicos).
- **Versionado:** semver; `CHANGELOG.md` desde la fase 1; tags de git por fase.
- **Estructura previsible:** una feature = una carpeta = un servicio = un CSS = un doc.
- **Deuda controlada:** todo atajo consciente se marca `// TODO(fase-N):` y se registra en el informe de fase.
- **Actualización a v14:** el día 1 de la beta de v14 se ejecuta la checklist de §13 sobre `foundry-compat.mjs` y `AppAdapter`.
- **Revisión continua** (cada fase, antes de cerrar): duplicaciones, listeners huérfanos, especificidad CSS, tamaño de archivos (>300 líneas = candidato a dividir), accesibilidad.

---

## 15. Posibles mejoras futuras (post-1.0)

1. **Optimizador de imágenes de escena** (WebP ≤4096px servido solo a móviles) — la mejor idea "grande" del módulo de referencia.
2. **Mini-mapa de tokens** ligero para modo sin canvas (dispositivos muy débiles).
3. **Modo Sheet-Only / Expanded-Tablet** (canvas desactivado, multi-panel).
4. **Monitor de memoria/diagnóstico** para el GM (qué consume en los clientes móviles).
5. **PWA**: manifest + service worker para "instalar" la sesión como app.
6. **Haptics** (`navigator.vibrate`) en gestos confirmados.
7. **Overrides por usuario desde el GM** ampliados (perfiles de rendimiento por jugador).
8. **Temas de densidad** (compact/comfortable/spacious) más allá del uiScale.
9. **Soporte de lápiz/stylus** diferenciado del dedo para dibujo y medición.
10. **Limpieza de settings huérfanos** como utilidad de mundo (idea de referencia, útil para GMs).

---

*Fin del análisis. La Fase 1 puede comenzar una vez validado este documento; su alcance exacto y checklist de prueba se entregan en `docs/FASE-1.md`.*
