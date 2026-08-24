from __future__ import annotations

import json
import re

import comtradeapicall

from common import (
    ROOT,
    PUBLIC,
    write_json,
    clean_code,
)


def normalize(text: str) -> str:
    return re.sub(
        r"\s+",
        " ",
        str(text)
        .lower()
        .replace("&", " and ")
        .replace("/", " ")
        .replace("-", " ")
        .replace(",", " ")
        .replace(";", " "),
    ).strip()


def words(text: str):
    stop = {
        "and",
        "the",
        "for",
        "with",
        "other",
        "than",
        "whether",
        "not",
        "including",
        "included",
        "thereof",
        "therein",
        "kind",
        "kinds",
        "nes",
        "elsewhere",
        "specified",
    }

    return [
        word
        for word in re.findall(
            r"[a-z0-9]+",
            normalize(text),
        )
        if (
            len(word) >= 3
            and word not in stop
        )
    ]


def clean_description(
    code: str,
    description: str,
):
    desc = str(
        description
    ).strip()

    for prefix in (
        f"{code} - ",
        f"{code}-",
        f"{code} – ",
        f"{code} — ",
    ):
        if desc.startswith(prefix):
            return desc[
                len(prefix):
            ].strip()

    return desc


def main():
    scope = json.loads(
        (
            ROOT
            / "config"
            / "scope.json"
        ).read_text()
    )

    aliases = json.loads(
        (
            ROOT
            / "config"
            / "search_tags.json"
        ).read_text()
    )

    headings = [
        item["code"]
        for item in scope[
            "headings"
        ]
    ]

    reference = (
        comtradeapicall
        .getReference(
            "cmd:H6"
        )
    )

    if (
        reference is None
        or reference.empty
    ):
        raise RuntimeError(
            "HS 2022 reference table unavailable"
        )

    code_column = next(
        (
            name
            for name in [
                "id",
                "cmdCode",
                "code",
            ]
            if name
            in reference.columns
        ),
        None,
    )

    description_column = next(
        (
            name
            for name in [
                "text",
                "cmdDesc",
                "description",
            ]
            if name
            in reference.columns
        ),
        None,
    )

    if (
        code_column is None
        or description_column
        is None
    ):
        raise RuntimeError(
            "Unexpected HS reference schema"
        )

    raw = {}

    for _, row in reference.iterrows():
        code = clean_code(
            row[code_column]
        )

        if (
            code.isdigit()
            and len(code)
            in (2, 4, 6)
        ):
            raw[code] = (
                clean_description(
                    code,
                    row[
                        description_column
                    ],
                )
            )

    hs6 = sorted(
        code
        for code in raw
        if (
            len(code) == 6
            and any(
                code.startswith(
                    heading
                )
                for heading
                in headings
            )
        )
    )

    loaded = set(hs6)

    search_codes = set(hs6)

    for code in hs6:
        search_codes.add(
            code[:2]
        )

        search_codes.add(
            code[:4]
        )

    records = []

    for code in sorted(
        search_codes
    ):
        description = raw.get(
            code,
            "",
        )

        level = len(code)

        tags = set(
            words(description)
        )

        for prefix, values in aliases.items():
            if (
                code.startswith(
                    prefix
                )
                or prefix.startswith(
                    code
                )
            ):
                tags.update(
                    normalize(value)
                    for value in values
                )

        parent2 = code[:2]

        parent4 = (
            code[:4]
            if level >= 4
            else None
        )

        if parent2 in raw:
            tags.update(
                words(
                    raw[parent2]
                )
            )

        if (
            parent4 in raw
            and parent4 != code
        ):
            tags.update(
                words(
                    raw[parent4]
                )
            )

        records.append(
            {
                "code": code,
                "level": level,
                "description":
                    description,
                "parent2":
                    parent2,
                "parent4":
                    parent4,
                "loaded":
                    code in loaded,
                "tags":
                    sorted(tags),
                "searchText":
                    " ".join(
                        sorted(
                            {
                                normalize(
                                    description
                                ),
                                *tags,
                            }
                        )
                    ),
            }
        )

    write_json(
        PUBLIC
        / "hs-library.json",
        records,
    )

    (
        ROOT
        / "config"
        / "hs6_universe.txt"
    ).write_text(
        "\n".join(hs6)
        + "\n"
    )

    print(
        f"Search records: {len(records)}"
    )

    print(
        f"Loaded MeitY HS-6: {len(hs6)}"
    )


if __name__ == "__main__":
    main()
