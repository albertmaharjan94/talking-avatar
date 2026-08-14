// ============================================================================
//  HUMAN NUANCES
// ----------------------------------------------------------------------------
//  The animation clips give her poses. This file gives her presence: breathing,
//  weight on one hip, eye contact, the little darts a real eye makes, a lean in
//  when she speaks, an occasional glance away.
//
//  HOW IT WORKS -- the important bit
//
//  The clips already write a rotation into Head, Neck, Spine and Hips on every
//  single frame. Anything we set beforehand is simply overwritten. So all of
//  this runs in `scene.onAfterAnimationsObservable`, which fires after the
//  animation system has written its values and before the frame is drawn, and
//  MULTIPLIES a small extra rotation onto whatever the clip decided.
//
//  That is why these read as additions to her performance rather than a fight
//  with it -- the idle animation still runs underneath, untouched.
//
//  The eyes are the exception: no clip targets LeftEye/RightEye, so those are
//  set outright rather than added to.
// ============================================================================

var nuanceObserver = null;
var bones = {};          // Head, Neck, Spine, Spine1, Spine2, Hips
var eyeRest = {};        // bind-pose rotation of each eye, to compose against

// --- Tuning ------------------------------------------------------------------
// Everything here is small. That is the entire trick: at these amplitudes you
// do not consciously see any of it, you just stop reading her as a mannequin.
// Turn any number up by 10x to see what it is actually doing.

const BREATH_RATE_IDLE = 0.23;      // Hz -- about 14 breaths a minute, resting
const BREATH_RATE_TALKING = 0.33;   // speech needs more air
const BREATH_DEPTH = 0.011;         // radians of spine pitch

const SWAY_DEPTH = 0.020;           // hip roll, the "weight on one leg" shift
const LEAN_WHEN_SPEAKING = 0.030;   // radians of forward spine pitch
const LEAN_SECONDS = 0.9;           // how long the lean takes to arrive/leave

const LOOK_YAW_LIMIT = 0.42;        // ~24 degrees: past this a neck looks broken
const LOOK_PITCH_LIMIT = 0.26;
const LOOK_SECONDS = 0.38;          // head lag -- eyes arrive first, head follows
const HEAD_SHARE = 0.55;            // how much of the look the head does...
const NECK_SHARE = 0.30;            // ...and how much the neck does

const EYE_SECONDS = 0.06;           // eyes snap, they do not glide
const SACCADE_EVERY = [0.5, 2.4];   // seconds between little darts
const SACCADE_SIZE = 0.045;         // radians

const GLANCE_EVERY = [7, 16];       // seconds between looking away
const GLANCE_HOLD = [0.9, 2.2];     // how long she looks away for

// --- Runtime state -----------------------------------------------------------
let lean = 0;
let lookYaw = 0, lookPitch = 0;             // eased, what is actually applied
let eyeYaw = 0, eyePitch = 0;
let saccadeYaw = 0, saccadePitch = 0;
let nextSaccadeAt = 0;
let glanceYaw = 0, glancePitch = 0;         // non-zero while looking away
let nextGlanceAt = 0, glanceUntil = 0;
let clock = 0;

const rand = (min, max) => min + Math.random() * (max - min);

// Frame-rate independent easing, same approach as the mouth filter: a time
// constant in seconds rather than a fixed fraction per frame.
function ease(current, target, tau, dt) {
    return current + (target - current) * (1 - Math.exp(-dt / tau));
}

// Multiply a small euler rotation onto whatever the animation just wrote.
function addRotation(node, pitch, yaw, roll) {
    if (!node || !node.rotationQuaternion) return;
    node.rotationQuaternion.multiplyInPlace(
        BABYLON.Quaternion.FromEulerAngles(pitch, yaw, roll));
}

// Where is the camera, in the character's own frame of reference? Returns the
// yaw and pitch she would have to turn to face it.
function angleToCamera() {
    const head = bones.Head;
    const root = scene.getMeshByName("_Character_");
    if (!head || !root) return { yaw: 0, pitch: 0 };

    const headPos = head.getAbsolutePosition();
    const toCamera = camera.globalPosition.subtract(headPos);

    // Into character space, so this still works if she is ever turned around.
    const inverse = BABYLON.Matrix.Invert(root.getWorldMatrix());
    const local = BABYLON.Vector3.TransformNormal(toCamera, inverse).normalize();

    return {
        yaw: Math.atan2(local.x, local.z),
        pitch: -Math.asin(BABYLON.Scalar.Clamp(local.y, -1, 1)),
    };
}

// Call once, after the character and its clips are loaded.
function startNuances() {
    if (nuanceObserver) return;

    const root = scene.getMeshByName("_Character_");
    if (!root) return;

    const nodes = root.getChildTransformNodes();
    ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftEye", "RightEye"]
        .forEach((name) => {
            bones[name] = nodes.find((n) => n.name === name) || null;
            if (!bones[name]) console.warn("Nuances: bone '" + name + "' not found");
        });

    // Eyes are ours alone -- remember the bind pose so we rotate from rest.
    ["LeftEye", "RightEye"].forEach((name) => {
        const bone = bones[name];
        if (bone && bone.rotationQuaternion) {
            eyeRest[name] = bone.rotationQuaternion.clone();
        }
    });

    nuanceObserver = scene.onAfterAnimationsObservable.add(applyNuances);
}

function applyNuances() {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
    clock += dt;

    // ---- Breathing ---------------------------------------------------------
    // Spread across three spine joints so the whole torso swells rather than
    // one vertebra hinging. The neck takes a little back off so her head does
    // not nod along with every breath.
    const breathRate = talking ? BREATH_RATE_TALKING : BREATH_RATE_IDLE;
    const breath = Math.sin(clock * Math.PI * 2 * breathRate);
    addRotation(bones.Spine, breath * BREATH_DEPTH * 0.5, 0, 0);
    addRotation(bones.Spine1, breath * BREATH_DEPTH, 0, 0);
    addRotation(bones.Spine2, breath * BREATH_DEPTH * 0.7, 0, 0);
    addRotation(bones.Neck, breath * BREATH_DEPTH * -0.5, 0, 0);

    // ---- Weight shift ------------------------------------------------------
    // Two sine waves at unrelated speeds, so the sway never repeats on a beat
    // you can count. One wave alone reads as a metronome.
    const sway = Math.sin(clock * 0.13) * 0.6 + Math.sin(clock * 0.071) * 0.4;
    addRotation(bones.Hips, 0, sway * SWAY_DEPTH * 0.5, sway * SWAY_DEPTH);
    addRotation(bones.Spine, 0, 0, sway * -SWAY_DEPTH * 0.35);  // counter-balance

    // ---- Lean in while speaking -------------------------------------------
    lean = ease(lean, talking ? 1 : 0, LEAN_SECONDS, dt);
    addRotation(bones.Spine1, lean * LEAN_WHEN_SPEAKING, 0, 0);

    // ---- Glancing away -----------------------------------------------------
    // Unbroken eye contact is unnerving. Every so often she looks off, then
    // comes back. Never while speaking -- that would read as evasive.
    if (clock > nextGlanceAt && !talking) {
        glanceYaw = rand(-0.32, 0.32);
        glancePitch = rand(-0.10, 0.14);
        glanceUntil = clock + rand(GLANCE_HOLD[0], GLANCE_HOLD[1]);
        nextGlanceAt = glanceUntil + rand(GLANCE_EVERY[0], GLANCE_EVERY[1]);
    }
    if (clock > glanceUntil) {
        glanceYaw = 0;
        glancePitch = 0;
    }

    // ---- Eye contact -------------------------------------------------------
    const toCamera = angleToCamera();
    const targetYaw = BABYLON.Scalar.Clamp(toCamera.yaw + glanceYaw, -LOOK_YAW_LIMIT, LOOK_YAW_LIMIT);
    const targetPitch = BABYLON.Scalar.Clamp(toCamera.pitch + glancePitch, -LOOK_PITCH_LIMIT, LOOK_PITCH_LIMIT);

    // The head lags the eyes. In life the eyes land on a target first and the
    // head catches up, and reversing that is a large part of why a rig can look
    // robotic even when everything is technically pointed the right way.
    lookYaw = ease(lookYaw, targetYaw, LOOK_SECONDS, dt);
    lookPitch = ease(lookPitch, targetPitch, LOOK_SECONDS, dt);

    addRotation(bones.Head, lookPitch * HEAD_SHARE, lookYaw * HEAD_SHARE, 0);
    addRotation(bones.Neck, lookPitch * NECK_SHARE, lookYaw * NECK_SHARE, 0);

    // ---- Saccades ----------------------------------------------------------
    // Real eyes never hold still; they flick constantly around whatever they
    // are looking at. Without this the stare is glassy.
    if (clock > nextSaccadeAt) {
        saccadeYaw = rand(-SACCADE_SIZE, SACCADE_SIZE);
        saccadePitch = rand(-SACCADE_SIZE, SACCADE_SIZE) * 0.6;
        nextSaccadeAt = clock + rand(SACCADE_EVERY[0], SACCADE_EVERY[1]);
    }

    // Whatever the head has not turned, the eyes make up.
    const eyeTargetYaw = (targetYaw - lookYaw * HEAD_SHARE) + saccadeYaw;
    const eyeTargetPitch = (targetPitch - lookPitch * HEAD_SHARE) + saccadePitch;
    eyeYaw = ease(eyeYaw, BABYLON.Scalar.Clamp(eyeTargetYaw, -0.5, 0.5), EYE_SECONDS, dt);
    eyePitch = ease(eyePitch, BABYLON.Scalar.Clamp(eyeTargetPitch, -0.3, 0.3), EYE_SECONDS, dt);

    ["LeftEye", "RightEye"].forEach((name) => {
        const bone = bones[name];
        const rest = eyeRest[name];
        if (!bone || !rest) return;
        // Set rather than multiply: nothing else writes these, so compose
        // straight from the bind pose each frame.
        bone.rotationQuaternion.copyFrom(
            rest.multiply(BABYLON.Quaternion.FromEulerAngles(eyePitch, eyeYaw, 0)));
    });
}
