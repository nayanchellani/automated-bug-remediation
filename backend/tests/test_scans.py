import io
import json
import zipfile
import pytest
from httpx import AsyncClient, ASGITransport

from app.core.security import generate_api_key, create_access_token
from app.models.user import User
from app.models.project import Project
from app.models.api_key import ApiKey
from app.main import app


def make_zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


async def _create_user_project_key(test_db, email: str):
    async with test_db() as session:
        user = User(email=email, password_hash="hash")
        session.add(user)
        await session.commit()
        await session.refresh(user)

        project = Project(name="Scan App", user_id=user.id)
        session.add(project)
        await session.commit()
        await session.refresh(project)

        raw_key, prefix, key_hash = generate_api_key()
        session.add(ApiKey(project_id=project.id, prefix=prefix, key_hash=key_hash))
        await session.commit()
        return user.id, project.id, raw_key


@pytest.mark.asyncio
async def test_nested_folders_appear_in_snapshot_tree(test_db):
    user_id, project_id, raw_key = await _create_user_project_key(test_db, "nested@example.com")
    zip_bytes = make_zip({
        "server.js": "console.log(1)",
        "public/Counter.jsx": "const a = 1",
        "public/index.html": "<html></html>",
        "src/components/ui/Button.tsx": "export const B = 1",
    })

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/snapshots",
            headers={"X-API-Key": raw_key},
            files={"file": ("project.zip", zip_bytes, "application/zip")},
        )
        assert res.status_code == 201
        paths = {item["path"] for item in res.json()["tree"]}
        assert "public/Counter.jsx" in paths
        assert "public/index.html" in paths
        assert "src/components/ui/Button.tsx" in paths


@pytest.mark.asyncio
async def test_scan_reports_syntax_json_and_lint_findings(test_db):
    user_id, project_id, raw_key = await _create_user_project_key(test_db, "scanner@example.com")
    token = create_access_token(subject=user_id)
    auth = {"Authorization": f"Bearer {token}"}

    zip_bytes = make_zip({
        # Syntax error inside a nested folder (JSX tag never closed)
        "public/Counter.jsx": "function C() {\n  return <div>hi</div\n}\n",
        # Lint: undefined variable + unreachable code
        "server.js": "function f() {\n  return notDefinedAnywhere\n  console.log('dead')\n}\nmodule.exports = f\n",
        # Broken JSON (trailing comma)
        "package.json": '{\n  "name": "x",\n}\n',
        # Clean TypeScript file must produce no findings
        "src/deep/ok.ts": "export function add(a: number, b: number): number { return a + b }\n",
    })

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/snapshots",
            headers={"X-API-Key": raw_key},
            files={"file": ("project.zip", zip_bytes, "application/zip")},
        )
        assert res.status_code == 201

        res = await client.post(f"/projects/{project_id}/scans", headers=auth)
        assert res.status_code == 201
        scan = res.json()
        assert scan["status"] == "completed", scan.get("error")
        assert scan["files_analyzed"] == 4

        res = await client.get(f"/projects/{project_id}/findings", headers=auth)
        assert res.status_code == 200
        findings = res.json()
        by_rule = {}
        for f in findings:
            by_rule.setdefault(f["rule"], []).append(f)

        syntax = by_rule["syntax-error"]
        assert syntax[0]["file"] == "public/Counter.jsx"
        assert syntax[0]["severity"] == "error"
        assert syntax[0]["type"] == "syntax"
        assert "div" in syntax[0]["snippet"]

        assert by_rule["json-parse-error"][0]["file"] == "package.json"
        assert by_rule["json-parse-error"][0]["line"] == 3

        assert by_rule["no-undef"][0]["message"] == "'notDefinedAnywhere' is not defined"
        assert by_rule["no-undef"][0]["file"] == "server.js"
        assert by_rule["no-unreachable"][0]["line"] == 3

        assert not any(f["file"] == "src/deep/ok.ts" for f in findings)

        # Errors are listed before warnings
        severities = [f["severity"] for f in findings]
        assert severities == sorted(severities)

        # Filters
        res = await client.get(f"/projects/{project_id}/findings?severity=error", headers=auth)
        assert all(f["severity"] == "error" for f in res.json())
        res = await client.get(f"/projects/{project_id}/findings?type=lint", headers=auth)
        assert all(f["type"] == "lint" for f in res.json())

        res = await client.get(f"/projects/{project_id}/scans/latest", headers=auth)
        assert res.status_code == 200
        assert res.json()["finding_count"] == len(findings)


@pytest.mark.asyncio
async def test_scan_requires_snapshot_and_ownership(test_db):
    user_a_id, project_a_id, _ = await _create_user_project_key(test_db, "scan_a@example.com")
    user_b_id, _, _ = await _create_user_project_key(test_db, "scan_b@example.com")
    auth_a = {"Authorization": f"Bearer {create_access_token(subject=user_a_id)}"}
    auth_b = {"Authorization": f"Bearer {create_access_token(subject=user_b_id)}"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # No snapshot yet -> 404
        res = await client.post(f"/projects/{project_a_id}/scans", headers=auth_a)
        assert res.status_code == 404

        # No scan yet -> empty findings and 404 latest
        res = await client.get(f"/projects/{project_a_id}/findings", headers=auth_a)
        assert res.status_code == 200 and res.json() == []
        res = await client.get(f"/projects/{project_a_id}/scans/latest", headers=auth_a)
        assert res.status_code == 404

        # Other user cannot touch the project
        for method, url in (
            ("post", f"/projects/{project_a_id}/scans"),
            ("get", f"/projects/{project_a_id}/scans/latest"),
            ("get", f"/projects/{project_a_id}/findings"),
        ):
            res = await getattr(client, method)(url, headers=auth_b)
            assert res.status_code == 404

        # Unauthenticated -> 401
        res = await client.post(f"/projects/{project_a_id}/scans")
        assert res.status_code == 401
