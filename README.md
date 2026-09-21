# Notification Hub Card

A Lovelace card for Home Assistant that keeps notifications in one place:
persistent notifications, pending updates, weather warnings, calendar entries
and any other entity you point it at.

Collapsed, the card shows the top item in a single row. Tap it to open the
list, dismiss items one by one or clear all of them. When there is nothing left,
the card hides itself. No helper entities or template sensors needed.

## Install

### HACS

1. HACS, three dot menu, *Custom repositories*
2. Add `https://github.com/hazymorning/Notification-Card`, type *Dashboard*
3. Install **Notification Hub Card**

### Manual

Copy `dist/notification-hub-card.js` into `config/www/` and add a dashboard
resource:

```yaml
url: /local/notification-hub-card.js
type: module
```

## Use it

```yaml
type: custom:notification-hub-card
```

That is a working card. It picks up system notifications and pending updates on
its own. Everything else is optional and can be clicked together in the visual
editor.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `hide_when_empty` | `true` | Hide the card while there is nothing to show |
| `updates` | `true` | Include every `update.` entity with an update pending |
| `entities` | `[]` | Extra entities to watch, as ids or as objects (below) |
| `label` | - | Include every entity carrying this Home Assistant label |
| `audience` | - | Limit sources to certain people |
| `styles` | - | CSS properties per element |
| `css` | - | Raw CSS, added to the card |

## Entities

Either a plain entity id, or an object with a few extras:

```yaml
type: custom:notification-hub-card
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

| Key | Description |
| --- | --- |
| `entity` | Entity id, required |
| `type` | `auto`, `calendar`, `update`, `dwd`, `recipe` or `generic` |
| `name` | Replaces the title |
| `icon` | Replaces the icon |
| `image` | Image URL or attribute path, e.g. `recipe.image` |
| `tap_action` | Runs when the row is tapped, same syntax as other cards |
| `actions` | Buttons in the row, each with `label` and `tap_action` |

With `type: auto` the card looks at the entity and decides what to do with it:
calendar entities show a running event, update entities get an install
button, DWD warnings become one row per warning, anything with a `recipe`
attribute shows the dish. Everything else is read as a plain entity and only
shows up while it is `on`, `active` or a number above zero. Set `type: generic`
to also let text states through.

## Who sees what

Sources can be limited to people. `only` lists who sees a source, `except`
lists who doesn't. Keys are `system`, `updates` or an entity id.

```yaml
audience:
  system:
    only:
      - person.anna
  sensor.dwd_weather_warnings:
    except:
      - person.kid
```

A person is matched through the user account linked in *Settings > People*. The
filter is off while the dashboard editor is open, so you can still see what you
are configuring.

## Styling

`styles` sets CSS properties on single elements, `css` takes a plain stylesheet
for everything else.

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

## Good to know

- Persistent notifications are dismissed in Home Assistant, updates are skipped
  through `update.skip`. Everything else is only dismissed on the device you are
  looking at, and comes back as soon as its content changes.
- Critical weather warnings stay on top of the list, the rest is sorted by time.
- The card speaks English and German and follows the language of the logged in
  user.

## License

MIT
