# NEON OVERDRIVE

A 2.5D cyberpunk escape game set in San Francisco, 2088. You are driving a stolen **Tesla Roadster 2** through a procedurally generated neon city while the SFPD escalates from patrol cruisers to riot SUVs, roadblocks, spike strips and helicopter air support. The city is sealed: there are **three bay gates** left open, and the only way out is to launch the Roadster onto the escape boat.

Built with plain **HTML5 Canvas 2D + ES modules**. No frameworks, no build step, no external assets — all city geometry, cars, effects, UI and audio are generated in code.

## Run

```bash
cd roadster_game
npm start
```

Then open **http://localhost:5173**.

Alternatively, serve the directory with any static server (the game is just `index.html` + `src/`). ES modules require HTTP, so opening `index.html` directly from disk will not work.

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `←` `→` | Steer |
| `C` / `Ctrl` | Handbrake drift (earns turbo) |
| `Shift` | Rear jet boost (drains turbo) |
| `Space` | Compressed-air jump (costs 26 turbo) |
| `LMB` / `J` | Automatic fire-control lock (no manual aiming) |
| `Q` / mouse wheel | Switch weapon |
| `Esc` / `P` | Pause |
| `R` | Restart after death |
| `M` | Mute audio |
| `H` | Horn |

## Features

- **Escape mission** — the SFPD has sealed the grid; exactly three cyan bay gate routes lead to the waterfront. Pick a lane, hit the pier ramp and land on the cargo ship. Missing the deck puts you back on the pier.
- **Hills and launch ramps** — natural hill crests throw the car without spending turbo; fixed pier ramps handle the final boat jump.
- **Slow-motion action beats** — clearing two or more cruisers in one airborne pass triggers a slow-mo blockade-jump bonus, and the final boat jump gets its own cinematic time dilation.
- **Two turbo abilities** fed by one shared reservoir:
  - **Air jump** — 26 turbo, clears roadblock barriers, spikes and traffic; the Roadster pulls a full 360 flip, and a clean landing earns bonus score, combo and turbo.
  - **Rear boost** — 27 turbo/sec, pushes the Roadster toward 340 km/h with jet flames, speed lines and camera FOV.
  - Turbo is recharged by distance driven, drifting, near misses, ramps, air time and turbo-cell pickups.
- **Escalating police pursuit** — interceptors, fast pursuit cruisers that ram, heavy riot SUVs and surveillance drones. Heat raises spawn rates, aggression, roadblocks and eventually a searchlight helicopter.
- **Roadblocks** — destructible striped barriers, blinking beacons and spike strips. Jump them, shoot them, or thread the gap.
- **Five salvage weapons**, each with limited ammo: Volt SMG, Breach-12 shotgun, Hellfire rocket, Arc Rail and EMP-9.
- **Procedural cyberpunk SF** — open city grid with 16 named districts, landmark towers, rooftop signs, holograms, puddles, neon, rain, flying traffic and a working bay with piers and a cargo ship.
- **Score systems** — drift combos, near misses, air-time bonuses, pickups, kills and a personal best saved in `localStorage`.
- **HUD** — live minimap, SFPD heat stars, speed/gear readout, integrity/shield/turbo bars, weapon wheel, police radio chatter and kill feed.
- **Procedural audio** — synthesized engine, sirens, weapons, impacts and a synthwave loop via WebAudio; no audio files.
- Pause, game-over/victory stats, restart, menu and responsive layout.
- **Occlusion-aware camera** — buildings fade to a ghost cutaway when they would hide the hero car.
- **Performance-aware rendering** — cheap layered glow/shadow shapes instead of canvas blur filters, adaptive internal resolution and sub-stepped simulation keep the action moving at full speed even on software rendering.

## Project layout

```
index.html          HUD / menu / overlay markup
server.mjs          zero-dependency static server
src/main.js         boot + requestAnimationFrame loop
src/game.js         game state, collisions, scoring, pickups, death flow
src/player.js       Roadster physics, drift, turbo, weapons
src/police.js       pursuit AI, roadblocks, helicopters, police fire
src/world.js        procedural city generation and collision
src/renderer.js     isometric painter, cars, buildings, FX, minimap support
src/fx.js           particles, rings, skid marks, floating text
src/audio.js        procedural WebAudio engine/SFX/music
src/hud.js          DOM HUD, minimap, overlays
src/config.js       tuning constants, weapons, cop stats, districts, signs
src/styles.css      cyberpunk HUD and menu styling
```

## Notes

- The escape objective is always east: look for the three cyan gate beacons at the bay and the orange landing chevrons on the ship. The minimap bearing arrow points to the boat.
- Weapons auto-lock the nearest police target in range and lead the shot; the player never aims manually.
- Air targets (drones, helicopters) use elevated shots automatically.
- The game is tuned for desktop keyboard + mouse. The mouse/`J` fires and the wheel swaps weapons.
- No git history or build artefacts are required; the directory is self-contained.
