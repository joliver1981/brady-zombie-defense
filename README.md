# 🧟 Brady's Zombie Defense

A 3D zombie defense game built with Three.js — designed by Brady, built by Claude.

Rescue caged people to earn 💵 money, 💎 diamonds and ♦ emeralds. Spend them on
turrets, weapons, food, traps — and costumes for your turrets!

## How to run

Any static web server works (an internet connection is needed the first time, to load Three.js from a CDN):

```
npm start
```

then open http://localhost:4173 — or use any other static server in this folder.

## How to play

| Control | Action |
| --- | --- |
| WASD / Arrows | Move |
| Mouse + Click | Aim + attack |
| 1–6 | Switch weapon (Fists / Bat / Crowbar / Zapper Gun / Repair Hammer / Robot Suit) |
| B | Open the shop |
| N | Start the next wave early |
| Esc | Close shop / cancel placement |

Walk up to caged people to rescue them. Protect your 🏠 base — if it falls, it's game over!

## The 11 zombies

1. **Normal zombie** — attacks turrets
2. **Buff zombie** — does bigger damage
3. **Fast zombie** — moves quickly
4. **Stone headed zombie** — has a lot of HP, headbutts turrets doing big attacks
5. **Fire zombie** — lights turrets on fire 🔥
6. **Soccer zombie** — targets the most powerful turret and kicks a soccer ball at it, stunning it for 10 seconds
7. **Sword zombie** — hits 2 turrets at a time doing bigger damage
8. **Axe zombie** — spins and attacks turrets doing gigantic attacks really fast
9. **Baseball zombie** — blocks 5 attacks with its bat, throws baseballs at turrets ⚾
10. **Hockey zombie** — has high HP and blocks 7 attacks 🏒
11. **Hacker zombie** — hacks turrets; hacked turrets shoot other turrets 💻
12. **Acid zombie** 🧪 — coats turrets in acid that keeps doing continuous damage
13. **Dust zombie** 🌪️ — spawns 3 small sandstorms that wreck turrets for 3 seconds (desert only)

## 🤖 Squad & upgrades

- **Rescued people join your squad** (up to 3) — they grab a bat, crowbar or zapper and fight for you!
- **Helper Robot** ($300) — give it the Repair Hammer to fix turrets, or a bat/crowbar to bonk zombies
- **Robot Suit** ($1000, key 6) — SOOPER strong: punches for 55 (legendary-turret damage) and halves damage you take
- **Acid Turret** ($500) — shots keep burning zombies with acid after the hit
- **Base levels 2–5** — barbed wire → stronger walls → mega base with towers → a real **CASTLE** 🏰 (2000 HP)
- **Loot buildings** 💰 — appear every couple of waves; walk up for big money and a FREE turret
- The **Mustard turret shoots actual mustard** (ketchup one shoots ketchup); new **Cowboy** and **Scientist** costumes

## 🏜️ The Desert (wave 20+)

Reach wave 20 and the world turns to desert — sand, cacti, pyramids. Every 5th wave
from 20, the **BOSS** appears: a SUPER big **Infected Sand Worm** with sharp teeth that

- makes 1 **giant sandstorm**,
- causes **earthquakes** (screen shakes, all turrets take damage),
- **summons 5 dust zombies** at a time,
- and **slashes at the player** when you get close.

Beating it drops 💵300, 💎5 and ♦5.

New desert gear:
- **Dust Turret** (7 ♦) — shoots sand that pushes zombies back, 25% chance to stun them
- **Repair Hammer** 🔨 ($200) — whack your turrets to heal them +20 HP

## Turrets

Five rarities: **Common → Uncommon → Rare → Epic → Legendary**.
Common/Uncommon/Rare cost money; Epic and Legendary cost emeralds.

Each rarity has a **costume** (bought with diamonds) that dresses up every turret of
that rarity and gives +10% damage — including the famous **Mustard Costume** for the
common turret (20 💎).

## Performance & graphics

The game adapts to your computer automatically:

- It measures how long each frame takes and steps graphics down (High → Medium → Low → Potato)
  if your machine can't keep up. Software/remote-desktop graphics start on Potato automatically.
- The 🖥️ button (top right) lets you pick a setting yourself; your choice is remembered.
- If frames ever get *really* slow, the game pauses itself and shows a "Whoa, slow down!" screen —
  click **Keep Playing** to continue on the lower setting. It will never run away with your computer.
- Internal rendering resolution is capped (no more than ~2 megapixels on High), menus render at a
  gentle 15 fps, and particles are drawn in a single batch.

## Files

- `index.html` / `style.css` — page, HUD, shop UI
- `js/config.js` — all game numbers (zombie/turret/weapon stats, waves, prices)
- `js/models.js` — every 3D model, built from Three.js primitives (no asset files)
- `js/main.js` — game logic
- `js/audio.js` — synthesized sound effects (no audio files)
- `js/quality.js` — graphics quality governor (resolution cap, auto tiers, panic brake); `node tests/quality.test.js` runs its tests
- `tests/sim/all.mjs` — end-to-end smoke test that runs the whole game under Node (real three.js, stubbed renderer/DOM) in several GPU modes — no browser or GPU needed
