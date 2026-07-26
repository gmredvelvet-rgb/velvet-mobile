# Opciones de combate, exploración y downtime de PF2e / SF2e

**Estado:** aplicado el 2026-07-26 sobre `main` (0.16.0).
**Punto de retorno:** etiqueta `v0.16.0`.

Un primer intento se aplicó el 2026-07-25 y se revirtió el mismo día porque la
hoja móvil dejó de mostrarse. La investigación de entonces **no señaló a este
código** (ver «Por qué se retiró la vez anterior» al final). Esta segunda
aplicación repite el código verificado, endurece dos puntos que sí eran
frágiles, y añade exploración y downtime.

Todo está contrastado leyendo la fuente de **PF2e 7.12.2** y **SF2e 0.0.11**,
no de memoria.

---

## Qué resuelve

La hoja de escritorio de PF2e muestra, encima de los ataques, una serie de
casillas y desplegables: *Current Form*, *Double Slice Second Attack*,
*Hunt Prey*, *One Shot One Kill*… La hoja móvil no los tenía, así que había
opciones de combate imposibles de activar desde el teléfono.

No son una lista fija de acciones: son **rule elements de tipo `RollOption`**.
Por eso cualquier dote u objeto que añada uno nuevo aparece solo, sin tocar
código.

Además, las actividades de **exploración** y las acciones de **downtime**
estaban repartidas entre *Acciones* y *Rasgos* según tuvieran o no coste, y
no había forma de activar una actividad de exploración desde el móvil.

---

## El API de PF2e (verificado en 7.12.2)

### Toggles — lectura

`actor.synthetics.toggles` → `{ dominio: { opción: toggle } }`

Cada `toggle` tiene esta forma (construida en `RollOptionRuleElement#setOptionAndFlag`):

```js
{
  itemId: string,        // ítem que aporta la regla
  label: string,         // getReducedLabel() — puede ser texto o clave i18n
  placement: string,     // "actions" por defecto; otros van junto a una estadística
  domain: string,
  option: string,        // opción base, SIN la suboption
  suboptions: [{ value, label, selected, predicate, rule }],
  alwaysActive: boolean, // desplegable sin casilla
  checked: boolean,
  enabled: boolean       // false cuando un `disabledIf` lo apaga
}
```

Filtrar por `placement === "actions"`: los demás pertenecen a otra parte de
la hoja.

### Toggles — escritura

```js
async toggleRollOption(domain, option, itemId = null, value, suboption = null)
```

Internamente hace `item.update({ "system.rules": … })` (o
`actor.updateEmbeddedDocuments("Item", …)` para reglas *mergeable*), así que
**dispara el hook `updateItem`**. El shell ya escucha ese hook
(`sheet-shell.mjs`) y llama a `msheet.refresh()`, por lo que la hoja se
actualiza sola.

Si no encuentra la regla devuelve `null` — no lanza.

### Exploración

`actor.system.exploration` es una lista plana de ids de ítem. El manejador
`toggle-exploration` del sistema:

```js
const exploration = this.actor.system.exploration.filter((id) => this.actor.items.has(id));
exploration.findSplice((id) => id === actionId) || exploration.push(actionId);
await this.actor.update({ "system.exploration": exploration });
```

Es decir: **descarta ids huérfanos antes de escribir**. `explorationIds()`
hace exactamente lo mismo. La escritura dispara `updateActor`, que el shell
también escucha.

### Reparto en tres paneles

El sistema clasifica en `#prepareAbilities` así:

```js
if (!item.isOfType("action") && !(item.isOfType("feat") && item.actionCost) || item.suppressed) continue;
const traits = item.system.traits.value;
if (traits.includes("exploration"))      → exploration.active / .other
else if (traits.includes("downtime"))    → downtime
else                                     → encounter[actionCost.type ?? "free"]
```

`actionPanel()` replica esa criba. La única diferencia deliberada: en
*encounter* seguimos exigiendo coste de acción, para que las capacidades
pasivas se queden donde siempre han estado, en la pestaña de Rasgos.
Exploración y downtime sí lo cogen todo, porque la mayoría no cuesta nada.

### Referencia de la hoja de escritorio

- `systems/pf2e/templates/actors/partials/toggles.hbs`
- `systems/pf2e/templates/actors/character/tabs/actions.hbs`
- `systems/pf2e/templates/actors/partials/action.hbs` (botón `toggle-exploration`)

El módulo `pf2e-velvet-sheet` del propio autor ya usaba este patrón
(`_prepareToggles`, `_prepareExplorationActivities`), y se contrastó con la
fuente del sistema antes de portarlo.

---

## Starfinder 2e

`sf2e` **es un sistema aparte** con su propio `game.system.id`, y ya estaba
registrado contra el adaptador de PF2e en `sheet/adapters.mjs` desde la
**0.14.1**. No hizo falta tocar nada: hereda todo lo de este documento por
usar el mismo adaptador.

Lo que sí se verificó aquí, leyendo `systems/sf2e/sf2e.mjs` (0.0.11), es que
las tres APIs nuevas existen también allí: conserva `game.pf2e` (265 usos),
`CONFIG.PF2E` (700 usos), `toggleRollOption`, `system.exploration` y el mismo
manejador `toggle-exploration` carácter por carácter. Sus tipos de actor son
`character` y `npc` — no tiene `familiar`, lo cual es inofensivo.

---

## Dónde vive el código

| Qué | Dónde |
|---|---|
| `toggleRow`, `toggleRows` | `scripts/sheet/adapters/pf2e.mjs`, sección *Roll-option toggles* |
| `actionPanel`, `displayTraits`, `explorationIds`, `toggleExploration`, `explorationRows` | misma sección siguiente, *Encounter / exploration / downtime* |
| Reparto en un solo pase y secciones de la pestaña | `model()` |
| Claves de idioma | `VELVETMOBILE.Sheet` en `lang/en.json` y `lang/es.json` |

`scripts/sheet/adapters.mjs` **no se toca**: `sf2e` ya estaba registrado ahí.

Claves añadidas: `Toggles`, `ToggleHint`, `ToggleOption`, `Exploration`,
`ExplorationActive`, `Downtime`, `SendToChat`.

---

## Decisiones de diseño

- **Casilla** → punto de estado (`prof`) más `✓` en el badge. Un toque cambia.
- **Desplegable** (`alwaysActive`) → sin casilla; el toque abre el selector y
  la opción activa se lee en la sub-línea.
- **Mixto** → el toque cambia la casilla; un botón `☰` a la derecha (y la
  pulsación larga) abre el selector.
- El selector reutiliza el mismo `DialogV2` que ya usan el picker de MAP, el
  de porte y el de munición. No se añadió ningún componente nuevo.
- Con una sola suboption no hay nada que elegir: el escritorio también
  desactiva su desplegable en ese caso.
- **Exploración**: el toque activa/desactiva (es el gesto principal en el
  escritorio) y un botón de chat conserva el envío de la tarjeta, que es lo
  que hace el toque en el resto de la hoja. Las activas suben arriba, igual
  que el grupo *Active* que separa el escritorio.
- **Nada de CSS nuevo.** Todo se dibuja con las filas, badges y puntos de
  estado que la hoja ya tenía. Cero riesgo de romper el layout.
- **Nada de pestañas nuevas.** Las cinco pestañas siguen siendo cinco; las
  secciones nuevas van dentro de Combate, en el mismo orden que el escritorio:
  Opciones → Ataques → Acciones → Exploración → Downtime.

---

## Verificación

`node` con un stub mínimo de los globales de Foundry, ejecutando el grafo
real (`adapters.mjs` → `modelFor` → adaptador de PF2e). **52 comprobaciones,
todas en verde.** Cubren:

1. Personaje completo: orden de secciones, filtrado por `placement`, badges,
   sub-línea del desplegable, botón de opción, y que nada se duplique en Rasgos.
2. Que el toque de un toggle llame a `toggleRollOption` con la firma exacta
   del sistema `(domain, option, itemId, value, suboption)`.
3. Que el toque de exploración escriba `system.exploration` igual que el
   sistema, **incluido el descarte de ids huérfanos**.
4. Regresión: un personaje sin toggles produce exactamente la hoja de antes.
5. Formas hostiles (15 casos): sin `synthetics`, `toggles` vacío, dominio
   nulo, `toggles` como array, toggle nulo, toggle vacío, `suboptions: null`,
   suboption con referencia circular, label que es clave i18n, toggle
   deshabilitado, `exploration` nulo / string / objeto, traits como `Set`,
   ítem sin nombre, y un getter de `synthetics` que lanza.
6. Que `sf2e` use el adaptador de PF2e y no el genérico.
7. Que el getter deprecado de velocidad ya no se toque, y que aun así siga
   funcionando el camino antiguo.
8. Orden completo con strikes reales, y que **D&D 5e no se vea afectado**.

Lo que el harness **no** puede cubrir, y hay que mirar en el mundo real:
el renderizado en pantalla, los gestos, y el refresco vía hooks.

---

## Cómo volver atrás

Todo esto vive en un único commit sobre `main`. Para deshacerlo sin reescribir
historia publicada:

```powershell
git -C "i:\Foundry_Data\Data\modules\velvet-mobile" revert <sha-del-commit>
```

Para volver el árbol de trabajo a la release anterior y ya está:

```powershell
git -C "i:\Foundry_Data\Data\modules\velvet-mobile" checkout v0.16.0
```

En ambos casos hace falta **recarga forzada** en el navegador: Chrome cachea
los `.mjs` con ganas y ha confundido el diagnóstico más de una vez.

---

## Por qué se retiró la vez anterior — y qué NO fue la causa

Tras aplicarlo, la hoja móvil dejó de mostrarse. Se revirtió para recuperar un
estado bueno conocido, **pero la investigación no señaló a este código**:

- Se ejecutó el grafo completo contra 10 casos límite. Los 10 construyeron el
  modelo. (Ahora son 15, más 37 comprobaciones funcionales.)
- El log de consola del usuario mostró `Velvet Mobile | shell active`, la
  llamada a `new MobileSheet` pasando de `mobile-sheet.mjs:65` (el modelo se
  construyó con pestañas) y **ningún error ni aviso de Velvet Mobile**.
- Estructuralmente tampoco puede: las secciones se pintan en un `try` por
  sección (`mobile-sheet.mjs`) y las filas en otro por fila. Una fila rota se
  pierde a sí misma, no a la hoja. Y cada extractor va envuelto en `attempt()`,
  así que no puede propagar una excepción.

### Sospechoso pendiente de descartar

En el log aparece **`monks-player-settings`** empujando los ajustes de cliente
del GM a todos los clientes:

```
GM Update Setting: velvet-mobile.mode, "phone"
GM Update Setting: velvet-mobile.map, "true"
GM Update Setting: core.noCanvas, "false"
GM has made changes to your client settings
```

Todos los ajustes de Velvet Mobile son de ámbito **cliente a propósito** — la
experiencia móvil es una decisión por dispositivo (`core/settings.mjs`). Que
otro módulo los sobreescriba con los del GM significa que:

1. Si el `mode` del GM llega como `off`, el móvil recibe `off` → `evaluate()`
   → `#stop()` → el shell se apaga y **no hay hoja**. Coincide con el síntoma.
2. Fuerza `core.noCanvas` a `false`, justo el ajuste que gestiona
   `#syncNoCanvas` en `main.mjs`. Se pelean entre ellos.

Además llega **después** de `ready`, lo que encaja con "se veía y dejó de verse".

### Si vuelve a pasar

1. Descartar `monks-player-settings`: desactivarlo, reiniciar el mundo y
   recargar el móvil en duro. O excluir `velvet-mobile.*` y `core.noCanvas`
   de su sincronización.
2. Confirmar en el móvil qué valen realmente:
   ```js
   game.settings.get("velvet-mobile", "mode")
   game.modules.get("velvet-mobile").api.state.active
   ```
3. Reproducir primero en PC con *Forzar teléfono* y F12 abierto: si ahí
   funciona, el problema no está en este código.
4. Recarga forzada siempre antes de juzgar.
