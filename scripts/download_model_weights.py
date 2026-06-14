"""
Download pretrained model checkpoints used by PadelPro.

Usage:
    python scripts/download_model_weights.py --model wasb
    python scripts/download_model_weights.py --model e2e_spot
    python scripts/download_model_weights.py --all

Models:
  wasb       MIT, WASB ball detector (tennis weights, fine-tunable for padel)
  e2e_spot   BSD-3, E2E-Spot stroke-boundary detector (tennis weights)

Notes:
  - Weights are not bundled in this repo (size + licence reasons).
  - Run this script once on the training machine / Modal instance.
  - Render (the inference server) does NOT need these — Gemini handles analysis.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

CKPT_DIR = Path("checkpoints")

# Registry: name → {url, sha256 (first 8 chars), dest}
# TODO: fill in real URLs once we host the fine-tuned checkpoints.
_MODELS: dict[str, dict] = {
    "wasb": {
        "url": None,  # Placeholder — update when WASB paddle weights are ready
        "sha256_prefix": None,
        "dest": CKPT_DIR / "wasb_ball.pth",
        "note": (
            "WASB ball-detector weights are not yet hosted publicly.\n"
            "Fine-tune from the tennis weights using annotated padel frames:\n"
            "  python scripts/train_stroke_classifier.py --task ball"
        ),
    },
    "e2e_spot": {
        "url": None,  # Placeholder — original tennis weights from the E2E-Spot repo
        "sha256_prefix": None,
        "dest": CKPT_DIR / "e2e_spot_tennis.pth",
        "note": (
            "Download the original E2E-Spot tennis checkpoint from:\n"
            "  https://github.com/jhong93/e2e-spot\n"
            "and place it at checkpoints/e2e_spot_tennis.pth"
        ),
    },
}


def _download(url: str, dest: Path, sha256_prefix: str | None = None) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url} → {dest} …")
    tmp = dest.with_suffix(".tmp")
    try:
        urllib.request.urlretrieve(url, tmp)
        if sha256_prefix:
            h = hashlib.sha256(tmp.read_bytes()).hexdigest()
            if not h.startswith(sha256_prefix):
                tmp.unlink(missing_ok=True)
                raise RuntimeError(
                    f"Checksum mismatch: expected prefix {sha256_prefix!r}, got {h[:8]!r}"
                )
        tmp.rename(dest)
        print(f"  ✓  Saved to {dest}")
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Download PadelPro model weights")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--model", choices=list(_MODELS), help="Model to download")
    group.add_argument("--all", action="store_true", help="Download all models")
    args = parser.parse_args(argv)

    names = list(_MODELS) if args.all else [args.model]
    errors = []
    for name in names:
        m = _MODELS[name]
        dest: Path = m["dest"]
        if dest.exists():
            print(f"[{name}] Already present at {dest} — skipping.")
            continue
        url: str | None = m.get("url")
        if not url:
            print(f"[{name}] {m.get('note', 'No URL configured yet.')}")
            errors.append(name)
            continue
        try:
            _download(url, dest, m.get("sha256_prefix"))
        except Exception as exc:
            print(f"[{name}] Download failed: {exc}", file=sys.stderr)
            errors.append(name)

    if errors:
        print(f"\nCould not download: {', '.join(errors)}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
