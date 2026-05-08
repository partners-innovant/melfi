#!/usr/bin/env python3
"""Backfill `medication_categories` from `medications.therapeutic_class`.

Parses each therapeutic_class string into one or more (family, subgroup) rows
and either previews the result (dry-run, default) or inserts them (--apply).

Patterns handled:
  1. Single family + subgroup
       "Sistema Nervioso Central:\\nAntidepresivos"
       → 1 row {family="Sistema Nervioso Central", subgroup="Antidepresivos",
                is_primary=true}
  2. Multi-family (alternating Familia:/Subgrupo lines)
       "F1:\\nS1\\nF2:\\nS2"
       → 2 rows, first is_primary=true
  3. Three-level (subfamily flattened)
       "Antiinfecciosos de Uso Sistémico: Antibióticos:\\nAminoglucósidos"
       → 1 row {family="Antiinfecciosos de Uso Sistémico",
                subgroup="Antibióticos Aminoglucósidos"}
"""

import argparse
import os
import sys
from typing import List, Optional, Tuple

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY")
    or os.environ.get("SUPABASE_ANON_KEY")
)


def parse_therapeutic_class(tc: str) -> Tuple[List[dict], Optional[str], bool]:
    """Return (rows, error, had_subfamily).

    Rows are dicts {family, subgroup, is_primary}; first row gets is_primary=True.
    error is None if parsed cleanly, otherwise a short reason string.
    had_subfamily flags any 3-level subfamily flattening that occurred.
    """
    if not tc or not tc.strip():
        return [], "empty therapeutic_class", False

    lines = [l.strip() for l in tc.split("\n") if l.strip()]
    rows: List[dict] = []
    pending_family: Optional[str] = None
    pending_subfamily_prefix: Optional[str] = None
    had_subfamily = False

    for line in lines:
        if line.endswith(":"):
            inner = line[:-1].strip()
            if ":" in inner:
                # 3-level: "Family: Subfamily" — split on the FIRST colon only.
                fam, sub = inner.split(":", 1)
                pending_family = fam.strip()
                pending_subfamily_prefix = sub.strip()
                had_subfamily = True
            else:
                pending_family = inner
                pending_subfamily_prefix = None
        else:
            # Subgroup line (no trailing colon).
            if pending_family is None:
                return [], f"orphan subgroup line: {line!r}", had_subfamily
            subgroup = (
                f"{pending_subfamily_prefix} {line}"
                if pending_subfamily_prefix
                else line
            )
            rows.append(
                {
                    "family": pending_family,
                    "subgroup": subgroup,
                    "is_primary": len(rows) == 0,
                }
            )
            pending_family = None
            pending_subfamily_prefix = None

    # Trailing family with no subgroup → row with subgroup=None.
    if pending_family is not None:
        rows.append(
            {
                "family": pending_family,
                "subgroup": None,
                "is_primary": len(rows) == 0,
            }
        )

    if not rows:
        return [], "no rows produced", had_subfamily
    return rows, None, had_subfamily


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--apply",
        action="store_true",
        help="Actually insert rows. Default is dry-run only.",
    )
    args = p.parse_args()

    if not (SUPABASE_URL and SUPABASE_KEY):
        print("Missing Supabase credentials in .env", file=sys.stderr)
        return 1

    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Inform on current pivot state (always, both modes — replaces the
    # previous abort-on-non-empty safeguard with observability).
    existing_resp = (
        client.table("medication_categories")
        .select("id", count="exact", head=True)
        .execute()
    )
    pivot_existing = existing_resp.count or 0

    # IDs already covered by the pivot — used to filter the incremental set.
    already_in_pivot: set = set()
    page = 0
    while True:
        r = (
            client.table("medication_categories")
            .select("medication_id")
            .range(page * 1000, page * 1000 + 999)
            .execute()
        )
        if not r.data:
            break
        for row in r.data:
            already_in_pivot.add(row["medication_id"])
        if len(r.data) < 1000:
            break
        page += 1

    # Pull all medications, paginated (the table now exceeds 1000 rows).
    meds_all: List[dict] = []
    page = 0
    while True:
        r = (
            client.table("medications")
            .select("id,name,therapeutic_class")
            .range(page * 1000, page * 1000 + 999)
            .execute()
        )
        if not r.data:
            break
        meds_all.extend(r.data)
        if len(r.data) < 1000:
            break
        page += 1

    # Incremental: only meds without rows in the pivot get processed.
    meds = [m for m in meds_all if m["id"] not in already_in_pivot]

    counts = {"single": 0, "multi": 0, "subfamily": 0}
    not_parseable: List[dict] = []
    parsed: List[Tuple[str, str, List[dict], str, str]] = []  # (id, name, rows, category, tc)

    for med in meds:
        med_id = med["id"]
        name = med["name"]
        tc = med.get("therapeutic_class") or ""
        rows, err, had_subfam = parse_therapeutic_class(tc)

        if err:
            not_parseable.append({"id": med_id, "name": name, "tc": tc, "err": err})
            continue

        if had_subfam:
            category = "subfamily"
        elif len(rows) > 1:
            category = "multi"
        else:
            category = "single"
        counts[category] += 1
        parsed.append((med_id, name, rows, category, tc))

    total_to_insert = sum(len(r) for _, _, r, _, _ in parsed)

    print("=== DRY RUN — backfill_categories ===" if not args.apply else "=== APPLY MODE ===")
    print()
    print(f"Estado de la pivot:")
    print(f"  filas existentes:                   {pivot_existing}")
    print(f"  medications en DB:                  {len(meds_all)}")
    print(f"    · ya con filas en pivot (skip):   {len(meds_all) - len(meds)}")
    print(f"    · a procesar (incremental):       {len(meds)}")
    print()
    print(f"{len(meds)} medicamentos procesados → {total_to_insert} filas a insertar")
    print(f"  · {counts['single']:>3} single-family (1 fila c/u)")
    print(f"  · {counts['multi']:>3} multi-family (varias filas)")
    print(f"  · {counts['subfamily']:>3} con subfamily aplanada (tres niveles)")
    print(f"  · {len(not_parseable):>3} no parseables")
    print()
    print(f"Total proyectado en pivot post-backfill: {pivot_existing + total_to_insert}")

    if not_parseable:
        print()
        print(f"=== {len(not_parseable)} no parseables (NO se insertarán) ===")
        for x in not_parseable:
            tc_disp = x["tc"].replace("\n", "\\n")[:160]
            print(f"  · id={x['id']}")
            print(f"    name: {x['name']}")
            print(f"    err:  {x['err']}")
            print(f"    tc:   {tc_disp!r}")

    # Sample output for visual spot-check (3 of each category).
    print()
    print("=== Sample del parser (3 ejemplos por categoría) ===")
    samples = {c: [] for c in ("single", "multi", "subfamily")}
    for entry in parsed:
        cat = entry[3]
        if len(samples[cat]) < 3:
            samples[cat].append(entry)

    for cat_label, key in (("single-family", "single"), ("multi-family", "multi"), ("subfamily-aplanada", "subfamily")):
        print(f"\n  -- {cat_label} --")
        for med_id, name, rows, _, tc in samples[key]:
            tc_disp = tc.replace("\n", "\\n")
            print(f"    {name:<30} | tc: {tc_disp!r}")
            for r in rows:
                p_flag = " ★PRI" if r["is_primary"] else "     "
                sub = r["subgroup"] if r["subgroup"] is not None else "(NULL)"
                print(f"      {p_flag}  family={r['family']!r:<45}  subgroup={sub!r}")

    if not args.apply:
        print()
        print("Dry-run completado. Para insertar, re-ejecutar con: python3 backfill_categories.py --apply")
        return 0

    # APPLY: insert in batches.
    payload: List[dict] = []
    for med_id, _, rows, _, _ in parsed:
        for r in rows:
            payload.append(
                {
                    "medication_id": med_id,
                    "family": r["family"],
                    "subgroup": r["subgroup"],
                    "is_primary": r["is_primary"],
                }
            )

    BATCH = 100
    inserted = 0
    for i in range(0, len(payload), BATCH):
        chunk = payload[i : i + BATCH]
        client.table("medication_categories").insert(chunk).execute()
        inserted += len(chunk)
        print(f"  insertados {inserted}/{len(payload)}")

    print(f"\n✅ {inserted} filas insertadas en medication_categories")
    return 0


if __name__ == "__main__":
    sys.exit(main())
