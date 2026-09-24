/* notification-card
 * Stateless notification card for Home Assistant.
 */

const CARD = "notification-card";
const EDITOR = CARD + "-editor";
const REPO = "https://github.com/hazymorning/Notification-Card";
const VERSION = "0.1.2";

/* ── configuration ──────────────────────────────────────────────────── */

const DEFAULTS = Object.freeze({
  hide_when_empty: true,
  updates: true,
  repairs: true,
  entities: [],
  label: null,
  audience: null,
});

/* The order the editor writes keys in, so the YAML reads top to bottom. */
const KEY_ORDER = ["entities", "label", "updates", "repairs", "hide_when_empty", "audience", "css"];
const ENTITY_KEY_ORDER = ["entity", "type", "name", "icon", "image", "background", "tap_action", "actions"];

const TYPES = ["auto", "calendar", "update", "alarm", "alert", "dwd", "recipe", "picture", "generic"];

const ICONS = Object.freeze({
  system: "mdi:bell",
  update: "mdi:rocket-launch",
  repair: "mdi:wrench",
  alarm: "mdi:shield-alert",
  alert: "mdi:alert",
  weather: "mdi:flash",
  calendar: "mdi:calendar-month",
  recipe: "mdi:chef-hat",
  picture: "mdi:image-outline",
  generic: "mdi:information-outline",
});

const typeIcon = (type) => ICONS[type === "dwd" ? "weather" : type] || ICONS.generic;

/* UI strings keyed by hass.locale.language (base tag). Other languages start
 * from en and take what Home Assistant already translates, see HA_STRINGS. */
const STRINGS = Object.freeze({
  en: Object.freeze({
    idle_title: "All quiet",
    idle_msg: "No notifications",
    clear: "Clear all",
    dismiss: "Dismiss",
    install: "Install",
    installing: "Installing…",
    installing_pct: "Installing {p}%",
    just_now: "just now",
    count_one: "1 notification",
    count_other: "{n} notifications",
    event: "Event",
    notification: "Notification",
    update: "Update",
    update_msg: "Update {v} available",
    update_msg_plain: "Update available",
    level: "Level {l}",
    breaks_in: "Stops working in {v}",
    day_at: "{d} at {t}",
    date_at: "on {d} at {t}",
    on_date: "on {d}",
  }),
  de: Object.freeze({
    idle_title: "Alles ruhig",
    idle_msg: "Keine Benachrichtigungen",
    clear: "Alle löschen",
    dismiss: "Löschen",
    install: "Installieren",
    installing: "Installiert…",
    installing_pct: "Installiert {p} %",
    just_now: "gerade eben",
    count_one: "1 Meldung",
    count_other: "{n} Meldungen",
    event: "Termin",
    notification: "Benachrichtigung",
    update: "Update",
    update_msg: "Update {v} verfügbar",
    update_msg_plain: "Update verfügbar",
    level: "Stufe {l}",
    breaks_in: "Funktioniert ab {v} nicht mehr",
    day_at: "{d} um {t}",
    date_at: "am {d} um {t}",
    on_date: "am {d}",
  }),
});

/* Frontend strings Home Assistant ships in every language it supports. */
const HA_STRINGS = Object.freeze({
  idle_title: ["ui.notification_drawer.title"],
  idle_msg: ["ui.notification_drawer.empty"],
  clear: ["ui.notification_drawer.dismiss_all"],
  dismiss: ["ui.common.close"],
  install: ["ui.dialogs.more_info_control.update.install"],
  installing: ["ui.card.update.installing"],
  installing_pct: ["ui.card.update.installing_with_progress", { progress: "{p}" }],
  update: ["ui.dialogs.more_info_control.update.update"],
});

const borrowedStrings = (localize) => {
  const t = { ...STRINGS.en, just_now: null, day_at: "{d}, {t}", date_at: "{d}, {t}", on_date: "{d}" };
  if (typeof localize === "function") {
    for (const [key, [id, vars]] of Object.entries(HA_STRINGS)) {
      const text = localize(id, vars);
      if (text) t[key] = text;
    }
    const title = localize("ui.notification_drawer.title");
    if (title) t.count_one = t.count_other = title + " ({n})";
  }
  return Object.freeze(t);
};

/* Never shown. The message match covers cores without the stable id. */
const MUTED_NOTIFICATIONS = new Set(["http-login"]);

/* Generic entities with one of these states are considered inactive. */
const INACTIVE = new Set(["off", "unavailable", "unknown", "idle", "none", "0", ""]);

/* update.install exists only with this feature bit (UpdateEntityFeature.INSTALL). */
const UPDATE_INSTALL = 1;

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

const pick = (obj, keys) => {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return undefined;
};

const isEmpty = (v) =>
  v == null || v === "" || v === false || (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

/* Where entities keep a picture. entity_picture is Home Assistant's own; the
 * others are common on template and REST sensors and count only as a URL. */
const PICTURE_ATTRS = ["image", "image_url", "picture", "thumbnail"];
const URL_LIKE = /^(https?:\/\/|\/|data:image\/)/i;

const findPicture = (attrs) => {
  if (typeof attrs.entity_picture === "string" && attrs.entity_picture) return attrs.entity_picture;
  for (const k of PICTURE_ATTRS) {
    if (typeof attrs[k] === "string" && URL_LIKE.test(attrs[k])) return attrs[k];
  }
  return null;
};

/* Persistent notifications are Markdown. The card shows them as plain text
 * and lets the first link decide where a tap goes. */
const plainText = (md) =>
  String(md == null ? "" : md)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/(\*\*|__|~~|`)(.+?)\1/g, "$2")
    .replace(/^ {0,3}(#{1,6} +|> ?|[-*+] +)/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const SAFE_LINK = /^(https?:\/\/|\/(?!\/))/i;

const firstLink = (md) => {
  const m = /\[[^\]]*\]\(([^)\s]+)[^)]*\)/.exec(String(md || ""));
  return m && SAFE_LINK.test(m[1]) ? m[1] : null;
};

const prettySlug = (slug) => {
  const s = String(slug).replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

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
 * language dictionary t, the resolved kind, whether it was forced in config,
 * and name(st) / format(st) that go through Home Assistant's formatters. */

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

/* One thing worth showing with its picture: a dish from a meal plan, a book,
 * a parcel, a film tonight. Either an attribute holds it as an object (a
 * recipe attribute is detected on its own) or, with type: picture, the state
 * names it. The picture itself is resolved in renderEntity like for any kind. */
const renderPicture = (id, st, items, ctx) => {
  const a = st.attributes;
  const ts = parseTs(st.last_changed, Date.now());
  const obj = a.recipe && typeof a.recipe === "object" ? a.recipe : null;
  if (obj) {
    const title = pick(obj, ["name", "title"]);
    if (!title) return;
    items.push({
      key: "r:" + id,
      kind: ctx.kind,
      source: id,
      entity: id,
      title: String(title),
      message: String(pick(obj, ["description", "summary"]) || ctx.name(st)),
      image: pick(obj, ["image", "image_url", "picture", "thumbnail"]),
      ts,
    });
    return;
  }
  if (ctx.kind === "recipe" || INACTIVE.has(String(st.state).toLowerCase())) return;
  items.push({
    key: "r:" + id,
    kind: ctx.kind,
    source: id,
    entity: id,
    title: ctx.format(st),
    message: ctx.name(st),
    ts,
  });
};

/* All-day events carry midnight as start_time, so they get a day, no time. */
const renderCalendar = (id, st, items, ctx) => {
  if (st.state !== "on" || !st.attributes.message) return;
  items.push({
    key: "c:" + id,
    kind: "calendar",
    source: id,
    entity: id,
    title: st.attributes.message,
    message: ctx.calWhen(st.attributes.start_time, st.attributes.all_day),
    ts: parseTs(st.last_changed, Date.now()),
  });
};

/* Update entities: title attribute is the actual software name (docs). The
 * install button needs the INSTALL feature, and skipping is refused while
 * auto_update is on, so such an update falls back to the local dismiss. */
const renderUpdate = (id, st, items, ctx) => {
  if (st.state !== "on") return;
  const a = st.attributes;
  const t = ctx.t;
  const name = a.title || ctx.name(st).replace(/\s*update\s*$/i, "").trim();
  const version = a.latest_version;
  const busy = Boolean(a.in_progress);
  const pct = !busy
    ? null
    : typeof a.update_percentage === "number"
      ? a.update_percentage
      : typeof a.in_progress === "number"
        ? a.in_progress
        : null;
  const canInstall = (Number(a.supported_features) & UPDATE_INSTALL) === UPDATE_INSTALL;
  items.push({
    key: "u:" + id,
    kind: "update",
    source: "updates",
    entity: id,
    title: name || t.update,
    message: version ? fill(t.update_msg, { v: version }) : t.update_msg_plain,
    ts: parseTs(st.last_changed, Date.now()),
    dismiss: a.auto_update ? undefined : () => ctx.hass.callService("update", "skip", { entity_id: id }),
    actions: busy
      ? [{ label: pct === null ? t.installing : fill(t.installing_pct, { p: Math.round(pct) }), disabled: true }]
      : canInstall
        ? [{ label: t.install, run: () => ctx.hass.callService("update", "install", { entity_id: id }) }]
        : [],
  });
};

/* Only the states that need attention, and they stay until the panel moves on. */
const ALARM_SEV = Object.freeze({ triggered: "crit", pending: "warn", arming: "warn" });

const renderAlarm = (id, st, items, ctx) => {
  const sev = ALARM_SEV[st.state];
  if (!sev) return;
  items.push({
    key: "a:" + id,
    kind: "alarm",
    sev,
    sticky: true,
    source: id,
    entity: id,
    title: ctx.name(st),
    message: ctx.format(st),
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
    title: ctx.name(st),
    message: st.attributes.message || "",
    ts: parseTs(st.last_changed, Date.now()),
  });
};

const renderGeneric = (id, st, items, ctx) => {
  const active = ctx.forced
    ? !INACTIVE.has(String(st.state).toLowerCase())
    : isUnambiguouslyActive(st.state);
  if (!active) return;
  items.push({
    key: "g:" + id,
    kind: "generic",
    source: id,
    entity: id,
    title: ctx.name(st),
    message: ctx.format(st),
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
  recipe: renderPicture,
  picture: renderPicture,
  calendar: renderCalendar,
  update: renderUpdate,
  alarm: renderAlarm,
  alert: renderAlert,
  generic: renderGeneric,
});

/* Titles come from the integration translations, which Home Assistant loads
 * on demand; _refreshRepairs asks for them. Fixing happens in the panel. */
const REPAIR_SEV = Object.freeze({ critical: "crit", error: "crit", warning: "warn" });

const renderRepair = (issue, items, ctx) => {
  const h = ctx.hass;
  const slug = issue.translation_key || issue.issue_id;
  const key = "component." + issue.domain + ".issues." + slug + ".title";
  const vars = issue.translation_placeholders || {};
  const title =
    (ctx.issueLocalize && ctx.issueLocalize(key, vars)) ||
    (h.localize && h.localize(key, vars)) ||
    prettySlug(slug);
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
    open: () => fireAction(ctx.host, { tap_action: { action: "navigate", navigation_path: "/config/repairs" } }),
  });
};

const fire = (node, type, detail) =>
  node.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));

const fireMoreInfo = (host, entityId) => fire(host, "hass-more-info", { entityId });

/* Home Assistant runs the action itself, the same way as for its own cards:
 * confirmation, navigation history, toasts, haptics, assist and so on. */
const fireAction = (host, config) => fire(host, "hass-action", { config, action: "tap" });

const buildTapAction = (tap, host, entity) =>
  tap && tap.action && tap.action !== "none" ? () => fireAction(host, { entity, tap_action: tap }) : null;

const linkAction = (host, url) => () =>
  fireAction(host, {
    tap_action: url.startsWith("/")
      ? { action: "navigate", navigation_path: url }
      : { action: "url", url_path: url },
  });

/* One malformed entity must not blank the whole card. Per-entry overrides
 * from the source config apply to everything it produced. */
const renderEntity = (id, st, items, ctx, src) => {
  if (!st) return;
  const forced = Boolean(src && src.type && src.type !== "auto");
  const kind = forced ? src.type : detectType(id, st);
  const renderer = RENDERERS[kind];
  if (!renderer) return;
  const before = items.length;
  try {
    renderer(id, st, items, { ...ctx, forced, kind });
  } catch (e) {
    console.warn(CARD + ": renderer failed for " + id, e);
    items.length = before;
    return;
  }
  const ref = src && src.image;
  const configured = ref && (ref.includes("/") ? ref : attrPath(st.attributes, ref));
  const backdrop = Boolean(src && src.background);
  for (let i = before; i < items.length; i++) {
    const image = ref ? configured : items[i].image || findPicture(st.attributes);
    items[i].image = typeof image === "string" && image ? ctx.hass.hassUrl(image) : null;
    items[i].backdrop = backdrop && Boolean(items[i].image);
  }
  if (!src) return;
  if (src.tap_action) {
    const openFn = buildTapAction(src.tap_action, ctx.host, id);
    for (let i = before; i < items.length; i++) {
      items[i].open = openFn;
      if (!openFn) items[i].inert = true;
    }
  }
  if (src.icon || src.name || src.actions) {
    const title = typeof src.name === "string" ? src.name : src.name ? ctx.name(st, src.name) : null;
    const extra = (src.actions || [])
      .map((ac) => ({ label: ac.label, run: buildTapAction(ac.tap_action, ctx.host, id) }))
      .filter((ac) => ac.label && ac.run);
    for (let i = before; i < items.length; i++) {
      if (src.icon) items[i].icon = src.icon;
      if (title) items[i].title = title;
      if (extra.length) items[i].actions = [...(items[i].actions || []), ...extra];
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
    img.decoding = "async";
    img.draggable = false;
    img.referrerPolicy = "no-referrer";
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
    --nc-radius: var(--radius-inner, var(--ha-border-radius-lg, 12px));
    --nc-radius-s: var(--radius-small, var(--ha-border-radius-md, 8px));
    --nc-tile: var(--control-height-icon, 40px);
    --nc-tile-s: var(--control-height-mini, 32px);
    --nc-muted: var(--opacity-muted, 0.6);
    --nc-quiet: var(--opacity-quiet, 0.45);
    --nc-ease: var(--ease-standard, cubic-bezier(0.22, 1, 0.36, 1));
    --nc-time: var(--duration-normal, var(--ha-animation-duration-normal, 250ms));
    --nc-icon: var(--icon-size-s, 20px);
    --nc-focus: var(--fill-strong, var(--ha-color-focus, var(--primary-color)));
    --nc-card-bg: var(--ha-card-background, var(--card-background-color, #fff));
    --nc-row-bg: var(--card-item-background, var(--secondary-background-color));
    --nc-hover: color-mix(in srgb, currentColor 7%, transparent);
    --nc-bg-auto: 0.22;
    display: grid;
    grid-template-rows: 1fr;
    opacity: 1;
    -webkit-tap-highlight-color: transparent;
    transition:
      grid-template-rows 450ms var(--nc-ease),
      opacity 450ms var(--nc-ease),
      display 450ms allow-discrete;
  }
  :host(.dark) { --nc-bg-auto: 0.32; }
  /* Home Assistant drops the grid cell of a card that sets hidden, so the
   * section closes the gap. .gone plays the collapse before that. */
  :host([hidden]) { display: none !important; }
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
    display: flex;
    flex-direction: column;
    min-height: 0;
    max-height: var(--nc-max-height, none);
    overflow: hidden;
    isolation: isolate;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
    transition: transform 400ms var(--nc-ease);
  }
  /* The sticky view footer of a sections dashboard caps a card at a quarter
   * of the screen; the list scrolls inside that instead of running off it. */
  :host(.docked) ha-card { max-height: var(--nc-max-height, 25dvh); }
  /* Only with a fixed height from the layout tab does the card fill its cell:
   * the header centers in it, the open list scrolls inside it. With automatic
   * height nothing stretches. ha-card itself is stretched, not sized, so a
   * margin set in css is taken off instead of pushed out of the cell. */
  :host(.bounded) { height: 100%; }
  :host(.bounded) ha-card:not(.open) .hwrap { flex: 1 1 auto; }
  ha-card.has-items:not(.open):active { transform: scale(0.98); transition-duration: 120ms; }

  .backdrop {
    position: absolute;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    border-radius: inherit;
    pointer-events: none;
  }
  .backdrop img {
    position: absolute;
    top: calc(var(--nc-bg-blur, 24px) * -2);
    left: calc(var(--nc-bg-blur, 24px) * -2);
    width: calc(100% + var(--nc-bg-blur, 24px) * 4);
    height: calc(100% + var(--nc-bg-blur, 24px) * 4);
    max-width: none;
    object-fit: cover;
    filter: blur(var(--nc-bg-blur, 24px)) saturate(1.3);
    opacity: 0;
    transition: opacity 700ms var(--nc-ease);
  }
  .backdrop img.on { opacity: var(--nc-bg-opacity, var(--nc-bg-auto)); }

  .head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: "htl hti hsd" "htl hsub hsd";
    align-content: center;
    column-gap: var(--nc-gap);
    padding: var(--nc-pad);
    outline: none;
  }
  ha-card.has-items .head, .ebar { cursor: pointer; }

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
    background: var(--nc-row-bg);
    color: var(--primary-text-color);
    opacity: var(--nc-muted);
  }
  .tile ha-icon { --mdc-icon-size: var(--nc-icon); }

  .badge {
    position: absolute;
    top: calc(var(--ha-space-1, 4px) * -1);
    inset-inline-end: calc(var(--ha-space-1, 4px) * -1);
    min-width: 20px; height: 20px;
    padding: 0 4px;
    display: flex; align-items: center; justify-content: center;
    background: var(--nc-card-bg);
    color: var(--primary-text-color);
    border-radius: var(--nc-radius-s);
    box-shadow: var(--ha-card-box-shadow, none);
    font-size: var(--font-size-compact, 11px);
    font-weight: var(--ha-font-weight-bold, 700);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .badge[hidden] { display: none; }

  .head .title {
    grid-area: hti;
    align-self: end;
    min-width: 0;
    color: var(--primary-text-color);
    font-size: var(--ha-font-size-l, 16px);
    font-weight: var(--ha-font-weight-bold, 700);
    line-height: var(--ha-line-height-condensed, 1.2);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .subslot {
    grid-area: hsub;
    align-self: start;
    margin-top: 2px;
    display: grid;
  }
  /* Header and drawer trade places through their grid row, nothing measures. */
  .hwrap, .drawer {
    display: grid;
    transition: grid-template-rows 280ms var(--nc-ease);
  }
  .hwrap { flex: none; grid-template-rows: 1fr; }
  .drawer { flex: 0 1 auto; min-height: 0; grid-template-rows: 0fr; }
  ha-card.open .hwrap { grid-template-rows: 0fr; }
  ha-card.open .drawer { grid-template-rows: 1fr; }
  .inner { min-height: 0; }
  .head, .inner {
    overflow: hidden;
    transition: opacity 200ms var(--nc-ease), padding 280ms var(--nc-ease), visibility 0s 280ms;
  }
  .inner {
    display: flex; flex-direction: column;
    padding-bottom: 0; opacity: 0; visibility: hidden;
  }
  ha-card.open .head { padding-block: 0; opacity: 0; visibility: hidden; }
  ha-card.open .inner {
    padding-bottom: var(--nc-pad);
    opacity: 1;
    visibility: visible;
    transition: opacity 200ms 80ms var(--nc-ease), padding 280ms var(--nc-ease), visibility 0s;
  }
  ha-card:not(.open) .head {
    transition: opacity 200ms 80ms var(--nc-ease), padding 280ms var(--nc-ease), visibility 0s;
  }
  .ebar {
    flex: none;
    display: flex; align-items: center;
    gap: var(--nc-gap-s);
    padding: var(--nc-pad);
    outline: none;
  }
  .head:focus-visible, .ebar:focus-visible {
    outline: 2px solid var(--nc-focus);
    outline-offset: -2px;
    border-radius: var(--nc-radius);
  }
  .count {
    flex: 1 1 auto;
    color: var(--primary-text-color);
    opacity: var(--nc-muted);
    font-size: var(--ha-font-size-s, 12px);
    font-weight: var(--ha-font-weight-medium, 500);
    font-variant-numeric: tabular-nums;
  }
  .list {
    position: relative;
    flex: 0 1 auto;
    min-height: 0;
    display: flex; flex-direction: column;
    gap: var(--nc-pad);
    padding: 0 var(--nc-pad);
  }
  :host(.docked) .list, :host(.bounded) .list {
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }
  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: "rtile rtitle rmeta" "rtile rbody rbody";
    align-items: center;
    column-gap: var(--nc-gap);
    row-gap: 2px;
    padding: var(--nc-pad);
    background: var(--nc-row-bg);
    border-radius: var(--nc-radius);
    transition: box-shadow 150ms ease, background-color var(--nc-time) var(--nc-ease);
  }
  .row.link, .row.expandable, .row.open { cursor: pointer; }
  :host(.has-bg) .row { background: color-mix(in srgb, var(--nc-row-bg) 72%, transparent); }
  .rtile {
    grid-area: rtile;
    align-self: start;
    position: relative;
    width: var(--nc-tile-s);
    height: var(--nc-tile-s);
    display: flex; align-items: center; justify-content: center;
    background: var(--fill-active, var(--primary-text-color));
    color: var(--text-color-active, var(--nc-card-bg));
    border-radius: var(--nc-radius-s);
    outline: none;
  }
  .rtile[role="button"] { cursor: pointer; }
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
  img { -webkit-user-drag: none; }
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
  .row.open .title { white-space: normal; overflow-wrap: anywhere; text-wrap: pretty; }
  .meta {
    grid-area: rmeta;
    align-self: start;
    justify-self: end;
    min-height: calc(var(--ha-font-size-m, 14px) * var(--ha-line-height-normal, 1.3));
    display: flex; align-items: center;
    gap: var(--nc-gap-s);
  }
  .when {
    color: var(--primary-text-color);
    opacity: var(--nc-quiet);
    font-size: var(--font-size-compact, 11px);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    white-space: nowrap;
  }
  button {
    -webkit-appearance: none;
    appearance: none;
    font: inherit;
    touch-action: manipulation;
  }
  .x {
    position: relative;
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
    transition: opacity 150ms ease, background-color 150ms ease, transform 150ms ease;
  }
  /* A finger needs more than the 28px the eye needs. */
  .x::before { content: ""; position: absolute; inset: -8px -4px; }
  .x ha-icon { --mdc-icon-size: var(--icon-size-xs, 18px); display: flex; }
  .row .body {
    grid-area: rbody;
    margin-top: 0;
    color: var(--primary-text-color);
    opacity: var(--nc-muted);
    font-size: var(--ha-font-size-s, 12px);
    line-height: var(--ha-line-height-normal, 1.3);
    overflow-wrap: anywhere;
    text-wrap: pretty;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    max-height: calc(2 * var(--ha-line-height-normal, 1.3) * 1em);
    overflow: hidden;
  }
  /* An opened message can be copied; a tap that only ends a selection does not close it. */
  .row.open .body {
    display: block;
    -webkit-line-clamp: unset;
    line-clamp: none;
    max-height: none;
    white-space: pre-line;
    -webkit-user-select: text;
    user-select: text;
    cursor: text;
  }
  .actions {
    grid-row: 3;
    grid-column: 2 / -1;
    display: flex;
    flex-wrap: wrap;
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
    font-size: var(--font-size-compact, 11px);
    font-weight: var(--ha-font-weight-medium, 500);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    transition: box-shadow 150ms ease, transform 150ms ease;
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
  .track.scroll:dir(rtl) { animation-name: nc-scroll-rtl; }
  .track.scroll .t { overflow: visible; max-width: none; padding-inline-end: var(--nc-gap); }
  .track.scroll .t::after {
    content: "\\2022";
    padding-inline-start: var(--nc-gap);
    opacity: var(--nc-quiet);
  }
  .track.scroll .dup { display: inline; }
  @keyframes nc-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  @keyframes nc-scroll-rtl { from { transform: translateX(0); } to { transform: translateX(50%); } }

  .hside {
    grid-area: hsd;
    align-self: center;
    justify-self: end;
    margin-inline-end: var(--nc-gap-s);
    display: flex; align-items: center;
    gap: var(--nc-gap-s);
  }
  .chev {
    flex: 0 0 auto;
    color: var(--primary-text-color);
    opacity: var(--nc-muted);
    --mdc-icon-size: var(--icon-size-m, 24px);
    transition: opacity 150ms ease;
  }
  .chev[hidden] { display: none; }

  .foot {
    flex: none;
    margin: var(--nc-pad) var(--nc-pad) 0;
    border-top: var(--separator, 2px solid var(--divider-color, color-mix(in srgb, currentColor 10%, transparent)));
    padding-top: var(--nc-gap-s);
    text-align: end;
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
    font-size: var(--ha-font-size-s, 12px);
    font-weight: var(--ha-font-weight-medium, 500);
    transition: opacity 150ms ease, background-color 150ms ease, transform 150ms ease;
  }
  .x:focus-visible, .act:focus-visible, .clear:focus-visible, .rtile:focus-visible {
    outline: 2px solid var(--nc-focus);
    outline-offset: 2px;
  }
  .x:active, .clear:active { transform: scale(0.92); }
  .act:active { transform: scale(0.96); }

  @media (hover: hover) {
    .msg:hover .track.scroll { animation-play-state: paused; }
    .head:hover .chev, .ebar:hover .chev { opacity: 1; }
    .row.link:hover, .row.expandable:hover, .row.open:hover { box-shadow: inset 0 0 0 100vmax var(--nc-hover); }
    .x:hover, .clear:hover { opacity: 1; background-color: var(--nc-hover); }
    .act:hover { box-shadow: inset 0 0 0 100vmax var(--nc-hover); }
  }

  /* The picture behind the card is decoration; whoever asks for less of it gets none. */
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active) {
    .backdrop { display: none; }
    :host(.has-bg) .row { background: var(--nc-row-bg); }
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
    <div class="backdrop" aria-hidden="true"><img alt="" draggable="false"><img alt="" draggable="false"></div>
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
      <div class="foot"><button class="clear" type="button"></button></div>
    </div></div>
  </ha-card>
`;

/* ── card ───────────────────────────────────────────────────────────── */

class NotificationCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    /* Stay attached while hidden, or the subscriptions that would bring the
     * card back are gone (Home Assistant detaches hidden cards otherwise). */
    this.connectedWhileHidden = true;
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
    this._bgUrl = null;
    this._hideTimer = null;
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
              background: entry ? entry.background : null,
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
      if (src.background != null && typeof src.background !== "boolean") {
        throw new Error(CARD + ": background must be true or false");
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
    const rows = config.grid_options && config.grid_options.rows;
    this.classList.toggle("bounded", typeof rows === "number");
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
    return { hide_when_empty: false };
  }

  /* -- language --------------------------------------------------------- */

  _setLang(lang, localize) {
    this._lang = lang;
    const base = String(lang).split("-")[0];
    this._curated = Boolean(STRINGS[base]);
    this._t = STRINGS[base] || borrowedStrings(localize);
    this._localizeRef = localize || null;
    try {
      this._rel = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
    } catch (e) {
      this._rel = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });
    }
    this._abs = null;
    if (this._dom) this._dom.clear.textContent = this._t.clear;
  }

  /* 12 or 24 hours and the time zone follow the user's profile in Home Assistant. */
  _clockOpts() {
    const h = this._hass;
    const l = (h && h.locale) || {};
    const o = {};
    if (l.time_format === "12") o.hour12 = true;
    else if (l.time_format === "24") o.hour12 = false;
    else if (l.time_format === "system") {
      const sys = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12;
      if (sys !== undefined) o.hour12 = sys;
    }
    if (l.time_zone === "server" && h.config && h.config.time_zone) o.timeZone = h.config.time_zone;
    return o;
  }

  _relTime(ts) {
    const s = Math.round((ts - Date.now()) / 1000);
    const abs = Math.abs(s);
    if (abs < 60) return this._t.just_now || this._rel.format(0, "second");
    if (abs < 3600) return this._rel.format(Math.round(s / 60), "minute");
    if (abs < 86400) return this._rel.format(Math.round(s / 3600), "hour");
    return this._rel.format(Math.round(s / 86400), "day");
  }

  _absTime(ts) {
    if (!this._abs) {
      try {
        this._abs = new Intl.DateTimeFormat(this._lang, { dateStyle: "medium", timeStyle: "short", ...this._clockOpts() });
      } catch (e) {
        this._abs = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
      }
    }
    return this._abs.format(ts);
  }

  _calWhen(start, allDay) {
    const t = this._t;
    if (!start) return t.event;
    const d = new Date(String(start).replace(" ", "T"));
    if (isNaN(d)) return t.event;
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((day - today) / 86400000);
    const near = Math.abs(diff) <= 1;
    const date = near
      ? this._rel.format(diff, "day")
      : d.toLocaleDateString(this._lang, { day: "2-digit", month: "2-digit" });
    if (allDay) return near ? date : fill(t.on_date, { d: date });
    let time;
    try {
      time = d.toLocaleTimeString(this._lang, { hour: "numeric", minute: "2-digit", ...this._clockOpts() });
    } catch (e) {
      time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }
    return fill(near ? t.day_at : t.date_at, { d: date, t: time });
  }

  /* -- hass / lifecycle ------------------------------------------------ */
  /* hass objects are immutable; changed parts get new references, so all
   * change detection here is strict-equality checks (documented contract). */

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._dom) this._build();
    if (this.isConnected && !this._unsub) this._subscribe();
    this.classList.toggle("dark", Boolean(hass.themes && hass.themes.darkMode));
    const lang = (hass.locale && hass.locale.language) || hass.language || "en";
    const langSwitched = lang !== this._lang;
    /* Borrowed strings are read again whenever Home Assistant loads more of them. */
    const langChanged =
      langSwitched || (!this._curated && hass.localize && hass.localize !== this._localizeRef);
    if (langChanged) this._setLang(lang, hass.localize);
    const localeChanged = !old || hass.locale !== old.locale || hass.config !== old.config;
    if (localeChanged) this._abs = null;
    const registryChanged = hass.entities !== this._entitiesRef;
    const viewer = this._viewerOf(hass);
    const viewerChanged = viewer !== this._viewer;
    this._viewer = viewer;
    if (!old || registryChanged || langChanged || viewerChanged) {
      this._entitiesRef = hass.entities;
      if (!old || langSwitched) this._refreshRepairs();
      this._refreshUpdateIds();
      this._refreshLabelIds();
      this._refreshWatched();
      this._recompute();
      return;
    }
    if (localeChanged) {
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

  get hass() {
    return this._hass;
  }

  /* preview is the current name, editMode the one older cores still set. */
  set preview(v) {
    this._setEditMode(v);
  }

  get preview() {
    return this._editMode;
  }

  set editMode(v) {
    this._setEditMode(v);
  }

  get editMode() {
    return this._editMode;
  }

  _setEditMode(v) {
    const on = Boolean(v);
    if (on === this._editMode && this._painted) return;
    this._editMode = on;
    if (on) this.classList.add("no-anim");
    else if (!this._settling) this.classList.remove("no-anim");
    this._recompute();
  }

  connectedCallback() {
    if (this._detachReset) {
      clearTimeout(this._detachReset);
      this._detachReset = null;
    }
    const root = this.getRootNode();
    this.classList.toggle("docked", Boolean(root && root.host && root.host.localName === "hui-view-footer"));
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
    clearTimeout(this._repairsTimer);
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

  _isAdmin() {
    const u = this._hass && this._hass.user;
    return !u || u.is_admin !== false;
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
    /* Repairs are admin only; asking anyway only writes refusals to the log. */
    if (!this._unsubRepairs && conn.subscribeEvents && this._isAdmin()) {
      this._unsubRepairs = conn.subscribeEvents(
        () => {
          clearTimeout(this._repairsTimer);
          this._repairsTimer = setTimeout(() => this._refreshRepairs(), 500);
        },
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
    if (!h || !h.callWS || !this._config || !this._config.repairs || !this._isAdmin()) {
      this._repairs = [];
      return;
    }
    h.callWS({ type: "repairs/list_issues" })
      .then((res) => {
        this._repairs = ((res && res.issues) || []).filter((i) => i.active !== false && !i.ignored);
        this._recompute();
        const domains = [...new Set(this._repairs.map((i) => i.domain))];
        if (domains.length && typeof h.loadBackendTranslation === "function") {
          return h.loadBackendTranslation("issues", domains).then((localize) => {
            this._issueLocalize = localize;
            this._recompute();
          });
        }
        return undefined;
      })
      .catch(() => {
        this._repairs = this._repairs || [];
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
    const name = (st, override) => {
      if (h && h.formatEntityName) {
        try {
          return h.formatEntityName(st, override) || st.entity_id;
        } catch (e) {
          /* fall through to the plain name */
        }
      }
      return (typeof override === "string" && override) || st.attributes.friendly_name || st.entity_id;
    };
    const ctx = {
      hass: h,
      host: this,
      t: this._t,
      issueLocalize: this._issueLocalize,
      calWhen: (s, allDay) => this._calWhen(s, allDay),
      name,
      format: (st) => (h && h.formatEntityState ? h.formatEntityState(st) : String(st.state)),
    };

    if (allowed("system")) {
      for (const [id, n] of this._persistent) {
        const message = n.message || "";
        if (MUTED_NOTIFICATIONS.has(id) || message.includes("invalid authentication")) continue;
        const link = firstLink(message);
        items.push({
          key: "s:" + id,
          kind: "system",
          source: "system",
          title: plainText(n.title) || this._t.notification,
          message: plainText(message),
          ts: parseTs(n.created_at, Date.now()),
          seq: n.__seq || 0,
          open: link ? linkAction(this, link) : null,
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
      bgs: [...this.shadowRoot.querySelectorAll(".backdrop img")],
      userCss,
    };
    for (const img of this._dom.bgs) img.referrerPolicy = "no-referrer";
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
    this._dom.card.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this._expanded) return;
      e.stopPropagation();
      this._toggle();
      this._dom.head.focus({ preventScroll: true });
    });
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
    this._settling = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this._settling = false;
        if (!this._editMode) this.classList.remove("no-anim");
      });
    });
  }

  /* Keyboard focus follows the toggle, which hides itself as it opens or closes. */
  _toggle() {
    if (!this._items.length) return;
    const d = this._dom;
    const active = this.shadowRoot.activeElement;
    const refocus = active === d.head || active === d.ebar;
    this._expanded = !this._expanded;
    d.head.setAttribute("aria-expanded", String(this._expanded));
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
    if (refocus) (this._expanded ? d.ebar : d.head).focus({ preventScroll: true });
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

  /* Hidden the way Home Assistant expects it: the hidden attribute plus
   * card-visibility-changed, so sections, masonry and the view footer drop
   * the card's slot instead of keeping an empty gap. The collapse plays first. */
  _setShown(show) {
    if (show) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
      this.classList.remove("gone");
      if (this.hidden) {
        this.hidden = false;
        fire(this, "card-visibility-changed", { value: true });
      }
      return;
    }
    if (this.hidden || this._hideTimer) return;
    const finish = () => {
      this._hideTimer = null;
      this.hidden = true;
      fire(this, "card-visibility-changed", { value: false });
    };
    const animate = this._animOK();
    this.classList.add("gone");
    if (animate) this._hideTimer = setTimeout(finish, 450);
    else finish();
  }

  /* Two layers so one picture fades into the next; a picture shows only once loaded. */
  _setBackdrop(url) {
    if (url === this._bgUrl) return;
    this._bgUrl = url;
    const layers = this._dom.bgs;
    const shown = layers.find((l) => l.classList.contains("on")) || null;
    if (!url) {
      if (shown) shown.classList.remove("on");
      this.classList.remove("has-bg");
      return;
    }
    const next = shown === layers[0] ? layers[1] : layers[0];
    const reveal = () => {
      if (this._bgUrl !== url) return;
      next.classList.add("on");
      if (shown && shown !== next) shown.classList.remove("on");
      this.classList.add("has-bg");
    };
    next.onload = reveal;
    next.onerror = () => {
      if (this._bgUrl !== url) return;
      if (shown) shown.classList.remove("on");
      this.classList.remove("has-bg");
    };
    if (next.getAttribute("src") === url && next.complete && next.naturalWidth) reveal();
    else next.src = url;
  }

  _render() {
    if (!this._dom || !this._config) return;
    const d = this._dom;
    const items = this._items;
    const empty = items.length === 0;

    if (empty && this._config.hide_when_empty && !this._editMode) {
      this._setShown(false);
      this._setBackdrop(null);
      this._lastMsg = null;
      this._stopClock();
      this._painted = true;
      return;
    }
    this._setShown(true);

    if (empty) {
      this._expanded = false;
      this._stopClock();
      d.head.setAttribute("aria-expanded", "false");
    }
    d.card.classList.toggle("open", this._expanded);
    d.card.classList.toggle("has-items", !empty);
    d.head.setAttribute("aria-disabled", String(empty));

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
    this._setBackdrop(!empty && items[0].backdrop ? items[0].image : null);
    d.count.textContent = empty
      ? ""
      : fill(items.length === 1 ? this._t.count_one : this._t.count_other, { n: items.length });
    this._renderList(empty ? [] : items);
    d.foot.hidden = empty || items.length < 2 || !items.some((it) => it.dismiss);
    this._painted = true;
  }

  _animOK() {
    return (
      this._painted &&
      !this._editMode &&
      this.isConnected &&
      !this.classList.contains("no-anim") &&
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
        Boolean(it.open || it.entity) && !it.inert,
        (it.actions || []).map((a) => a.label + (a.disabled ? "!" : "")).join("|"),
      ].join("␟");
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
    const out = getComputedStyle(this).direction === "rtl" ? -24 : 24;
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
        ghost.style.top = (oldRect.top - listRect.top) * scale + listEl.scrollTop + "px";
        ghost.style.left = (oldRect.left - listRect.left) * scale + "px";
        ghost.style.width = oldRect.width * scale + "px";
        ghost.style.pointerEvents = "none";
        listEl.appendChild(ghost);
        const anim = ghost.animate(
          [
            { opacity: 1, transform: "none" },
            { opacity: 0, transform: "translateX(" + out + "px)" },
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
    const when = document.createElement("time");
    when.className = "when";
    when.dateTime = new Date(it.ts).toISOString();
    when.title = this._absTime(it.ts);
    when.textContent = this._relTime(it.ts);
    meta.append(when);
    if (it.dismiss) {
      const x = document.createElement("button");
      x.className = "x";
      x.type = "button";
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
        btn.type = "button";
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
    const clamped = () =>
      body.scrollHeight > body.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1;
    const selecting = () => {
      const sel = (this.shadowRoot.getSelection && this.shadowRoot.getSelection()) || document.getSelection();
      return Boolean(sel && !sel.isCollapsed && String(sel).trim());
    };
    const go = it.inert ? null : it.open || (it.entity ? () => fireMoreInfo(this, it.entity) : null);
    /* The pointer shows a hand only where a tap does something. */
    row.addEventListener("pointerenter", () => row.classList.toggle("expandable", clamped()));
    /* Tap: clamped long text expands/collapses; otherwise the row opens its
     * target. The icon tile always opens the target. */
    row.addEventListener("click", () => {
      if (selecting()) return;
      if (row.classList.contains("open") || clamped()) {
        row.classList.toggle("open");
      } else if (go) {
        go();
      }
    });
    if (go) {
      row.classList.add("link");
      tile.setAttribute("role", "button");
      tile.tabIndex = 0;
      tile.setAttribute("aria-label", it.title);
      tile.addEventListener("click", (e) => {
        e.stopPropagation();
        go();
      });
      tile.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        go();
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

/* Generic labels come from Home Assistant, in the user's language. */
const HA_EDITOR = Object.freeze({
  entities: "ui.panel.lovelace.editor.card.generic.entities",
  name: "ui.panel.lovelace.editor.card.generic.name",
  icon: "ui.panel.lovelace.editor.card.generic.icon",
  tap_action: "ui.panel.lovelace.editor.card.generic.tap_action",
});

const EDITOR_STRINGS = Object.freeze({
  en: {
    entities: "Entities",
    label: "Include entities by label",
    updates: "Pending updates",
    repairs: "Repairs",
    hide_when_empty: "Hide when there is nothing to show",
    options: "Entity options",
    type: "Kind",
    name: "Name",
    icon: "Icon",
    image: "Picture",
    background: "Picture as card background",
    tap_action: "Tap behavior",
    audience: "Who sees what",
    visible: "Visible to",
    people: "People",
    system: "System notifications",
    everyone: "Everyone",
    only: "Only these people",
    except: "Everyone except these people",
    nobody: "Nobody",
    only_x: "Only {x}",
    except_x: "Everyone except {x}",
    type_auto: "Detect automatically",
    type_calendar: "Calendar event",
    type_update: "Update",
    type_alarm: "Alarm panel",
    type_alert: "Alert",
    type_dwd: "DWD weather warnings",
    type_recipe: "Recipe attribute",
    type_picture: "Picture with a text state",
    type_generic: "Plain entity",
  },
  de: {
    entities: "Entitäten",
    label: "Entitäten mit diesem Label einbeziehen",
    updates: "Ausstehende Updates",
    repairs: "Reparaturen",
    hide_when_empty: "Ausblenden, wenn nichts anliegt",
    options: "Optionen je Entität",
    type: "Art",
    name: "Name",
    icon: "Symbol",
    image: "Bild",
    background: "Bild als Kartenhintergrund",
    tap_action: "Verhalten beim Tippen",
    audience: "Wer sieht was",
    visible: "Sichtbar für",
    people: "Personen",
    system: "Systembenachrichtigungen",
    everyone: "Alle",
    only: "Nur diese Personen",
    except: "Alle außer diesen Personen",
    nobody: "Niemand",
    only_x: "Nur {x}",
    except_x: "Alle außer {x}",
    type_auto: "Automatisch erkennen",
    type_calendar: "Kalendertermin",
    type_update: "Update",
    type_alarm: "Alarmanlage",
    type_alert: "Alarm (alert)",
    type_dwd: "DWD-Unwetterwarnungen",
    type_recipe: "Rezept-Attribut",
    type_picture: "Bild mit Text-Zustand",
    type_generic: "Einfache Entität",
  },
});

const EDITOR_HELPERS = Object.freeze({
  en: {
    label: "Every entity with this label is added and detected automatically.",
    visible: "Applies outside edit mode, like Home Assistant's own card visibility.",
    people: "Matches the user account linked to each person in Settings → People.",
    image: "An attribute such as recipe.image, or a URL. Empty: the entity's own picture.",
    background: "Shown softly blurred behind the card while this entity is the notification on top.",
  },
  de: {
    label: "Jede Entität mit diesem Label kommt dazu und wird automatisch erkannt.",
    visible: "Gilt außerhalb des Bearbeitungsmodus, wie die Sichtbarkeit von Home Assistant selbst.",
    people: "Verglichen wird das Benutzerkonto, das unter Einstellungen → Personen verknüpft ist.",
    image: "Ein Attribut wie recipe.image oder eine URL. Leer: das eigene Bild der Entität.",
    background: "Weich und unscharf hinter der Karte, solange diese Entität oben steht.",
  },
});

const OPTION_KEYS = ["type", "name", "icon", "image", "background", "tap_action"];

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

  _lang() {
    const h = this._hass;
    return String((h && ((h.locale && h.locale.language) || h.language)) || "en").split("-")[0];
  }

  _label(key) {
    const h = this._hass;
    const own = EDITOR_STRINGS[this._lang()] || {};
    if (own[key]) return own[key];
    const borrowed = HA_EDITOR[key] && h && h.localize ? h.localize(HA_EDITOR[key]) : "";
    return borrowed || EDITOR_STRINGS.en[key] || key;
  }

  _helper(key) {
    return (EDITOR_HELPERS[this._lang()] || EDITOR_HELPERS.en)[key];
  }

  _name(id) {
    const st = this._hass && this._hass.states[id];
    return (st && st.attributes.friendly_name) || id;
  }

  _entries() {
    return (this._config.entities || [])
      .map((e) => (typeof e === "string" ? { entity: e } : e || {}))
      .filter((e) => typeof e.entity === "string");
  }

  _sources() {
    const c = this._config || {};
    const h = this._hass;
    const reg = h ? h.entities : null;
    const labelled =
      c.label && reg
        ? Object.keys(reg).filter((id) => ((reg[id] && reg[id].labels) || []).includes(c.label))
        : [];
    const sources = [{ key: "system", name: this._label("system"), icon: ICONS.system }];
    if (c.updates !== false) sources.push({ key: "updates", name: this._label("updates"), icon: ICONS.update });
    if (c.repairs !== false) sources.push({ key: "repairs", name: this._label("repairs"), icon: ICONS.repair });
    for (const src of [...this._entries(), ...labelled.map((entity) => ({ entity }))]) {
      if (sources.some((s) => s.key === src.entity)) continue;
      sources.push({
        key: src.entity,
        name: typeof src.name === "string" && src.name ? src.name : this._name(src.entity),
        icon: src.icon || typeIcon(this._typeOf(src)),
      });
    }
    return sources;
  }

  _typeOf(src) {
    if (src.type && src.type !== "auto") return src.type;
    const st = this._hass && this._hass.states[src.entity];
    return st ? detectType(src.entity, st) : "generic";
  }

  _summary(rule) {
    const mode = ruleMode(rule);
    if (mode === "everyone") return this._label("everyone");
    const names = rule[mode].map((id) => this._name(id)).join(", ");
    if (mode === "only") return names ? fill(this._label("only_x"), { x: names }) : this._label("nobody");
    return names ? fill(this._label("except_x"), { x: names }) : this._label("everyone");
  }

  _schema(sources) {
    const audience = this._config.audience || {};
    const options = ["everyone", "only", "except"].map((value) => ({ value, label: this._label(value) }));
    const entries = this._entries();
    return [
      { name: "entities", selector: { entity: { multiple: true } } },
      { name: "label", selector: { label: {} } },
      {
        name: "",
        type: "grid",
        schema: [
          { name: "updates", selector: { boolean: {} } },
          { name: "repairs", selector: { boolean: {} } },
        ],
      },
      { name: "hide_when_empty", selector: { boolean: {} } },
      ...(entries.length
        ? [
            {
              name: "options",
              type: "expandable",
              title: this._label("options"),
              icon: "mdi:tune-variant",
              schema: entries.map((e) => {
                const icon = typeIcon(this._typeOf(e));
                return {
                  name: e.entity,
                  type: "expandable",
                  title: typeof e.name === "string" && e.name ? e.name : this._name(e.entity),
                  icon: e.icon || icon,
                  schema: [
                    {
                      name: "type",
                      selector: {
                        select: {
                          mode: "dropdown",
                          options: TYPES.map((value) => ({ value, label: this._label("type_" + value) })),
                        },
                      },
                    },
                    {
                      name: "",
                      type: "grid",
                      schema: [
                        { name: "name", selector: { text: {} } },
                        { name: "icon", selector: { icon: { placeholder: icon } } },
                      ],
                    },
                    { name: "image", selector: { text: {} } },
                    { name: "background", selector: { boolean: {} } },
                    { name: "tap_action", selector: { ui_action: { default_action: "more-info" } } },
                  ],
                };
              }),
            },
          ]
        : []),
      {
        name: "audience",
        type: "expandable",
        title: this._label("audience"),
        icon: "mdi:account-eye-outline",
        schema: sources.map((s) => ({
          name: s.key,
          type: "expandable",
          title: s.name + " · " + this._summary(audience[s.key]),
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

  _data(sources) {
    const audience = this._config.audience || {};
    const data = { ...DEFAULTS, ...this._config };
    data.entities = this._entries().map((e) => e.entity);
    data.options = Object.fromEntries(
      this._entries().map((e) => [
        e.entity,
        {
          type: e.type || "auto",
          name: typeof e.name === "string" ? e.name : undefined,
          icon: e.icon,
          image: e.image,
          background: Boolean(e.background),
          tap_action: e.tap_action,
        },
      ])
    );
    data.audience = Object.fromEntries(
      sources.map((s) => {
        const mode = ruleMode(audience[s.key]);
        return [s.key, { visible: mode, people: mode === "everyone" ? [] : audience[s.key][mode] }];
      })
    );
    return data;
  }

  /* Picked entities keep what only YAML can set (actions, name parts). */
  _mergeEntities(ids, options) {
    const prev = new Map(this._entries().map((e) => [e.entity, e]));
    return (ids || []).map((id) => {
      const base = prev.get(id) || { entity: id };
      const opt = (options && options[id]) || {};
      const merged = { ...base, entity: id };
      for (const key of OPTION_KEYS) {
        if (!(key in opt)) continue;
        const v = opt[key];
        if (key === "name" && isEmpty(v) && base.name != null && typeof base.name !== "string") continue;
        if (isEmpty(v) || (key === "type" && v === "auto")) delete merged[key];
        else merged[key] = v;
      }
      const ordered = {};
      for (const key of [...ENTITY_KEY_ORDER, ...Object.keys(merged)]) {
        if (key in merged && !(key in ordered)) ordered[key] = merged[key];
      }
      return Object.keys(ordered).length === 1 ? id : ordered;
    });
  }

  _onChange(e) {
    e.stopPropagation();
    const value = { ...(e.detail.value || {}) };
    if (Array.isArray(value.entities)) {
      value.entities = this._mergeEntities(value.entities, value.options);
    }
    delete value.options;
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
    /* Only what differs from the defaults is written, in a fixed order. */
    const merged = { ...this._config, ...value };
    const config = { type: "custom:" + CARD };
    for (const k of [...KEY_ORDER, ...Object.keys(merged)]) {
      if (k === "type" || k in config || !(k in merged)) continue;
      const v = merged[k];
      if (v === "" || v == null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (k in DEFAULTS && v === DEFAULTS[k]) continue;
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
  }

  /* Schema and data are handed to ha-form only when they change, not on
   * every state update, so fields keep their focus and nothing flickers. */
  _renderForm() {
    if (!this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.addEventListener("value-changed", (e) => this._onChange(e));
      this.appendChild(this._form);
    }
    const lang = this._lang();
    if (lang !== this._formLang || (this._hass && this._hass.localize !== this._formLocalize)) {
      this._formLang = lang;
      this._formLocalize = this._hass && this._hass.localize;
      this._form.computeLabel = (s) => this._label(s.name);
      this._form.computeHelper = (s) => this._helper(s.name);
      this._schemaKey = null;
    }
    const sources = this._sources();
    this._form.hass = this._hass;
    const schema = this._schema(sources);
    const schemaKey = JSON.stringify(schema);
    if (schemaKey !== this._schemaKey) {
      this._schemaKey = schemaKey;
      this._form.schema = schema;
    }
    const data = this._data(sources);
    const dataKey = JSON.stringify(data);
    if (dataKey !== this._dataKey) {
      this._dataKey = dataKey;
      this._form.data = data;
    }
  }
}

/* ── registration ───────────────────────────────────────────────────── */

/* Loading the file twice (HACS plus a manual resource) must not throw. The
 * version line is what a bug report asks for. */
if (!customElements.get(CARD)) {
  customElements.define(CARD, NotificationCard);
  console.info("%c Notification Card %c v" + VERSION + " ", "font-weight:bold", "opacity:0.7");
}
if (!customElements.get(EDITOR)) customElements.define(EDITOR, NotificationCardEditor);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === CARD)) {
  window.customCards.push({
    type: CARD,
    name: "Notification Card",
    description:
      "System notifications, repairs, updates, warnings and any entity you add.",
    preview: true,
    documentationURL: REPO,
  });
}
