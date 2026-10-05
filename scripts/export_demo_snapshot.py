#!/usr/bin/env python3
"""Export the two seeded demo workspaces from a running stack into frontend/src/demo/snapshot.json
(the data served by the frontend's VITE_DEMO_MODE=true mock API).

    python3 scripts/export_demo_snapshot.py [--api http://localhost:8000/api/v1]
"""
import argparse
import json
import pathlib
import urllib.request

DEMOS = ("NordWave Networks", "LedgerLeaf")
OUT = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "src" / "demo" / "snapshot.json"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000/api/v1")
    ap.add_argument("--email", default="demo@selloq.local")
    ap.add_argument("--password", default="demo1234")
    a = ap.parse_args()

    def req(path, body=None, tok=None):
        headers = {"Content-Type": "application/json"}
        if tok:
            headers["Authorization"] = "Bearer " + tok
        data = json.dumps(body).encode() if body is not None else None
        return json.load(urllib.request.urlopen(urllib.request.Request(a.api + path, data=data, headers=headers)))

    tok = req("/auth/login", {"email": a.email, "password": a.password})["access_token"]
    get = lambda p: req(p, tok=tok)  # noqa: E731
    snap = {"workspaces": []}
    for w in get("/workspaces"):
        if w["name"] not in DEMOS or not w["company"] or w["company"]["status"] != "leads_ready":
            continue
        cid = w["company"]["id"]
        leads = [get(f"/leads/{lead['id']}") for lead in get(f"/companies/{cid}/leads?page_size=100")["items"]]
        for lead in leads:
            lead["activities"] = []
        snap["workspaces"].append(
            {
                "workspace": {k: w[k] for k in ("id", "name", "created_at")},
                "company": get(f"/companies/{cid}"),
                "status": get(f"/companies/{cid}/status"),
                "sources": get(f"/companies/{cid}/sources"),
                "icp_versions": get(f"/companies/{cid}/icp/versions"),
                "signals": get(f"/companies/{cid}/signals"),
                "runs": get(f"/companies/{cid}/runs"),
                "leads": leads,
            }
        )
    if len(snap["workspaces"]) != len(DEMOS):
        raise SystemExit(f"expected {len(DEMOS)} finished demo workspaces, found {len(snap['workspaces'])}")
    OUT.write_text(json.dumps(snap, indent=1, ensure_ascii=False))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
