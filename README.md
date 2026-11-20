# HUSH

**A first-person horror escape game that listens to your pulse.**

You are locked in a dark house with a creature that cannot see well but hears everything. Find the key, unlock the exit and get out. Your webcam (through the Presage SmartSpectra SDK) and, optionally, your microphone feed a "noise" meter: a racing pulse, fast breathing, a gasp, a whisper or a cough all make noise the creature can follow. Staying calm, hiding and even closing your eyes become real tactics. No camera or key? A simulation mode lets anyone play.

<!-- screenshot -->

## Features

- **A new house every run.** The layout is generated from a seed (shown on screen): 6-10 rooms, furniture, one key and one locked exit door placed in the farthest edge room.
- **Hiding spots that matter.** Wardrobes, beds, lockers, closets, curtains and big crates (every room except the start room has at least one). Inside you get a locked view with a small peek range. If the creature saw you go in, or your noise is above 70, it walks over and searches the spot for a few seconds, then catches you if you are still too loud, or gives up.
- **Creature AI on a tile grid (A\* pathfinding).** States: `WANDER`, `INVESTIGATE` (goes to where it heard something), `HUNT` (sees you or hears your exact position), `SEARCH` (checks a hiding spot) and `CATCH`.
- **Biometric signals** from the SmartSpectra SDK: pulse rate, breathing rate, HRV (rmssd), fear/surprise expression, blinking (eyes closed) and talking.
- **Microphone sound events (optional).** Loud sounds you make create a sound event at your position that the creature investigates, or hunts if it is loud.
- **Scare director.** Random jump scares every 45-120 s (more frequent as the run goes on), never during a chase or a catch, never the same one twice in a row: lights out, door slam, whisper, a figure in a doorway, a crash in another room, a hand on the wall, a doubled heartbeat, a music box. Each has procedural audio. They are designed to make you jump, and your reaction feeds the noise meter.
- **Simulation mode** with synthetic signals that react to gameplay, for playing without a key or camera.
- **End-screen stats:** time, peak pulse, times hunted, seed, signal source, a pulse graph with scares marked and your "biggest scare".
- Procedural audio (heartbeat synced to your BPM, drone, footsteps, growl, creaks, stings) and CC0 PBR textures; props and the creature are built from primitives.

## How your body controls the game

These are **game signals**, not measurements for any other purpose. All values are relative to a baseline recorded during a ~20 s calibration at the start.

| Signal | Effect on the game |
|---|---|
| Pulse rate | Main noise source: roughly +4 noise per BPM above your baseline + 5 (capped) |
| Breathing rate | Smaller noise bonus when above your baseline |
| HRV (rmssd) | Small bonus when it drops below your baseline |
| Fear / surprise expression | A short noise burst when the score jumps above 40 |
| Talking | A big noise burst ("it heard you whisper") |
| Blinking held 1 s or more (eyes closed) | The screen dims, noise is cut sharply and falls faster: the calm-down tactic |
| Microphone level (optional) | Sustained level above your room's noise floor adds noise; sudden loud onsets create a sound event the creature goes to |
| Movement | Sprint is loud, walking medium, crouch-walking low, standing still zero |
| Flashlight | On: a little extra noise, and the creature can see you from far away in line of sight |
| Hiding | Noise is reduced while hidden; holding your breath removes breathing noise but strains after ~6 s |

The creature's hearing radius grows with noise. At 60+ noise it knows exactly where you are; below that it only gets a fuzzy position. Scares can spike your real pulse, which makes you louder.

## Controls

| Key | Action |
|---|---|
| `W` `A` `S` `D` | Move |
| Mouse | Look (the mouse is captured while playing) |
| `Shift` | Sprint (loud) |
| `C` | Toggle crouch (quiet, slow) |
| `F` | Toggle flashlight |
| `E` | Take the key, hide in / leave a hiding spot, unlock the exit |
| `Space` (hold, while hidden) | Hold your breath |
| `Esc` | Release the mouse and pause. This stops the camera and microphone |
| `M` | Switch between live and simulation mode while playing |
| `B` (hold) | Simulation mode only: close your eyes |
| `T` (hold) | Simulation mode only: whisper (talking) |
| `V` | Make a loud noise (fake mic spike) |

## Requirements

- **OS:** Windows 10/11 x64 (the version this was developed and tested on), macOS arm64, or Linux x64/arm64 (the platforms the SmartSpectra SDK ships runtimes for; only Windows has been tested here)
- **Node.js** 20 or newer (22 tested) and **pnpm** 10
- A **webcam** for live mode, and optionally a **microphone**
- Optional: a **Presage API key** for live mode (free to register at https://physiology.presagetech.com/auth/register). Simulation mode needs none.

## Local setup

```
git clone <this repository>
cd hush
pnpm install
```

If Electron fails to start because its binary is missing (pnpm can skip the download script), run:

```
node node_modules/electron/install.js
```

**Provide a Presage API key (optional, for live mode), either way:**

1. **In the app:** paste it into the "Presage API key" box on the consent screen (or the pause screen) and press "Use key". It is kept for the session only unless you tick "Remember on this device", which saves it encrypted with your OS keystore (Electron `safeStorage`). "Clear saved key" removes it.
2. **With `.env`:** copy `.env.example` to `.env` and set `PRESAGE_API_KEY=your_key`. `.env` is git-ignored; never commit it.

Precedence: key entered this session, then saved key, then `.env`, then simulation only. A status line shows which is in use (with a masked hint of the last 4 characters).

Then start the game:

```
pnpm start
```

On first launch you will see:

1. **Consent screen:** choose "I agree - use my camera (live)" or "Play in simulation mode". There is a separate, unchecked-by-default box to opt in to the microphone. Nothing is opened before you choose.
2. **Calibration (~20 s in live mode):** sit still, face the camera and breathe normally. The game records your resting pulse, breathing and HRV (and the room's noise floor, if the mic is on). Simulation mode calibrates in a few seconds.
3. **Controls screen**, then click to enter the house.

## Simulation mode

No camera or API key needed. Press "Play in simulation mode" on the first screen, or press `M` in game. Synthetic pulse, breathing, HRV and fear react to what you do (sprinting, the creature getting close, being hunted, scares), and the HUD shows **SIMULATED**. Use `B` to close your eyes, `T` to whisper and `V` to make a loud noise.

## Scripts

| Command | What it does |
|---|---|
| `pnpm start` | Bundles the renderer with esbuild, then launches Electron |
| `pnpm run build` | Only bundles the renderer into `dist/` |
| `pnpm test` | Unit tests: level generation (50 seeds: key, exit and hiding spots reachable, no door blocked), mic onset/threshold logic, scare scheduling rules, API-key precedence/masking |
| `pnpm assets` | Re-downloads the CC0 Poly Haven textures into `assets/textures/` |

Smoke test (runs a simulated session: triggers every scare, a fake mic spike, a hiding/search sequence and a fake session key, then exits with code 0 on pass):

```
# bash
HUSH_SMOKE=1 node_modules/.bin/electron .
# PowerShell
$env:HUSH_SMOKE='1'; node_modules\.bin\electron.cmd .
```

Set `SMARTSPECTRA_DIAGNOSTICS=1` before `pnpm start` to open DevTools alongside the game.

## Troubleshooting

- **"No face found", "Too dark", "Hold still", "Move closer" etc.** These hints come from the SDK and appear in the HUD/calibration screen. Face the camera, light your face evenly from the front, keep your head still and roughly centred. Calibration only counts time when a valid pulse is detected.
- **"Key rejected by Presage".** The key is wrong or revoked. Re-enter it in the key box (or fix `.env`). You can keep playing in simulation mode.
- **"This key has no credits left".** Your account is out of credits; use simulation mode or another key.
- **Live mode button is disabled.** No API key is set (add one in-app or in `.env`), or the SDK failed to load (the reason is shown under the buttons).
- **Electron does not launch** (missing binary or a "failed to install" error): run `node node_modules/electron/install.js`, then `pnpm start` again. Make sure you ran `pnpm install` (approved build scripts are configured in `package.json`).
- **Camera in use by another app / "Requested device not found".** Close other apps using the webcam (video calls, other browsers), check your OS camera privacy settings, and retry. HUSH reports the error and you can fall back to simulation mode.
- **Microphone unavailable.** Check the OS microphone permission; the game continues without it.

## Privacy and consent

- The **camera** opens only after you press the opt-in button on the consent screen. The **microphone** is a separate opt-in, off by default.
- The microphone is analysed **in memory only**: just a sound level number is computed. Audio is never recorded, stored or uploaded.
- The app itself stores and uploads nothing. Video processing is handled by the Presage SmartSpectra SDK under Presage's privacy policy: https://api.physiology.presagetech.com/privacypolicy
- SDK telemetry is disabled (`enableTelemetry: false`).
- Your **API key** is only ever sent to Presage by the SDK. A key typed into the app lives in memory unless you opt in to "Remember on this device" (encrypted with the OS keystore, never in browser storage). If secure storage is unavailable it stays session-only. The UI and logs show at most the last 4 characters.
- Pressing `Esc` (or reaching the end screen) stops the camera and microphone.
- HUSH is a game for entertainment. It is not a medical device, does not diagnose anything and makes no health claims.

## Project structure

```
hush/
  package.json  pnpm-lock.yaml  .env.example  LICENSE  CREDITS.md  README.md
  src/
    main/
      main.cjs            Electron main: SDK IPC binding, permissions, .env, key storage IPC
      hush-preload.cjs    exposes the narrow key API (hushKeys) and config to the renderer
      keylogic.cjs        key precedence, masking, validation, link allow-list
    renderer/
      index.html          screens, HUD, styles, CSP
      app.js              screen flow, game loop, smoke-test hook
      biometrics.js       SmartSpectra SDK wrapper + simulation
      noise.js            noise model
      mic.js, micLogic.js microphone level meter and onset logic
      levelgen.js         seeded procedural house
      world.js            Three.js scene
      player.js           controls and hiding view
      creature.js         creature AI states
      pathfind.js         A* and line of sight
      scares.js           scare director and scares
      audio.js            procedural Web Audio
      hud.js, keyui.js    HUD helpers and the API-key panel
  scripts/                build.mjs (esbuild), fetch-assets.mjs
  test/                   levelgen, mic, scares, keystore tests
  assets/textures/        CC0 Poly Haven textures + SOURCES.json
```

## Credits

Textures are CC0 from Poly Haven; the SmartSpectra SDK, Electron, three.js and esbuild are used as dependencies. See [CREDITS.md](CREDITS.md) for the full list with authors and licenses.

## License

The HUSH source code is MIT licensed (see [LICENSE](LICENSE)). The `@smartspectra/node-sdk` package is proprietary to Presage Technologies, is used under Presage's Terms of Service and is **not** covered by this license.
