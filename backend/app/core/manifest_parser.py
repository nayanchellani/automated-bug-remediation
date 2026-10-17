import json
import re
from typing import Dict, List, Tuple, Any

def parse_package_json(path: str, text: str) -> List[Tuple[str, str, str | None, bool, str]]:
    """
    Parses package.json dependencies and devDependencies.
    Returns list of (ecosystem, name, version, is_dev, source_file).
    """
    results: List[Tuple[str, str, str | None, bool, str]] = []
    try:
        data = json.loads(text)
        deps = data.get("dependencies", {})
        if isinstance(deps, dict):
            for name, version in deps.items():
                results.append(("npm", str(name), str(version) if version else None, False, path))

        dev_deps = data.get("devDependencies", {})
        if isinstance(dev_deps, dict):
            for name, version in dev_deps.items():
                results.append(("npm", str(name), str(version) if version else None, True, path))
    except Exception:
        pass
    return results

def parse_package_lock(path: str, text: str) -> List[Tuple[str, str, str | None, bool, str]]:
    """
    Parses package-lock.json (supporting v1, v2, and v3 formats).
    Returns list of (ecosystem, name, version, is_dev, source_file).
    """
    results: List[Tuple[str, str, str | None, bool, str]] = []
    try:
        data = json.loads(text)
        # Lockfile v2/v3: {"packages": {"node_modules/express": {"version": "4.18.2", "dev": true}}}
        packages = data.get("packages")
        if isinstance(packages, dict):
            for key, meta in packages.items():
                if not isinstance(meta, dict):
                    continue
                # Key is typically "node_modules/pkg" or "node_modules/a/node_modules/b"
                if "node_modules/" in key and "version" in meta:
                    pkg_name = key.split("node_modules/")[-1]
                    version = meta.get("version")
                    is_dev = bool(meta.get("dev", False))
                    results.append(("npm", pkg_name, str(version) if version else None, is_dev, path))

        # Fallback to Lockfile v1: {"dependencies": {"express": {"version": "4.18.2", "dev": true}}}
        if not results:
            dependencies = data.get("dependencies")
            if isinstance(dependencies, dict):
                for name, meta in dependencies.items():
                    if isinstance(meta, dict) and "version" in meta:
                        version = meta.get("version")
                        is_dev = bool(meta.get("dev", False))
                        results.append(("npm", str(name), str(version) if version else None, is_dev, path))
    except Exception:
        pass
    return results

def parse_requirements_txt(path: str, text: str) -> List[Tuple[str, str, str | None, bool, str]]:
    """
    Parses requirements.txt lines for PyPI dependencies.
    Only name==version gives exact version.
    Unpinned or ranged dependencies receive version as None or approximate note.
    Skips comments, options (-r, -i), and direct URLs.
    """
    results: List[Tuple[str, str, str | None, bool, str]] = []
    try:
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("-"):
                continue

            # Strip inline comments
            line = re.split(r"\s+#", line)[0].strip()

            # Skip URL-based requirements
            if "://" in line or line.startswith("git+"):
                continue

            # Exact pin: package==1.2.3
            exact_match = re.match(r"^([a-zA-Z0-9_\-\.]+)\s*==\s*([a-zA-Z0-9_\-\.]+)", line)
            if exact_match:
                name = exact_match.group(1)
                version = exact_match.group(2)
                results.append(("PyPI", name, version, False, path))
                continue

            # Inexact/unpinned match: package>=1.0, package~=2.1, package
            match = re.match(r"^([a-zA-Z0-9_\-\.]+)", line)
            if match:
                name = match.group(1)
                results.append(("PyPI", name, None, False, path))
    except Exception:
        pass
    return results

def parse_manifests(manifests: Dict[str, str]) -> List[Dict[str, Any]]:
    """
    Parses all collected manifest files.
    Priority rule: When package-lock.json exists, its exact versions are used.
    Package.json is used only if no package-lock.json is present.
    """
    has_npm_lock = any(p.endswith("package-lock.json") for p in manifests.keys())
    all_deps: List[Dict[str, Any]] = []

    for path, content in manifests.items():
        if path.endswith("package-lock.json"):
            for eco, name, ver, is_dev, src in parse_package_lock(path, content):
                all_deps.append({
                    "ecosystem": eco,
                    "name": name,
                    "version": ver,
                    "is_dev": is_dev,
                    "source_file": src,
                })
        elif path.endswith("package.json"):
            if not has_npm_lock:
                for eco, name, ver, is_dev, src in parse_package_json(path, content):
                    all_deps.append({
                        "ecosystem": eco,
                        "name": name,
                        "version": ver,
                        "is_dev": is_dev,
                        "source_file": src,
                    })
        elif path.endswith("requirements.txt"):
            for eco, name, ver, is_dev, src in parse_requirements_txt(path, content):
                all_deps.append({
                    "ecosystem": eco,
                    "name": name,
                    "version": ver,
                    "is_dev": is_dev,
                    "source_file": src,
                })

    # Deduplicate dependencies by (ecosystem, name, source_file)
    seen = set()
    deduped = []
    for dep in all_deps:
        key = (dep["ecosystem"], dep["name"], dep["source_file"])
        if key not in seen:
            seen.add(key)
            deduped.append(dep)

    return deduped
