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
  submission/post.md          draft DEV post (kept local, git-ignored)
```

## Iteration 2 (requested Nov 20)

### A. Hiding spots as a real mechanic
- Spot types: wardrobe, bed (crawl under), locker, closet, curtain and big crate. Generate 2–3 per room on average, with at least 1 in every room except the spawn room. Corridors get an occasional locker.
- Readable in the world. Show an "[E] Hide" prompt when you're within 1.2 m and looking at a spot. Give spots a subtle rim or glow on approach.
- Hidden view: the camera locks inside, with a slatted or dark overlay and a limited peek (small mouse-look range). Press E to exit.
- Rules:
  - The creature can't see a hidden player.
  - If it saw you enter, or your noise is above 70 while hidden, it walks to the spot and **searches** it: a 2–3 s tense search animation and sound, then a catch if noise is still above the threshold. Otherwise it gives up and leaves.
  - The real win condition while hidden is calming your pulse and keeping quiet. Hold Space for "hold breath", which cuts breathing noise but makes noise spike after 6 s.
- Update levelgen and its tests: every hiding spot is reachable and not blocking a doorway.

### B. Microphone control: real sound attracts the creature
- Ask for the microphone on the consent screen as a **separate opt-in checkbox**, off by default and explained clearly. Use getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}}). Analyse levels only with an AnalyserNode (RMS → dBFS). **Never record, store or upload audio.**
- Calibration measures the room noise floor during the existing 20 s. Mic noise counts only how far you are above that floor. Use a short attack and slower release smoothing.
- Feed the noise model in two ways:
  - Continuous level adds to noise.
  - Spikes such as a cough, clap or speaking create a **sound event at the player's position**, with a radius scaled by loudness. The creature goes to INVESTIGATE at that spot, or HUNTs if loud. SDK `talking` stays as a separate signal that confirms speech.
- HUD: a small mic level bar with the threshold line, plus an on-screen "it heard that" cue. Esc or pause stops the mic tracks, as with the camera. Simulation key `V` fakes a loud noise.
- Electron: make sure the permission handler allows `media` (audio) for file://, and the CSP doesn't block it. Update the consent text, README and submission/post.md "Consent and Data Handling" for the mic.

### C. Scare director: random jump scares
- A `scares.js` module. A director picks a random scare every 45–120 s. It has a cooldown, never fires during a chase or catch, and never repeats the same scare twice in a row. Scare intensity rises as the run goes on.
- Scares (each with its own procedural Web Audio sting or sound effect):
  1. Lights flicker and go out for 2 s; the flashlight sputters.
  2. A door nearby slams shut.
  3. A whisper in one ear (panned left or right) that sounds like breathing or your name.
  4. The creature's silhouette flashes at the end of a corridor or in a doorway for about 0.3 s and is gone (a fake creature, not the real AI).
  5. A loud object falls or crashes in a nearby room. This is also a real sound event that pulls the creature there.
  6. A hand slams the window or wall, with a camera shake.
  7. The heartbeat audio suddenly doubles plus a screen pulse, for a "something is behind you" moment.
  8. A radio or music box that suddenly starts playing distorted, then stops.
- Goal: make the player's real pulse spike, which feeds the noise model, so scares are dangerous as well as cosmetic. Log scare times and show them on the end screen next to the pulse graph ("Biggest scare: door slam, +18 BPM"). This is a game stat, not a health claim.
- The jump-scare frequency setting is honoured if one is added later. For now, a `scares` toggle in settings or code constant.

### D. Remove hackathon or contest mentions from the app
- Remove "Challenge entry" wording from `package.json` description and the `README.md` header line, and anything user-facing in-game. Keep `submission/post.md` and PLAN.md as they are; they're not shipped in the app.

### E. Bring your own API key
- An in-app key field on the consent and settings screens, with show/hide, "remember on this device" (off by default) and "clear saved key".
- Precedence: session key, then saved key, then .env, then simulation.
- Saved only through Electron safeStorage (encrypted) in userData, never in localStorage. The renderer only ever sees a masked hint. The key is never logged.
- Rejected key or no credits: show a clear message and offer simulation.

## Milestones
1. Scaffold, plus the SDK live-metrics debug overlay working (this is the riskiest part, so do it first).
2. Level generation, world building, player walking with flashlight.
3. Creature AI and noise model, simulation mode.
4. Biometrics wired into noise, calibration, consent, HUD.
5. Assets, audio, polish, win and lose screens.
6. README, CREDITS, submission/post.md draft.
