<div align="center">

# Notification Card

A clean, minimal card for notifications, alerts, and any updates that matter to you.

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5?style=flat-square)](https://hacs.xyz)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-Dashboard%20card-41BDF5?style=flat-square&logo=home-assistant&logoColor=white)](https://www.home-assistant.io)

</div>

![The card collapsed on a dashboard and expanded with two notifications](https://raw.githubusercontent.com/hazymorning/Notification-Card/main/images/dark-and-light-preview.png)

## Install

In HACS: three dot menu > *Custom repositories* > add
`https://github.com/hazymorning/Notification-Card` as type **Dashboard**, then
install *Notification Card*.

<details>
<summary>Manual install</summary>

Copy `dist/notification-card.js` to `config/www/` and add the resource:

```yaml
url: /local/notification-card.js
type: module
```

</details>

## Use

Add a card to your dashboard, pick **Notification Card**, done. In YAML:

```yaml
type: custom:notification-card
```

> [!TIP]
> That is already a working card. System notifications, repairs and pending
> updates are picked up on their own, and everything below can be clicked
> together in the visual editor instead of written by hand.

| Option | Default | |
| --- | --- | --- |
| `hide_when_empty` | `true` | Hide the card while there is nothing to show |
| `updates` | `true` | Include `update.` entities with a pending update |
| `repairs` | `true` | Include open repairs from Settings > System > Repairs |
| `entities` | `[]` | Extra entities, as ids or as objects |
| `label` | | Include every entity carrying this Home Assistant label |
| `audience` | | Limit a single source to certain people |
| `css` | | A stylesheet for the card, see *Styling* |

<details>
<summary><b>Entities</b>: per entity options, auto detection</summary>

```yaml
entities:
  - sensor.dwd_weather_warnings
  - entity: calendar.family
    name: Family
  - entity: sensor.dinner
    background: true
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
| `type` | `auto`, `calendar`, `update`, `alarm`, `alert`, `dwd`, `recipe`, `picture` or `generic` |
| `name`, `icon` | Replace title and icon |
| `image` | Picture URL or attribute path, e.g. `recipe.image` |
| `background` | Also show the picture softly blurred behind the card, see *Pictures* |
| `tap_action` | Runs when the row is tapped, same syntax and behavior as other cards |
| `actions` | Buttons in the row, each with `label` and `tap_action` |

With `type: auto` the card decides by itself: calendar entities show a running
event, update entities get an install button when the integration can install,
alarm panels show up while they are triggered, pending or arming, alert
entities while they are on, DWD warnings become one row per warning, and an
entity with a `recipe` attribute shows what it describes. The rest is read as a
plain entity and only shows up while it is `on`, `active` or a number above
zero. `type: generic` also lets text states through.

All editable in the visual editor under *Entity options*, except `actions`.

</details>

<details>
<summary><b>Pictures</b>: meal plans, books, deliveries, what is playing</summary>

Any row can carry a picture. It comes from `image` when set, otherwise from
the entity itself: `entity_picture` (what template sensors set with `picture:`,
and what media players, cameras and people have), or an `image`, `image_url`,
`picture` or `thumbnail` attribute holding a URL.

Two kinds are made for entities that describe one thing:

- An attribute holding an object with `name` or `title`, `description` or
  `summary`, and `image`. `recipe` is detected on its own, as a meal plan
  sensor would carry it. The row shows the name and the description, or the
  entity's name when there is no description.
- `type: picture` for entities whose state is the thing itself, like a
  template sensor with the dish of the day as its state and a `picture:`. The
  state becomes the title, the entity's name the line below.

```yaml
entities:
  - entity: sensor.dinner          # recipe attribute, found automatically
    background: true
  - entity: sensor.book_of_the_day
    type: picture
    image: cover_url
```

With `background: true` the picture of that entity also fills the card, faint
and blurred, as long as it is the notification on top. Other sources never
change the background. Devices set to reduce transparency or raise contrast
get the card without it.

</details>

<details>
<summary><b>Audience</b>: who sees what</summary>

`only` lists who sees a source, `except` lists who doesn't. Keys are `system`,
`updates`, `repairs` or an entity id.

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
<summary><b>Layout</b>: sections, footer, languages</summary>

Collapsed, the card is exactly one row of a sections view high, so it lines up
with the tile cards next to it. When it hides itself, the section closes the
gap. In the sticky footer of a sections view it stays within the space the
footer allows, and the list scrolls.

Texts follow the language of your profile. English and German are written for
the card; other languages use Home Assistant's own words for notifications,
updates and dismissing. Times follow the 12 or 24 hour setting and the time
zone chosen there.

</details>

<details>
<summary><b>Styling</b></summary>

Sizes, shapes and timings are variables. Set them in `css`, together with
whatever else you want to change.

```yaml
css: |
  :host { --nc-radius: 20px; --nc-pad: 16px; }
  .row { border: 1px solid var(--divider-color); }
```

Variables: `--nc-pad`, `--nc-gap`, `--nc-gap-s`, `--nc-radius`,
`--nc-radius-s`, `--nc-tile`, `--nc-tile-s`, `--nc-head`, `--nc-icon`,
`--nc-muted`, `--nc-quiet`, `--nc-ease`, `--nc-time`, `--nc-focus`,
`--nc-max-height`, and for the background `--nc-bg-opacity` and
`--nc-bg-blur`. The last two also work in a theme.

Classes: `.head`, `.tile`, `.badge`, `.title`, `.msg`, `.ebar`, `.count`,
`.list`, `.row`, `.rtile`, `.body`, `.when`, `.x`, `.act`, `.foot`, `.clear`,
`.backdrop`.

</details>

> [!NOTE]
> System notifications show as plain text, and a tap follows their first link.
> They, updates and repairs are dismissed in Home Assistant itself. Everything
> else is only dismissed on the device you are looking at, and comes back when
> its content changes. Repairs need an admin account, so they stay hidden for
> everyone else.
