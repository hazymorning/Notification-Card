/* notification-card
 * Stateless notification card for Home Assistant.
 */

const CARD = "notification-card";
const EDITOR = CARD + "-editor";

/* ── configuration ──────────────────────────────────────────────────── */

const DEFAULTS = Object.freeze({
  hide_when_empty: true,
  updates: true,
  repairs: true,
  entities: [],
  label: null,
  audience: null,
});

const LABELS = Object.freeze({
  hide_when_empty: "Hide when empty",
  updates: "Show pending updates",
  repairs: "Show repairs",
  entities: "Source entities",
  label: "Include entities by label",
  audience: "Who sees what",
  visible: "Visible to",
  people: "People",
});

const HELPERS = Object.freeze({
  visible: "Applies outside edit mode, like Home Assistant's own card visibility.",
  people: "Matches the user account linked to each person in Settings \u2192 People.",
});

const ICONS = Object.freeze({
  system: "mdi:bell",
  update: "mdi:rocket-launch",
  repair: "mdi:wrench",
  alarm: "mdi:shield-alert",
  alert: "mdi:alert",
  weather: "mdi:flash",
  calendar: "mdi:calendar-month",
  recipe: "mdi:chef-hat",
  generic: "mdi:information-outline",
});

/* UI strings keyed by hass.locale.language (base tag); en is the fallback. */
const STRINGS = Object.freeze({
  en: {
    idle_title: "All quiet",
    idle_msg: "No notifications",
    clear: "Clear all",
    dismiss: "Dismiss",
    install: "Install",
    installing: "Installing\u2026",
    installing_pct: "Installing {p}%",
    just_now: "just now",
    item: "notification",
    items: "notifications",
    event: "Event",
    notification: "Notification",
    update: "Update",
    update_msg: "Update {v} available",
    update_msg_plain: "Update available",
    level: "Level {l}",
    breaks_in: "Stops working in {v}",
    dinner: "Today's dinner",
    today_at: "today at {t}",
    tomorrow_at: "tomorrow at {t}",
    date_at: "on {d} at {t}",
  },
  de: {
    idle_title: "Alles ruhig",
    idle_msg: "Keine Benachrichtigungen",
    clear: "Alle l\u00f6schen",
    dismiss: "L\u00f6schen",
    install: "Installieren",
    installing: "Installiert\u2026",
    installing_pct: "Installiert {p}\u202f%",
    just_now: "gerade eben",
    item: "Meldung",
    items: "Meldungen",
    event: "Termin",
    notification: "Benachrichtigung",
    update: "Update",
    update_msg: "Update {v} verf\u00fcgbar",
    update_msg_plain: "Update verf\u00fcgbar",
    level: "Stufe {l}",
    breaks_in: "Funktioniert ab {v} nicht mehr",
    dinner: "Heutiges Abendessen",
    today_at: "heute um {t} Uhr",
    tomorrow_at: "morgen um {t} Uhr",
    date_at: "am {d} um {t} Uhr",
  },
});

/* Never shown. The message match covers cores without the stable id. */
const MUTED_NOTIFICATIONS = new Set(["http-login"]);

/* Generic entities with one of these states are considered inactive. */
const INACTIVE = new Set(["off", "unavailable", "unknown", "idle", "none", "0", ""]);

/* ── helpers ────────────────────────────────────────────────────────── */

const parseTs = (value, fallback) => {
  const t = value ? Date.parse(value) : NaN;
  return isNaN(t) ? fallback : t;
};

const badgeText = (n) => (n > 9 ? "9+" : String(n));

const REDUCED_MOTION = window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null;

const motionOK = () => !(REDUCED_MOTION && REDUCED_MOTION.matches);

const sevClass = (sev) => (sev === "crit" ? " crit" : sev === "warn" ? " warn" : "");

const fill = (template, vars) =>
  template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ""));

const attrPath = (attrs, path) =>
  path.split(".").reduce((v, k) => (v == null ? v : v[k]), attrs);

const ruleMode = (rule) => (!rule ? "everyone" : "only" in rule ? "only" : "except");

const visibleTo = (rule, viewer) => {
  const mode = ruleMode(rule);
  if (mode === "everyone") return true;
  const listed = rule[mode].includes(viewer);
  return mode === "only" ? listed : !listed;
};

const checkAudience = (audience) => {
  if (audience == null) return {};
  if (typeof audience !== "object" || Array.isArray(audience)) {
    throw new Error(CARD + ": audience must map sources to only or except");
  }
  for (const [key, rule] of Object.entries(audience)) {
    const modes = rule && typeof rule === "object" ? ["only", "except"].filter((m) => m in rule) : [];
    if (modes.length !== 1) {
      throw new Error(CARD + ": audience." + key + " needs either only or except");
    }
    const people = rule[modes[0]];
    if (!Array.isArray(people) || !people.every((id) => typeof id === "string" && id.startsWith("person."))) {
      throw new Error(CARD + ": audience." + key + "." + modes[0] + " must list person entities, e.g. person.anna");
    }
  }
  return audience;
};

/* Under auto-detection only unambiguous activity may notify: binary "on",
 * timer "active", or a numeric state above zero. Text states (e.g. a sensor
 * whose empty state is a sentence) stay silent unless type: generic is set. */
const isUnambiguouslyActive = (state) => {
  const s = String(state).toLowerCase();
  if (s === "on" || s === "active") return true;
  const n = Number(state);
  return !isNaN(n) && n > 0;
};

/* ── entity renderers (auto-detected) ───────────────────────────────── */
/* Each renderer receives (id, state, items, ctx) where ctx carries hass, the
 * language dictionary t, and whether the type was forced in config. */

/* DWD weather warnings (dwd_weather_warnings integration): one item per
 * warning_<x>, level 0-4 per the docs, level >= 3 (Unwetter) is critical. */
const renderDwd = (id, st, items, ctx) => {
  if (!(Number(st.state) > 0)) return;
  const a = st.attributes;
  const count = Number(a.warning_count) || 0;
  for (let i = 1; i <= count; i++) {
    const headline = a["warning_" + i + "_headline"];
    const name = a["warning_" + i + "_name"];
    if (!headline && !name) continue;
    const level = Number(a["warning_" + i + "_level"]) || 0;
    items.push({
      key: "w:" + id + ":" + i,
      kind: "weather",
      sev: level >= 3 ? "crit" : "warn",
      source: id,
      entity: id,
      title: headline || name,
      message: a["warning_" + i + "_description"] || fill(ctx.t.level, { l: level }),
      ts: parseTs(a["warning_" + i + "_start"], parseTs(st.last_changed, Date.now())),
    });
  }
};

const renderRecipe = (id, st, items, ctx) => {
  const recipe = st.attributes.recipe;
  if (!recipe || !recipe.name) return;
  items.push({
    key: "r:" + id,
    kind: "recipe",
    source: id,
    entity: id,
    title: recipe.name,
    message: recipe.description || ctx.t.dinner,
    image: recipe.image,
    ts: parseTs(st.last_changed, Date.now()),
  });
};

const renderCalendar = (id, st, items, ctx) => {
  if (st.state !== "on" || !st.attributes.message) return;
  items.push({
    key: "c:" + id,
    kind: "calendar",
    source: id,
    entity: id,
    title: st.attributes.message,
    message: ctx.calWhen(st.attributes.start_time),
    ts: parseTs(st.last_changed, Date.now()),
  });
};

/* Update entities: title attribute is the actual software name (docs), the
 * install action is update.install; in_progress reflects a running install. */
const renderUpdate = (id, st, items, ctx) => {
  if (st.state !== "on") return;
  const a = st.attributes;
  const name =
    a.title || (a.friendly_name || id).replace(/\s*update\s*$/i, "").trim();
  const version = a.latest_version;
  const pct =
    typeof a.update_percentage === "number"
      ? a.update_percentage
      : typeof a.in_progress === "number"
        ? a.in_progress
        : null;
  const busy = a.in_progress === true || pct !== null;
  items.push({
    key: "u:" + id,
    kind: "update",
    source: "updates",
    entity: id,
    title: name || ctx.t.update,
    message: version ? fill(ctx.t.update_msg, { v: version }) : ctx.t.update_msg_plain,
    ts: parseTs(st.last_changed, Date.now()),
    dismiss: () => ctx.hass.callService("update", "skip", { entity_id: id }),
    actions: [
      busy
        ? {
            label: pct === null ? ctx.t.installing : fill(ctx.t.installing_pct, { p: Math.round(pct) }),
            disabled: true,
          }
        : {
            label: ctx.t.install,
            run: () => ctx.hass.callService("update", "install", { entity_id: id }),
          },
    ],
  });
};

/* Only the states that need attention, and they stay until the panel moves on. */
const ALARM_SEV = Object.freeze({ triggered: "crit", pending: "warn", arming: "warn" });

const renderAlarm = (id, st, items, ctx) => {
  const sev = ALARM_SEV[st.state];
  if (!sev) return;
  const h = ctx.hass;
  items.push({
    key: "a:" + id,
    kind: "alarm",
    sev,
    sticky: true,
    source: id,
    entity: id,
    title: st.attributes.friendly_name || id,
    message: h && h.formatEntityState ? h.formatEntityState(st) : String(st.state),
    ts: parseTs(st.last_changed, Date.now()),
  });
};

/* alert.turn_off reaches beyond this card, so alerts keep the local ack. */
const renderAlert = (id, st, items, ctx) => {
  if (st.state !== "on") return;
  items.push({
    key: "al:" + id,
    kind: "alert",
    sev: "warn",
    source: id,
    entity: id,
    title: st.attributes.friendly_name || id,
    message: st.attributes.message || "",
    ts: parseTs(st.last_changed, Date.now()),
  });
};

const renderGeneric = (id, st, items, ctx) => {
  const active = ctx.forced
    ? !INACTIVE.has(String(st.state).toLowerCase())
    : isUnambiguouslyActive(st.state);
  if (!active) return;
  const unit = st.attributes.unit_of_measurement;
  const h = ctx.hass;
  items.push({
    key: "g:" + id,
    kind: "generic",
    source: id,
    entity: id,
    title: st.attributes.friendly_name || id,
    message: h && h.formatEntityState
      ? h.formatEntityState(st)
      : unit
        ? st.state + " " + unit
        : String(st.state),
    ts: parseTs(st.last_changed, Date.now()),
  });
};

/* Detection order: attribute shapes first, then domain, then generic.
 * A present-but-empty shape key (e.g. recipe: null) still claims the entity,
 * so an empty source renders nothing instead of falling through to generic. */
const detectType = (id, st) => {
  const a = st.attributes;
  if (a.warning_count !== undefined) return "dwd";
  if ("recipe" in a) return "recipe";
  if (id.startsWith("calendar.")) return "calendar";
  if (id.startsWith("update.")) return "update";
  if (id.startsWith("alarm_control_panel.")) return "alarm";
  if (id.startsWith("alert.")) return "alert";
  return "generic";
};

const RENDERERS = Object.freeze({
  dwd: renderDwd,
  recipe: renderRecipe,
  calendar: renderCalendar,
  update: renderUpdate,
  alarm: renderAlarm,
  alert: renderAlert,
  generic: renderGeneric,
});

/* Titles come from the integration translations, fixing happens in the panel. */
const REPAIR_SEV = Object.freeze({ critical: "crit", error: "crit", warning: "warn" });

const renderRepair = (issue, items, ctx) => {
  const h = ctx.hass;
  const slug = issue.translation_key || issue.issue_id;
  const title =
    (h.localize &&
      h.localize("component." + issue.domain + ".issues." + slug + ".title", issue.translation_placeholders || {})) ||
    slug;
  items.push({
    key: "i:" + issue.domain + "/" + issue.issue_id,
    kind: "repair",
    sev: REPAIR_SEV[issue.severity] || "warn",
    source: "repairs",
    title,
    message: issue.breaks_in_ha_version ? fill(ctx.t.breaks_in, { v: issue.breaks_in_ha_version }) : "",
    ts: parseTs(issue.created, Date.now()),
    dismiss: () =>
      h.callWS({
        type: "repairs/ignore_issue",
        domain: issue.domain,
        issue_id: issue.issue_id,
        ignore: true,
      }),
    open: () => {
      history.pushState(null, "", "/config/repairs");
      window.dispatchEvent(new CustomEvent("location-changed"));
    },
  });
};

const fireMoreInfo = (host, entityId) =>
  host.dispatchEvent(
    new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId } })
  );

/* HA-style tap_action subset for custom per-entry action buttons. */
const buildTapAction = (tap, hassRef, host, fallbackEntity) => {
  const a = tap || {};
  switch (a.action) {
    case "url":
      return () => window.open(a.url_path, "_blank", "noopener");
    case "navigate":
      return () => {
        history.pushState(null, "", a.navigation_path);
        window.dispatchEvent(new CustomEvent("location-changed"));
      };
    case "more-info":
      return () => fireMoreInfo(host, a.entity_id || fallbackEntity);
    case "perform-action":
    case "call-service": {
      const svc = a.perform_action || a.service || "";
      const [domain, service] = svc.split(".");
      return () =>
        hassRef().callService(domain, service, a.data || a.service_data || {}, a.target);
    }
    default:
      return null;
  }
};

/* One malformed entity must not blank the whole card. Per-entry icon and
 * name overrides from the source config apply to everything it produced. */
const renderEntity = (id, st, items, ctx, src) => {
  if (!st) return;
  const forced = Boolean(src && src.type && src.type !== "auto");
  const kind = forced ? src.type : detectType(id, st);
  const renderer = RENDERERS[kind];
  if (!renderer) return;
  const before = items.length;
  try {
    renderer(id, st, items, { ...ctx, forced });
  } catch (e) {
    console.warn(CARD + ": renderer failed for " + id, e);
    items.length = before;
    return;
  }
  const ref = src && src.image;
  const configured = ref && (ref.includes("/") ? ref : attrPath(st.attributes, ref));
  for (let i = before; i < items.length; i++) {
    const image = ref ? configured : items[i].image || st.attributes.entity_picture;
    items[i].image = typeof image === "string" && image ? ctx.hass.hassUrl(image) : null;
  }
  if (src && src.tap_action) {
    const openFn = buildTapAction(src.tap_action, () => ctx.hass, ctx.host, id);
    if (openFn) {
      for (let i = before; i < items.length; i++) items[i].open = openFn;
    }
  }
  if (src && (src.icon || src.name || src.actions)) {
    for (let i = before; i < items.length; i++) {
      if (src.icon) items[i].icon = src.icon;
      if (src.name) items[i].title = src.name;
      if (src.actions) {
        const extra = src.actions
          .map((ac) => ({
            label: ac.label,
            run: buildTapAction(ac.tap_action, () => ctx.hass, ctx.host, id),
          }))
          .filter((ac) => ac.label && ac.run);
        items[i].actions = [...(items[i].actions || []), ...extra];
      }
    }
  }
};

const setImage = (tile, url) => {
  let img = tile.querySelector("img");
  if (!url) {
    if (img) img.remove();
    return;
  }
  if (!img) {
    img = document.createElement("img");
    img.alt = "";
    img.addEventListener("load", () => img.classList.add("ready"));
    img.addEventListener("error", () => img.classList.remove("ready"));
    tile.prepend(img);
  }
  if (img.getAttribute("src") !== url) img.src = url;
};

/* ── styles ─────────────────────────────────────────────────────────── */

const STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  :host {
    --nc-pad: var(--card-padding, 12px);
    --nc-gap: var(--ha-space-3, 12px);
    --nc-gap-s: var(--ha-space-2, 8px);
    --nc-radius: var(--radius-inner, 12px);
    --nc-radius-s: var(--radius-small, 8px);
    --nc-tile: var(--control-height-icon, 40px);
    --nc-tile-s: var(--control-height-mini, 32px);
    --nc-muted: var(--opacity-muted, 0.6);
    --nc-quiet: var(--opacity-quiet, 0.45);
    --nc-ease: var(--ease-standard, cubic-bezier(0.22, 1, 0.36, 1));
    --nc-time: var(--duration-normal, 250ms);
    --nc-icon: var(--icon-size-s, 20px);
    display: grid;
    grid-template-rows: 1fr;
    opacity: 1;
    -webkit-tap-highlight-color: transparent;
    transition:
      grid-template-rows 450ms var(--nc-ease),
      opacity 450ms var(--nc-ease),
      display 450ms allow-discrete;
  }
  :host(.gone) {
    display: none;
    grid-template-rows: 0fr;
    opacity: 0;
  }
  /* Leaving display: none needs a start value. First paint is covered by no-anim. */
  @starting-style {
    :host(:not(.gone)) {
      grid-template-rows: 0fr;
      opacity: 0;
    }
  }
  :host(.no-anim), :host(.no-anim) * {
    transition: none !important;
    animation: none !important;
  }
  ha-card {
    min-height: 0;
    overflow: hidden;
    transition: transform 400ms var(--nc-ease);
  }
  ha-card:active { transform: scale(0.98); transition-duration: 120ms; }

  .head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: "htl hti hsd" "htl hsub hsd";
    column-gap: var(--nc-gap);
    padding: var(--nc-pad);
    cursor: pointer; outline: none;
  }

  .tilewrap { grid-area: htl; align-self: center; }
  .tile {
    position: relative;
    width: var(--nc-tile);
    height: var(--nc-tile);
    display: flex; align-items: center; justify-content: center;
    background: var(--accent-color);
    color: var(--text-color-active, var(--primary-background-color));
    border-radius: var(--nc-radius);
  }
  .tile.warn { background: var(--warning-color); }
  .tile.crit { background: var(--error-color); }
  .tile.idle {
    background: var(--card-item-background, var(--secondary-background-color));
    color: var(--primary-text-color);
    opacity: var(--nc-muted);
  }
  .tile ha-icon { --mdc-icon-size: var(--nc-icon); }

  .badge {
    position: absolute;
    top: calc(var(--ha-space-1, 4px) * -1);
    right: calc(var(--ha-space-1, 4px) * -1);
    width: 20px; height: 20px;
    display: flex; align-items: center; justify-content: center;
    background: var(--ha-card-background);
    color: var(--primary-text-color);
    border-radius: var(--nc-radius-s);
    box-shadow: var(--ha-card-box-shadow);
    font-size: var(--font-size-compact, 11px);
    font-weight: var(--ha-font-weight-bold, 700);
  }
  .badge[hidden] { display: none; }

  .head .title {
    grid-area: hti;
    align-self: center;
    min-width: 0;
    color: var(--primary-text-color);
    font-size: var(--ha-font-size-l, 16px);
    font-weight: var(--ha-font-weight-bold, 700);
    line-height: var(--ha-line-height-condensed, 1.1);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .subslot {
    grid-area: hsub;
    margin-top: 2px;
    display: grid;
  }
  /* Header and drawer trade places through their grid row, nothing measures. */
  .hwrap, .drawer {
    display: grid;
    transition: grid-template-rows 280ms var(--nc-ease);
  }
  .hwrap { grid-template-rows: 1fr; }
  .drawer { grid-template-rows: 0fr; }
  ha-card.open .hwrap { grid-template-rows: 0fr; }
  ha-card.open .drawer { grid-template-rows: 1fr; }
  .head, .inner {
    min-height: 0;
    overflow: hidden;
    transition: opacity 200ms var(--nc-ease), visibility 0s 280ms;
  }
  .inner { padding-bottom: var(--nc-pad); opacity: 0; visibility: hidden; }
  ha-card.open .head { opacity: 0; visibility: hidden; }
  ha-card.open .inner {
    opacity: 1;
    visibility: visible;
    transition: opacity 200ms 80ms var(--nc-ease), visibility 0s;
  }
  ha-card:not(.open) .head { transition: opacity 200ms 80ms var(--nc-ease), visibility 0s; }
  .ebar {
    display: flex; align-items: center;
    gap: var(--nc-gap-s);
    padding: var(--nc-pad);
    cursor: pointer; outline: none;
  }
  .head:focus-visible, .ebar:focus-visible {
    outline: 2px solid var(--fill-strong, var(--divider-color, currentColor));
    outline-offset: -2px;
    border-radius: var(--nc-radius);
  }
  .count {
    flex: 1 1 auto;
    color: var(--primary-text-color);
    opacity: var(--nc-muted);
    font-size: var(--ha-font-size-s, 12px);
    font-weight: var(--ha-font-weight-medium, 500);
  }
  .ebar .chev { opacity: var(--nc-muted); }
  .list {
    position: relative;
    display: flex; flex-direction: column;
    gap: var(--nc-pad);
    padding: 0 var(--nc-pad);
  }
  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: "rtile rtitle rmeta" "rtile rbody rbody";
    align-items: center;
    column-gap: var(--nc-gap);
    row-gap: 2px;
    padding: var(--nc-pad);
    background: var(--card-item-background, var(--secondary-background-color));
    border-radius: var(--nc-radius);
  }
  .row.link { cursor: pointer; }
  .rtile {
    grid-area: rtile;
    align-self: start;
    position: relative;
    width: var(--nc-tile-s);
    height: var(--nc-tile-s);
    display: flex; align-items: center; justify-content: center;
    background: var(--fill-active, var(--primary-text-color));
    color: var(--text-color-active, var(--ha-card-background));
    border-radius: var(--nc-radius-s);
  }
  .rtile ha-icon { --mdc-icon-size: var(--icon-size-xs, 18px); display: flex; }
  .rtile.warn { background: var(--warning-color); color: var(--text-color-active, var(--primary-background-color)); }
  .rtile.crit { background: var(--error-color); color: var(--text-color-active, var(--primary-background-color)); }
  .tile img, .rtile img {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    object-fit: cover;
    border-radius: inherit;
    opacity: 0;
    transition: opacity var(--nc-time) var(--nc-ease);
  }
  img.ready { opacity: 1; }
  img.ready ~ ha-icon { visibility: hidden; }
  .row .title {
    grid-area: rtitle;
    min-width: 0;
    color: var(--primary-text-color);
    font-size: var(--ha-font-size-m, 14px);
    font-weight: var(--ha-font-weight-bold, 700);
    line-height: var(--ha-line-height-normal, 1.3);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .meta {
    grid-area: rmeta;
    justify-self: end;
    display: flex; align-items: center;
    gap: var(--nc-gap-s);
  }
  .when {
    color: var(--primary-text-color);
    opacity: var(--nc-quiet);
    font-size: var(--font-size-compact, 11px);
    line-height: 1;
    white-space: nowrap;
  }
  .x {
    width: 28px; height: 28px;
    margin: calc((var(--icon-size-xs, 18px) - 28px) / 2);
    display: flex; align-items: center; justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--primary-text-color);
    opacity: var(--nc-quiet);
    border-radius: var(--nc-radius-s);
    cursor: pointer;
  }
  .x ha-icon { --mdc-icon-size: var(--icon-size-xs, 18px); display: flex; }
  .row .body {
    grid-area: rbody;
    margin-top: 0;
    color: var(--primary-text-color);
    opacity: var(--nc-muted);
    font-size: var(--ha-font-size-s, 12px);
    line-height: var(--ha-line-height-normal, 1.3);
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    max-height: calc(2 * var(--ha-line-height-normal, 1.3) * 1em);
    overflow: hidden;
  }
  .row.open .body {
    display: block;
    -webkit-line-clamp: unset;
    line-clamp: none;
    max-height: none;
  }
  .actions {
    grid-row: 3;
    grid-column: 2 / -1;
    display: flex;
    gap: var(--nc-gap-s);
    margin-top: var(--nc-gap-s);
  }
  .act {
    border: none; cursor: pointer;
    height: 28px;
    padding: 0 var(--nc-gap);
    background: var(--fill-strong, color-mix(in srgb, currentColor 10%, transparent));
    color: var(--primary-text-color);
    border-radius: var(--nc-radius-s);
    font: inherit;
    font-size: var(--font-size-compact, 11px);
    font-weight: var(--ha-font-weight-medium, 500);
  }
  .act[disabled] {
    cursor: default;
    opacity: var(--opacity-disabled, 0.3);
    pointer-events: none;
  }
  .srow { overflow: hidden; min-height: 0; }
  .msg {
    overflow: hidden;
    color: var(--primary-text-color);
    opacity: var(--nc-muted);
    font-size: var(--ha-font-size-s, 12px);
    line-height: var(--ha-line-height-normal, 1.3);
    white-space: nowrap;
  }
  .msg.fade { mask-image: linear-gradient(to right, transparent 0, black 8%, black 92%, transparent 100%); }
  .track { display: inline-flex; max-width: 100%; }
  .track .t { flex: 0 0 auto; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .track .dup { display: none; }
  .track.scroll { max-width: none; animation: nc-scroll var(--scroll-s, 12s) linear infinite; }
  .track.scroll .t { overflow: visible; max-width: none; padding-right: var(--nc-gap); }
  .track.scroll .t::after {
    content: "\\2022";
    padding-left: var(--nc-gap);
    opacity: var(--nc-quiet);
  }
  .track.scroll .dup { display: inline; }
  @keyframes nc-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }

  .hside {
    grid-area: hsd;
    align-self: center;
    justify-self: end;
    margin-right: var(--nc-gap-s);
    display: flex; align-items: center;
    gap: var(--nc-gap-s);
  }
  .chev {
    flex: 0 0 auto;
    color: var(--primary-text-color);
    opacity: var(--nc-muted);
    --mdc-icon-size: var(--icon-size-m, 24px);
  }
  .chev[hidden] { display: none; }

  .foot {
    margin: var(--nc-pad) var(--nc-pad) 0;
    border-top: var(--separator, 2px solid var(--divider-color, color-mix(in srgb, currentColor 10%, transparent)));
    padding-top: var(--nc-gap-s);
    text-align: right;
  }
  .foot[hidden] { display: none; }
  .clear {
    border: none; cursor: pointer;
    height: var(--nc-tile-s);
    padding: 0 var(--nc-gap);
    background: transparent;
    color: var(--primary-text-color);
    opacity: var(--nc-muted);
    border-radius: var(--nc-radius);
    font: inherit;
    font-size: var(--ha-font-size-s, 12px);
    font-weight: var(--ha-font-weight-medium, 500);
  }

  @media (hover: hover) {
    .msg:hover .track.scroll { animation-play-state: paused; }
  }

  @media (prefers-reduced-motion: reduce) {
    :host, :host * {
      transition: none !important;
      animation: none !important;
    }
  }
`;

const TEMPLATE = `
  <style>${STYLES}</style>
  <ha-card>
    <div class="hwrap">
    <div class="head" role="button" tabindex="0" aria-expanded="false" aria-live="polite">
      <div class="tilewrap">
        <div class="tile"><ha-icon></ha-icon><div class="badge"></div></div>
      </div>
      <div class="title"></div>
      <div class="subslot">
        <div class="srow"><div class="msg"><div class="track"><span class="t"></span><span class="t dup" aria-hidden="true"></span></div></div></div>
      </div>
      <div class="hside">
        <ha-icon class="chev" icon="mdi:chevron-down"></ha-icon>
      </div>
    </div>
    </div>
    <div class="drawer"><div class="inner">
      <div class="ebar" role="button" tabindex="0" aria-expanded="true">
        <span class="count"></span>
        <ha-icon class="chev" icon="mdi:chevron-up"></ha-icon>
      </div>
      <div class="list"></div>
      <div class="foot"><button class="clear"></button></div>
    </div></div>
  </ha-card>
`;

/* ── card ───────────────────────────────────────────────────────────── */

class NotificationCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._persistent = new Map();
    this._items = [];
    this._updateIds = [];
    this._labelIds = [];
    this._repairs = [];
    this._watched = [];
    this._allSources = [];
    this._audience = {};
    this._people = [];
    this._viewer = null;
    this._rowCache = new Map();
    this._entitiesRef = null;
    this._expanded = false;
    this._editMode = false;
    this._unsub = null;
    this._unsubRepairs = null;
    this._clock = null;
    this._lastMsg = null;
    this._acks = this._loadAcks();
    this._painted = false;
    this._seq = 0;
    this._setLang("en");
  }

  /* -- config ---------------------------------------------------------- */

  setConfig(config) {
    const sources = [];
    for (const entry of config.entities || []) {
      const src =
        typeof entry === "string"
          ? { entity: entry, type: "auto" }
          : {
              entity: entry && entry.entity,
              type: (entry && entry.type) || "auto",
              icon: entry ? entry.icon : null,
              name: entry ? entry.name : null,
              image: entry ? entry.image : null,
              actions: entry && Array.isArray(entry.actions) ? entry.actions : null,
              tap_action: entry ? entry.tap_action : null,
            };
      if (typeof src.entity !== "string" || !src.entity.includes(".")) {
        throw new Error(CARD + ": entities must contain entity ids, got " + JSON.stringify(entry));
      }
      if (src.type !== "auto" && !RENDERERS[src.type]) {
        throw new Error(CARD + ": unknown source type '" + src.type + "'");
      }
      if (src.image != null && typeof src.image !== "string") {
        throw new Error(CARD + ": image must be an attribute path or URL");
      }
      if (!sources.some((s) => s.entity === src.entity)) sources.push(src);
    }
    const audience = checkAudience(config.audience);
    if (config.styles != null) {
      console.warn(CARD + ": the styles option was replaced by css and --nc-* variables");
    }
    if (config.css != null && typeof config.css !== "string") {
      throw new Error(CARD + ": css must be a string");
    }
    this._config = { ...DEFAULTS, ...config };
    this._sources = sources;
    this._audience = audience;
    this._people = [...new Set(Object.values(audience).flatMap((rule) => rule[ruleMode(rule)]))];
    this._viewer = null;
    this._rowCache = new Map();
    this._applyCustomStyles();
    this._refreshLabelIds();
    this._refreshWatched();
    this._refreshRepairs();
  }

  _applyCustomStyles() {
    if (this._dom) this._dom.userCss.textContent = this._config.css || "";
  }

  static getConfigElement() {
    return document.createElement(EDITOR);
  }

  static getStubConfig() {
    return { hide_when_empty: false, updates: true };
  }

  /* -- language --------------------------------------------------------- */

  _setLang(lang) {
    this._lang = lang;
    this._t = STRINGS[String(lang).split("-")[0]] || STRINGS.en;
    try {
      this._rel = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
    } catch (e) {
      this._rel = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });
    }
    if (this._dom) this._dom.clear.textContent = this._t.clear;
  }

  _relTime(ts) {
    const s = Math.round((ts - Date.now()) / 1000);
    const abs = Math.abs(s);
    if (abs < 60) return this._t.just_now;
    if (abs < 3600) return this._rel.format(Math.round(s / 60), "minute");
    if (abs < 86400) return this._rel.format(Math.round(s / 3600), "hour");
    return this._rel.format(Math.round(s / 86400), "day");
  }

  _calWhen(start) {
    const t = this._t;
    if (!start) return t.event;
    const d = new Date(String(start).replace(" ", "T"));
    if (isNaN(d)) return t.event;
    const time = d.toLocaleTimeString(this._lang, { hour: "2-digit", minute: "2-digit" });
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((day - today) / 86400000);
    if (diff === 0) return fill(t.today_at, { t: time });
    if (diff === 1) return fill(t.tomorrow_at, { t: time });
    const date = d.toLocaleDateString(this._lang, { day: "2-digit", month: "2-digit" });
    return fill(t.date_at, { d: date, t: time });
  }

  /* -- hass / lifecycle ------------------------------------------------ */
  /* hass objects are immutable; changed parts get new references, so all
   * change detection here is strict-equality checks (documented contract). */

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._dom) this._build();
    if (this.isConnected && !this._unsub) this._subscribe();
    const lang = (hass.locale && hass.locale.language) || hass.language || "en";
    const langChanged = lang !== this._lang;
    if (langChanged) this._setLang(lang);
    const registryChanged = hass.entities !== this._entitiesRef;
    const viewer = this._viewerOf(hass);
    const viewerChanged = viewer !== this._viewer;
    this._viewer = viewer;
    if (!old || registryChanged || langChanged || viewerChanged) {
      this._entitiesRef = hass.entities;
      if (!old) this._refreshRepairs();
      this._refreshUpdateIds();
      this._refreshLabelIds();
      this._refreshWatched();
      this._recompute();
      return;
    }
    for (const id of this._watched) {
      if (old.states[id] !== hass.states[id]) {
        this._recompute();
        return;
      }
    }
  }

  set editMode(v) {
    this._editMode = Boolean(v);
    this.classList.toggle("no-anim", this._editMode);
    this._recompute();
  }

  connectedCallback() {
    if (this._detachReset) {
      clearTimeout(this._detachReset);
      this._detachReset = null;
    }
    if (this._hass) this._subscribe();
    if (this._dom) {
      this._ro.observe(this._dom.msg);
      this._suppressAnim();
    }
  }

  disconnectedCallback() {
    for (const key of ["_unsub", "_unsubRepairs"]) {
      if (this[key]) {
        this[key].then((u) => u()).catch(() => {});
        this[key] = null;
      }
    }
    if (this._ro) this._ro.disconnect();
    this._stopClock();
    /* Collapse only if the card stays detached; the dashboard editor
     * re-parents the preview constantly and must not lose expansion. */
    this._detachReset = setTimeout(() => {
      this._expanded = false;
      if (this._dom) {
        this._dom.card.classList.remove("open");
        this._dom.head.setAttribute("aria-expanded", "false");
      }
    }, 150);
  }

  _subscribe() {
    const conn = this._hass && this._hass.connection;
    if (!conn) return;
    if (!this._unsub) {
      this._unsub = conn.subscribeMessage((msg) => this._onNotifications(msg), {
        type: "persistent_notification/subscribe",
      });
      this._unsub.catch(() => {
        this._unsub = null;
      });
    }
    /* Repairs are admin only, so a refused subscription is normal. */
    if (!this._unsubRepairs && conn.subscribeEvents) {
      this._unsubRepairs = conn.subscribeEvents(
        () => this._refreshRepairs(),
        "repairs_issue_registry_updated"
      );
      this._unsubRepairs.catch(() => {
        this._unsubRepairs = null;
      });
    }
  }

  _onNotifications(msg) {
    const raw = msg.notifications || {};
    const entries = Array.isArray(raw)
      ? raw.map((n) => [n.notification_id, n])
      : Object.entries(raw);
    if (msg.type === "removed") {
      for (const [id] of entries) this._persistent.delete(id);
    } else {
      if (msg.type === "current") this._persistent = new Map();
      for (const [id, n] of entries) {
        n.__seq = ++this._seq;
        this._persistent.set(id, n);
      }
    }
    this._recompute();
  }

  /* -- source resolution ------------------------------------------------ */

  _refreshUpdateIds() {
    if (!this._config || !this._config.updates || !this._hass) {
      this._updateIds = [];
      return;
    }
    this._updateIds = Object.keys(this._hass.states).filter((id) =>
      id.startsWith("update.")
    );
  }

  _refreshRepairs() {
    const h = this._hass;
    if (!h || !h.callWS || !this._config || !this._config.repairs) {
      this._repairs = [];
      return;
    }
    h.callWS({ type: "repairs/list_issues" })
      .then((res) => {
        this._repairs = ((res && res.issues) || []).filter((i) => !i.ignored);
        this._recompute();
      })
      .catch(() => {
        this._repairs = [];
      });
  }

  /* Entities carrying the configured HA label (entity registry). */
  _refreshLabelIds() {
    const label = this._config ? this._config.label : null;
    const reg = this._hass ? this._hass.entities : null;
    if (!label || !reg) {
      this._labelIds = [];
      return;
    }
    this._labelIds = Object.keys(reg).filter((id) =>
      ((reg[id] && reg[id].labels) || []).includes(label)
    );
  }

  _viewerOf(hass) {
    const uid = hass.user && hass.user.id;
    const person =
      uid && this._people.find((id) => hass.states[id] && hass.states[id].attributes.user_id === uid);
    return person || "";
  }

  _refreshWatched() {
    const list = [...(this._sources || [])];
    for (const id of this._labelIds) {
      if (!list.some((s) => s.entity === id)) list.push({ entity: id, type: "auto" });
    }
    this._allSources = list;
    this._watched = [
      ...new Set([...this._updateIds, ...list.map((s) => s.entity)]),
    ];
  }

  /* -- items ----------------------------------------------------------- */

  _recompute() {
    const h = this._hass;
    const c = this._config || {};
    const items = [];
    const allowed = (source) => this._editMode || visibleTo(this._audience[source], this._viewer);
    const ctx = {
      hass: h,
      host: this,
      t: this._t,
      calWhen: (s) => this._calWhen(s),
    };

    if (allowed("system")) {
      for (const [id, n] of this._persistent) {
        const message = n.message || "";
        if (MUTED_NOTIFICATIONS.has(id) || message.includes("invalid authentication")) continue;
        items.push({
          key: "s:" + id,
          kind: "system",
          source: "system",
          title: n.title || this._t.notification,
          message,
          ts: parseTs(n.created_at, Date.now()),
          seq: n.__seq || 0,
          dismiss: () =>
            h.callService("persistent_notification", "dismiss", {
              notification_id: id,
            }),
        });
      }
    }

    if (h && c.repairs && allowed("repairs")) {
      for (const issue of this._repairs) renderRepair(issue, items, ctx);
    }

    const seen = new Set();
    if (h) {
      for (const src of this._allSources) {
        if (seen.has(src.entity) || !allowed(src.entity)) continue;
        seen.add(src.entity);
        renderEntity(src.entity, h.states[src.entity], items, ctx, src);
      }
      if (c.updates && allowed("updates")) {
        for (const id of this._updateIds) {
          if (!seen.has(id)) renderEntity(id, h.states[id], items, ctx, null);
        }
      }
    }

    /* Critical warnings pin above everything; within a tier newest first. */
    /* Items without a native dismiss get a local acknowledgment: hidden on
     * this device until their content changes, then they resurface. An ack
     * is removed only when its item resurfaces with different content; absent
     * keys are kept (bounded by _ack) so reloads cannot resurrect items. */
    let acksDirty = false;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.dismiss || it.sticky) continue;
      const sig = it.title + "\u0000" + it.message;
      if (this._acks[it.key] === sig) {
        items.splice(i, 1);
      } else {
        if (this._acks[it.key] !== undefined) {
          delete this._acks[it.key];
          acksDirty = true;
        }
        it.ackSig = sig;
        it.dismiss = () => this._ack(it.key, sig);
        it.localDismiss = true;
      }
    }
    if (acksDirty) this._saveAcks();
    items.sort((a, b) => {
      const ra = a.sev === "crit" ? 0 : 1;
      const rb = b.sev === "crit" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      if (b.ts !== a.ts) return b.ts - a.ts;
      return (b.seq || 0) - (a.seq || 0);
    });
    this._items = items;
    this._render();
  }

  /* -- dom -------------------------------------------------------------- */

  _build() {
    this.shadowRoot.innerHTML = TEMPLATE;
    const q = (s) => this.shadowRoot.querySelector(s);
    const userCss = document.createElement("style");
    this.shadowRoot.appendChild(userCss);
    this._dom = {
      card: q("ha-card"),
      head: q(".head"),
      tile: q(".head .tile"),
      icon: q(".head .tile ha-icon"),
      title: q(".head .title"),
      msg: q(".msg"),
      track: q(".track"),
      t1: q(".track .t:not(.dup)"),
      t2: q(".track .dup"),
      badge: q(".badge"),
      chev: q(".chev"),
      list: q(".list"),
      foot: q(".foot"),
      clear: q(".clear"),
      ebar: q(".ebar"),
      count: q(".count"),
      userCss,
    };
    this._dom.clear.textContent = this._t.clear;
    this._applyCustomStyles();
    for (const el of [this._dom.head, this._dom.ebar]) {
      el.addEventListener("click", () => this._toggle());
      el.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        this._toggle();
      });
    }
    this._dom.clear.addEventListener("click", () => this._clearAll());
    this._ro = new ResizeObserver(() => {
      const t = this._lastMsg;
      this._lastMsg = null;
      if (t !== null) this._setMessage(t);
    });
    this._ro.observe(this._dom.msg);
    this._suppressAnim();
  }

  /* No transitions on the first paint after (re)attachment, and none at all
   * while the dashboard editor is open. */
  _suppressAnim() {
    this.classList.add("no-anim");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this._editMode) this.classList.remove("no-anim");
      });
    });
  }

  _toggle() {
    if (!this._items.length) return;
    this._expanded = !this._expanded;
    this._dom.head.setAttribute("aria-expanded", String(this._expanded));
    if (this._expanded) {
      this._refreshTimes();
      this._startClock();
    } else {
      this._stopClock();
      const t = this._lastMsg;
      this._lastMsg = null;
      if (t !== null) this._setMessage(t);
    }
    this._render();
  }

  _startClock() {
    if (this._clock) return;
    this._clock = setInterval(() => this._refreshTimes(), 60000);
  }

  _stopClock() {
    if (this._clock) {
      clearInterval(this._clock);
      this._clock = null;
    }
  }

  _refreshTimes() {
    if (!this._dom) return;
    const whens = this._dom.list.querySelectorAll(".when");
    this._items.forEach((it, i) => {
      if (whens[i]) whens[i].textContent = this._relTime(it.ts);
    });
  }

  _loadAcks() {
    try {
      return JSON.parse(localStorage.getItem("notification-card-ack") || "{}");
    } catch (e) {
      return {};
    }
  }

  _saveAcks() {
    try {
      localStorage.setItem("notification-card-ack", JSON.stringify(this._acks));
    } catch (e) {
      /* private mode etc. */
    }
  }

  _ack(key, sig) {
    this._acks[key] = sig;
    const keys = Object.keys(this._acks);
    if (keys.length > 64) delete this._acks[keys[0]];
    this._saveAcks();
    this._recompute();
  }

  _clearAll() {
    if (!this._hass) return;
    let acked = false;
    for (const item of this._items) {
      if (item.localDismiss) {
        this._acks[item.key] = item.ackSig;
        acked = true;
      } else if (item.dismiss) {
        item.dismiss();
      }
    }
    if (acked) {
      this._saveAcks();
      this._recompute();
    }
  }

  _render() {
    if (!this._dom || !this._config) return;
    const d = this._dom;
    const items = this._items;
    const empty = items.length === 0;

    if (empty && this._config.hide_when_empty && !this._editMode) {
      this.classList.add("gone");
      this._lastMsg = null;
      this._stopClock();
      this._painted = true;
      return;
    }
    this.classList.remove("gone");

    if (empty) {
      this._expanded = false;
      this._stopClock();
      d.head.setAttribute("aria-expanded", "false");
    }
    d.card.classList.toggle("open", this._expanded);

    if (empty) {
      d.icon.setAttribute("icon", "mdi:bell-outline");
      d.tile.className = "tile idle";
      d.title.textContent = this._t.idle_title;
      this._setMessage(this._t.idle_msg);
      d.badge.hidden = true;
      d.chev.hidden = true;
    } else {
      const top = items[0];
      d.icon.setAttribute("icon", top.icon || ICONS[top.kind]);
      d.tile.className = "tile" + sevClass(top.sev);
      d.title.textContent = top.title;
      this._setMessage(top.message || top.title);
      d.badge.hidden = false;
      d.badge.textContent = badgeText(items.length);
      d.chev.hidden = false;
    }

    setImage(d.tile, empty ? null : items[0].image);
    d.count.textContent = empty
      ? ""
      : items.length === 1
        ? "1 " + this._t.item
        : items.length + " " + this._t.items;
    this._renderList(empty ? [] : items);
    d.foot.hidden = empty || items.length < 2 || !items.some((it) => it.dismiss);
    this._painted = true;
  }

  _animOK() {
    return (
      this._painted &&
      !this._editMode &&
      this.isConnected &&
      motionOK() &&
      typeof this.animate === "function"
    );
  }

  static get _EASE() {
    return "cubic-bezier(0.22, 1, 0.36, 1)";
  }

  /* Keyed reconciliation with FLIP: removed rows exit as absolutely
   * positioned clones, surviving rows glide, new rows ease in. */
  _renderList(items) {
    const cache = this._rowCache;
    const animate = this._animOK();
    const listEl = this._dom.list;
    const listRect = animate ? listEl.getBoundingClientRect() : null;
    const before = new Map();
    if (animate) {
      for (const [key, entry] of cache) {
        if (entry.el.isConnected) {
          before.set(key, entry.el.getBoundingClientRect());
        }
      }
    }
    const next = new Map();
    const els = [];
    for (const it of items) {
      const sig = [
        it.kind,
        it.icon || "",
        it.sev || "",
        it.title,
        it.message,
        it.ts,
        Boolean(it.dismiss),
        (it.actions || []).map((a) => a.label + (a.disabled ? "!" : "")).join("|"),
      ].join("\u241f");
      const hit = cache.get(it.key);
      let el;
      if (hit && hit.sig === sig) {
        el = hit.el;
        const when = el.querySelector(".when");
        if (when) when.textContent = this._relTime(it.ts);
        setImage(el.querySelector(".rtile"), it.image);
      } else {
        el = this._row(it);
      }
      next.set(it.key, { sig, el });
      els.push(el);
    }
    this._rowCache = next;
    listEl.replaceChildren(...els);
    if (!animate) return;
    const EASE = NotificationCard._EASE;
    const scale = listEl.offsetWidth / listRect.width || 1;
    for (const [key, oldRect] of before) {
      const entry = next.get(key);
      if (entry) {
        const newRect = entry.el.getBoundingClientRect();
        const dy = (oldRect.top - newRect.top) * scale;
        if (Math.abs(dy) > 1) {
          entry.el.animate(
            [{ transform: "translateY(" + dy + "px)" }, { transform: "none" }],
            { duration: 400, easing: EASE }
          );
        }
      } else {
        const ghost = cache.get(key).el;
        ghost.style.position = "absolute";
        ghost.style.top = (oldRect.top - listRect.top) * scale + "px";
        ghost.style.left = (oldRect.left - listRect.left) * scale + "px";
        ghost.style.width = oldRect.width * scale + "px";
        ghost.style.pointerEvents = "none";
        listEl.appendChild(ghost);
        const anim = ghost.animate(
          [
            { opacity: 1, transform: "none" },
            { opacity: 0, transform: "translateX(24px)" },
          ],
          { duration: 450, easing: EASE }
        );
        anim.onfinish = () => ghost.remove();
      }
    }
    for (const [key, entry] of next) {
      if (!before.has(key) && this._listPainted) {
        entry.el.animate(
          [{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }],
          { duration: 350, easing: EASE }
        );
      }
    }
    this._listPainted = true;
  }

  _row(it) {
    const row = document.createElement("div");
    row.className = "row";
    const tile = document.createElement("div");
    tile.className = "rtile" + sevClass(it.sev);
    const ic = document.createElement("ha-icon");
    ic.setAttribute("icon", it.icon || ICONS[it.kind]);
    tile.append(ic);
    setImage(tile, it.image);
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = it.title;
    const meta = document.createElement("div");
    meta.className = "meta";
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = this._relTime(it.ts);
    meta.append(when);
    if (it.dismiss) {
      const x = document.createElement("button");
      x.className = "x";
      x.setAttribute("aria-label", this._t.dismiss);
      x.setAttribute("title", this._t.dismiss);
      const xi = document.createElement("ha-icon");
      xi.setAttribute("icon", "mdi:close");
      x.append(xi);
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        it.dismiss();
      });
      meta.append(x);
    }
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = it.message;
    if (!it.message) body.hidden = true;
    row.append(tile, title, meta, body);
    if (it.actions && it.actions.length) {
      const actions = document.createElement("div");
      actions.className = "actions";
      for (const a of it.actions) {
        const btn = document.createElement("button");
        btn.className = "act";
        btn.textContent = a.label;
        if (a.disabled) btn.disabled = true;
        else
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            a.run();
          });
        actions.append(btn);
      }
      row.append(actions);
    }
    /* Tap: clamped long text expands/collapses; otherwise entity rows open
     * more-info. The icon tile always opens more-info for entity rows. */
    row.addEventListener("click", () => {
      const clamped = body.scrollHeight > body.clientHeight + 1;
      if (row.classList.contains("open") || clamped) {
        row.classList.toggle("open");
      } else if (it.open) {
        it.open();
      } else if (it.entity) {
        fireMoreInfo(this, it.entity);
      }
    });
    if (it.open || it.entity) {
      row.classList.add("link");
      tile.style.cursor = "pointer";
      tile.addEventListener("click", (e) => {
        e.stopPropagation();
        if (it.open) it.open();
        else fireMoreInfo(this, it.entity);
      });
    }
    return row;
  }

  _setMessage(text) {
    const d = this._dom;
    if (this._expanded) {
      this._lastMsg = null;
      d.t1.textContent = text;
      d.t2.textContent = text;
      return;
    }
    if (text === this._lastMsg) return;
    this._lastMsg = text;
    d.t1.textContent = text;
    d.t2.textContent = text;
    d.track.classList.remove("scroll");
    d.msg.classList.remove("fade");
    d.track.style.removeProperty("--scroll-s");
    requestAnimationFrame(() => {
      if (this._lastMsg !== text) return;
      const w = d.t1.scrollWidth;
      if (motionOK() && w > d.msg.clientWidth + 2) {
        d.track.style.setProperty(
          "--scroll-s",
          Math.max(6, Math.round(w / 30)) + "s"
        );
        d.track.classList.add("scroll");
        d.msg.classList.add("fade");
      }
    });
  }

  /* -- sizing ----------------------------------------------------------- */

  getCardSize() {
    return this._expanded ? 1 + this._items.length : 1;
  }

  getGridOptions() {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }
}

/* ── editor ─────────────────────────────────────────────────────────── */

class NotificationCardEditor extends HTMLElement {
  setConfig(config) {
    checkAudience(config.audience);
    this._config = { ...config };
    this._renderForm();
  }

  set hass(hass) {
    this._hass = hass;
    this._renderForm();
  }

  _name(id) {
    const st = this._hass && this._hass.states[id];
    return (st && st.attributes.friendly_name) || id;
  }

  _sources() {
    const c = this._config || {};
    const h = this._hass;
    const reg = h ? h.entities : null;
    const labelled =
      c.label && reg
        ? Object.keys(reg).filter((id) => ((reg[id] && reg[id].labels) || []).includes(c.label))
        : [];
    const sources = [{ key: "system", name: "System notifications", icon: ICONS.system }];
    if (c.updates !== false) sources.push({ key: "updates", name: "Updates", icon: ICONS.update });
    if (c.repairs !== false) sources.push({ key: "repairs", name: "Repairs", icon: ICONS.repair });
    for (const entry of [...(c.entities || []), ...labelled]) {
      const src = typeof entry === "string" ? { entity: entry } : entry || {};
      if (!src.entity || sources.some((s) => s.key === src.entity)) continue;
      const st = h && h.states[src.entity];
      const type = src.type && src.type !== "auto" ? src.type : st ? detectType(src.entity, st) : "generic";
      sources.push({
        key: src.entity,
        name: src.name || this._name(src.entity),
        icon: src.icon || ICONS[type === "dwd" ? "weather" : type],
      });
    }
    return sources;
  }

  _summary(rule) {
    const mode = ruleMode(rule);
    if (mode === "everyone") return "Everyone";
    const names = rule[mode].map((id) => this._name(id)).join(", ");
    if (mode === "only") return names ? "Only " + names : "Nobody";
    return names ? "Everyone except " + names : "Everyone";
  }

  _schema(sources) {
    const audience = this._config.audience || {};
    const options = [
      { value: "everyone", label: "Everyone" },
      { value: "only", label: "Only these people" },
      { value: "except", label: "Everyone except these people" },
    ];
    return [
      { name: "hide_when_empty", selector: { boolean: {} } },
      { name: "updates", selector: { boolean: {} } },
      { name: "repairs", selector: { boolean: {} } },
      { name: "entities", selector: { entity: { multiple: true } } },
      { name: "label", selector: { label: {} } },
      {
        name: "audience",
        type: "expandable",
        title: LABELS.audience,
        icon: "mdi:account-eye-outline",
        schema: sources.map((s) => ({
          name: s.key,
          type: "expandable",
          title: s.name + " \u00b7 " + this._summary(audience[s.key]),
          icon: s.icon,
          schema: [
            { name: "visible", selector: { select: { mode: "list", options } } },
            ...(ruleMode(audience[s.key]) === "everyone"
              ? []
              : [{ name: "people", selector: { entity: { multiple: true, filter: { domain: "person" } } } }]),
          ],
        })),
      },
    ];
  }

  _renderForm() {
    if (!this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => LABELS[s.name] || s.name;
      this._form.computeHelper = (s) => HELPERS[s.name];
      this._form.addEventListener("value-changed", (e) => {
        e.stopPropagation();
        const value = { ...(e.detail.value || {}) };
        if (Array.isArray(value.entities)) {
          const prev = (this._config.entities || []).filter(
            (p) => typeof p === "object" && p
          );
          value.entities = value.entities.map((id) => {
            const meta = prev.find((p) => p.entity === id);
            return meta || id;
          });
        }
        if (value.audience) {
          const audience = { ...(this._config.audience || {}) };
          for (const [key, v] of Object.entries(value.audience)) {
            if (v && (v.visible === "only" || v.visible === "except")) {
              audience[key] = { [v.visible]: v.people || [] };
            } else {
              delete audience[key];
            }
          }
          value.audience = Object.keys(audience).length ? audience : null;
        }
        const config = { type: "custom:" + CARD };
        for (const [k, v] of Object.entries({ ...this._config, ...value })) {
          if (k === "type") continue;
          if (v === "" || v == null) continue;
          if (Array.isArray(v) && v.length === 0) continue;
          config[k] = v;
        }
        this._config = config;
        this._renderForm();
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config },
            bubbles: true,
            composed: true,
          })
        );
      });
      this.appendChild(this._form);
    }
    const sources = this._sources();
    const audience = this._config.audience || {};
    this._form.hass = this._hass;
    this._form.schema = this._schema(sources);
    const data = { ...DEFAULTS, ...this._config };
    data.entities = (data.entities || []).map((e) =>
      typeof e === "string" ? e : e.entity
    );
    data.audience = Object.fromEntries(
      sources.map((s) => {
        const mode = ruleMode(audience[s.key]);
        return [s.key, { visible: mode, people: mode === "everyone" ? [] : audience[s.key][mode] }];
      })
    );
    this._form.data = data;
  }
}

/* ── registration ───────────────────────────────────────────────────── */

customElements.define(CARD, NotificationCard);
customElements.define(EDITOR, NotificationCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD,
  name: "Notification Card",
  description:
    "System notifications, repairs, updates, warnings and any entity you add.",
  preview: true,
});
