# Probar Velvet Mobile en Foundry v14 sin tocar tus mundos

La migración de mundos en Foundry es **de un solo sentido**: un mundo abierto
en v14 queda migrado y no vuelve a v13. Nunca pruebes v14 sobre tu instalación
de producción.

La solución es una **instancia aislada**: otra copia de Foundry apuntando a una
carpeta de datos distinta y a otro puerto. Tus mundos actuales no se tocan
porque la instancia de pruebas ni siquiera los ve.

---

## Situación actual

| | Producción (no tocar) | Pruebas |
|---|---|---|
| Programa | `C:\Program Files\Foundry Virtual Tabletop` (v13) | Descarga de v14 en carpeta aparte |
| Datos | `I:\Foundry_Data` | `I:\Foundry_v14_Data` (nueva, vacía) |
| Puerto | 30000 | 30014 |

Ambas pueden coexistir e incluso ejecutarse a la vez.

---

## Receta

### 1. Descargar v14 sin instalarlo encima

En foundryvtt.com → *Purchased Licenses* → descarga la versión **v14** en
formato **Node.js** o **Windows (zip)** — no el instalador, para que no
sustituya tu v13. Descomprímelo en, por ejemplo:

```
I:\Foundry_v14_App
```

> Tu licencia permite instalaciones múltiples para uso personal. Solo no
> ejecutes dos instancias con la *misma* carpeta de datos.

### 2. Lanzarlo contra datos nuevos

Desde `I:\Foundry_v14_App`:

```powershell
node resources/app/main.js --dataPath="I:\Foundry_v14_Data" --port=30014
```

Foundry crea la carpeta vacía y arranca limpio en <http://localhost:30014>.
Tu v13 sigue intacta en el puerto 30000.

Hay un lanzador listo en `docs/foundry-v14-test.ps1`.

### 3. Preparar el entorno de pruebas

Dentro de la instancia v14:

1. Instala los sistemas **dnd5e** y **pf2e**.
2. Instala Velvet Mobile desde la URL de manifiesto:
   ```
   https://github.com/gmredvelvet-rgb/velvet-mobile/releases/latest/download/module.json
   ```
3. Crea un mundo nuevo de cada sistema con un par de personajes de ejemplo.

### 4. (Opcional) Probar con tus personajes reales

Si quieres probar contra una ficha real, **copia** —nunca muevas— la carpeta
del mundo:

```powershell
Copy-Item -Recurse "I:\Foundry_Data\Data\worlds\MI-MUNDO" `
                   "I:\Foundry_v14_Data\Data\worlds\MI-MUNDO-test"
```

La copia se migrará a v14 al abrirla; el original ni se entera. Cambia el
`title` en su `world.json` para no confundirlas.

---

## Checklist de regresión

Con la instancia v14 en marcha, entra desde el móvil (o con *Forzar teléfono*
desde el PC) y comprueba:

- [ ] **Sin restos de interfaz de Foundry** sobre la interfaz móvil — ni lista
      de jugadores, ni barra lateral, ni barra de escenas. → `ChromeHider`
- [ ] **Abre la hoja de personaje** en dnd5e. → adaptador dnd5e
- [ ] **Abre la hoja de personaje** en pf2e. → adaptador pf2e
- [ ] **Tirada de ataque**: diálogo centrado, se cierra solo al elegir, el de
      daño llega limpio y encima. → apilado de ventanas
- [ ] **Modo mapa**: joystick mueve la ficha, cámara la sigue, zoom ± funciona,
      selector de objetivo lista las fichas. → canvas
- [ ] **Chat**: se abre, se aparta al pulsar una acción de una tarjeta.
- [ ] **Sin notificación roja** de Velvet Mobile al entrar.

Si los siete pasan, `verified` puede subir a `"14"` con fundamento.
Si alguno falla, la consola (F12) filtrada por `Velvet Mobile` dice qué y dónde.

---

## Si algo sale mal

La instancia de pruebas es desechable: borra `I:\Foundry_v14_Data` y vuelves a
empezar. Producción nunca estuvo en riesgo.
