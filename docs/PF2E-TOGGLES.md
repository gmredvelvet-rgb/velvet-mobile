# Opciones de combate de PF2e (toggles) — implementado y retirado

**Estado:** implementado el 2026-07-25, **revertido el mismo día**.
**Punto de retorno:** el módulo quedó tal y como estaba justo después del
arreglo de munición y recarga, que sí funcionaba.

Este documento guarda todo lo necesario para volver a aplicarlo sin repetir
la investigación. El código está verificado contra **PF2e 7.12.2** leyendo su
fuente, no de memoria.

---

## Qué resuelve

La hoja de escritorio de PF2e muestra, encima de los ataques, una serie de
casillas y desplegables: *Current Form*, *Double Slice Second Attack*,
*Hunt Prey*, *One Shot One Kill*… La hoja móvil no los tenía, así que había
opciones de combate imposibles de activar desde el teléfono.

No son una lista fija de acciones: son **rule elements de tipo `RollOption`**.
Por eso cualquier dote u objeto que añada uno nuevo aparece solo, sin tocar
código.

---

## El API de PF2e (verificado en 7.12.2)

### Lectura

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

### Escritura

```js
async toggleRollOption(domain, option, itemId = null, value, suboption = null)
```

Internamente hace `item.update({ "system.rules": … })` (o
`actor.updateEmbeddedDocuments("Item", …)` para reglas *mergeable*), así que
**dispara el hook `updateItem`**. El shell ya escucha ese hook y llama a
`msheet.refresh()`, por lo que la hoja se actualiza sola: no hizo falta tocar
nada de `sheet-shell.mjs`.

### Referencia de la hoja de escritorio

`systems/pf2e/templates/actors/character/partials/strike.hbs` y el manejador
`ul[data-option-toggles]` del sheet. El módulo `pf2e-velvet-sheet` del propio
autor ya usaba este mismo patrón (`_prepareToggles`), y se contrastó con la
fuente del sistema antes de portarlo.

---

## Código retirado

Iba en `scripts/sheet/adapters/pf2e.mjs`, justo antes de la sección
`/* -- Ammunition -- */`.

```js
/* -- Roll-option toggles --------------------------------------------------- */

/**
 * One toggle row: the checkbox (or dropdown) PF2e draws above its strikes.
 * @param {Actor} actor
 * @param {object} toggle  An entry of `actor.synthetics.toggles[domain]`.
 * @returns {object}
 */
function toggleRow(actor, toggle) {
  const label = maybeLocalize(toggle.label, text(toggle.label, toggle.option));
  const suboptions = (toggle.suboptions ?? []).map((sub) => ({
    value: sub.value,
    label: maybeLocalize(sub.label, text(sub.label, sub.value)),
    selected: sub.selected === true
  }));
  const selected = suboptions.find((sub) => sub.selected) ?? suboptions[0] ?? null;
  const alwaysActive = toggle.alwaysActive === true;
  const checked = toggle.checked === true || alwaysActive;

  const set = (value, suboption) => safe(() =>
    actor.toggleRollOption(toggle.domain, toggle.option, toggle.itemId ?? null, value, suboption ?? null));

  // A single suboption is fixed — the desktop disables its dropdown too.
  const pick = suboptions.length > 1
    ? safe(async () => {
      const picked = await foundry.applications.api.DialogV2.wait({
        window: { title: label },
        position: { width: 320 },
        content: `<p style="margin: 0 0 .5rem;">${foundry.utils.escapeHTML(t("ToggleHint"))}</p>`,
        buttons: suboptions.slice(0, 8).map((sub, i) => ({
          action: `opt${i}`,
          label: sub.label,
          default: sub.selected,
          callback: () => sub.value
        })),
        rejectClose: false
      });
      if (picked) await set(checked, picked)();
    })
    : undefined;

  /* An always-active toggle is a dropdown with no checkbox, so tapping it
     picks the option; everything else flips, with the option one tap aside. */
  let onTap;
  if (alwaysActive) onTap = pick;
  else if (toggle.enabled !== false || checked) onTap = set(!checked, selected?.value);

  return {
    id: `${toggle.domain}:${toggle.option}`,
    label,
    sub: suboptions.length ? (selected?.label ?? "") : "",
    badge: !alwaysActive && checked ? "✓" : "",
    prof: alwaysActive ? undefined : checked,
    onTap,
    onLong: alwaysActive ? undefined : pick,
    actions: pick ? [{ icon: "fa-solid fa-list-ul", label: t("ToggleOption"), onTap: pick }] : []
  };
}

/**
 * The options PF2e's own Actions tab shows above the strikes — Current Form,
 * Double Slice, Hunt Prey, One Shot One Kill…
 *
 * They are `RollOption` rule elements, which the system collects into
 * `actor.synthetics.toggles` as `{ domain: { option: toggle } }`, and writes
 * back through `actor.toggleRollOption()`. Only the ones placed in the
 * actions area are ours; the rest belong next to a specific statistic.
 * @param {Actor} actor
 * @returns {object[]}
 */
function toggleRows(actor) {
  const domains = actor.synthetics?.toggles ?? {};
  return Object.values(domains)
    .flatMap((domain) => Object.values(domain ?? {}))
    .filter((toggle) => toggle && (toggle.placement ?? "actions") === "actions")
    .map((toggle) => toggleRow(actor, toggle));
}
```

### Conexión en `model()`

Antes del bloque de *strikes*:

```js
  /* Toggles that belong in the actions area, above the strikes. */
  const toggles = attempt("toggles", () => toggleRows(actor), []);
```

Y en la pestaña de combate (condición ampliada + sección al principio, igual
que en el escritorio):

```js
  if (strikes.length || activities.length || toggles.length) {
    tabs.push({
      id: "combat",
      icon: "fa-solid fa-hand-fist",
      label: t("TabCombat"),
      sections: [
        ...(toggles.length ? [{ title: t("Toggles"), rows: toggles }] : []),
        { title: t("Strikes"), rows: strikes },
        ...(activities.length ? [{ title: t("TabActions"), rows: activities }] : [])
      ]
    });
  }
```

### Claves de idioma

Van en `VELVETMOBILE.Sheet` de `lang/en.json` y `lang/es.json`:

| Clave | EN | ES |
|---|---|---|
| `Toggles` | Combat Options | Opciones de combate |
| `ToggleHint` | Choose which option applies. | Elige qué opción se aplica. |
| `ToggleOption` | Choose option | Elegir opción |

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

---

## Por qué se retiró — y qué NO fue la causa

Tras aplicarlo, la hoja móvil dejó de mostrarse. Se revirtió para recuperar un
estado bueno conocido, **pero la investigación no señaló a este código**:

- Se ejecutó el grafo completo (`adapters.mjs` → `modelFor` → adaptador) contra
  10 casos límite: sin `synthetics`, `synthetics` vacío, dominios nulos, toggle
  deshabilitado, label que es clave i18n, suboptions con referencia circular
  `rule`, toggle sin label ni option, `suboptions: null`, `toggles` como array,
  y un getter de `synthetics` que lanza. **Los 10 construyeron el modelo.**
- El log de consola del usuario mostró `Velvet Mobile | shell active`, la
  llamada a `new MobileSheet` pasando de `mobile-sheet.mjs:65` (el modelo se
  construyó con pestañas) y **ningún error ni aviso de Velvet Mobile**.
- Estructuralmente tampoco puede: las secciones se pintan en un `try` por
  sección (`mobile-sheet.mjs`) y las filas en otro por fila. Una fila de toggle
  rota se pierde a sí misma, no a la hoja. Y `toggleRows` va envuelto en
  `attempt()`, así que ni siquiera puede propagar una excepción.

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

---

## Antes de volver a aplicarlo

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
4. Recarga forzada siempre antes de juzgar: Chrome cachea los `.mjs` con
   ganas y ha confundido el diagnóstico más de una vez.

---

## Extra: un arreglo real que se fue con la reversión

En el mismo lote se corrigió una deprecación que **no tiene nada que ver con
los toggles** y conviene recuperar por separado, en `model()` → chips de
cabecera:

```js
// Antes: num() evalúa TODOS sus argumentos, así que tocaba el getter
// deprecado en cada construcción de la hoja aunque la ruta moderna
// ya tuviera el valor.
const walk = num(speeds.land?.value, speeds.land, system.attributes?.speed?.total, system.attributes?.speed?.value);

// Después:
const walk = num(speeds.land?.value, speeds.land)
  ?? num(system.attributes?.speed?.total, system.attributes?.speed?.value);
```

PF2e deprecó `system.attributes.speed` en 7.5.0 y **lo elimina en 8.0.0**.
Además, con `CONFIG.compatibility.mode` en `FAILURE` lanzaría hoy mismo y los
chips de cabecera desaparecerían en silencio. Es independiente de los toggles
y seguro de aplicar por sí solo.
