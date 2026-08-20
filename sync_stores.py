#!/usr/bin/env python3
"""Download the public Joie Google Sheet and generate the three store JSON files."""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

SHEET_ID = "1MtK53tDgZuLw_553Tm8uskSa9mZSUrVpUcJ7Vh0iWGU"
SHEET_GID = "0"
DEFAULT_SOURCE = (
    f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export"
    f"?format=csv&gid={SHEET_GID}"
)
OUTPUT_NAMES = ("stores.json", "stores-nl.json", "stores-fr.json")
REQUIRED_COLUMNS = {
    "name",
    "address",
    "postalCode",
    "city",
    "country",
    "lat",
    "lng",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        default=DEFAULT_SOURCE,
        help="Public CSV URL or local CSV path. Defaults to the Joie Google Sheet.",
    )
    parser.add_argument(
        "--output-dir",
        default=Path(__file__).resolve().parents[1],
        type=Path,
        help="Directory in which the three JSON files are written.",
    )
    return parser.parse_args()


def read_source(source: str) -> str:
    if re.match(r"^https?://", source, flags=re.IGNORECASE):
        request = urllib.request.Request(
            source,
            headers={"User-Agent": "Joie-Store-Locator-Sync/1.0"},
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = response.read()
                content_type = response.headers.get("Content-Type", "")
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Google Sheet kon niet worden gedownload: {exc}") from exc

        text = payload.decode("utf-8-sig")
        if "text/html" in content_type.lower() or "<html" in text[:500].lower():
            raise RuntimeError(
                "De spreadsheet is niet als openbare CSV bereikbaar. "
                "Zet delen op 'Iedereen met de link - Kijker'."
            )
        return text

    return Path(source).read_text(encoding="utf-8-sig")


def clean_header(value: str | None) -> str:
    return (value or "").strip()


def parse_number(value: str, *, integer: bool = False) -> int | float | str:
    raw = value.strip()
    if not raw:
        return ""

    candidate = raw.replace(",", ".")
    try:
        number = float(candidate)
    except ValueError:
        return raw

    if not math.isfinite(number):
        raise ValueError(f"Ongeldig numeriek veld: {raw}")

    if integer and number.is_integer() and not re.match(r"^0\d+", raw):
        return int(number)
    return number


def parse_csv(text: str) -> list[dict[str, Any]]:
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise ValueError("De spreadsheet bevat geen gegevens.")

    headers = [clean_header(value) for value in rows[0]]
    usable: list[tuple[int, str]] = []
    seen: set[str] = set()

    for index, header in enumerate(headers):
        if not header or header.lower().startswith("unnamed:"):
            continue
        if header in seen:
            raise ValueError(f"Dubbele kolomnaam in spreadsheet: {header}")
        seen.add(header)
        usable.append((index, header))

    missing = REQUIRED_COLUMNS - seen
    if missing:
        raise ValueError(f"Verplichte kolommen ontbreken: {', '.join(sorted(missing))}")

    stores: list[dict[str, Any]] = []
    for sheet_row, values in enumerate(rows[1:], start=2):
        record: dict[str, Any] = {}
        for index, header in usable:
            value = values[index].strip() if index < len(values) else ""
            record[header] = value

        if not any(str(value).strip() for value in record.values()):
            continue
        if not str(record.get("name", "")).strip():
            raise ValueError(f"Rij {sheet_row} bevat gegevens maar geen winkelnaam.")

        record["postalCode"] = parse_number(str(record.get("postalCode", "")), integer=True)
        record["lat"] = parse_number(str(record.get("lat", "")))
        record["lng"] = parse_number(str(record.get("lng", "")))
        stores.append(record)

    if not stores:
        raise ValueError("Na opschoning zijn geen winkels overgebleven.")
    return stores


def write_json_atomic(path: Path, stores: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(stores, ensure_ascii=False, indent=2) + "\n"
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        delete=False,
    ) as handle:
        handle.write(rendered)
        temporary = Path(handle.name)
    temporary.replace(path)


def main() -> None:
    args = parse_args()
    stores = parse_csv(read_source(args.source))
    for name in OUTPUT_NAMES:
        write_json_atomic(args.output_dir / name, stores)
    print(f"{len(stores)} winkels gesynchroniseerd naar {', '.join(OUTPUT_NAMES)}")


if __name__ == "__main__":
    main()
