---
name: verify
description: Build, launch and drive the interactive classroom scene in a real browser to observe rendering, speech, subtitles and per-avatar lipsync.
---

# Verify talking-avatar

Static site, no build step. Babylon.js 6 from `node_modules/` via plain `<script>`
tags — must be served over HTTP, not opened as `file://`.

## Launch

```bash
npm install                          # once
npx http-server -p 8123 -c-1 --silent &
```

Playwright is not a project dep. Install it somewhere scratch, not in the repo:

```bash
cd <scratch> && npm install playwright && npx playwright install chromium
```

## Drive

Headless Chromium needs these flags or the scene never renders / audio never runs:

```js
args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle',
       '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
```

```js
await page.waitForFunction(() => window.avatars && avatars.player && avatars.julia
  && document.getElementById('loadingDiv').style.display === 'none', null, {timeout: 180000});
await page.click('#beginBT');                          // title card; also unlocks audio
await page.click('.question:nth-child(1)');            // menu is built from lines.json
await page.waitForFunction(() => window.playing === true);
```

Loading both avatars plus their clip sets under swiftshader takes ~60-90s. Use
generous timeouts.

**Sample motion in-page, not over the wire.** A playwright `evaluate` round-trip
is slower than the animation, so polling from node makes a smooth walk look like
a teleport. Push a recorder into the page and read it back at the end:

```js
await page.evaluate(() => {
  window.__rec = [];
  scene.onBeforeRenderObservable.add(() => window.__rec.push(avatars.julia.pivot.position.z));
});
// ... later
const jz = await page.evaluate(() => window.__rec);
```

## What to observe

Lipsync is `jawOpen`, driven per-avatar off its own analyser. Sample over time —
a flat 0 means the analyser is dead even while `speaking` is true:

```js
avatars.julia.headMorphs.jawOpen.influence   // ~0.2-0.35 mid-speech
```

Check the *other* avatar's jaw stays near 0 while one speaks — a shared analyser
or a shared head mesh would move both. Also worth checking: subtitle `.who` text
tracks the speaker, `camera.alpha` changes between shots (1.9 player / 1.25 julia),
`document.body.classList.contains('cinematic')` during a branch.

## Gotchas — these are load-bearing

- **Never address a morph by index.** player.glb is ARKit-52 (`jawOpen`=34);
  julia.glb is a 60-target export (`jawOpen`=11) with extra visemes and no
  `mouthOpen` on player at all. `morphMap()` resolves by name for this reason.
- **Both models name meshes `Wolf3D_*`**, so `scene.getMeshByName` returns
  whichever loaded first. Always scope via `findMesh(root, ...)`.
- **`__root__` carries a rotationQuaternion** from the glTF handedness flip, which
  silently overrides `.rotation`. Avatars are placed/turned via a parent pivot.
- **`SoundTrack.connectToAnalyser()` must follow `addSound()`**, or the analyser
  reads silence forever. The audio graph is built lazily on first speak because
  before the audio context exists a track gets no graph at all.
- `scene.soundTracks` may be `undefined` until Babylon creates it — guard it.
- `var` globals (`avatars`, `playing`, `manifest`, `scene`, `camera`) are on
  `window`; `let`/`const` ones (`pipeline`, `pushIn`) are NOT.
- A `CreatePlane` faces -Z; textured signage needs `rotation.y = Math.PI` or every
  word renders mirrored.
- **`ArcRotateCamera.setTarget()` rebuilds alpha/beta/radius from the camera's
  current position.** Call it BEFORE assigning those, never after, or it silently
  overwrites them. Symptom: a camera move that barely budges.
- `camera.upperRadiusLimit` (8) silently clamps any wider shot you set.
- **RPM walk clips carry root motion** — the Hips translate 3-4m forward and snap
  back on loop. `stripRootMotion()` flattens X/Z (keeping the vertical bob) and
  returns the travel so `clipSpeed()` can match the pivot's speed to the feet.
  Check `Hips.position.z` stays ~0 during a walk; if it ranges to 3+, stripping
  broke and the avatar will slide across the room.
- Observer count oscillates ~80-92 under swiftshader — that's `animateFace` tween
  backlog at low fps, not a leak. Check it doesn't *climb* across branches.
- **Animation weights must always sum to 1.** Stopping the outgoing clip before
  ramping the incoming one leaves a single clip at weight <1, and Babylon blends
  the shortfall against the *rest pose* — the skeleton drifts through bind pose
  mid-blend. Symptom: the head lolls back for the duration of the ramp. Barely
  visible at 60fps, obvious under swiftshader. Measure it rather than eyeball it:

  ```js
  const n = avatars.player.root.getChildTransformNodes().find((x) => x.name === 'Head');
  BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(0,1,0), n.getWorldMatrix()).normalize().y
  // ~1.0 upright. Sustained dips to ~0.4 across a blend = rest-pose bleed, not animation.
  ```

## Regenerate speech

```bash
C:\Users\alber\anaconda3\envs\ml\python.exe tools/generate_speech.py        # CUDA
C:\Users\alber\anaconda3\envs\ml\python.exe tools/generate_speech.py --demo # parser check
```

Parses `script.md` → `resources/sounds/lines/*.wav` + `lines.json`. Editing the
script's branch ids or speaker names requires a regen; the web app reads only the
manifest.
