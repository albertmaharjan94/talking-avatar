// GET Character from ReadyPlayerMe
// https://models.readyplayer.me/--READYPLAYERME--.glb?morphTargets=ARKit&lod=1&textureFormat=webp
// https://models.readyplayer.me/669e26d98409082e90da6351.glb?morphTargets=ARKit&lod=1&textureFormat=webp

// On Document Loaded - Start Game //
document.addEventListener("DOMContentLoaded", startGame);

// Global BabylonJS Variables
var canvas = document.getElementById("renderCanvas");
var engine = new BABYLON.Engine(canvas, true, { stencil: false }, true);
var scene = createScene(engine, canvas);
var camera = new BABYLON.ArcRotateCamera("camera", BABYLON.Tools.ToRadians(-90), BABYLON.Tools.ToRadians(65), 6, BABYLON.Vector3.Zero(), scene);
var dirLight = new BABYLON.DirectionalLight("dirLight", new BABYLON.Vector3(0,0,0), scene);
var hemiLight = new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, 1, 0), scene);
var shadowGenerator = new BABYLON.ShadowGenerator(2048, dirLight, true);

var hdrTexture;
var hdrRotation = 0;

// Every animation group from js/animations.js, keyed by its "key" field.
// clips["dance1"] is the BABYLON.AnimationGroup you can .play() / .stop().
var clips = {};
var idle1, idle2, idle3;   // the three clips that chain into each other while idle
var talkingClips = [];     // picked at random while speech audio is playing
var observer1, observer2, observer3;
var mouthObserver = null;
var currentAnimation;
var talking;
var animationOffset = 50;

// Player
var player;
var modelName = "player";

// Morph Targets
var leftEye, rightEye;
var smoothedLoudness = 0;   // eased mouth-open amount, 0..1

var paused = false;
var timer = 0;

var music, sfx1, speech;
var myAnalyser;

// ---------------------------------------------------------------------------
//  MORPH TARGET LOOKUP
// ---------------------------------------------------------------------------
// ALWAYS address morph targets by name, never by index.
//
// Ready Player Me does not guarantee a stable target order between exports --
// swap in a different avatar and index 16 silently stops being "jawOpen" and
// becomes "mouthRight" instead. Nothing errors; the face just does the wrong
// thing. Every target below is an ARKit blend shape, and those names ARE stable.
//
// Run this in the console to see what an avatar actually has:
//   scene.getMeshByName("Wolf3D_Head").morphTargetManager.numTargets
function morph(mesh, name) {
    const manager = mesh && mesh.morphTargetManager;
    if (!manager) {
        console.warn("No morphTargetManager on " + (mesh ? mesh.name : "missing mesh"));
        return null;
    }
    for (let i = 0; i < manager.numTargets; i++) {
        if (manager.getTarget(i).name === name) {
            return manager.getTarget(i);
        }
    }
    console.warn('Morph target "' + name + '" not found on ' + mesh.name);
    return null;
}

// Set influence only if the target exists -- avatars vary in what they ship.
function setMorph(target, value) {
    if (target) target.influence = value;
}

// Create Scene
function createScene(engine, canvas) {
    // Set Canvas & Engine //
    canvas = document.getElementById("renderCanvas");
    engine.clear(new BABYLON.Color3(0, 0, 0), true, true);
    var scene = new BABYLON.Scene(engine);
    return scene;
}

// ---------------------------------------------------------------------------
//  SPEECH
// ---------------------------------------------------------------------------
// Play an audio file and make the character's mouth follow it.
// The .wav files come from tools/generate_speech.py -- see the README.
//
//   talk()                                       -> the bundled demo clip
//   talk("./resources/sounds/speech/hello.wav")  -> a generated phrase
function talk(AUDIO_URL) {
    if (AUDIO_URL === undefined) {
        AUDIO_URL = "./resources/sounds/audio.wav";
    }

    // Only one voice at a time. Throw away whatever was playing first.
    stopTalking();

    // Held in a local too: by the time the file finishes decoding, another
    // button may already have replaced the global `speech` with null.
    const sound = new BABYLON.Sound("speech", AUDIO_URL, scene, function () {
        // Fires once the file is decoded and ready.
        if (speech !== sound) return;   // superseded while loading
        sound.setVolume(1);
        talking = true;
        sound.play();
        startTimeline();
        setStatus("Speaking");
        setShot(SHOT_CLOSE);   // push in so the lipsync is actually visible
    });
    speech = sound;

    speech.onended = function () {
        if (speech !== sound) return;
        stopTalking();
        returnToIdle();
    };

    // A Sound has to sit on a SoundTrack before an Analyser can read it.
    const speechTrack = new BABYLON.SoundTrack(scene);
    speechTrack.addSound(sound);

    myAnalyser = new BABYLON.Analyser(scene);
    speechTrack.connectToAnalyser(myAnalyser);
    myAnalyser.FFT_SIZE = 64;    // 32 usable frequency bins
    // Filter stage 1. This is Web Audio's own smoothingTimeConstant: each FFT
    // frame is blended with the previous one. At 0.03 (near zero) every bit of
    // frame-to-frame noise in the spectrum reached the jaw directly, which is
    // what made the mouth chatter. 0.7 was too much -- it added lag before the
    // other two stages had even run.
    myAnalyser.SMOOTHING = 0.5;
    // myAnalyser.drawDebugCanvas();  // uncomment to see the live spectrum

    // Idle animations must stop chaining while she is speaking.
    removeAnimObservers();
}

// Stop the current voice and the talking-animation picker.
function stopTalking() {
    if (timelineInterval) {
        clearInterval(timelineInterval);
        timelineInterval = null;
    }
    talking = false;
    if (speech) {
        speech.stop();
        speech.dispose();
        speech = null;
    }
}

// Drive the jaw morph targets from the audio spectrum. Registered ONCE, at
// model load -- it reads the `talking` flag rather than being added per clip.
function registerMouthMorph() {
    if (mouthObserver) return;

    const head = scene.getMeshByName("Wolf3D_Head");
    const teeth = scene.getMeshByName("Wolf3D_Teeth");

    const headJawOpen = morph(head, "jawOpen");
    const headMouthOpen = morph(head, "mouthOpen");
    const headVisemeAA = morph(head, "viseme_aa");
    const teethMouthOpen = morph(teeth, "mouthOpen");

    mouthObserver = scene.onBeforeRenderObservable.add(function () {
        const raw = (talking && myAnalyser) ? speechLoudness() : 0;

        // Filter stage 2: a short moving average. The spectrum still throws the
        // odd single-frame spike -- a consonant burst, a click at a word
        // boundary. Averaging the last few samples removes those without
        // noticeably delaying the syllables.
        loudnessHistory.push(raw);
        if (loudnessHistory.length > LOUDNESS_WINDOW) loudnessHistory.shift();
        const target = loudnessHistory.reduce((a, b) => a + b, 0) / loudnessHistory.length;

        // Filter stage 3: an exponential ease with attack and release measured
        // in SECONDS rather than per-frame fractions.
        //
        // This matters more than it looks. The old code moved a fixed fraction
        // of the way to the target every frame, so on a 144 Hz display the mouth
        // moved nearly two and a half times faster than on a 60 Hz one -- the
        // same code looked smooth on one machine and twitchy on another.
        // Deriving the step from elapsed time makes it identical everywhere.
        const dt = Math.min(engine.getDeltaTime() / 1000, 0.1); // clamp: tab was hidden
        const tau = target > smoothedLoudness ? ATTACK_SECONDS : RELEASE_SECONDS;
        smoothedLoudness += (target - smoothedLoudness) * (1 - Math.exp(-dt / tau));

        setMorph(headJawOpen, smoothedLoudness * MAX_JAW_OPEN);
        setMorph(headMouthOpen, smoothedLoudness * MAX_MOUTH_OPEN);
        setMorph(teethMouthOpen, smoothedLoudness * MAX_MOUTH_OPEN);
        // A little "aa" shape on top -- jawOpen alone is a slack, gormless mouth.
        setMorph(headVisemeAA, smoothedLoudness * MAX_VISEME_AA);
    });
}

// --- Mouth smoothing and travel limits --------------------------------------
// Three filter stages run in series, each removing a different kind of noise:
//   1. myAnalyser.SMOOTHING  -- averages the FFT itself over time
//   2. the moving average    -- kills isolated single-frame spikes
//   3. the exponential ease  -- gives the jaw physical weight
// Every stage of smoothing buys steadiness with lag, and lag is what makes a
// mouth look dubbed. Measured end-to-end against the audio:
//
//   unfiltered             jitter 0.067   lag   0 ms
//   window 6, 60/130 ms    jitter 0.015   lag 133 ms   <- visibly dubbed
//   window 3, 35/80 ms     jitter 0.025   lag  67 ms   <- here
//   window 1, 25/55 ms     jitter 0.035   lag  33 ms   <- chatters again
//
// Window 3 keeps most of the smoothing while staying under the ~100 ms where a
// viewer starts noticing the mouth trailing the voice.
const LOUDNESS_WINDOW = 3;
const loudnessHistory = [];

// Opening faster than it closes is how a real jaw behaves.
const ATTACK_SECONDS = 0.035;
const RELEASE_SECONDS = 0.08;

// Travel limits. Conversational speech barely moves the jaw -- most of the
// visible motion of a talking mouth is lips, not a dropping chin. Past about a
// third, jawOpen reads as a yawn on the loud syllables.
const MAX_JAW_OPEN = 0.30;
const MAX_MOUTH_OPEN = 0.22;
const MAX_VISEME_AA = 0.16;

// How loud is she right now, 0..1?
//
// Averaging the low bins rather than sampling one of them: a single bin tracks
// one narrow frequency, so it drops out whenever the voice moves off that pitch
// and the mouth stutters. Bins 1-12 of a 64-point FFT cover roughly 300 Hz to
// 4 kHz, which is where the energy of speech actually lives.
//
// These three numbers were measured, not guessed. Sampling this average across
// a full generated phrase (Kokoro af_heart) gave:
//
//   silence      0.000  (peaks at 0.015)
//   speech  p2   0.299
//           p50  0.519
//           p98  0.652
//
// Re-measure if you change TTS voice or model: a louder or quieter voice moves
// this whole distribution, and the mouth is only as good as this calibration.
//
// NOISE_FLOOR sits just above the silence peak so the mouth actually shuts
// between phrases. FULL_VOLUME sits at the p98 of real speech -- set it any
// lower and the loud half of every sentence clips to "fully open", which is
// what makes a talking avatar look like it is holding its jaw ajar rather
// than forming words.
const NOISE_FLOOR = 0.05;
const FULL_VOLUME = 0.65;

// Speech is a compressed signal: most of it sits in the top half of that range,
// so a straight linear map still leaves the jaw hovering near its maximum.
// Raising the normalised value to a power pushes the quiet and mid parts back
// down and keeps the peaks, which is what restores syllable-by-syllable
// movement. 1.0 would be linear; higher means punchier.
const LOUDNESS_CONTRAST = 2.5;

function speechLoudness() {
    const spectrum = myAnalyser.getByteFrequencyData();
    let total = 0;
    for (let i = 1; i <= 12; i++) {
        total += spectrum[i];
    }
    const raw = total / 12 / 255;
    const normalised = BABYLON.Scalar.Clamp(
        (raw - NOISE_FLOOR) / (FULL_VOLUME - NOISE_FLOOR), 0, 1);
    return Math.pow(normalised, LOUDNESS_CONTRAST);
}

// Start Game
function startGame() {
    // Imported .glb animations must NOT auto-play -- we start them ourselves.
    BABYLON.SceneLoader.OnPluginActivatedObservable.add(function (plugin) {
        if (plugin.name === "gltf" && plugin instanceof BABYLON.GLTFFileLoader) {
            plugin.animationStartMode = BABYLON.GLTFLoaderAnimationStartMode.NONE;
        }
    });

    // Set Canvas & Engine
    setRenderResolution();
    var toRender = function () {
        scene.render();
    }
    engine.runRenderLoop(toRender);
    engine.clear(new BABYLON.Color3(0, 0, 0), true, true);

    // Setup Sounds 
    music = new BABYLON.Sound("Music", "./resources/sounds/music.mp3", scene, null, {
        loop: true
    });


    // SFX Using HTML Audio to prevent Silence switch on mobile devices
    sfx1 = document.createElement("audio");
    sfx1.preload = "auto";
    sfx1.src = "./resources/sounds/sfx1.mp3";

   
    // Glow Layer
    var gl = new BABYLON.GlowLayer("glow", scene, {
        mainTextureFixedSize: 256,
        blurKernelSize: 128
    });
    gl.intensity = 0.7;

    // Create Camera
    createCamera();

    // Three-point lighting, the standard portrait setup.
    //
    // KEY    front-left and above, the light that actually shapes the face
    // FILL   opposite side, weak, just lifts the shadow side out of black
    // RIM    behind and above, separates her hair and shoulders from the
    //        background -- this is the one that stops her looking pasted on
    //
    // A single hard directional light (what this was) makes a flat, harshly
    // shadowed face with no separation from the backdrop.

    // Ambient
    hemiLight.intensity = 0.25;
    hemiLight.diffuse = new BABYLON.Color3(0.85, 0.9, 1.0);      // cool sky
    hemiLight.groundColor = new BABYLON.Color3(0.35, 0.3, 0.35); // warmer bounce

    // Key
    dirLight.intensity = 2.1;
    dirLight.diffuse = new BABYLON.Color3(1.0, 0.97, 0.92);      // slightly warm
    dirLight.position = new BABYLON.Vector3(-3, 6, 5);
    dirLight.direction = new BABYLON.Vector3(0.45, -0.8, -0.6);
    dirLight.shadowMinZ = 1;
    dirLight.shadowMaxZ = 15;

    // Fill
    var fillLight = new BABYLON.DirectionalLight("fillLight",
        new BABYLON.Vector3(-0.7, -0.25, -0.6), scene);
    fillLight.intensity = 0.55;
    fillLight.diffuse = new BABYLON.Color3(0.75, 0.82, 1.0);     // cool
    fillLight.specular = new BABYLON.Color3(0.1, 0.1, 0.12);     // no hot spot

    // Rim
    var rimLight = new BABYLON.DirectionalLight("rimLight",
        new BABYLON.Vector3(0.15, -0.45, 1.0), scene);
    rimLight.intensity = 1.6;
    rimLight.diffuse = new BABYLON.Color3(0.7, 0.82, 1.0);

    // Create Lights Transform Node
    var lightsNode = new BABYLON.TransformNode("_Lights_", scene);
    hemiLight.parent = lightsNode;
    dirLight.parent = lightsNode;
    fillLight.parent = lightsNode;
    rimLight.parent = lightsNode;

    // Setup Lighting & Import Models
    setLighting();
    // importBaseModel("base.glb");
    importAnimationsAndModel(modelName + ".glb");

    // Check Window Blur / Focus

    // scene.debugLayer.show({embedMode: true}).then(function () {
    // });

}

// Check Window Focus
function checkWindowFocused() {
    if (document.hasFocus()) {
        paused = false;
        if (talking && speech)
            speech.setVolume(1);
        if (timer > 2 && !music.isPlaying) {
            music.play();
        }
    } else {
        paused = true;
        if (speech)
            speech.setVolume(0);
        if (music && music.isPlaying)
        {
            music.pause();
        }
    }
}

// --- Camera shots ------------------------------------------------------------
// She is 1.79 m tall. At a 0.62 fov the visible height is about 0.64 x the
// camera distance, so ~2.3 m of framing needs ~3.6 m of radius.
//
// WIDE is the resting shot: the whole figure, so the weight shifts and gestures
// read. CLOSE is for speaking -- at full-body distance her mouth is a handful
// of pixels and none of the lipsync is visible.
// beta under 1.5 tilts the camera above the horizon so the floor is visible.
// At a level 1.5 the ground is edge-on and she appears to stand in a void.
const SHOT_WIDE = { radius: 3.75, targetY: 0.95, beta: 1.34 };
const SHOT_CLOSE = { radius: 1.62, targetY: 1.46, beta: 1.47 };
const SHOT_SECONDS = 2.1;   // how long the dolly takes, start to finish

var currentShot = SHOT_WIDE;
var shotTargetY = SHOT_WIDE.targetY;
var shotFrom = null;        // where the move started
var shotProgress = 1;       // 0..1 through the current move; 1 means settled

// Create ArcRotateCamera
// Turned a few degrees off dead-on. A perfectly symmetric front-on shot reads
// as a passport photo; a small angle reads as a person standing in front of you.
function createCamera() {
    camera.setTarget(new BABYLON.Vector3(0, SHOT_WIDE.targetY, 0));
    camera.allowUpsideDown = false;
    camera.panningSensibility = 0;   // no dragging the subject out of frame
    camera.pinchDeltaPercentage = 0.0006;
    camera.wheelPrecision = 60;
    camera.useBouncingBehavior = false;

    camera.alpha = 1.42;
    camera.beta = SHOT_WIDE.beta;
    camera.radius = SHOT_WIDE.radius;

    // Keep the user inside a flattering range -- no worm's-eye or top-down, and
    // never far enough out to see the edge of the set.
    camera.lowerRadiusLimit = 1.1;
    camera.upperRadiusLimit = 7.0;
    camera.lowerBetaLimit = 1.02;
    camera.upperBetaLimit = 1.72;
    camera.lowerAlphaLimit = 1.42 - 0.85;
    camera.upperAlphaLimit = 1.42 + 0.85;

    // Inertia is what makes the orbit feel weighted instead of twitchy.
    camera.inertia = 0.88;
    camera.angularSensibilityX = 2200;
    camera.angularSensibilityY = 2200;

    camera.fov = 0.62;   // slight telephoto -- less facial distortion up close
    camera.minZ = 0.1;
    camera.maxZ = 1000;
}

// Whether the auto-framing is currently allowed to move the camera. The moment
// the user touches it they own it, until the next shot change hands it back.
var autoFraming = true;

// Choose a shot. The move itself is eased every frame in registerShotDolly().
function setShot(shot) {
    if (shot === currentShot && shotProgress >= 1) {
        autoFraming = true;
        return;
    }
    // Start the move from wherever the camera actually is right now, so
    // interrupting a move mid-way does not jump.
    shotFrom = { radius: camera.radius, beta: camera.beta, targetY: shotTargetY };
    currentShot = shot;
    shotProgress = 0;
    autoFraming = true;   // a new shot takes the camera back
}

// Smootherstep. Zero velocity AND zero acceleration at both ends, so the dolly
// creeps into motion, runs, and settles without a visible stop.
//
// The previous version eased exponentially -- move a fraction of the remaining
// distance each frame. That is smooth at the END but starts at full speed, so
// every camera move began with a lurch. A timed curve fixes the start as well.
function smootherstep(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

// Drive the camera toward the chosen shot over SHOT_SECONDS.
function registerShotDolly() {
    // Any manual camera input cancels the auto-framing. Without this the dolly
    // rewrites radius and beta every frame and the user simply cannot orbit --
    // the camera springs back the instant they let go.
    ["pointerdown", "wheel"].forEach((event) => {
        canvas.addEventListener(event, () => { autoFraming = false; }, { passive: true });
    });

    scene.onBeforeRenderObservable.add(function () {
        if (!autoFraming || shotProgress >= 1 || !shotFrom) return;

        const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
        shotProgress = Math.min(shotProgress + dt / SHOT_SECONDS, 1);
        const t = smootherstep(shotProgress);

        camera.radius = shotFrom.radius + (currentShot.radius - shotFrom.radius) * t;
        camera.beta = shotFrom.beta + (currentShot.beta - shotFrom.beta) * t;

        shotTargetY = shotFrom.targetY + (currentShot.targetY - shotFrom.targetY) * t;
        camera.target.y = shotTargetY;
    });
}

// Setup Animations & Player
var animationsGLB = [];

// Import Animations and Model
// Loads every .glb listed in js/animations.js. Promise.all keeps the results in
// table order, so animationsGLB[i] always belongs to ANIMATIONS[i].
async function importAnimationsAndModel(model) {
    animationsGLB = await Promise.all(ANIMATIONS.map((a) => importAnimations(a.file)));
    importModel(model);
}

// Import Animations
// Each animation .glb also contains a throwaway mesh -- we keep only the
// skeleton animation and dispose the rest.
function importAnimations(animation) {
    return BABYLON.SceneLoader.ImportMeshAsync(null, "./resources/models/animations/" + animation, null, scene)
        .then((result) => {
            result.meshes.forEach(element => {
                if (element) {
                    element.dispose();
                }
            });
            return result.animationGroups[0];
    });
}

// Import Model
function importModel(model) {
    return BABYLON.SceneLoader.ImportMeshAsync(null, "./resources/models/" + model, null, scene)
        .then((result) => {
            const player = result.meshes[0];
            player.name = "_Character_";
            shadowGenerator.addShadowCaster(result.meshes[0]);

            const modelTransformNodes = player.getChildTransformNodes();

            // Retarget every loaded animation onto THIS character's skeleton and
            // file it under its key, so clips["dance1"] is the playable clip.
            animationsGLB.forEach((animation, i) => {
                clips[ANIMATIONS[i].key] = animation.clone(ANIMATIONS[i].key, (oldTarget) => {
                    return modelTransformNodes.find((node) => node.name === oldTarget.name);
                });
                animation.dispose();
            });

            // Clean Imported Animations
            animationsGLB = [];

            // Setup Idle Anims
            idle1 = clips.idle1;
            idle2 = clips.idle2;
            idle3 = clips.idle3;
            talkingClips = byCategory("talk").map((a) => clips[a.key]);

            // Current Anim
            currentAnimation = idle1;
            idle1.play(false);

            setIdleAnimObservers();

            // Build the set now that there is someone to stand in it -- the
            // floor mirror captures its reflection list when it is created.
            createStudio();

            setReflections();
            setShadows();
            dimMouthInterior();   // must run after setReflections
            registerShotDolly();
            startNuances();       // breathing, weight, eye contact
            initModel();

            const head = scene.getMeshByName("Wolf3D_Head");
            leftEye = morph(head, "eyeBlinkLeft");
            rightEye = morph(head, "eyeBlinkRight");

            // Setup Init Jaw Forward -- stops the resting mouth looking clenched.
            setMorph(morph(head, "jawForward"), 0.4);

            // Animate Face Morphs
            animateFaceMorphs();

            // The mouth reads the audio spectrum every frame from here on.
            registerMouthMorph();

            // Build the UI now that the clips exist.
            buildAnimationButtons();
            loadPhraseButtons();
        });
}


// Animate Eyes
function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

// Animate Face Morphs using intervals
function animateFaceMorphs() {

    const mesh = scene.getMeshByName("Wolf3D_Head");

    const getRandomNumber = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    // A blink. Real eyelids snap shut and open slower, so the close is 4 frames
    // and the open is 9. Snapping influence straight to 1 and back -- what this
    // used to do -- reads as a glitch rather than a blink.
    const blink = () => {
        if (!leftEye || !rightEye) return;
        animateMorphTarget(leftEye, leftEye.influence, 1, 4);
        animateMorphTarget(rightEye, rightEye.influence, 1, 4);
        setTimeout(() => {
            animateMorphTarget(leftEye, 1, 0, 9);
            animateMorphTarget(rightEye, 1, 0, 9);
        }, 90);
    };

    const animateEyes = async () => {
        if (getRandomNumber(1, 2) !== 1) return;
        blink();
        // Every so often, a double blink.
        if (getRandomNumber(1, 4) === 1) {
            await wait(340);
            blink();
        }
    };

    // Ease one morph target from where it is now to a new value over numSteps
    // frames. Takes the target itself, not an index -- see morph() above.
    const animateMorphTarget = (morphTarget, initialValue, targetValue, numSteps) => {
        if (!morphTarget) return;
        let currentStep = 0;

        const animationCallback = () => {
            currentStep++;
            const t = currentStep / numSteps;
            morphTarget.influence = BABYLON.Scalar.Lerp(initialValue, targetValue, t);
            if (currentStep >= numSteps) {
                scene.unregisterBeforeRender(animationCallback);
            }
        };

        scene.registerBeforeRender(animationCallback);
    };

    // Move a group of targets together to the same random value.
    const animateGroup = (names, amount, numSteps) => {
        const targets = names.map((n) => morph(mesh, n));
        const initialValue = targets[0] ? targets[0].influence : 0;
        const targetValue = Math.random() * amount;
        targets.forEach((t) => animateMorphTarget(t, initialValue, targetValue, numSteps));
    };

    // Brows
    const animateBrow = () => animateGroup(
        ["browInnerUp", "browOuterUpLeft", "browOuterUpRight"], 0.35, 45);

    // Smile -- kept subtle, a full-strength smile looks manic at rest.
    const animateSmile = () => animateGroup(
        ["mouthSmileLeft", "mouthSmileRight"], 0.16, 60);

    // Mouth Left / Right -- one side at a time, so the mouth shifts rather than
    // pulling in both directions at once.
    const animateMouthLeftRight = () => animateGroup(
        [getRandomNumber(0, 1) === 1 ? "mouthRight" : "mouthLeft"], 0.25, 120);

    // Nose -- a sneer is an ugly shape, so barely any of it.
    const animateNose = () => animateGroup(
        ["noseSneerLeft", "noseSneerRight"], 0.12, 90);

    // Jaw Forward
    const animateJawForward = () => animateGroup(["jawForward"], 0.35, 90);

    // Cheeks
    const animateCheeks = () => animateGroup(
        ["cheekSquintLeft", "cheekSquintRight"], 0.25, 90);

    // Timings and amplitudes are deliberately slow and small. The face is at
    // REST here -- an assistant waiting for you, not emoting. Fast intervals
    // with big amplitudes (the original 0.8 brows every 1.2s) read as twitching.
    setInterval(animateEyes, 900);
    setInterval(animateBrow, 3500);
    setInterval(animateSmile, 4000);
    setInterval(animateMouthLeftRight, 5000);
    setInterval(animateNose, 6000);
    setInterval(animateJawForward, 5000);
    setInterval(animateCheeks, 4000);
}

// Setup Idle Animation OnEnd Observers
// idle1 -> idle2 -> idle3 -> idle1, forever, each transition blended.
// Clears the old observers first so repeated calls never stack duplicates.
function setIdleAnimObservers() {
    removeAnimObservers();
    observer1 = idle1.onAnimationEndObservable.add(function () {
        scene.onBeforeRenderObservable.runCoroutineAsync(animationBlending(idle1, 0.8, idle2, 0.8, false, 0.02));
    });
    observer2 = idle2.onAnimationEndObservable.add(function () {
        scene.onBeforeRenderObservable.runCoroutineAsync(animationBlending(idle2, 0.8, idle3, 0.8, false, 0.02));
    });
    observer3 = idle3.onAnimationEndObservable.add(function () {
        scene.onBeforeRenderObservable.runCoroutineAsync(animationBlending(idle3, 0.8, idle1, 0.8, false, 0.02));
    });
}

// Remove Idle Animation OnEnd Observers -- hands control back to the caller.
function removeAnimObservers() {
    if (!idle1) return;
    idle1.onAnimationEndObservable.remove(observer1);
    idle2.onAnimationEndObservable.remove(observer2);
    idle3.onAnimationEndObservable.remove(observer3);
    observer1 = observer2 = observer3 = null;
}

// ---------------------------------------------------------------------------
//  PLAY ONE ANIMATION  --  the entry point every button uses
// ---------------------------------------------------------------------------
// Also callable from the browser console:   playAnimation("dance1")
function playAnimation(key) {
    const def = ANIMATIONS.find((a) => a.key === key);
    const clip = clips[key];
    if (!def || !clip) {
        console.warn("No animation named '" + key + "'. Known keys: " + Object.keys(clips).join(", "));
        return;
    }

    // The idle chain and the speech timeline also drive the character. A button
    // press has to take the wheel from both of them first.
    removeAnimObservers();
    stopTalking();
    setStatus("Listening");
    setShot(SHOT_WIDE);   // a gesture is a whole-body thing -- show the body

    // Rapid clicking can leave a half-blended clip stuck at full weight.
    Object.values(clips).forEach((c) => {
        if (c !== currentAnimation && c !== clip && c.isPlaying) c.stop();
    });

    const loop = def.loop === true;
    scene.onBeforeRenderObservable.runCoroutineAsync(
        animationBlending(currentAnimation, 0.8, clip, 0.8, loop, 0.02));

    if (!loop) {
        // One-shot: drop back to idle when it finishes, then unhook ourselves.
        const backToIdle = clip.onAnimationEndObservable.add(function () {
            clip.onAnimationEndObservable.remove(backToIdle);
            returnToIdle();
        });
    }

    setActiveButton(key);
}

// Blend back into the idle loop and let it chain again.
function returnToIdle() {
    if (!idle1) return;
    setStatus("Listening");
    setShot(SHOT_WIDE);   // pull back out to the full figure
    setIdleAnimObservers();
    scene.onBeforeRenderObservable.runCoroutineAsync(
        animationBlending(currentAnimation, 0.7, idle1, 0.7, false, 0.02, 0, idle1.duration, 0.8));
    setActiveButton(null);
}

// Play Sounds
function playSounds() {
    sfx1.play();
    stopTalking();
    if (music && !music.isPlaying) {
        music.setVolume(0.6);
        music.play();
    }
}

// startBTPressed Function from Client Logo
function startBTPressed() {
    camera.attachControl(canvas, true);
    camera.alpha = 1.57;
    camera.beta = 1.42;

    playSounds();

    timer = 0;
}

// Animation Blending
// Cross-fades fromAnim out and toAnim in over roughly (1 / speed) frames, so
// the character never snaps between poses.
//
// Blends can overlap -- the idle chain, the speech timeline and a button press
// can all start one within the same second. `blendToken` makes the most recent
// blend the only one allowed to finish; older ones bow out on their next frame.
// Without it two blends fight over currentAnimation and leave both clips
// playing at full weight, which reads on screen as a mangled pose.
var blendToken = 0;

function* animationBlending(fromAnim, fromAnimSpeedRatio, toAnim, toAnimSpeedRatio, repeat, speed, toAnimFrameIn, toAnimFrameOut, maxWeight) {
    if (!toAnimFrameIn)
        toAnimFrameIn = 0;
    if (!toAnimFrameOut)
        toAnimFrameOut = toAnim.duration;
    if (!maxWeight)
        maxWeight = 1;

    const myToken = ++blendToken;

    let t = 0;
    fromAnim.stop();
    toAnim.start(repeat, toAnimSpeedRatio, toAnimFrameIn, toAnimFrameOut, false)
    fromAnim.speedRatio = fromAnimSpeedRatio;
    toAnim.speedRatio = toAnimSpeedRatio;

    // Claim the character now, not when the fade finishes -- a blend that is
    // still ramping is already "the current animation" as far as everything
    // else is concerned.
    currentAnimation = toAnim;

    while (t < 1)
    {
        if (myToken !== blendToken) {
            // Superseded. Don't leave our clip running underneath the new one.
            if (toAnim !== currentAnimation)
                toAnim.stop();
            return;
        }
        t = Math.min(t + speed, 1);

        // Smoothstep, not a straight ramp. A linear crossfade changes velocity
        // instantly at both ends of the blend, and the eye reads that as a jolt
        // at the start and a second one at the finish. Easing in and out means
        // the limbs accelerate and settle instead of snapping.
        const eased = t * t * (3 - 2 * t);

        toAnim.setWeightForAllAnimatables(eased * maxWeight);
        fromAnim.setWeightForAllAnimatables(1 - eased);
        yield;
    }
    fromAnim.setWeightForAllAnimatables(0);
}


// Start Timeline
// While speech audio plays, keep swapping in a random talking gesture whenever
// the current one runs out. Stopped by stopTalking().
let timelineInterval;
function startTimeline() {
    clearInterval(timelineInterval);

    // Gesture straight away. Waiting for the running idle clip to end would
    // leave a short phrase with no body movement at all.
    playTalkingGesture();

    timelineInterval = setInterval(() => {
        if (talking && speech && speech.isPlaying && !currentAnimation.isPlaying) {
            playTalkingGesture();
        }
    }, 1000);
}

// Blend into a random talking gesture that isn't the one already running.
function playTalkingGesture() {
    if (!talkingClips.length) return;

    let next;
    do {
        next = talkingClips[Math.floor(Math.random() * talkingClips.length)];
    } while (next === currentAnimation && talkingClips.length > 1);

    // Trim `animationOffset` frames off both ends -- the raw clips start and
    // end in a rest pose that would pop on the way in and out.
    scene.onBeforeRenderObservable.runCoroutineAsync(
        animationBlending(currentAnimation, 0.8, next, 0.8, false, 0.02,
            animationOffset, next.duration - animationOffset, 0.75));
}

// ---------------------------------------------------------------------------
//  UI  --  buttons are generated from the tables, never hand-written in HTML
// ---------------------------------------------------------------------------

// One button per entry in ANIMATIONS, grouped by category.
function buildAnimationButtons() {
    const panel = document.getElementById("animation-panel");
    if (!panel) return;

    Object.keys(CATEGORY_LABELS).forEach((category) => {
        const group = byCategory(category);
        if (!group.length) return;

        const row = document.createElement("div");
        row.className = "panel-group";

        const heading = document.createElement("h4");
        heading.textContent = CATEGORY_LABELS[category];
        row.appendChild(heading);

        group.forEach((a) => {
            const button = document.createElement("button");
            button.className = "anim-btn";
            button.dataset.key = a.key;
            button.textContent = a.label;
            button.onclick = () => playAnimation(a.key);
            row.appendChild(button);
        });

        panel.appendChild(row);
    });
}

// Assistant state readout: "Listening" at rest, "Speaking" while a phrase plays.
// Purely cosmetic, but it is what turns a looping 3D model into something that
// reads as an assistant waiting on you.
function setStatus(state) {
    const el = document.getElementById("status-state");
    const bar = document.getElementById("status-bar");
    if (!el || !bar) return;
    el.textContent = state;
    bar.dataset.state = state.toLowerCase();
}

// Highlight whichever animation is running. Pass null to clear.
function setActiveButton(key) {
    document.querySelectorAll(".anim-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.key === key);
    });
}

// One button per phrase in the manifest written by tools/generate_speech.py.
function loadPhraseButtons() {
    const panel = document.getElementById("speech-panel");
    if (!panel) return;

    fetch("./resources/sounds/speech/manifest.json")
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((phrases) => {
            const heading = document.createElement("h4");
            heading.textContent = "Say something";
            panel.appendChild(heading);

            phrases.forEach((p) => {
                const button = document.createElement("button");
                button.className = "speech-btn";
                button.textContent = p.text.length > 46 ? p.text.slice(0, 46) + "..." : p.text;
                button.title = p.text + "  (" + p.seconds + "s)";
                button.onclick = () => talk(p.file);
                panel.appendChild(button);
            });
        })
        .catch(() => {
            // No generated audio yet -- tell the student how to make some.
            panel.innerHTML =
                '<h4>Say something</h4><p class="hint">No speech generated yet.<br>' +
                'Run <code>python tools/generate_speech.py</code></p>' +
                '<button class="speech-btn" onclick="talk()">Play bundled demo audio</button>';
        });
}

// Environment Lighting
// The HDR is kept purely as an image-based light -- it is what puts believable
// reflections in her eyes and a soft falloff on her skin. It is no longer drawn
// as a visible skybox; the studio backdrop in scene.js is the background now.
function setLighting() {
    hdrTexture = BABYLON.CubeTexture.CreateFromPrefilteredData("./resources/env/environment_19.env", scene);
    hdrTexture.rotationY = BABYLON.Tools.ToRadians(hdrRotation);
    scene.environmentTexture = hdrTexture;
    scene.environmentIntensity = 0.85;
}

// Set Shadows
// Contact shadows under the chin and nose. These are self-shadows on the
// character, which is why the quality matters at this framing -- a low-res
// shadow map shows up as a stair-stepped edge across her cheek.
function setShadows() {
    shadowGenerator.darkness = 0.35;
    shadowGenerator.bias = 0.0008;
    shadowGenerator.normalBias = 0.012;
    shadowGenerator.usePercentageCloserFiltering = true;
    shadowGenerator.filteringQuality = BABYLON.ShadowGenerator.QUALITY_HIGH;
    shadowGenerator.transparencyShadow = true;

    scene.meshes.forEach(function (mesh) {
        // The set receives shadows but must never cast them -- a 60 m backdrop
        // sphere in the shadow map would swallow the whole scene in darkness.
        if (isStudioMesh(mesh)) {
            mesh.receiveShadows = mesh.name.indexOf("studioGround") === 0;
            return;
        }
        mesh.receiveShadows = true;
        shadowGenerator.addShadowCaster(mesh);
    });
}

// The inside of the mouth has to read as a cavity, not a lightbox.
//
// Only the key light casts shadows. The fill and rim therefore shine straight
// through the head and land on the teeth with nothing to occlude them, and at
// portrait framing that shows up as a bright white bar floating in the middle
// of her mouth every time it opens. Excluding the teeth from those two lights
// is what fixes it -- the mouth interior is then lit by the key and ambient
// only, which is roughly what happens in life.
function dimMouthInterior() {
    const teeth = scene.getMeshByName("Wolf3D_Teeth");
    if (!teeth) return;

    ["fillLight", "rimLight"].forEach((name) => {
        const light = scene.getLightByName(name);
        if (light) light.excludedMeshes.push(teeth);
    });

    // Enamel, not chrome. The default environment reflection makes teeth glow,
    // but taking it all the way down leaves a black hole where her teeth are --
    // they still need to read as teeth, just not as a headlight.
    if (teeth.material) {
        teeth.material.environmentIntensity = 0.4;
        teeth.material.directIntensity = 0.9;
    }
}

// Set Reflections
// Only the character's own materials. The studio floor and backdrop manage
// their own look and would be wrecked by having the HDR forced onto them.
function setReflections() {
    scene.materials.forEach(function (material) {
        if (material.name.indexOf("studio") === 0 || material.name === "BackgroundPlaneMaterial") return;
        if (!(material instanceof BABYLON.PBRMaterial)) return;

        material.reflectionTexture = hdrTexture;
        material.environmentIntensity = 0.9;
        material.disableLighting = false;
    });
}

// Show START DEMO BUTTON
function initModel() {
    setTimeout(() => {
        hideLoadingView();
        startBTPressed();   
    }, 1200);
    setPostProcessing();

    setTimeout(() => {
        optimizeScene();
    }, 2000);
}

// Hide Loading View
function hideLoadingView() {
    // Unlock Audio Engine
    BABYLON.Engine.audioEngine.unlock();
    document.getElementById("loadingDiv").classList.add("fadeOut");
    setTimeout(() => {
        document.getElementById("loadingDiv").style.display = "none"
    }, 400);
}

// Optimizer
function optimizeScene() {
    scene.skipPointerMovePicking = true;
    scene.blockfreeActiveMeshesAndRenderingGroups = true;

    // NOTE: the SceneOptimizer's HardwareScalingOptimization used to run here.
    // It drops render resolution whenever fps dips, which on an integrated GPU
    // means the avatar renders at half resolution and every edge goes jagged --
    // and it never scales back up. A talking head is small on screen and cheap
    // to draw; keeping full resolution is the right trade.
}

// Match the render buffer to the display's real pixel density. Without this the
// canvas renders at CSS pixels and looks soft and stair-stepped on any HiDPI
// screen. Capped at 2 so a 3x phone doesn't render 9x the pixels for nothing.
function setRenderResolution() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    engine.setHardwareScalingLevel(1 / dpr);
}

// Post Processing
function setPostProcessing() {
    var pipeline = new BABYLON.DefaultRenderingPipeline(
        "defaultPipeline",  // The name of the pipeline
        true,               // HDR -- needed for tone mapping and clean bloom
        scene,              // The scene instance
        [scene.activeCamera] // The list of cameras to be attached to
    );

    // Anti-aliasing. MSAA cleans the geometry edges (hair, glasses, collar);
    // FXAA catches the specular shimmer MSAA can't see.
    pipeline.samples = 4;
    pipeline.fxaaEnabled = true;

    // Filmic tone mapping -- without it the HDR environment blows out her
    // forehead and cheekbones into flat white.
    pipeline.imageProcessing.toneMappingEnabled = true;
    pipeline.imageProcessing.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
    // ACES rolls the highlights off hard, so the exposure has to come up to
    // compensate or the whole frame sits muddy and underlit.
    // Watch the teeth when changing this. Before dimMouthInterior() existed,
    // anything past 1.5 clipped them to pure white the moment her mouth opened.
    pipeline.imageProcessing.exposure = 1.6;
    pipeline.imageProcessing.contrast = 1.12;

    // A soft glow on the brightest highlights. Kept low: this should read as
    // "lit well", not "science fiction hologram".
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.85;
    pipeline.bloomWeight = 0.15;
    pipeline.bloomKernel = 64;
    pipeline.bloomScale = 0.5;

    // Vignette pulls the eye to the centre of the frame, where her face is.
    // Weight 2.2 was heavy enough to crush the top of the backdrop to near
    // black, which read as a dirty band across the sky rather than as a vignette.
    pipeline.imageProcessing.vignetteEnabled = true;
    pipeline.imageProcessing.vignetteWeight = 1.1;
    pipeline.imageProcessing.vignetteColor = new BABYLON.Color4(0, 0, 0.05, 0);
    pipeline.imageProcessing.vignetteCameraFov = 0.85;

    // Depth of field is deliberately OFF. The backdrop is a smooth gradient --
    // there is no background detail for a blur to separate her from, so all DOF
    // achieved here was softening her own hair and glasses.
    pipeline.depthOfFieldEnabled = false;

    // Very slight sharpen to bring back detail the AA softened.
    pipeline.sharpenEnabled = true;
    pipeline.sharpen.edgeAmount = 0.15;
    pipeline.sharpen.colorAmount = 1.0;
}

// Resize Window
// Re-check pixel density too -- dragging the window to a monitor with a
// different DPI changes devicePixelRatio without changing the CSS size.
window.addEventListener("resize", function () {
    setRenderResolution();
    engine.resize();
});