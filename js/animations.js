// ============================================================================
//  ANIMATION LIBRARY
// ----------------------------------------------------------------------------
//  This is the ONLY file you need to touch to add or remove an animation.
//  main.js reads this table, loads every .glb listed here, and builds one
//  button per entry automatically.
//
//  To add an animation:
//    1. Drop the .glb into resources/models/animations/
//    2. Add one line below
//    3. Reload the page. That's it -- no other code changes.
//
//  Fields:
//    key      unique id, used by playAnimation("key") from the console
//    label    text shown on the button
//    file     path relative to resources/models/animations/
//    category groups the buttons into rows: idle | talk | expression | dance
//    loop     true = repeat forever, false/omitted = play once then return to idle
//
//  Animations come from https://github.com/readyplayerme/animation-library
// ============================================================================

const ANIMATIONS = [
    // ---- IDLE ---------------------------------------------------------------
    // These three chain into each other automatically when nothing else plays.
    { key: "idle1", label: "Idle 1", file: "feminine/glb/idle/F_Standing_Idle_Variations_001.glb", category: "idle" },
    { key: "idle2", label: "Idle 2", file: "feminine/glb/idle/F_Standing_Idle_Variations_002.glb", category: "idle" },
    { key: "idle3", label: "Idle 3", file: "feminine/glb/idle/F_Standing_Idle_Variations_003.glb", category: "idle" },

    // ---- TALKING ------------------------------------------------------------
    // Picked at random while speech audio is playing (see startTimeline in main.js).
    { key: "talk1", label: "Talk 1", file: "feminine/glb/expression/F_Talking_Variations_001.glb", category: "talk" },
    { key: "talk2", label: "Talk 2", file: "feminine/glb/expression/F_Talking_Variations_002.glb", category: "talk" },
    { key: "talk3", label: "Talk 3", file: "feminine/glb/expression/F_Talking_Variations_003.glb", category: "talk" },
    { key: "talk4", label: "Talk 4", file: "feminine/glb/expression/F_Talking_Variations_004.glb", category: "talk" },
    { key: "talk5", label: "Talk 5", file: "feminine/glb/expression/F_Talking_Variations_005.glb", category: "talk" },
    { key: "talk6", label: "Talk 6", file: "feminine/glb/expression/F_Talking_Variations_006.glb", category: "talk" },

    // ---- EXPRESSIONS --------------------------------------------------------
    { key: "salute",  label: "Salute",  file: "feminine/glb/expression/M_Standing_Expressions_013.glb", category: "expression" },
    { key: "clap",    label: "Clap",    file: "feminine/glb/expression/M_Standing_Expressions_004.glb", category: "expression" },
    { key: "shrug",   label: "Shrug",   file: "feminine/glb/expression/M_Standing_Expressions_008.glb", category: "expression" },
    { key: "point",   label: "Point",   file: "feminine/glb/expression/M_Standing_Expressions_017.glb", category: "expression" },

    // ---- DANCES -------------------------------------------------------------
    // loop:true keeps them going until you press another button.
    { key: "dance1", label: "Dance 1", file: "feminine/glb/dance/F_Dances_001.glb", category: "dance", loop: true },
    { key: "dance2", label: "Dance 2", file: "feminine/glb/dance/F_Dances_005.glb", category: "dance", loop: true },
    { key: "dance3", label: "Dance 3", file: "feminine/glb/dance/F_Dances_007.glb", category: "dance", loop: true },
];

// Human-readable row headings for the button panel.
const CATEGORY_LABELS = {
    idle: "Idle",
    talk: "Talking",
    expression: "Expressions",
    dance: "Dances",
};

// Convenience lookups used by main.js. Filled in once the .glb files are loaded.
const byCategory = (category) => ANIMATIONS.filter((a) => a.category === category);
