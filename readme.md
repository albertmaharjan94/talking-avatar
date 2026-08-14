# BabylonJS ReadyPlayerMe Talk Animation Demo

<br>
* https://models.readyplayer.me/--READYPLAYERME--.glb?morphTargets=ARKit&lod=1&textureFormat=webp
* https://models.readyplayer.me/669e26d98409082e90da6351.glb?morphTargets=ARKit&lod=1&textureFormat=webp


Babylon JS & ReadyPlayerMe -- <b>Demo Talking Animation</b>
<br>
<br>
Used animations from:
<br>
https://github.com/readyplayerme/animation-library

<br>
And converted from FBX to GLB using this simple NodeJS APP:
<br>
https://github.com/crazyramirez/FBX2GLB-Batch-Convert-Optimizer

<br>
<br>
Of course, current Player is from <b>ReadyPlayerMe</b>
<br>
Animations use Blending, Morphing using BJS Morph Targets
<br>
Download your ReadyPlayerMe Model using GET values <b>?morphTargets=ARKit&lod=1&textureFormat=webp</b>
<br>
https://docs.readyplayer.me/ready-player-me/api-reference/rest-api/avatars/get-3d-avatars
<br>
<br>

<b><span>&#10003;</span>
Setup NPM and Install BJS</b>

- Install NodeJS from https://nodejs.org/en
- Download or Clone this Repository
- Open a Terminal (Usign for example VSCode) 
- RUN: <b>npm install</b> (To Install BJS Libraries from NPM)
- RUN: npm install -g live-server
- RUN: http-server -p 8000
<br>

<b><span>&#10003;</span>
Main Code</b>
- `js/animations.js` -- the animation table. **This is the only file you edit to add an animation.**
- `js/main.js` -- loading, blending, lipsync, camera shots and the button panels.
- `js/scene.js` -- the studio set: backdrop, floor, reflection, contact shadow.
- `js/nuance.js` -- breathing, weight shifts, eye contact, saccades, glances.
- `tools/generate_speech.py` -- makes the speech .wav files.
<br>

## The space

There are no 3D assets in the set. It is a sphere, a plane and two gradients
painted into canvases, which is why it loads instantly.

- **Backdrop** -- a 60 m sphere seen from the inside, so there is no edge to
  find however far you orbit. Its gradient is the only thing lighting it.
- **Floor** -- a 120 m plane with a *pool of light* painted into its texture.
  This is the part that took the most fiddling: `createDefaultEnvironment()`
  gives you a floor whose colour is mostly a reflection of what is above it,
  and what is above it is a dark backdrop, so the floor came out the same value
  as the wall and she appeared to stand in a void.
- **Reflection** -- a half-resolution blurred `MirrorTexture`.
- **Contact shadow** -- a painted dark pool under her feet. The shadow map casts
  her long shadow, but the tight dark patch where a body meets the ground is
  exactly what a shadow map at this scale smears away, and without it a figure
  reads as hovering.

**The horizon is the fiddly bit.** The sphere's equator is where floor meets
backdrop, so the gradient there has to match the floor's distant colour exactly
or you get a hard line straight across the frame. The glow sits higher up, at
about `v = 0.42`, where it lands behind her head and separates her dark hair
from the wall.

## Camera

Two shots, eased between:

| | radius | framing | when |
| --- | --- | --- | --- |
| `SHOT_WIDE` | 3.75 | full body | at rest |
| `SHOT_CLOSE` | 1.62 | chest up | while speaking |

She pushes in to speak because at full-body distance her mouth is a handful of
pixels and none of the lipsync is visible.

Any mouse input sets `autoFraming = false` and hands the camera to the user
until the next shot change. Without that the dolly rewrites radius and beta
every frame and you simply cannot orbit -- the camera springs back the instant
you let go.

## Human nuances

The clips give her poses; `js/nuance.js` gives her presence.

| | what it does |
| --- | --- |
| breathing | spine swells across three joints, faster while speaking |
| weight shift | slow hip roll from two sine waves at unrelated speeds, so it never lands on a countable beat |
| lean | leans in slightly while speaking, settles back after |
| eye contact | head and neck turn toward the camera, clamped so the neck never breaks |
| saccades | small constant eye darts -- without them the stare is glassy |
| glances | looks away every 7-16 s, never while speaking |

**Everything here is tiny.** At these amplitudes you do not consciously see any
of it, you just stop reading her as a mannequin. Multiply any constant at the
top of the file by 10 to see what it is actually doing.

**Why it runs in `onAfterAnimationsObservable`:** the clips write a rotation
into Head, Neck, Spine and Hips on every frame, so anything set beforehand is
simply overwritten. This runs after the animation system and *multiplies* a
small extra rotation onto whatever the clip decided -- so the idle animation
still plays underneath, untouched.

The eyes are the exception. No clip targets `LeftEye`/`RightEye`, so those are
set outright, composed from the bind pose captured at load.
<br>

---

## Exercise 1 -- Add an animation

Every button on the left comes from one line in `js/animations.js`:

```js
{ key: "dance1", label: "Dance 1", file: "feminine/glb/dance/F_Dances_001.glb", category: "dance", loop: true },
```

| field | meaning |
| --- | --- |
| `key` | unique id -- also works in the console: `playAnimation("dance1")` |
| `label` | the button text |
| `file` | path under `resources/models/animations/` |
| `category` | which row the button lands in: `idle`, `talk`, `expression`, `dance` |
| `loop` | `true` = repeat forever, omitted = play once then blend back to idle |

There are ~200 unused `.glb` files in `resources/models/animations/feminine/glb/`.
Pick one, add a line, reload. No other code changes.

**The three `idle*` keys are required** -- `main.js` chains them together
(`idle1 -> idle2 -> idle3 -> idle1`) as the resting state, and blends back to
`idle1` whenever a one-shot animation or a phrase ends.

## Exercise 2 -- Make her say something new

Speech is generated offline with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx),
an 82M-parameter neural TTS model. Runs on CPU, no API key, no internet after
the one-time model download.

```bash
conda create -n avatar-tts python=3.11 -y
conda activate avatar-tts
pip install kokoro-onnx soundfile

mkdir -p tools/voices
curl -L -o tools/voices/kokoro-v1.0.onnx  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -o tools/voices/voices-v1.0.bin   https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

Add your line to `tools/phrases.json`:

```json
{ "id": "myphrase", "text": "Spell out acronyms like B J S or the voice mangles them." }
```

Then:

```bash
python tools/generate_speech.py                  # writes .wav + manifest.json, then self-checks
python tools/generate_speech.py --list           # all voices the model ships
python tools/generate_speech.py --voice bf_emma  # British English
python tools/generate_speech.py --check          # verify existing audio only
```

Reload the page -- a button appears for every phrase in the manifest.
`tools/voices/` is gitignored (~350 MB).

## How the mouth works

There is no viseme detection and no phoneme alignment. `registerMouthMorph()`
in `main.js` runs once per frame and does this:

1. `BABYLON.Analyser` gives a 32-bin FFT of whatever the speech track is playing.
2. `speechLoudness()` averages bins 1-12 -- roughly 300 Hz to 4 kHz, where the
   energy of speech lives.
3. That is normalised against a measured floor and ceiling, then raised to a
   power to expand the dynamic range.
4. The result eases into `jawOpen`, `mouthOpen` and `viseme_aa`.

**The calibration is the whole trick.** Speech is a compressed signal: most of
it sits in the top half of its own range. Map it linearly and the jaw pins
open, which is what makes most avatars look like they are holding their mouth
ajar rather than forming words. The constants in `main.js` come from actually
sampling a phrase:

```
silence      0.000  (peaks at 0.015)
speech  p2   0.299
        p50  0.519
        p98  0.652
```

**If you change voice or TTS model, re-measure.** A louder voice shifts that
whole distribution and the mouth is only as good as these three numbers.

**Try this:** set `LOUDNESS_CONTRAST` to `1.0` (linear) and watch the jaw sit
permanently half-open. Or drop `FULL_VOLUME` to `0.4` and watch it clip to
fully-open on every syllable. Uncomment `myAnalyser.drawDebugCanvas()` to see
the live spectrum it is reading.

### Smoothing

An FFT read straight into a morph target chatters. Three filter stages run in
series, each removing a different kind of noise:

| stage | what it removes | knob |
| --- | --- | --- |
| `myAnalyser.SMOOTHING` | frame-to-frame noise in the spectrum itself | `0.5` |
| moving average | isolated single-frame spikes (consonants, clicks) | `LOUDNESS_WINDOW` |
| exponential ease | the last of it, and gives the jaw weight | `ATTACK_SECONDS` / `RELEASE_SECONDS` |

**Every stage buys steadiness with lag, and lag is what makes a mouth look
dubbed.** Both have to be measured, not just the jitter. Over one phrase,
replayed at 60 fps:

| | jitter (mean step) | largest jump | lag behind audio |
| --- | --- | --- | --- |
| no filter | 0.067 | 0.379 | 0 ms |
| one-line per-frame lerp | 0.049 | 0.363 | — |
| over-filtered (window 6) | 0.015 | 0.075 | **133 ms** — visibly behind |
| **shipped (window 3)** | **0.025** | **0.123** | **67 ms** |

Two things to notice. A naive `value += (target - value) * 0.6` every frame is
barely better than no filter at all. And the smoothest column is not the best
setting -- past roughly 100 ms a viewer starts seeing the mouth trail the voice.

**Attack is faster than release** (35 ms vs 80 ms) because a real jaw drops
quickly and closes slowly.

**The time constants are in seconds, not per-frame fractions.** This is the
easy one to get wrong: moving a fixed fraction of the way each frame means the
mouth moves nearly 2.5x faster on a 144 Hz display than on a 60 Hz one, so the
same code looks smooth on one machine and twitchy on another. Deriving the step
from `engine.getDeltaTime()` makes it identical everywhere.

`MAX_JAW_OPEN` caps the travel at `0.30`. Conversational speech barely moves the
jaw -- most of the visible motion of a talking mouth is lips, not a dropping
chin.

## Two traps worth knowing about

**Never address morph targets by index.** Ready Player Me does not guarantee a
stable order between exports. Swapping in a different avatar turned index 16
from `jawOpen` into `mouthRight` -- nothing errored, the face just did the
wrong thing. Everything here goes through `morph(mesh, "name")`.

**Lights that cast no shadow shine straight through the head.** Only the key
light has a shadow generator, so the fill and rim lit up the inside of her
mouth and the teeth rendered as a bright white bar. `dimMouthInterior()`
excludes the teeth from those two lights.

---


<b><span>&#10003;</span>
Try the Live DEMO</b>

https://viseni.com/readyplayer_talk/

## Make sure to give permission at start
![alt text](<Screenshot 2024-07-22 at 8.37.12 PM.png>)