import json
import os
import subprocess
import tempfile
import zipfile
from pathlib import PurePosixPath
from typing import Any

from app.core.config import settings

ANALYZER_DIR = settings.ANALYZER_DIR or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "analyzer")
)
ANALYZER_SCRIPT = os.path.join(ANALYZER_DIR, "analyze.mjs")

ANALYZER_TIMEOUT_SECONDS = 60
MAX_FINDINGS = 2000
MAX_EXTRACT_BYTES = 100 * 1024 * 1024  # 100 MB total
MAX_EXTRACT_FILE_BYTES = 2 * 1024 * 1024  # 2 MB per file

ANALYZABLE_EXTENSIONS = {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".json"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "coverage", ".next", ".vscode", "__pycache__", ".venv"}


class AnalyzerError(Exception):
    """Raised when the analyzer cannot run or returns unusable output."""


def _extract_analyzable(archive_path: str, dest: str) -> None:
    """Safely extracts only analyzable source files from the snapshot archive."""
    try:
        zf = zipfile.ZipFile(archive_path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise AnalyzerError(f"Snapshot archive unreadable: {exc}") from exc

    dest_real = os.path.realpath(dest)
    total = 0
    with zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            p = PurePosixPath(info.filename)
            if p.is_absolute() or ".." in p.parts:
                continue  # zip-slip: never extract
            if any(part in SKIP_DIRS for part in p.parts[:-1]):
                continue
            if p.suffix.lower() not in ANALYZABLE_EXTENSIONS:
                continue
            if info.file_size > MAX_EXTRACT_FILE_BYTES:
                continue
            total += info.file_size
            if total > MAX_EXTRACT_BYTES:
                raise AnalyzerError("Snapshot too large to analyze")

            target = os.path.realpath(os.path.join(dest_real, *p.parts))
            if os.path.commonpath([dest_real, target]) != dest_real:
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as out:
                out.write(src.read())


def run_analysis(archive_path: str) -> tuple[int, list[dict[str, Any]]]:
    """
    Extracts analyzable files from the snapshot zip into a temp dir and runs the
    Node analyzer on them. Blocking: call via asyncio.to_thread.
    Returns (files_analyzed, findings).
    """
    if not os.path.exists(ANALYZER_SCRIPT):
        raise AnalyzerError(f"Analyzer script not found at {ANALYZER_SCRIPT}")
    if not os.path.isdir(os.path.join(ANALYZER_DIR, "node_modules")):
        raise AnalyzerError("Analyzer dependencies not installed. Run 'npm ci' in backend/analyzer.")
    if not os.path.exists(archive_path):
        raise AnalyzerError("Snapshot archive is missing from storage. Push a new snapshot.")

    with tempfile.TemporaryDirectory(prefix="triage-scan-") as tmp:
        _extract_analyzable(archive_path, tmp)
        try:
            proc = subprocess.run(
                [settings.NODE_BIN, ANALYZER_SCRIPT, tmp],
                capture_output=True,
                timeout=ANALYZER_TIMEOUT_SECONDS,
                cwd=ANALYZER_DIR,
            )
        except FileNotFoundError as exc:
            raise AnalyzerError(f"Node.js not found (NODE_BIN='{settings.NODE_BIN}')") from exc
        except subprocess.TimeoutExpired as exc:
            raise AnalyzerError(f"Analyzer timed out after {ANALYZER_TIMEOUT_SECONDS}s") from exc

    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", "ignore").strip()[-500:]
        raise AnalyzerError(f"Analyzer exited with code {proc.returncode}: {stderr}")

    try:
        data = json.loads(proc.stdout.decode("utf-8", "ignore"))
        findings = data["findings"]
        files_analyzed = int(data.get("filesAnalyzed", 0))
    except (ValueError, KeyError, TypeError) as exc:
        raise AnalyzerError("Analyzer returned invalid output") from exc

    return files_analyzed, findings[:MAX_FINDINGS]
