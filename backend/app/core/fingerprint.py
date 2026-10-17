import hashlib
import re
from typing import Any

def _norm(path: str) -> str:
    return path.replace("\\", "/").removeprefix("file://").removeprefix("./")

def compute_fingerprint(name: str, message: str, frames: list[Any]) -> tuple[str, Any | None]:
    """
    Computes an authoritative server-side fingerprint.
    Picks the first in-app frame and hashes it.
    If no usable frame exists, falls back to error name + normalized message with IDs/numbers stripped.
    """
    frame = next((f for f in frames if getattr(f, "in_app", False)), None)
    if frame:
        file_path = getattr(frame, "file", "") or ""
        line_num = getattr(frame, "line", 0) or 0
        func_name = getattr(frame, "function", "") or ""
        raw = f"{name}|{_norm(file_path)}|{line_num}|{func_name}"
    else:
        # no usable frame: fall back to name + message with numbers/hex UUIDs stripped
        normalized_msg = re.sub(r'[0-9a-fA-F-]{6,}|\d+', '#', message)
        raw = f"{name}|{normalized_msg}"

    return hashlib.sha256(raw.encode()).hexdigest(), frame
