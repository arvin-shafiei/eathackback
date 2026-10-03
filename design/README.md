# design

Design language pulled from `clubmaxxing/octopus` (pregame): an ngl.link-style look with a loud brand gradient, sticker type, chunky 3D UI with ink outlines and solid ledges, and glossy 3D objects floating around. Copy is lowercase and casual.

- `design-language.md`: tokens, components and rules (the source of truth)
- `components-reference/`: original React Native components plus `tokens.ts`, and the web `globals.css`. Port these to web/R3F; don't import them directly.
- `reference/`: visual reference screenshots (ref-01..17, dob/, tinder/)

How it maps onto the store sim: a brand gradient on the hero/primary action only, Card3D panels for the divergence and why-panels, Sticker badges for "walked past" / "picked" / "agent pick", and a chunky Press3D button for "rearrange + re-run". The 3D store itself is the hero floaty.
