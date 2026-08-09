/**
 * Velvet Mobile -- system-aware sheet renderers.
 *
 * The adapters own data and behaviour. These renderers own composition: how
 * the same row model becomes a D&D feature card, a PF2e activity entry, a
 * Starfinder HUD record, or a Hopefinder field panel.
 *
 * @module sheet/system-renderers
 */

import { THEMES } from "../core/constants.mjs";

const SYSTEMS_BY_THEME = Object.freeze({
  [THEMES.AAA]: "dnd5e",
  [THEMES.VELVET_PF2E]: "pf2e",
  [THEMES.CYBER]: "sf2e",
  [THEMES.HOPEFINDER]: "hopefinder",
  [THEMES.VELVET]: "default"
});

function words(value) {
  return String(value ?? "").split(/\s*[·|,]\s*/u).map((part) => part.trim()).filter(Boolean);
}

function roleOf(tab, section, row) {
  const tabId = tab?.id ?? "";
  const title = String(section?.title ?? "").toLowerCase();
  if (tabId === "spells" || title.includes("spell") || title.includes("cantrip") || title.includes("rank")) return "spell";
  if (tabId === "inventory" || title.includes("inventory") || title.includes("currency")) return "item";
  if (tabId === "features" || title.includes("feat") || title.includes("feature")) return "feat";
  if (tabId === "combat" || title.includes("action") || title.includes("strike")) return "action";
  return "entry";
}

function metaList(row) {
  return words(row?.sub).slice(0, 4);
}

function badgeClass(row) {
  return row?.badge ? "vm-sys-badge" : "";
}

function cloneActions(actions) {
  return actions.filter(Boolean);
}

/**
 * The row's one horizontal line: whatever that system shows on the left, and
 * the row's actions pinned to the right.
 *
 * Every renderer composes through this, so "the buttons are on the right"
 * is one rule rather than four that drift apart. The actions container is
 * deliberately outside the content box: inside it, a long item name would
 * compete with the buttons for the same space and — under the `nowrap` and
 * `overflow: hidden` these rows need — squeeze them down to nothing.
 *
 * `detail` is never part of this line. It is the expanded description, and
 * it belongs full-width underneath, not as a third column.
 *
 * @param {Function} el
 * @param {(HTMLElement|string)[]} content
 * @param {HTMLElement[]} actions
 * @returns {HTMLElement}
 */
function rowLine(el, content, actions) {
  const kept = cloneActions(actions);
  return el("div", {
    cls: "vm-sys-line",
    children: [
      el("div", { cls: "vm-sys-line-content", children: content.filter(Boolean) }),
      kept.length ? el("div", { cls: "vm-sys-line-actions", children: kept }) : ""
    ].filter(Boolean)
  });
}

function defaultRow({ el, row, main, actions, detail }) {
  return el("div", {
    cls: `vm-ms-row vm-sys-row vm-sys-row-default ${row.dim ? "vm-dim" : ""}`.trim(),
    children: [rowLine(el, [main], actions), detail].filter(Boolean)
  });
}

function dndRow({ el, row, tab, section, main, actions, detail, role }) {
  const meta = metaList(row);
  const badge = row.badge ? el("span", { cls: badgeClass(row), text: row.badge }) : "";
  return el("article", {
    cls: `vm-ms-row vm-sys-row vm-sys-row-dnd vm-sys-role-${role} ${row.dim ? "vm-dim" : ""}`.trim(),
    attrs: { "data-vm-row-role": role },
    children: [
      el("div", {
        cls: "vm-sys-dnd-titlebar",
        children: [
          el("span", { cls: "vm-sys-kicker", text: section?.title || tab?.label || "" }),
          badge
        ].filter(Boolean)
      }),
      rowLine(el, [
        main,
        meta.length ? el("div", {
          cls: "vm-sys-meta-row vm-sys-dnd-meta",
          children: meta.map((part) => el("span", { cls: "vm-sys-meta", text: part }))
        }) : ""
      ], actions),
      detail
    ].filter(Boolean)
  });
}

function pf2eRow({ el, row, tab, section, main, actions, detail, role }) {
  const traits = metaList(row);
  // The adapter hands the cost over as its own field, carrying the character
  // the system's action font draws. Sniffing it out of the badge — as this
  // did — could not tell an action cost from any other short badge.
  const cost = String(row.cost ?? "");
  const badge = row.badge ? el("span", { cls: "vm-sys-badge", text: row.badge }) : "";
  return el("article", {
    cls: `vm-ms-row vm-sys-row vm-sys-row-pf2e ${cost ? "vm-has-cost" : ""} vm-sys-role-${role} ${row.dim ? "vm-dim" : ""}`.trim(),
    attrs: { "data-vm-row-role": role },
    children: [
      cost ? el("div", {
        cls: "vm-sys-pf2e-cost",
        attrs: { "aria-label": cost, title: cost },
        children: [el("span", { cls: "vm-sys-action-glyph", text: cost })]
      }) : "",
      el("div", {
        cls: "vm-sys-pf2e-content",
        children: [
          rowLine(el, [
            el("div", {
              cls: "vm-sys-pf2e-main",
              children: [main, badge, traits.length ? el("div", { cls: "vm-sys-subline", text: traits.join(" · ") }) : ""].filter(Boolean)
            })
          ], actions),
          detail
        ].filter(Boolean)
      })
    ].filter(Boolean)
  });
}

function cyberRow({ el, row, tab, section, main, actions, detail, role }) {
  const status = row.dim ? "STANDBY" : row.badge || (actions.some((action) => action.classList.contains("vm-on")) ? "ACTIVE" : "READY");
  return el("article", {
    cls: `vm-ms-row vm-sys-row vm-sys-row-cyber vm-sys-role-${role} ${row.dim ? "vm-dim" : ""}`.trim(),
    attrs: { "data-vm-row-role": role },
    children: [
      el("div", {
        cls: "vm-sys-hud-top",
        children: [
          el("span", { cls: "vm-sys-kicker", text: `// ${(section?.title || tab?.label || role).toUpperCase()}` }),
          el("span", { cls: "vm-sys-status", text: String(status).toUpperCase() })
        ]
      }),
      rowLine(el, [el("div", { cls: "vm-sys-hud-core", children: [main] })], actions),
      row.sub ? el("div", { cls: "vm-sys-hud-data", text: row.sub }) : "",
      detail
    ].filter(Boolean)
  });
}

function hopefinderRow({ el, row, tab, section, main, actions, detail, role }) {
  const status = row.dim ? "RESERVE" : row.badge || "READY";
  const meta = metaList(row);
  return el("article", {
    cls: `vm-ms-row vm-sys-row vm-sys-row-hope vm-sys-role-${role} ${row.dim ? "vm-dim" : ""}`.trim(),
    attrs: { "data-vm-row-role": role },
    children: [
      el("div", {
        cls: "vm-sys-field-label",
        children: [
          el("span", { text: `${role} / ${section?.title || tab?.label || "field"}` }),
          el("span", { cls: "vm-sys-status", text: `STATUS: ${String(status).toUpperCase()}` })
        ]
      }),
      rowLine(el, [
        el("div", {
          cls: "vm-sys-field-main",
          children: [
            main,
            meta.length ? el("div", {
              cls: "vm-sys-meta-row vm-sys-hope-meta",
              children: meta.map((part) => el("span", { cls: "vm-sys-meta", text: part }))
            }) : ""
          ].filter(Boolean)
        })
      ], actions),
      detail
    ].filter(Boolean)
  });
}

const RENDERERS = Object.freeze({
  default: Object.freeze({ id: "default", row: defaultRow }),
  dnd5e: Object.freeze({ id: "dnd5e", row: dndRow }),
  pf2e: Object.freeze({ id: "pf2e", row: pf2eRow }),
  sf2e: Object.freeze({ id: "sf2e", row: cyberRow }),
  hopefinder: Object.freeze({ id: "hopefinder", row: hopefinderRow })
});

/**
 * Resolve the visual renderer. This follows the already-centralized Theme
 * manager, so components never branch on `game.system.id` themselves.
 *
 * @param {string} theme
 * @param {string} systemId
 * @returns {{id: string, row: Function}}
 */
export function rendererFor(theme, systemId = "") {
  const byTheme = RENDERERS[SYSTEMS_BY_THEME[theme]];
  if (byTheme) return byTheme;
  if (systemId === "sf2e" || systemId === "starfinder2e") return RENDERERS.sf2e;
  return RENDERERS[systemId] ?? RENDERERS.default;
}

export function rowRole(tab, section, row) {
  return roleOf(tab, section, row);
}
