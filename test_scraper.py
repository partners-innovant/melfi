#!/usr/bin/env python3
"""Test scraper for a single Colegio Farmacéutico de Chile MFT page.

Downloads one product page, extracts the standard MFT sections, and prints
the result. Used to validate parsing assumptions before running on the
full vademécum.
"""

import os
import re
import sys
import unicodedata
from typing import Optional

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from supabase import create_client, Client

# Load Supabase credentials from the project's .env (sibling to this script).
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
# Prefer service-role for backend scripts; fall back to the publishable (anon) key.
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY")
    or os.environ.get("SUPABASE_ANON_KEY")
)

URL = "https://www.colegiofarmaceutico.cl/MFT/PRODUCTO/P1723.HTM"

# Maps the scraper's field names to the columns of the `medications` table.
FIELD_TO_COLUMN = {
    "nombre": "name",
    "laboratorio": "laboratory",
    "droga_activa": "active_ingredient",
    "clase_terapeutica": "therapeutic_class",
    "composicion": "composition",
    "indicaciones": "indications",
    "contraindicaciones": "contraindications",
    "efectos_adversos": "adverse_effects",
    "interacciones": "interactions",
    "posologia": "dosage",
    "precauciones": "precautions",
    "presentations": "presentations",
}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)

# Map of accent-folded section labels → canonical field key.
SECTION_MAP = {
    # composition
    "composicion": "composicion",
    # indications
    "indicaciones": "indicaciones",
    # contraindications
    "contraindicaciones": "contraindicaciones",
    # adverse effects
    "efectos adversos": "efectos_adversos",
    "efectos colaterales": "efectos_adversos",
    "reacciones adversas": "efectos_adversos",
    # interactions
    "interacciones": "interacciones",
    "interacciones medicamentosas": "interacciones",
    # posology
    "posologia": "posologia",
    "dosis": "posologia",
    # precautions
    "precauciones": "precauciones",
    "advertencias": "precauciones",
    "advertencias y precauciones": "precauciones",
    # therapeutic class (singular & plural — MFT uses "Clases Terapéuticas")
    "clase terapeutica": "clase_terapeutica",
    "clases terapeuticas": "clase_terapeutica",
    # active ingredient (MFT uses "Drogas")
    "droga activa": "droga_activa",
    "drogas": "droga_activa",
    "principio activo": "droga_activa",
    "principios activos": "droga_activa",
    # laboratory (MFT uses "Laboratorios <name>")
    "laboratorio": "laboratorio",
    "laboratorios": "laboratorio",
    # presentations section (raw text — parsed separately to populate the
    # presentations[] array; not written to the DB as-is)
    "presentaciones": "presentaciones_raw",
}

# Sub-headers that should close the current bucket without opening a new one.
# This stops leakage from target sections into descriptive sub-sections we
# don't store (e.g. "Indicaciones" → bleeds into "Propiedades" → "Mecanismo
# de acción"… until "Posología" finally appears).
DROP_LABELS = {
    "propiedades",
    "accion terapeutica",
    "mecanismo de accion",
    "caracteristicas farmacocineticas",
    "informacion farmacologica",
    "sobredosificacion",
}

# `\b` after the alternation prevents "laboratorio" from matching "laboratorios"
# (and similarly for other singular/plural confusions).
_ALT = "|".join(re.escape(k) for k in sorted(SECTION_MAP.keys(), key=len, reverse=True))
HEADER_RE = re.compile(rf"^\s*({_ALT})\b", re.IGNORECASE)

_DROP_ALT = "|".join(re.escape(k) for k in sorted(DROP_LABELS, key=len, reverse=True))
DROP_RE = re.compile(rf"^\s*({_DROP_ALT})\b", re.IGNORECASE)

# Pharmaceutical forms that mark the start of a presentation line in the
# Composición section (e.g. "Comprimidos 5 mg:", "Solución oral 20 mg/ml:",
# "Cápsulas blandas 100 mg:"). Matches the form word at the line start, then
# any descriptors up to a colon or end-of-line.
PRESENTATION_RE = re.compile(
    r"^\s*("
    r"comprimidos?|c[áa]psulas?|tabletas?|gr[aá]geas?|dr[áa]geas?|"
    r"jarabe|"
    r"soluci[óo]n|suspensi[óo]n|emulsi[óo]n|"
    r"crema|pomada|ung[üu]ento|gel|loci[óo]n|champ[úu]|"
    r"inyecci[óo]n|ampollas?|vial|frasco[\s-]?ampolla|"
    r"gotas|polvo|sobres?|supositorios?|[óo]vulos?|parches?|"
    r"aerosol|spray|inhalador"
    r")\b[^:\n]*",
    re.IGNORECASE,
)


def extract_presentations(*sources: Optional[str]) -> list:
    """Return individual presentation strings deduped, trimmed of trailing
    colons. Reads from multiple text blocks in priority order — typically
    the 'Presentaciones' section (most authoritative; lists envases) followed
    by 'Composición' as a fallback. For SOMNO returns
    ['Comprimidos 5 mg', 'Comprimidos 10 mg']."""
    out: list = []
    seen: set = set()
    for source in sources:
        if not source:
            continue
        for line in source.split("\n"):
            m = PRESENTATION_RE.match(line.strip())
            if not m:
                continue
            text = re.sub(r"\s+", " ", m.group(0)).strip().rstrip(":").strip()
            # Defensive — ignore body sentences that happen to start with a form
            # word (e.g. "Comprimidos contienen el principio activo...").
            if not text or "contiene" in text.lower():
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(text)
    return out


def fold(s: str) -> str:
    """Lowercase + strip diacritics. Length-preserving for Latin scripts,
    so positions in the folded string equal positions in the original."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower()


def extract(html_bytes: bytes) -> dict:
    soup = BeautifulSoup(html_bytes, "lxml")

    # Title: first prominent heading, fallback to <title>.
    name: Optional[str] = None
    for tag in ("h1", "h2", "h3"):
        el = soup.find(tag)
        if el:
            t = el.get_text(" ", strip=True)
            if t and len(t) < 200:
                name = t
                break
    if not name and soup.title:
        name = soup.title.get_text(strip=True) or None

    # Flatten document to lines and bucket them by section.
    raw = soup.get_text("\n")
    lines = [re.sub(r"\s+", " ", l).strip() for l in raw.splitlines()]
    lines = [l for l in lines if l]

    buckets: dict[str, list[str]] = {}
    current: Optional[str] = None

    for line in lines:
        folded = fold(line)
        m = HEADER_RE.match(folded)
        if m:
            key = SECTION_MAP.get(m.group(1))
            if key:
                current = key
                buckets.setdefault(current, [])
                # Take everything after the matched keyword from the *original*
                # line, then strip leading separator chars. fold() preserves
                # offsets so m.end(1) is valid in `line` too.
                rest = re.sub(r"^[\s:\-–]+", "", line[m.end(1):]).strip()
                if rest:
                    buckets[current].append(rest)
                continue
        if DROP_RE.match(folded):
            current = None
            continue
        if current:
            buckets[current].append(line)

    result: dict[str, Optional[str]] = {
        "nombre": name,
        "laboratorio": None,
        "droga_activa": None,
        "clase_terapeutica": None,
        "composicion": None,
        "indicaciones": None,
        "contraindicaciones": None,
        "efectos_adversos": None,
        "interacciones": None,
        "posologia": None,
        "precauciones": None,
        "presentaciones_raw": None,
    }
    for k, v in buckets.items():
        if k in result:
            joined = "\n".join(v).strip()
            result[k] = joined or None

    # Pass `presentaciones_raw` first so the dedicated section wins ties.
    result["presentations"] = extract_presentations(
        result.get("presentaciones_raw"), result.get("composicion")
    )
    result["texto_completo"] = "\n".join(lines)
    return result


def print_section(label: str, value: Optional[str]) -> None:
    print(f"\n--- {label} ---")
    print(value if value else "(no encontrado)")


def clean_text(s):
    """Fix the MFT mojibake where 'ñ' arrives as Latin Extended-A 'ń' (U+0144).
    Handles strings, lists of strings, and None transparently — needed because
    `presentations` is a list while everything else is a string."""
    if s is None:
        return None
    if isinstance(s, list):
        return [clean_text(x) for x in s]
    if isinstance(s, str):
        return s.replace("ń", "ñ").replace("Ń", "Ñ")
    return s


def upsert_medication(data: dict, source_url: str) -> None:
    """Insert (or update if `source_url` already exists) the medication."""
    if not (SUPABASE_URL and SUPABASE_KEY):
        print("\n⚠️  No se encontraron credenciales de Supabase en .env "
              "(esperaba VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY).")
        return

    payload = {col: clean_text(data.get(field)) for field, col in FIELD_TO_COLUMN.items()}
    payload["source_url"] = source_url
    payload = {k: v for k, v in payload.items() if v is not None}

    if "name" not in payload:
        print("\n❌ No se pudo determinar el nombre — abortando insert.")
        return

    client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
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
            print(f"\n✅ Actualizado en Supabase (id={row_id}, name={payload['name']!r})")
        else:
            res = client.table("medications").insert(payload).execute()
            new_id = res.data[0]["id"] if res.data else "(?)"
            print(f"\n✅ Insertado en Supabase (id={new_id}, name={payload['name']!r})")
    except Exception as e:
        msg = str(e)
        print(f"\n❌ Error al escribir en Supabase: {msg}")
        low = msg.lower()
        if "row-level" in low or "rls" in low or "policy" in low or "permission" in low or "401" in low or "403" in low:
            print("   Probablemente RLS está bloqueando el INSERT con la anon key.")
            print("   Soluciones: (a) agregá SUPABASE_SERVICE_ROLE_KEY al .env, o")
            print("   (b) creá una policy de INSERT/UPDATE en la tabla 'medications'.")
        if "column" in low and "does not exist" in low:
            print("   Alguna columna del payload no existe en la tabla — revisá el schema real.")


def main() -> int:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
    }
    try:
        r = requests.get(URL, headers=headers, timeout=15)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"Error al descargar: {e}", file=sys.stderr)
        return 1

    # Pass bytes so BeautifulSoup can detect encoding from <meta charset>.
    data = extract(r.content)

    print("=" * 72)
    print(f"URL: {URL}")
    print(f"HTTP {r.status_code} · {len(r.content)} bytes")
    print("=" * 72)

    print_section("Nombre",             data.get("nombre"))
    print_section("Laboratorio",        data.get("laboratorio"))
    print_section("Droga activa",       data.get("droga_activa"))
    print_section("Clase terapéutica",  data.get("clase_terapeutica"))
    print_section("Composición",        data.get("composicion"))
    pres = data.get("presentations") or []
    print_section("Presentaciones",     " · ".join(pres) if pres else None)
    print_section("Indicaciones",       data.get("indicaciones"))
    print_section("Contraindicaciones", data.get("contraindicaciones"))
    print_section("Efectos adversos",   data.get("efectos_adversos"))
    print_section("Interacciones",      data.get("interacciones"))
    print_section("Posología",          data.get("posologia"))
    print_section("Precauciones",       data.get("precauciones"))

    print("\n" + "=" * 72)
    print("TEXTO COMPLETO")
    print("=" * 72)
    print(data["texto_completo"])

    upsert_medication(data, URL)
    return 0


if __name__ == "__main__":
    sys.exit(main())
