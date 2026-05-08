#!/usr/bin/env python3
"""Scrape MFT product pages P1000..P1050 and upsert each into Supabase.

Reuses the extractor and config from test_scraper.py. Throttles 1 req/s.
Idempotent: re-running updates rows by source_url instead of duplicating.
"""

import sys
import time
from typing import Tuple

import requests
from supabase import Client, create_client

from test_scraper import (
    FIELD_TO_COLUMN,
    SUPABASE_KEY,
    SUPABASE_URL,
    USER_AGENT,
    clean_text,
    extract,
)

START = 1000
END = 1050  # inclusive
DELAY = 1.0  # seconds between requests
URL_TEMPLATE = "https://www.colegiofarmaceutico.cl/MFT/PRODUCTO/P{n}.HTM"


def is_empty(data: dict) -> bool:
    """A page counts as 'empty' if we couldn't get a name or any substantive
    content — this avoids inserting placeholder rows for missing IDs."""
    if not data.get("nombre"):
        return True
    main_fields = (
        "composicion", "indicaciones", "droga_activa", "laboratorio",
        "contraindicaciones", "efectos_adversos",
    )
    return not any(data.get(k) for k in main_fields)


def upsert(client: Client, data: dict, source_url: str) -> Tuple[str, str]:
    """Returns (status, detail). status ∈ {'inserted', 'updated', 'error'}."""
    payload = {col: clean_text(data.get(field)) for field, col in FIELD_TO_COLUMN.items()}
    payload["source_url"] = source_url
    payload = {k: v for k, v in payload.items() if v is not None}
    if "name" not in payload:
        return ("error", "sin nombre")
    try:
        existing = (
            client.table("medications")
            .select("id")
            .eq("source_url", source_url)
            .limit(1)
            .execute()
        )
        if existing.data:
            row_id = existing.data[0]["id"]
            client.table("medications").update(payload).eq("id", row_id).execute()
            return ("updated", row_id)
        res = client.table("medications").insert(payload).execute()
        new_id = res.data[0]["id"] if res.data else "?"
        return ("inserted", new_id)
    except Exception as e:
        return ("error", str(e)[:120])


def main() -> int:
    if not (SUPABASE_URL and SUPABASE_KEY):
        print("Faltan credenciales en .env", file=sys.stderr)
        return 1

    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
    }

    counts = {"inserted": 0, "updated": 0, "empty": 0, "404": 0, "error": 0}

    for n in range(START, END + 1):
        code = f"P{n}"
        url = URL_TEMPLATE.format(n=n)
        print(f"{code}... ", end="", flush=True)

        try:
            r = requests.get(url, headers=headers, timeout=15)
        except requests.RequestException as e:
            print(f"error de red ({e.__class__.__name__})")
            counts["error"] += 1
            if n < END:
                time.sleep(DELAY)
            continue

        if r.status_code == 404:
            print("404")
            counts["404"] += 1
        elif not r.ok:
            print(f"HTTP {r.status_code}")
            counts["error"] += 1
        else:
            data = extract(r.content)
            if is_empty(data):
                print("vacío")
                counts["empty"] += 1
            else:
                status, detail = upsert(client, data, url)
                if status in ("inserted", "updated"):
                    name = (data.get("nombre") or "?")[:40]
                    print(f"OK [{name}]")
                    counts[status] += 1
                else:
                    print(f"error: {detail}")
                    counts["error"] += 1

        if n < END:
            time.sleep(DELAY)

    total = sum(counts.values())
    print()
    print(f"Resumen ({total} URLs): "
          f"{counts['inserted']} insertados · {counts['updated']} actualizados · "
          f"{counts['empty']} vacíos · {counts['404']} 404 · {counts['error']} errores")
    return 0


if __name__ == "__main__":
    sys.exit(main())
