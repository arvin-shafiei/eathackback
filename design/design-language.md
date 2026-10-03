# pregame design language

ngl.link-inspired: loud brand gradient, sticker type, chunky 3D UI, glossy 3D objects floating around.
Copy is always lowercase and casual. There are no host or guest roles. Everyone can post a pres and ask to join
other people's, so say "your pres" and "people asking to join", never "host" or "guest".

## Tokens (`mobile/src/design/tokens.ts`)

| token | value | use |
|---|---|---|
| `gradients.brand` | `#FF4079 → #FE831B`, vertical (180deg) | sign-in bg, profile header, primary buttons, + button, IN stamp, open badges |
| `gradients.soft` | blush → peach → cream | default page wash behind white cards |
| `gradients.fire/night/sunset` | ngl secondaries | sparingly, for variety |
| `colors.ink` `#141014` | outlines, ledges, dark buttons |
| `colors.pink` `#ED1980`, `hotPink`, `orange`, `magenta` | brand accents; `magenta` is the ledge under gradient buttons |
| `colors.blush / cream / peach / surfaceDim / line` | warm neutrals, field fills and outlines inside cards |
| `depth.card 6 · button 5 · chip 4 · sticker 3 · border 2` | 3D ledge heights and outline width |
| `ledge(d, color)` | boxShadow string: solid offset ledge + soft warm drop shadow |
| `fonts.display` | Baloo 2 ExtraBold, for titles, names, numbers and button labels |
| `fonts.*` (Inter 500–900) | body, labels, captions |

Custom fonts select their face by family name, so never set `fontWeight` together with a `fonts.*` family.

## Components (`mobile/src/design`)

- **StickerTitle**: white display text with a thick black outline and a ledge, like the ngl logo. It's built from a ring of offset copies because iOS has no text stroke. Use it for screen titles and the logo, and give it a slight `tilt`.
- **Press3D**: the core pressable. It has an outlined face on a solid ledge; on press the face sinks onto the ledge and fires a light haptic.
- **ChunkyButton**: a capsule built on Press3D. `brand` is the gradient with a magenta ledge, `ink` is black with a pink ledge, and `white` has an ink ledge.
- **IconCircleButton**: a round Press3D. The tones are `light`, `dark`, `brand` and `plain`.
- **Card3D**: the big white rounded card with an ink outline and a 6px ledge. Use it for every content sheet.
- **ChipCard / Sticker / SocialChips**: small outlined capsules and cards on mini ledges. A `brand` Sticker is the "🔓 open" badge.
- **Floaty3D**: a glossy 3D object (`objects3d`) that bobs and wobbles slowly. It's decorative only and respects reduced motion.
- **Backdrop**: `soft` (the default) or `brand`, with an optional brand `headerHeight` band and a `decor` slot for floaties.
- **Avatar**: a tall oval with an ink outline. Big avatars get a ledge.
- **ProfileCard** (`features/cards`): a Tinder-style photo card with segmented bars, tap zones and an "i" sheet. The requests deck and "preview my card" both use it.

## Rules

1. One gradient per view region. Put the gradient on the background or the primary action, not both, except on sign-in.
2. Anything tappable or card-like gets a 2px ink outline and a solid ledge. Flat, borderless boxes are only for fields and rows inside a card.
3. Titles use StickerTitle on soft or brand backgrounds and plain `type.display` inside white cards.
4. Use 3D objects as seasoning. Put 2–5 per hero screen, at angles, partly cropped by the screen edge, and always behind content. Use one as the hero of an empty state.
5. Press feedback is physical. The face sinks onto the ledge with a light haptic. Don't fade on press.
6. The 3D objects in `assets/images/3d` are temporary ngl placeholders. Replace them with our own before launch.
