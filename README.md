# Notification Hub Card

One card for everything Home Assistant wants to tell you: persistent
notifications, pending updates, weather warnings, calendar entries and any
entity you point it at. Collapsed it shows the top item, tapped it opens the
list. When nothing is left it hides itself.

## Install

HACS → three dot menu → *Custom repositories* → add
`https://github.com/hazymorning/Notification-Card` as type **Dashboard**, then
install *Notification Hub Card*.

<details>
<summary>Manual install</summary>

Copy `dist/notification-hub-card.js` to `config/www/` and add the resource:

```yaml
url: /local/notification-hub-card.js
type: module
```

</details>

## Use

```yaml
type: custom:notification-hub-card
```

> [!TIP]
> That is already a working card. System notifications and pending updates are
> picked up on their own, and everything below can be clicked together in the
> visual editor instead of written by hand.

| Option | Default | |
| --- | --- | --- |
| `hide_when_empty` | `true` | Hide the card while there is nothing to show |
| `updates` | `true` | Include `update.` entities with a pending update |
| `entities` | `[]` | Extra entities, as ids or as objects |
| `label` | | Include every entity carrying this Home Assistant label |
| `audience` | | Limit a single source to certain people |
| `styles`, `css` | | CSS properties per element, or a plain stylesheet |

<details>
<summary><b>Entities</b> — per entity options, auto detection</summary>

```yaml
entities:
  - sensor.dwd_weather_warnings
  - entity: calendar.family
    name: Family
  - entity: sensor.doorbell
    type: generic
    icon: mdi:doorbell
    actions:
      - label: Open
        tap_action:
          action: perform-action
          perform_action: lock.open
          target:
            entity_id: lock.front_door
```

| Key | |
| --- | --- |
| `entity` | Entity id, required |
| `type` | `auto`, `calendar`, `update`, `dwd`, `recipe` or `generic` |
| `name`, `icon` | Replace title and icon |
| `image` | Image URL or attribute path, e.g. `recipe.image` |
| `tap_action` | Runs when the row is tapped, same syntax as other cards |
| `actions` | Buttons in the row, each with `label` and `tap_action` |

With `type: auto` the card decides by itself: calendar entities show a running
event, update entities get an install button, DWD warnings become one row per
warning, anything with a `recipe` attribute shows the dish. The rest is read as
a plain entity and only shows up while it is `on`, `active` or a number above
zero. `type: generic` also lets text states through.

</details>

<details>
<summary><b>Audience</b> — who sees what</summary>

`only` lists who sees a source, `except` lists who doesn't. Keys are `system`,
`updates` or an entity id.

```yaml
audience:
  system:
    only:
      - person.anna
  sensor.dwd_weather_warnings:
    except:
      - person.kid
```

People are matched through the user account linked in *Settings > People*. The
filter is off while the dashboard editor is open, so you can still see what you
are configuring.

</details>

<details>
<summary><b>Styling</b></summary>

```yaml
styles:
  card:
    border-radius: 24px
  row_title:
    font-size: 15px
css: |
  .row { border: 1px solid var(--divider-color); }
```

Element names: `card`, `header`, `tile`, `badge`, `title`, `message`,
`chevron`, `list`, `footer`, `clear`, `bar`, `count`, `row`, `row_tile`,
`row_title`, `row_message`, `time`, `dismiss`, `action`.

</details>

> [!NOTE]
> System notifications and updates are dismissed in Home Assistant itself
> (`update.skip`). Everything else is only dismissed on the device you are
> looking at, and comes back as soon as its content changes.

MIT
