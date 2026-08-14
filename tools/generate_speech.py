"""Generate the avatar's speech audio with Kokoro TTS (offline, neural).

Usage
-----
    conda activate avatar-tts
    python tools/generate_speech.py            # build every phrase in phrases.json
    python tools/generate_speech.py --check     # self-test, exits non-zero on failure
    python tools/generate_speech.py --list      # show available voices
    python tools/generate_speech.py --voice af_bella

Writes one .wav per phrase into resources/sounds/speech/ plus a manifest.json
that index.html reads to build the phrase buttons.

Why Kokoro and not Piper: Piper is fast and tiny but unmistakably synthetic --
flat intonation, clipped word endings. Kokoro is an 82M-parameter model that
produces natural prosody, and still runs on CPU with no API key. It costs a
~325 MB model download, once.

Model files live in tools/voices/ and are gitignored. If they are missing this
script prints the two curl commands that fetch them.
"""

import argparse
import json
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHRASES = ROOT / "tools" / "phrases.json"
VOICE_DIR = ROOT / "tools" / "voices"
OUT_DIR = ROOT / "resources" / "sounds" / "speech"

MODEL = VOICE_DIR / "kokoro-v1.0.onnx"
VOICES_BIN = VOICE_DIR / "voices-v1.0.bin"
RELEASE = ("https://github.com/thewh1teagle/kokoro-onnx/releases/download/"
           "model-files-v1.0")

# Female English voices. Kokoro ships many more -- run --list for the full set.
VOICES = {
    "af_heart": "Heart - female, US English, warm and natural (default)",
    "af_bella": "Bella - female, US English, brighter",
    "af_nicole": "Nicole - female, US English, softer, breathier",
    "af_sarah": "Sarah - female, US English, measured",
    "bf_emma": "Emma - female, British English",
    "bf_isabella": "Isabella - female, British English",
}
DEFAULT_VOICE = "af_heart"

# Slightly under 1.0. Assistants that talk at full speed sound like they are
# reading a disclaimer; a touch slower reads as attentive.
DEFAULT_SPEED = 0.95


def require_model():
    """Kokoro needs two files we do not vendor. Fail with the fix, not a stack trace."""
    missing = [p for p in (MODEL, VOICES_BIN) if not p.exists()]
    if not missing:
        return
    print("Kokoro model files are missing. Download them once:\n")
    print(f"  mkdir -p {VOICE_DIR}")
    for path in (MODEL, VOICES_BIN):
        print(f"  curl -L -o {path} {RELEASE}/{path.name}")
    raise SystemExit(1)


def load_kokoro():
    require_model()
    from kokoro_onnx import Kokoro

    return Kokoro(str(MODEL), str(VOICES_BIN))


def write_wav(path, samples, sample_rate):
    """Kokoro returns float32 in -1..1. Babylon's Analyser wants 16-bit PCM."""
    import numpy as np

    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767).astype("<i2")

    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())


def build(voice_name, speed):
    phrases = json.loads(PHRASES.read_text(encoding="utf-8"))
    kokoro = load_kokoro()

    manifest = []
    for phrase in phrases:
        samples, sample_rate = kokoro.create(phrase["text"], voice=voice_name, speed=speed)
        out = OUT_DIR / f"{phrase['id']}.wav"
        write_wav(out, samples, sample_rate)
        seconds = wav_seconds(out)
        print(f"  {phrase['id']:<10} {seconds:5.1f}s  {out.name}")
        manifest.append(
            {
                "id": phrase["id"],
                "text": phrase["text"],
                # Path is relative to index.html, which is what the browser needs.
                "file": f"./resources/sounds/speech/{out.name}",
                "seconds": round(seconds, 2),
            }
        )

    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\n{len(manifest)} phrases -> {OUT_DIR}  (voice: {voice_name})")
    return manifest


def wav_seconds(path):
    with wave.open(str(path), "rb") as wav:
        return wav.getnframes() / wav.getframerate()


def check():
    """One runnable check: every phrase produced audio of a believable length."""
    phrases = json.loads(PHRASES.read_text(encoding="utf-8"))
    manifest_path = OUT_DIR / "manifest.json"
    assert manifest_path.exists(), "manifest.json missing - run without --check first"

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert len(manifest) == len(phrases), f"{len(manifest)} entries for {len(phrases)} phrases"

    for entry in manifest:
        wav_path = ROOT / entry["file"].lstrip("./")
        assert wav_path.exists(), f"{wav_path} missing"
        seconds = wav_seconds(wav_path)
        # A phrase of N characters should never be shorter than N/40 seconds --
        # catches silent or truncated renders, which are the failure mode here.
        floor = len(entry["text"]) / 40
        assert seconds >= floor, f"{entry['id']}: {seconds:.1f}s is too short for {len(entry['text'])} chars"

    print(f"OK - {len(manifest)} phrases, all audible.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice", default=DEFAULT_VOICE, help="voice name (see --list)")
    parser.add_argument("--speed", type=float, default=DEFAULT_SPEED, help="1.0 is normal")
    parser.add_argument("--check", action="store_true", help="verify generated audio")
    parser.add_argument("--list", action="store_true", help="list voice choices")
    args = parser.parse_args()

    if args.list:
        print("Recommended female voices:")
        for name, desc in VOICES.items():
            print(f"  {name:<14} {desc}")
        try:
            everything = sorted(load_kokoro().get_voices())
            print(f"\nAll {len(everything)} voices shipped by the model:")
            print("  " + ", ".join(everything))
        except SystemExit:
            pass
        return

    if args.check:
        check()
        return

    build(args.voice, args.speed)
    check()


if __name__ == "__main__":
    sys.exit(main())
