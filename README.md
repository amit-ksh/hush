# HUSH

**A first-person horror escape game that listens to your heartbeat.**
Entry for the DEV Presage SmartSpectra SDK Challenge (`#presagechallenge`).

You wake up in a procedurally generated house. A creature hunts you by sound, not sight. Find the key, unlock the exit and get out, but the creature "hears" what your webcam sees: a racing pulse, fast breathing, a gasp of fear, a whispered word. Stay calm, close your eyes for a moment, hide, or run and be heard.

HUSH is a game. The SmartSpectra signals are used as **game signals only**. HUSH is not a medical device and makes no health claims.

## Setup

Requirements: Windows 10/11 (the SmartSpectra SDK ships a win32-x64 runtime; macOS and Linux packages are also installed by the SDK), Node 20+ (tested on Node 22), pnpm 10, a webcam for live mode.

```
pnpm install
pnpm assets          # optional: re-download the CC0 Poly Haven textures (already in the repo)
pnpm start           # bundles the renderer with esbuild, then launches Electron
```

### Live mode (webcam + SmartSpectra)

1. Get an API key from https://physiology.presagetech.com/.
2. Copy `.env.example` to `.env` and set `PRESAGE_API_KEY=your_key`. `.env` is git-ignored; never commit it.
3. `pnpm start`, read the consent screen, press "I agree - use my camera (live)". Calibrate for about 20 s (sit still, face the camera, breathe normally).

### Simulation mode (no key, no camera)

Press "Play in simulation mode" on the first screen, or press `M` in game to switch. Synthetic signals react to gameplay (sprinting, nearby creature, being hunted). The HUD shows **SIMULATED**. In simulation: hold `B` to close your eyes, hold `T` to "whisper".

## Controls

| Key | Action |
|---|---|
| WASD / mouse | move / look |
| Shift | sprint (loud) |
| C | crouch (quiet, slow) |
| F | flashlight (visible from afar) |
| E | take key, hide in wardrobe or bed, open the exit |
| M | switch live / simulation |
| Esc | release mouse, pause, **stop the camera** |

## How signals map to gameplay

The creature reacts to a **noise meter** (0-100), shown at the bottom of the screen.

| Signal (SmartSpectra field) | Effect |
|---|---|
| Pulse rate (`cardio.pulseRate`) above your calibrated baseline | main noise source, about +4 noise per BPM over baseline + 5 |
| Breathing rate (`breathing.rate`) above baseline | smaller noise bonus |
| HRV `rmssd` falling below baseline | small bonus |
| Fear or surprise expression score (`face.expression` types 4 and 8) | short noise burst |
| Talking detected (`face.talking`) | big burst: "it heard you whisper" |
| Blinking held 1 s or more (`face.blinking`) | eyes closed: screen dims and noise drops quickly |
| Your movement (not a biometric) | sprint high, walk medium, crouch low, still zero; flashlight adds a little |

The creature has four states: WANDER, INVESTIGATE (walks to where it heard you), HUNT (it sees you or hears an exact position) and CATCH. Hearing radius grows with noise; above 60 noise it knows exactly where you are, below that only roughly. Hiding stops it seeing you, but if your noise stays above 70 it can still hear your pulse and will open the door.

The heartbeat audio follows your live BPM. The small trace in the HUD is drawn from the current BPM (its shape is illustrative, not a raw signal).

## Privacy and consent

- The camera only opens after you press the opt-in button on the consent screen. `Esc` stops it again; the camera is also stopped on the end screen.
- Telemetry is disabled (`enableTelemetry: false`).
- The app itself stores, records and uploads nothing. Video processing is handled by the Presage SmartSpectra SDK under Presage's privacy policy: https://api.physiology.presagetech.com/privacypolicy
- The API key stays in your local `.env`.
- No health claims: values are shown as game signals, not diagnoses.

## Tests

```
pnpm test            # levelgen: 50 seeds, spawn -> key and spawn -> exit reachable
```

## Layout

```
src/main/main.cjs          Electron main, SDK IPC binding, permissions, .env loading
src/main/hush-preload.cjs  exposes the API key to the renderer
src/renderer/              app flow, biometrics (live + sim), noise, levelgen, world, player, creature, audio, hud
scripts/                   build (esbuild) and asset download
assets/textures/           CC0 Poly Haven textures
docs/SUBMISSION.md         draft DEV post
```

## Credits and license

Code: MIT (see `LICENSE`). Third-party assets and code are listed in `CREDITS.md`.
