# HUSH — implementation plan

Working title: **HUSH**. A first-person biometric horror escape game for the DEV
Presage SmartSpectra SDK Challenge.
Deadline: **Nov 22, 2026, 11:59 PM PST**. Started Nov 20, 2026 (inside the entry period).

## Hackathon rules we must satisfy
- Solo entry; development started during the entry period (this repo starts now). Credit every third-party asset and code snippet in `CREDITS.md`.
- Functional SmartSpectra SDK integration that uses **live** signals (we use pulse, breathing, HRV, expressions, blinking and talking).
- Public repo with setup instructions (`README.md`), a demo video, and a DEV post built from the template, tagged `#presagechallenge`.
- A required **Consent and Data Handling** section, plus an in-app opt-in consent screen before the camera opens.
- **No medical, diagnosis or health claims.** Wording is "game signal", never "stress level" as a health fact.
- Never commit the API key. Keep it in `.env`, which is listed in `.gitignore`, and ship a `.env.example`.

## Stack
- Electron (latest stable, >= 28), Node 22, plain ES modules, no heavy framework.
- Three.js (pinned version, installed from npm) for the 3D first-person view.
- `@smartspectra/node-sdk` with the Electron wiring from the official sample:
  https://github.com/Presage-Security/SmartSpectra/tree/main/nodejs/samples/electron-quickstart
  - Main process: `bindSmartSpectraIpc(win)` from `@smartspectra/node-sdk/main`. Preload: `require.resolve('@smartspectra/node-sdk/preload')`. Set `contextIsolation: true` and `sandbox: true`. The permission handler grants `media` only to `file://`. The CSP includes `worker-src 'self' blob:`.
  - Renderer: `SmartSpectraSDK` from `@smartspectra/node-sdk/renderer`, with `requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...faceMetrics]` and `enableTelemetry: false`.
  - Decode with `decodeMetrics` from `@smartspectra/node-sdk/messages`. Field names may be camelCase or snake_case, so check at runtime and log the first decoded object once.
  - Values: `cardio.pulseRate.at(-1).value/confidence`, `breathing.rate`, `cardio.hrv.at(-1).rmssd`, `face.expression.at(-1).scores` (FEAR=4, SURPRISE=8), `face.blinking.at(-1).detected` and `face.talking.at(-1).detected`.
  - Show `validationStatus` hints (for example "no face found") in the HUD.
  - Handle the `error` event: `kAuthenticationFailed` and `kCreditExhausted` show a clear message and offer simulation mode.
- The API key comes from `.env` (`PRESAGE_API_KEY`), loaded in main and passed to the renderer through a tiny contextBridge (or via whatever the SDK's preload pattern expects; follow the sample).

## Gameplay
1. **Consent screen**, then a **calibration** step of about 20 s (sit still, breathe normally). Record the baseline pulse and breathing rate.
2. **Procedural house**, regenerated every run (seeded RNG, seed shown on screen):
   - Grid-based BSP or room-and-corridor generator: 6–10 rooms (bedroom, kitchen, hall and so on) connected by doors.
   - One **exit door** placed far from the spawn (pick the room with the largest BFS distance). The exit is locked until the player finds the **key**, which spawns in a random far-ish room.
   - Furniture props scattered per room. **Hiding spots** (wardrobes or under beds) where the creature can't see you, but it can still hear your pulse.
3. **Player**: WASD plus mouse look (pointer lock), Shift to sprint, C to crouch, F to toggle the flashlight, E to interact or hide.
4. **Creature AI** works on the same grid with A* pathfinding. States are `WANDER` → `INVESTIGATE` (goes to the last noise position) → `HUNT` (has line of sight or high noise) → `CATCH`. Catching the player means game over with a jump-scare.
   - **Noise meter** (0–100) is what the creature "hears". It's a weighted sum:
     - heart rate above baseline (main factor, about +4 per BPM over +5)
     - breathing rate above baseline
     - low HRV (rmssd falling versus baseline) gives a small bonus
     - FEAR or SURPRISE expression confidence spikes give a short burst
     - TALKING detected gives a big burst ("it heard you whisper")
     - movement: sprint is high, walking is medium, crouching is low, standing still is zero
     - flashlight on: visible within line of sight
   - Hearing radius scales with noise. Above a threshold the creature gets your exact position. Below it, the creature gets a fuzzy one.
   - **Eyes closed** (blinking held for 1 s or more) dims the screen and slowly lowers noise. This is the calm-down mechanic, a nod to PULSE but used as a tactic, not the whole game.
5. **Win**: unlock the exit, then a "you escaped" screen with run stats (time, peak pulse, times hunted). **Lose**: caught.
6. **Simulation mode** (key `M`, or automatic fallback if there's no camera or key). Synthetic signals react to gameplay, and the HUD shows "SIMULATED" clearly. Judges must be able to test without a key, but the default is live.

## Presentation
- Dark, foggy, flashlight cone (SpotLight), PBR textures for walls, floors and doors.
- HUD: a small webcam picture-in-picture with a heartbeat waveform, live BPM and breaths/min, the noise meter, the key icon, and validation hints.
- Audio: Web Audio heartbeat synced to the **live** BPM, plus an ambient drone, creature footsteps and growl played with positional audio (THREE.PositionalAudio), door creaks and a jump-scare sting.

## Free assets (CC0 preferred; record license and URL in CREDITS.md)
Use any downloaded file only if its license is verified CC0 or CC-BY (credit CC-BY).
- Textures: **Poly Haven** (CC0). The API is `https://api.polyhaven.com/files/<asset_id>`, using the 1k jpg diffuse, normal and roughness maps. Candidates are a wood floor, wallpaper or plaster, and a wooden door.
- Models: **Kenney** (CC0), e.g. Furniture Kit (kenney.nl/assets/furniture-kit), and **Quaternius** (CC0) for furniture and a monster. If direct download isn't scriptable, build the props from primitives and make the creature procedurally (a tall, thin, dark silhouette with glowing eyes and jittery limb animation). That reads as scary in the dark anyway.
- Sounds: **Kenney audio packs** (CC0, e.g. Impact Sounds, RPG Audio) and/or CC0 sounds from OpenGameArt or Freesound (CC0 filter only). Fall back to procedural Web Audio for anything missing.
- Store under `assets/{textures,models,audio}/`. Keep the total under about 50 MB.

## Repo layout
```
hush/
  package.json  .gitignore  .env.example  README.md  CREDITS.md  LICENSE (MIT)  PLAN.md
  src/main/main.js            Electron main, SDK IPC binding, permissions, CSP
  src/renderer/index.html
  src/renderer/app.js         screen flow: consent -> calibrate -> play -> end
  src/renderer/biometrics.js  SDK wrapper + simulation; emits a normalized {bpm, br, rmssd, fear, talking, eyesClosed, confidence}
  src/renderer/noise.js       noise model
  src/renderer/levelgen.js    seeded procedural house
  src/renderer/world.js       Three.js scene building from the level
  src/renderer/player.js      controls
  src/renderer/creature.js    AI + A*
  src/renderer/audio.js
  src/renderer/hud.js
  assets/...
  docs/SUBMISSION.md          draft DEV post following the template sections
```

## Milestones
1. Scaffold, plus the SDK live-metrics debug overlay working (this is the riskiest part, so do it first).
2. Level generation, world building, player walking with flashlight.
3. Creature AI and noise model, simulation mode.
4. Biometrics wired into noise, calibration, consent, HUD.
5. Assets, audio, polish, win and lose screens.
6. README, CREDITS, SUBMISSION.md draft.
