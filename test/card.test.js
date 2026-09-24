/* Smoke tests: mount the card against a fake hass and read the shadow DOM.
 * Run with npm test. */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.argv[2] || path.join(__dirname, "..", "dist", "notification-card.js");

function makeWindow() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "http://ha.local/",
  });
  const w = dom.window;
  w.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const fakeAnim = () => ({
    cancel() {},
    set onfinish(fn) {
      this._f = fn;
      if (fn) fn();
    },
    get onfinish() {
      return this._f;
    },
  });
  w.Element.prototype.animate = fakeAnim;
  w.eval(fs.readFileSync(SRC, "utf8"));
  return w;
}

function st(entity_id, state, attributes = {}) {
  return { entity_id, state, attributes, last_changed: "2026-09-21T10:00:00+00:00" };
}

function makeHass(states = {}, opts = {}) {
  const calls = [];
  return {
    calls,
    states,
    entities: opts.entities || {},
    locale: { language: opts.lang || "en" },
    user: opts.user || { id: "u1", is_admin: true },
    connection: {
      subscribeMessage: (cb, msg) => {
        (opts.subs || []).push({ cb, msg });
        return Promise.resolve(() => {});
      },
      subscribeEvents: (cb, ev) => {
        (opts.subs || []).push({ cb, ev });
        return Promise.resolve(() => {});
      },
      sendMessagePromise: (msg) => {
        calls.push(["ws", msg.type]);
        return Promise.resolve(opts.wsReply ? opts.wsReply(msg) : { issues: [] });
      },
    },
    callService: (d, s, data) => {
      calls.push([d + "." + s, data]);
      return Promise.resolve();
    },
    callWS: (msg) => {
      calls.push(["ws", msg.type]);
      return Promise.resolve(opts.wsReply ? opts.wsReply(msg) : { issues: [] });
    },
    hassUrl: (p) => (String(p).startsWith("http") ? p : "http://ha.local" + p),
    formatEntityState: opts.formatEntityState,
    localize: opts.localize || (() => ""),
    loadBackendTranslation: opts.loadBackendTranslation,
    themes: opts.themes || { darkMode: false },
  };
}

function mount(w, config, hass) {
  const el = w.document.createElement("notification-card");
  el.setConfig(config);
  w.document.body.appendChild(el);
  el.hass = hass;
  return el;
}

const rows = (el) =>
  [...el.shadowRoot.querySelectorAll(".list .row")].map((r) => ({
    title: r.querySelector(".title").textContent,
    body: r.querySelector(".body").textContent,
    tile: r.querySelector(".rtile").className,
    icon: r.querySelector(".rtile ha-icon").getAttribute("icon"),
    actions: [...r.querySelectorAll(".act")].map((b) => b.textContent + (b.disabled ? "!" : "")),
    x: Boolean(r.querySelector(".x")),
  }));
const head = (el) => ({
  title: el.shadowRoot.querySelector(".head .title").textContent,
  badge: el.shadowRoot.querySelector(".badge").textContent,
});

let pass = 0;
let fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got);
  const wj = JSON.stringify(want);
  if (g === wj) {
    pass++;
    console.log("  ok   " + name);
  } else {
    fail++;
    console.log("  FAIL " + name + "\n       got  " + g + "\n       want " + wj);
  }
}
/* ---------------------------------------------------------------- */

console.log("\n# empty");
{
  const w = makeWindow();
  const el = mount(w, { type: "x" }, makeHass({}));
  check("hidden when empty", el.classList.contains("gone"), true);
  const el2 = mount(w, { type: "x", hide_when_empty: false }, makeHass({}));
  check("idle title", el2.shadowRoot.querySelector(".head .title").textContent, "All quiet");
}

console.log("\n# persistent notification");
{
  const w = makeWindow();
  const subs = [];
  const hass = makeHass({}, { subs });
  const el = mount(w, { type: "x" }, hass);
  subs[0].cb({
    type: "current",
    notifications: {
      n1: { notification_id: "n1", title: "Backup", message: "Backup done", created_at: "2026-09-21T09:00:00+00:00" },
    },
  });
  check("row", rows(el).map((r) => [r.title, r.body]), [["Backup", "Backup done"]]);
  el.shadowRoot.querySelector(".row .x").click();
  check("dismiss service", hass.calls.map((c) => c[0]).includes("persistent_notification.dismiss"), true);
}

console.log("\n# update entity");
{
  const w = makeWindow();
  const hass = makeHass({
    "update.router": st("update.router", "on", {
      friendly_name: "Router Update",
      title: "RouterOS",
      latest_version: "7.15",
      supported_features: 1,
    }),
  });
  const el = mount(w, { type: "x" }, hass);
  check("title from attr", rows(el)[0].title, "RouterOS");
  check("message", rows(el)[0].body, "Update 7.15 available");
  check("install button", rows(el)[0].actions, ["Install"]);

  const noInstall = makeHass({
    "update.bulb": st("update.bulb", "on", { title: "Bulb firmware", latest_version: "2", supported_features: 0 }),
  });
  check("no install button without the install feature", rows(mount(w, { type: "x" }, noInstall))[0].actions, []);

  const auto = makeHass({
    "update.addon": st("update.addon", "on", { title: "Add-on", latest_version: "3", supported_features: 1, auto_update: true }),
  });
  const elAuto = mount(w, { type: "x" }, auto);
  elAuto.shadowRoot.querySelector(".row .x").click();
  check("auto update is dismissed locally, not skipped", [elAuto._items.length, auto.calls.some((c) => c[0] === "update.skip")], [0, false]);

  const hass2 = makeHass({
    "update.router": st("update.router", "on", {
      title: "RouterOS",
      latest_version: "7.15",
      in_progress: true,
      update_percentage: 42,
    }),
  });
  const el2 = mount(w, { type: "x" }, hass2);
  check("install progress", rows(el2)[0].actions, ["Installing 42%!"]);
}

console.log("\n# configured update entity keeps its overrides");
{
  const w = makeWindow();
  const hass = makeHass({
    "update.router": st("update.router", "on", { title: "RouterOS", latest_version: "7.15" }),
  });
  const el = mount(
    w,
    { type: "x", entities: [{ entity: "update.router", name: "Router firmware", icon: "mdi:router" }] },
    hass
  );
  check("name override", rows(el)[0].title, "Router firmware");
  check("icon override", rows(el)[0].icon, "mdi:router");
}

console.log("\n# generic entity formatting");
{
  const w = makeWindow();
  const hass = makeHass(
    {
      "sensor.load": st("sensor.load", "3", { friendly_name: "Load", unit_of_measurement: "%" }),
      "sensor.next_alarm": st("sensor.next_alarm", "2026-09-22T06:30:00+00:00", {
        friendly_name: "Next alarm",
        device_class: "timestamp",
      }),
    },
    { formatEntityState: (s) => (s.entity_id === "sensor.load" ? "3 %" : "September 22, 2026 at 6:30 AM") }
  );
  const el = mount(w, { type: "x", entities: ["sensor.load", { entity: "sensor.next_alarm", type: "generic" }] }, hass);
  check("states come from Home Assistant", rows(el).map((r) => [r.title, r.body]), [
    ["Load", "3 %"],
    ["Next alarm", "September 22, 2026 at 6:30 AM"],
  ]);
}

console.log("\n# alarm panel + alert");
{
  const w = makeWindow();
  const hass = makeHass(
    {
      "alarm_control_panel.house": st("alarm_control_panel.house", "triggered", { friendly_name: "House" }),
      "alarm_control_panel.shed": st("alarm_control_panel.shed", "disarmed", { friendly_name: "Shed" }),
      "alert.garage": st("alert.garage", "on", { friendly_name: "Garage open too long" }),
    },
    { formatEntityState: () => "Triggered" }
  );
  const el = mount(
    w,
    { type: "x", entities: ["alarm_control_panel.house", "alarm_control_panel.shed", "alert.garage"] },
    hass
  );
  check("triggered is critical and pinned", rows(el).map((r) => [r.title, r.tile]), [
    ["House", "rtile crit"],
    ["Garage open too long", "rtile warn"],
  ]);
  check("disarmed panel stays silent", rows(el).some((r) => r.title === "Shed"), false);
  check("alarm has no dismiss, alert has one", rows(el).map((r) => [r.title, r.x]), [
    ["House", false],
    ["Garage open too long", true],
  ]);
  check("alarm icon", rows(el)[0].icon, "mdi:shield-alert");
}

console.log("\n# audience");
{
  const w = makeWindow();
  const subs = [];
  const hass = makeHass(
    { "person.anna": st("person.anna", "home", { user_id: "u1" }) },
    { subs, user: { id: "u1" } }
  );
  const el = mount(w, { type: "x", audience: { system: { except: ["person.anna"] } } }, hass);
  subs[0].cb({ type: "current", notifications: { n1: { notification_id: "n1", message: "hi" } } });
  check("viewer excluded", rows(el).length, 0);
}

console.log("\n# dwd + sorting");
{
  const w = makeWindow();
  const hass = makeHass({
    "sensor.dwd": st("sensor.dwd", "2", {
      warning_count: 2,
      warning_1_headline: "Sturm",
      warning_1_level: 3,
      warning_1_start: "2026-09-21T08:00:00+00:00",
      warning_2_headline: "Glatteis",
      warning_2_level: 2,
      warning_2_start: "2026-09-21T11:00:00+00:00",
    }),
    "update.router": st("update.router", "on", { title: "RouterOS", latest_version: "7.15" }),
  });
  const el = mount(w, { type: "x", entities: ["sensor.dwd"] }, hass);
  check("crit first, then newest", rows(el).map((r) => r.title), ["Sturm", "Glatteis", "RouterOS"]);
  check("head shows the top item", head(el).title, "Sturm");
  check("badge", head(el).badge, "3");
}

console.log("\n# local ack");
{
  const w = makeWindow();
  const hass = makeHass({ "binary_sensor.door": st("binary_sensor.door", "on", { friendly_name: "Door" }) });
  const el = mount(w, { type: "x", hide_when_empty: false, entities: ["binary_sensor.door"] }, hass);
  check("one row", rows(el).length, 1);
  el.shadowRoot.querySelector(".row .x").click();
  check("acked away", rows(el).length, 0);
}

console.log("\n# editor");
{
  const w = makeWindow();
  const ed = w.document.createElement("notification-card-editor");
  ed.setConfig({ type: "x", entities: ["calendar.family"] });
  ed.hass = makeHass({ "calendar.family": st("calendar.family", "off", { friendly_name: "Family" }) });
  const form = ed.querySelector("ha-form");
  check("schema", form.schema.map((s) => s.name || s.type), [
    "entities",
    "label",
    "grid",
    "hide_when_empty",
    "options",
    "audience",
  ]);
  check(
    "entity options",
    form.schema.find((s) => s.name === "options").schema[0].schema.map((s) => s.name || s.type),
    ["type", "grid", "image", "background", "tap_action"]
  );
  check("audience sources", form.schema.find((s) => s.name === "audience").schema.map((s) => s.name), [
    "system",
    "updates",
    "repairs",
    "calendar.family",
  ]);
}


console.log("\n# hidden the way Home Assistant expects");
{
  const w = makeWindow();
  const events = [];
  const el = w.document.createElement("notification-card");
  el.addEventListener("card-visibility-changed", (e) => events.push(e.detail.value));
  el.setConfig({ type: "x", entities: ["binary_sensor.door"] });
  w.document.body.appendChild(el);
  const off = st("binary_sensor.door", "off", { friendly_name: "Door" });
  el.hass = makeHass({ "binary_sensor.door": off });
  check("stays attached while hidden", el.connectedWhileHidden, true);
  check("hidden attribute when empty", el.hidden, true);
  el.hass = makeHass({ "binary_sensor.door": { ...off, state: "on" } });
  check("shown again with content", [el.hidden, events], [false, [false, true]]);
  el.preview = true;
  el.hass = makeHass({ "binary_sensor.door": off });
  check("never hidden in the dashboard editor", el.hidden, false);
}

console.log("\n# pictures: recipe attribute, picture type, background");
{
  const w = makeWindow();
  const hass = makeHass({
    "sensor.dinner": st("sensor.dinner", "Lasagne", {
      friendly_name: "Dinner",
      recipe: { name: "Lasagne", image: "/local/food/lasagne.jpg" },
    }),
    "sensor.book": st("sensor.book", "Dune", { friendly_name: "Book of the day", cover: "https://img.test/dune.jpg" }),
    "media_player.tv": st("media_player.tv", "playing", {
      friendly_name: "TV",
      entity_picture: "/api/media_player_proxy/media_player.tv",
    }),
  });
  const el = mount(
    w,
    {
      type: "x",
      entities: [
        { entity: "sensor.dinner", background: true },
        { entity: "sensor.book", type: "picture", image: "cover" },
        { entity: "media_player.tv", type: "generic" },
      ],
    },
    hass
  );
  const byTitle = Object.fromEntries(rows(el).map((r) => [r.title, r]));
  check("recipe falls back to the entity name", byTitle.Lasagne.body, "Dinner");
  check("picture type: the state is the title", byTitle.Dune.body, "Book of the day");
  const img = (title) => {
    const i = [...el.shadowRoot.querySelectorAll(".row")].find((r) => r.querySelector(".title").textContent === title);
    return i.querySelector(".rtile img").getAttribute("src");
  };
  check("images from any source", [img("Lasagne"), img("Dune"), img("TV")], [
    "http://ha.local/local/food/lasagne.jpg",
    "https://img.test/dune.jpg",
    "http://ha.local/api/media_player_proxy/media_player.tv",
  ]);
  const bg = () => [...el.shadowRoot.querySelectorAll(".backdrop img")].map((i) => i.getAttribute("src"));
  el._items.sort((a, b) => (a.title === "Lasagne" ? -1 : b.title === "Lasagne" ? 1 : 0));
  el._render();
  check("background from the item on top", bg().includes("http://ha.local/local/food/lasagne.jpg"), true);
  el._items.sort((a, b) => (a.title === "Dune" ? -1 : b.title === "Dune" ? 1 : 0));
  el._render();
  check("no background for sources without it", el._bgUrl, null);
}

console.log("\n# persistent notification markdown");
{
  const w = makeWindow();
  const subs = [];
  const el = mount(w, { type: "x" }, makeHass({}, { subs }));
  const actions = [];
  el.addEventListener("hass-action", (e) => actions.push(e.detail.config.tap_action));
  subs[0].cb({
    type: "current",
    notifications: {
      n1: { notification_id: "n1", title: "**New devices**", message: "We found [2 devices](/config/integrations/dashboard).\n\n- Hue\n- `Z-Wave`" },
    },
  });
  check("plain text", rows(el).map((r) => [r.title, r.body]), [["New devices", "We found 2 devices.\n\nHue\nZ-Wave"]]);
  el.shadowRoot.querySelector(".row .rtile").click();
  check("the link is the tap target", actions, [{ action: "navigate", navigation_path: "/config/integrations/dashboard" }]);
}

console.log("\n# tap actions go through Home Assistant");
{
  const w = makeWindow();
  const hass = makeHass({
    "binary_sensor.door": st("binary_sensor.door", "on", { friendly_name: "Door" }),
    "binary_sensor.window": st("binary_sensor.window", "on", { friendly_name: "Window" }),
  });
  const el = mount(
    w,
    {
      type: "x",
      entities: [
        { entity: "binary_sensor.door", tap_action: { action: "navigate", navigation_path: "/lovelace/doors" } },
        { entity: "binary_sensor.window", tap_action: { action: "none" } },
      ],
    },
    hass
  );
  const actions = [];
  const infos = [];
  el.addEventListener("hass-action", (e) => actions.push(e.detail));
  el.addEventListener("hass-more-info", (e) => infos.push(e.detail.entityId));
  const tiles = Object.fromEntries(
    [...el.shadowRoot.querySelectorAll(".row")].map((r) => [r.querySelector(".title").textContent, r.querySelector(".rtile")])
  );
  tiles.Door.click();
  tiles.Window.click();
  check("configured action is handed to Home Assistant", actions, [
    { config: { entity: "binary_sensor.door", tap_action: { action: "navigate", navigation_path: "/lovelace/doors" } }, action: "tap" },
  ]);
  check("action none does nothing", [infos, tiles.Window.getAttribute("role")], [[], null]);
}

console.log("\n# other languages borrow Home Assistant's strings");
{
  const w = makeWindow();
  const fr = {
    "ui.notification_drawer.title": "Notifications",
    "ui.notification_drawer.empty": "Aucune notification",
    "ui.dialogs.more_info_control.update.install": "Installer",
  };
  const hass = makeHass(
    { "update.router": st("update.router", "on", { title: "RouterOS", supported_features: 1 }) },
    { lang: "fr", localize: (k) => fr[k] || "" }
  );
  const el = mount(w, { type: "x" }, hass);
  check("install in french", rows(el)[0].actions, ["Installer"]);
  const idle = mount(w, { type: "x", hide_when_empty: false, updates: false }, makeHass({}, { lang: "fr", localize: (k) => fr[k] || "" }));
  check("idle text in french", idle.shadowRoot.querySelector(".msg .t").textContent, "Aucune notification");
}

console.log("\n# calendar");
{
  const w = makeWindow();
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const day = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());
  const hass = makeHass({
    "calendar.family": st("calendar.family", "on", { message: "Holiday", start_time: day + " 00:00:00", all_day: true }),
    "calendar.work": st("calendar.work", "on", { message: "Standup", start_time: day + " 09:30:00", all_day: false }),
  });
  hass.locale.time_format = "24";
  const el = mount(w, { type: "x", entities: ["calendar.family", "calendar.work"] }, hass);
  const byTitle = Object.fromEntries(rows(el).map((r) => [r.title, r.body]));
  check("all day events have no time", byTitle.Holiday, "today");
  check("24 hour clock from the profile", byTitle.Standup, "today at 09:30");
}

console.log("\n# editor writes only what differs");
{
  const w = makeWindow();
  const ed = w.document.createElement("notification-card-editor");
  const hass = makeHass({ "sensor.dinner": st("sensor.dinner", "Lasagne", { friendly_name: "Dinner", recipe: { name: "Lasagne" } }) });
  ed.setConfig({ type: "custom:notification-card", entities: [{ entity: "sensor.dinner", actions: [{ label: "Cook" }] }] });
  ed.hass = hass;
  const form = ed.querySelector("ha-form");
  const schemaBefore = form.schema;
  ed.hass = { ...hass };
  check("a state update does not rebuild the form", form.schema === schemaBefore, true);
  let written = null;
  ed.addEventListener("config-changed", (e) => (written = e.detail.config));
  const value = JSON.parse(JSON.stringify(form.data));
  value.options["sensor.dinner"].background = true;
  value.options["sensor.dinner"].name = "";
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value } }));
  check("options merged, defaults left out, YAML only keys kept", written, {
    type: "custom:notification-card",
    entities: [{ entity: "sensor.dinner", background: true, actions: [{ label: "Cook" }] }],
  });
}

console.log("\n# loading the file twice");
{
  const w = makeWindow();
  let error = null;
  try {
    w.eval(fs.readFileSync(SRC, "utf8").replace(/^const /gm, "var "));
  } catch (e) {
    error = e.message;
  }
  check("no error, one picker entry", [error, w.customCards.length], [null, 1]);
}

(async () => {
  console.log("\n# repairs");
  {
    const w = makeWindow();
    const issues = [
      {
        domain: "zwave_js",
        issue_id: "old_firmware",
        severity: "warning",
        created: "2026-09-21T08:00:00+00:00",
        translation_key: "old_firmware",
        breaks_in_ha_version: "2026.12",
      },
      { domain: "cloud", issue_id: "legacy", severity: "critical", created: "2026-09-21T07:00:00+00:00" },
      { domain: "hue", issue_id: "ignored_one", severity: "error", created: "2026-09-21T07:00:00+00:00", ignored: true },
      { domain: "hue", issue_id: "gone", severity: "error", created: "2026-09-21T07:00:00+00:00", active: false },
    ];
    const asked = [];
    const hass = makeHass({}, {
      wsReply: () => ({ issues }),
      loadBackendTranslation: (category, domains) => {
        asked.push([category, domains]);
        return Promise.resolve((k) => (k.includes("old_firmware") ? "Z-Wave firmware is out of date" : ""));
      },
    });
    const el = mount(w, { type: "x" }, hass);
    await new Promise((r) => setTimeout(r, 0));
    check("repair rows", rows(el).map((r) => [r.title, r.body, r.tile]), [
      ["Legacy", "", "rtile crit"],
      ["Z-Wave firmware is out of date", "Stops working in 2026.12", "rtile warn"],
    ]);
    check("issue translations are requested", asked, [["issues", ["zwave_js", "cloud"]]]);
    el.shadowRoot.querySelectorAll(".row .x")[0].click();
    check("ignore issue", hass.calls.filter((c) => c[0] === "ws").length > 0, true);

    const guest = makeHass({}, { wsReply: () => ({ issues }), user: { id: "u2", is_admin: false } });
    mount(w, { type: "x" }, guest);
    await new Promise((r) => setTimeout(r, 0));
    check("no repairs request for non-admins", guest.calls.some((c) => c[1] === "repairs/list_issues"), false);

    const off = makeHass({}, { wsReply: () => ({ issues }) });
    const el2 = mount(w, { type: "x", repairs: false, hide_when_empty: false }, off);
    await new Promise((r) => setTimeout(r, 0));
    check("repairs off", rows(el2).length, 0);
  }

  console.log("\n" + pass + " ok, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})();
