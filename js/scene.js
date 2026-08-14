// ============================================================================
//  THE SPACE
// ----------------------------------------------------------------------------
//  A photographic studio: a seamless gradient backdrop (a "cyclorama" -- the
//  curved wall in a photo studio that has no visible corner) and a dark floor
//  that catches her shadow and reflects her faintly.
//
//  There are no 3D assets here. The whole set is a sphere, a plane, and a
//  gradient drawn into a canvas, which is why it loads instantly.
// ============================================================================

var studio = {};   // handles to the ground/backdrop so other code can skip them

// Names of set dressing. Lighting and shadow code checks this so it never
// treats the room as if it were part of the character.
const STUDIO_MESHES = ["studioBackdrop", "studioGround", "studioContactShadow",
                       "BackgroundHelper"];

function isStudioMesh(mesh) {
    return STUDIO_MESHES.some((n) => mesh.name.indexOf(n) === 0);
}

// Draw a vertical gradient into a texture, with dithering.
//
// THE DITHERING IS THE POINT. A smooth gradient across dark colours has to be
// quantised to 8 bits per channel, and in the darks the steps between adjacent
// values are wide enough to see -- the gradient comes out as a stack of flat
// bands with visible edges, which is what makes a background look cheap.
//
// Adding a pixel or two of random noise scatters each boundary so the eye
// integrates it back into a smooth ramp. It is the same trick as dithering in
// audio, and it costs one pass over the canvas at load.
function verticalGradient(name, stops) {
    const height = 1024;
    const width = 64;   // wide enough for the noise to vary horizontally too
    const texture = new BABYLON.DynamicTexture(name,
        { width: width, height: height }, scene, true);
    const ctx = texture.getContext();

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    stops.forEach(([offset, colour]) => gradient.addColorStop(offset, colour));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const image = ctx.getImageData(0, 0, width, height);
    const px = image.data;
    for (let i = 0; i < px.length; i += 4) {
        const noise = (Math.random() - 0.5) * 4;
        px[i] += noise;
        px[i + 1] += noise;
        px[i + 2] += noise;
    }
    ctx.putImageData(image, 0, 0);

    texture.update();
    return texture;
}

// A painted contact shadow: a soft dark pool directly under her feet.
//
// The shadow map already casts her shadow across the floor, but the tight dark
// patch where a body actually meets the ground is exactly the detail a shadow
// map at this scale smears away -- and without it a figure reads as hovering an
// inch above the floor no matter how good everything else is.
function createContactShadow() {
    const size = 256;
    const texture = new BABYLON.DynamicTexture("studioContactTex",
        { width: size, height: size }, scene, true);
    const ctx = texture.getContext();
    const gradient = ctx.createRadialGradient(
        size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0.00, "rgba(0,0,0,0.60)");
    gradient.addColorStop(0.40, "rgba(0,0,0,0.32)");
    gradient.addColorStop(1.00, "rgba(0,0,0,0.00)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    texture.update();
    texture.hasAlpha = true;

    const blob = BABYLON.MeshBuilder.CreateGround("studioContactShadow",
        { width: 1.15, height: 0.95 }, scene);
    const mat = new BABYLON.StandardMaterial("studioContactMat", scene);
    mat.diffuseColor = BABYLON.Color3.Black();
    mat.specularColor = BABYLON.Color3.Black();
    mat.emissiveColor = BABYLON.Color3.Black();
    mat.opacityTexture = texture;
    mat.disableLighting = true;
    blob.material = mat;

    blob.position.y = 0.004;   // just clear of the floor, avoids z-fighting
    blob.isPickable = false;
    blob.receiveShadows = false;
    studio.contactShadow = blob;
    return blob;
}

// Build the set. Must run AFTER the character is loaded, so the floor mirror
// has something to reflect.
function createStudio() {
    // ---- Backdrop ----------------------------------------------------------
    // A big sphere seen from the inside. A sphere rather than a wall because
    // there is then no edge to find however far the camera orbits.
    const backdrop = BABYLON.MeshBuilder.CreateSphere("studioBackdrop", {
        diameter: 60,
        segments: 64,   // low segment counts show as facets along the gradient
        sideOrientation: BABYLON.Mesh.BACKSIDE,
    }, scene);

    const backdropMat = new BABYLON.StandardMaterial("studioBackdropMat", scene);
    // Lit by its own texture, not by the scene: a backdrop should not pick up
    // the key light and develop a bright patch where the light happens to fall.
    backdropMat.disableLighting = true;
    // Three things govern these stops, all of them learned the hard way:
    //
    // 1. ONLY v < 0.5 IS EVER VISIBLE. The sphere's equator is where the floor
    //    meets the backdrop, and everything below it is hidden behind the 120 m
    //    floor. Stops past 0.5 are invisible however nice they look in isolation.
    // 2. THE GLOW HAS TO SIT AROUND 0.455. The frame cuts off not far above the
    //    horizon, so a glow placed higher is technically present and visually
    //    useless. At 0.455 it lands behind her head and separates her near-black
    //    hair from the wall.
    // 3. THE VALUE AT 0.5 HAS TO MATCH HOW THE FAR FLOOR RENDERS -- which is not
    //    the floor's flat colour, because the mirror out there is reflecting
    //    this same backdrop back up. Land it too dark and a hard horizon line
    //    appears straight across the frame, which is the one thing a cyclorama
    //    exists to avoid.
    backdropMat.emissiveTexture = verticalGradient("studioGradient", [
        [0.00, "#333d4b"],
        [0.30, "#46525f"],
        [0.455, "#8290a1"],  // the glow, right behind her head and shoulders
        [0.500, "#57626f"],  // horizon: mid-tone, matching the reflective floor
        [0.62, "#2a313b"],
        [1.00, "#1e242c"],
    ]);
    backdropMat.diffuseColor = BABYLON.Color3.Black();
    backdropMat.specularColor = BABYLON.Color3.Black();
    backdrop.material = backdropMat;
    backdrop.isPickable = false;
    backdrop.infiniteDistance = false;
    studio.backdrop = backdrop;

    // ---- Floor -------------------------------------------------------------
    // Built by hand rather than with scene.createDefaultEnvironment(). That
    // helper produces a floor whose colour is almost entirely a reflection of
    // whatever is above it -- and above it is a dark backdrop, so the floor
    // came out the same value as the wall and she appeared to stand in a void.
    //
    // What makes a studio floor read is a POOL OF LIGHT: bright where she is
    // standing, falling off into the dark. That is a texture, not a light.
    // Wider than the backdrop sphere (60 across) on purpose. If the floor ends
    // inside the sphere you see its edge as a hard line, and a cyclorama is
    // defined by not having one.
    const ground = BABYLON.MeshBuilder.CreateGround("studioGround",
        { width: 120, height: 120 }, scene);

    const groundMat = new BABYLON.StandardMaterial("studioGroundMat", scene);
    // The pool of light is only a few metres across, but the floor is 120. Scale
    // and offset the texture so its gradient covers the middle 12 units, and
    // CLAMP so everything beyond that repeats the dark edge pixel rather than
    // tiling a grid of light pools across the floor.
    const pool = radialPool("studioFloorPool");
    pool.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    pool.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    pool.uScale = 10;
    pool.vScale = 10;
    pool.uOffset = -4.5;
    pool.vOffset = -4.5;
    groundMat.diffuseTexture = pool;
    groundMat.specularColor = new BABYLON.Color3(0.05, 0.06, 0.08);
    groundMat.specularPower = 64;
    groundMat.emissiveColor = BABYLON.Color3.Black();

    // A real reflection of her on the floor. Half resolution and blurred, so it
    // costs little and reads as a polished surface rather than a literal mirror.
    const mirror = new BABYLON.MirrorTexture("studioMirror", { ratio: 0.5 }, scene, true);
    mirror.mirrorPlane = new BABYLON.Plane(0, -1, 0, 0);   // the floor, y = 0
    mirror.adaptiveBlurKernel = 28;
    mirror.level = 0.26;
    scene.meshes.forEach((mesh) => {
        if (!isStudioMesh(mesh)) mirror.renderList.push(mesh);
    });
    groundMat.reflectionTexture = mirror;

    ground.material = groundMat;
    ground.receiveShadows = true;
    ground.isPickable = false;
    studio.ground = ground;
    studio.mirror = mirror;

    createContactShadow();

    return studio;
}

// A bright patch fading to dark, painted into a texture. This is the floor's
// lighting -- doing it as an actual spotlight would need another shadow map and
// would light her legs from below, which looks like a horror film.
// The outermost colour MUST match the backdrop's horizon stop, or the join
// between floor and wall reappears as a visible line.
function radialPool(name) {
    const size = 1024;
    const texture = new BABYLON.DynamicTexture(name, { width: size, height: size }, scene, true);
    const ctx = texture.getContext();

    ctx.fillStyle = "#2c333d";
    ctx.fillRect(0, 0, size, size);

    const gradient = ctx.createRadialGradient(
        size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0.00, "#7c8a9c");
    gradient.addColorStop(0.10, "#5a6675");
    gradient.addColorStop(0.24, "#3a4350");
    gradient.addColorStop(0.48, "#2f3742");
    gradient.addColorStop(1.00, "#2c333d");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    // Same dithering as the backdrop -- a large soft radial gradient bands just
    // as badly, and here it would show as concentric rings around her feet.
    const image = ctx.getImageData(0, 0, size, size);
    const px = image.data;
    for (let i = 0; i < px.length; i += 4) {
        const noise = (Math.random() - 0.5) * 4;
        px[i] += noise;
        px[i + 1] += noise;
        px[i + 2] += noise;
    }
    ctx.putImageData(image, 0, 0);

    texture.update();
    return texture;
}
