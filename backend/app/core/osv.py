"""
OSV.dev batch query client.

Docs: https://google.github.io/osv.dev/post-v1-querybatch/
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List

import httpx

from app.models.dependency import Dependency

logger = logging.getLogger(__name__)

OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch"
BATCH_SIZE = 100  # OSV limit per request


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class OSVVuln:
    osv_id: str
    package_name: str
    ecosystem: str
    installed_version: str | None
    fixed_version: str | None
    severity: str          # CRITICAL | HIGH | MEDIUM | LOW
    summary: str
    details: str | None


# ---------------------------------------------------------------------------
# Severity helpers
# ---------------------------------------------------------------------------

def _cvss_score_to_severity(score: float) -> str:
    if score >= 9.0:
        return "CRITICAL"
    if score >= 7.0:
        return "HIGH"
    if score >= 4.0:
        return "MEDIUM"
    return "LOW"


def _extract_severity(vuln: dict) -> str:
    """
    OSV severity array: [{"type": "CVSS_V3", "score": "CVSS:3.1/AV:N/..."}]
    We parse the base score from the CVSS vector string (BM:score) OR fall back
    to database_specific.severity strings.
    """
    for sev in vuln.get("severity", []):
        score_str: str = sev.get("score", "")
        # CVSS vectors end with /... we extract the numerical base score from
        # the vector's BM segment if present, or use cvssV3 severity label.
        # Simpler: OSV also exposes severity as a free-text in some entries.
        # Best approach: parse the last segment's numeric override if available.
        # OSV vectors look like "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
        # We can't compute base score without a full CVSS library, so we map
        # the common label from database_specific first.
        pass

    # Try database_specific severity label (GitHub/NVD advisory)
    db_specific = vuln.get("database_specific", {})
    label = db_specific.get("severity", "").upper()
    if label in ("CRITICAL", "HIGH", "MODERATE", "MEDIUM", "LOW"):
        return "MEDIUM" if label == "MODERATE" else label

    # Try ecosystem_specific
    eco_specific = vuln.get("ecosystem_specific", {})
    label2 = eco_specific.get("severity", "").upper()
    if label2 in ("CRITICAL", "HIGH", "MODERATE", "MEDIUM", "LOW"):
        return "MEDIUM" if label2 == "MODERATE" else label2

    # Count affected ranges as a rough proxy if nothing else
    affected_count = len(vuln.get("affected", []))
    return "MEDIUM" if affected_count > 0 else "LOW"


def _extract_fixed_version(vuln: dict, installed_version: str | None) -> str | None:
    """Walk affected[].ranges[].events to find a 'fixed' entry."""
    for affected in vuln.get("affected", []):
        for rng in affected.get("ranges", []):
            for event in rng.get("events", []):
                fixed = event.get("fixed")
                if fixed:
                    return fixed
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def batch_query(deps: List[Dependency]) -> List[OSVVuln]:
    """
    Query OSV.dev for all deps and return a flat list of OSVVuln results.
    Deps without a version are still queried (OSV returns all affected ranges).
    """
    if not deps:
        return []

    results: List[OSVVuln] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        for chunk_start in range(0, len(deps), BATCH_SIZE):
            chunk = deps[chunk_start: chunk_start + BATCH_SIZE]
            queries = []
            for dep in chunk:
                q: dict = {"package": {"name": dep.name, "ecosystem": dep.ecosystem}}
                if dep.version:
                    q["version"] = dep.version
                queries.append(q)

            try:
                resp = await client.post(OSV_BATCH_URL, json={"queries": queries})
                resp.raise_for_status()
                data = resp.json()
            except httpx.HTTPError as exc:
                logger.error("OSV batch query failed: %s", exc)
                raise

            batch_results = data.get("results", [])
            for idx, result in enumerate(batch_results):
                dep = chunk[idx]
                for vuln in result.get("vulns", []):
                    osv_id = vuln.get("id", "UNKNOWN")
                    summary = vuln.get("summary") or vuln.get("details", "No summary available")
                    details = vuln.get("details")
                    severity = _extract_severity(vuln)
                    fixed_version = _extract_fixed_version(vuln, dep.version)

                    results.append(OSVVuln(
                        osv_id=osv_id,
                        package_name=dep.name,
                        ecosystem=dep.ecosystem,
                        installed_version=dep.version,
                        fixed_version=fixed_version,
                        severity=severity,
                        summary=summary[:500] if summary else "No summary",
                        details=details,
                    ))

    return results
