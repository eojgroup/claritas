#!/usr/bin/env python3
"""Fail CI before Flyway when repository migration versions are ambiguous."""

from collections import defaultdict
from pathlib import Path
import re
import sys


MIGRATION_NAME = re.compile(r"^V(?P<version>[1-9][0-9]*)__.+\.sql$")


def main() -> int:
    directory = Path("infra/gcp/sql")
    versions: dict[str, list[str]] = defaultdict(list)
    invalid: list[str] = []

    for path in sorted(directory.glob("*.sql")):
        match = MIGRATION_NAME.match(path.name)
        if not match:
            invalid.append(path.name)
            continue
        versions[match.group("version")].append(path.name)

    duplicates = {version: names for version, names in versions.items() if len(names) > 1}
    if invalid or duplicates:
        print("Invalid Flyway migration set:", file=sys.stderr)
        for name in invalid:
            print(f"- invalid filename: {name}", file=sys.stderr)
        for version, names in sorted(duplicates.items(), key=lambda item: int(item[0])):
            print(f"- duplicate version {version}: {', '.join(names)}", file=sys.stderr)
        return 1

    print("Flyway migration versions verified:", ", ".join(sorted(versions, key=int)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
