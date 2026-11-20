# Credits

HUSH is an original entry; everything below is third-party material it uses.

## Code and SDKs

| Item | Author | URL | License |
|---|---|---|---|
| SmartSpectra Node SDK (`@smartspectra/node-sdk`), used as a dependency | Presage Technologies | https://github.com/Presage-Security/SmartSpectra | Proprietary; used under Presage's Terms of Service (https://physiology.presagetech.com/tos). Not redistributed in this repo. |
| SmartSpectra Electron quickstart sample, used as the reference for the wiring pattern (main-process `bindSmartSpectraIpc`, SDK preload, camera-only permission handler, CSP with `worker-src 'self' blob:`, esbuild bundling of the renderer, `streamAvailable` / `metrics` / `validationStatus` / `error` events). HUSH's code is written independently; no sample files are copied. | Presage Technologies | https://github.com/Presage-Security/SmartSpectra/tree/main/nodejs/samples/electron-quickstart | Proprietary (`LicenseRef-Proprietary` header in the sample); pattern credited here. |
| Electron | OpenJS Foundation / Electron contributors | https://www.electronjs.org | MIT |
| three.js | mrdoob and contributors | https://threejs.org | MIT |
| esbuild (build tool) | Evan Wallace | https://esbuild.github.io | MIT |

The mulberry32 PRNG in `src/renderer/levelgen.js` is a well-known public-domain algorithm (Tommy Ettinger / bryc); the A* and Bresenham routines are standard textbook algorithms written for this project.

## Textures (downloaded by `pnpm assets` into `assets/textures/`)

All from Poly Haven (https://polyhaven.com), license **CC0 1.0** (https://polyhaven.com/license). 1k JPG diffuse, normal (GL) and roughness maps.

| Asset | Author | URL | License |
|---|---|---|---|
| Dark Planks (floor) | Rob Tuytel | https://polyhaven.com/a/dark_planks | CC0 |
| Decrepit Wallpaper (walls) | Rob Tuytel | https://polyhaven.com/a/decrepit_wallpaper | CC0 |
| Rough Pine Door (exit door) | Dimitrios Savva | https://polyhaven.com/a/rough_pine_door | CC0 |
| Grey Plaster (ceiling) | Rob Tuytel | https://polyhaven.com/a/grey_plaster | CC0 |

Authors were read from the Poly Haven API (`https://api.polyhaven.com/info/<id>`); see `assets/textures/SOURCES.json`.

## Models and audio

None. All props, the key and the creature are built from three.js primitives in code, and all sound (heartbeat, drone, footsteps, growl, creaks, sting) is synthesised at runtime with the Web Audio API. No third-party model or sound files are included.
