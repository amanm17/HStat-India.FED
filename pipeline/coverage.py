from __future__ import annotations

import pandas as pd


def assess_coverage(candidate: pd.DataFrame, previous: pd.DataFrame) -> dict:
    """
    Classify reporter coverage as VALID, CAUTION or INVALID.

    The comparison asks whether the candidate year retains the economically
    important reporting economies observed in the previous year.

    VALID:
      - previous #1 reporter present
      - >= 9 of previous top 10 present
      - >= 95% of previous top-20 value retained
      - reporter count >= 80% of previous year

    CAUTION:
      - previous #1 reporter present
      - >= 8 of previous top 10 present
      - >= 90% of previous top-20 value retained
      - reporter count >= 75% of previous year

    Otherwise INVALID.
    """

    if candidate is None or previous is None:
        return {
            "status": "INVALID",
            "reason": "missing comparison frame",
        }

    if candidate.empty or previous.empty:
        return {
            "status": "INVALID",
            "reason": "empty comparison frame",
        }

    required = {"reporterCode", "primaryValue"}

    for label, frame in [
        ("candidate", candidate),
        ("previous", previous),
    ]:
        missing = required - set(frame.columns)

        if missing:
            return {
                "status": "INVALID",
                "reason": f"{label} missing columns {sorted(missing)}",
            }

    cur = candidate.copy()
    old = previous.copy()

    for frame in [cur, old]:
        frame["reporterCode"] = frame["reporterCode"].astype(str)
        frame["primaryValue"] = pd.to_numeric(
            frame["primaryValue"],
            errors="coerce",
        )

        frame.dropna(
            subset=["reporterCode", "primaryValue"],
            inplace=True,
        )

        frame.drop(
            frame[frame["primaryValue"] < 0].index,
            inplace=True,
        )

        frame.sort_values(
            "primaryValue",
            ascending=False,
            inplace=True,
        )

    if cur.empty or old.empty:
        return {
            "status": "INVALID",
            "reason": "no usable reporter values",
        }

    # Coverage calculations must operate on one analytical row per reporter.
    if cur["reporterCode"].duplicated().any():
        return {
            "status": "INVALID",
            "reason": "duplicate reporter rows in candidate year",
        }

    if old["reporterCode"].duplicated().any():
        return {
            "status": "INVALID",
            "reason": "duplicate reporter rows in previous year",
        }

    current_codes = set(cur["reporterCode"])

    current_count = cur["reporterCode"].nunique()
    previous_count = old["reporterCode"].nunique()

    count_ratio = (
        current_count / previous_count
        if previous_count
        else 0.0
    )

    old_top10 = old.head(10)
    old_top20 = old.head(20)

    top1_code = str(old.iloc[0]["reporterCode"])
    top1_present = top1_code in current_codes

    top10_present = int(
        old_top10["reporterCode"]
        .isin(current_codes)
        .sum()
    )

    top20_total = float(
        old_top20["primaryValue"].sum()
    )

    top20_retained = float(
        old_top20[
            old_top20["reporterCode"].isin(current_codes)
        ]["primaryValue"].sum()
    )

    top20_value_coverage = (
        top20_retained / top20_total
        if top20_total > 0
        else 0.0
    )

    valid = (
        top1_present
        and top10_present >= 9
        and top20_value_coverage >= 0.95
        and count_ratio >= 0.80
    )

    caution = (
        top1_present
        and top10_present >= 8
        and top20_value_coverage >= 0.90
        and count_ratio >= 0.75
    )

    if valid:
        status = "VALID"
    elif caution:
        status = "CAUTION"
    else:
        status = "INVALID"

    missing_top10 = (
        old_top10[
            ~old_top10["reporterCode"].isin(current_codes)
        ][
            [
                c
                for c in [
                    "reporterCode",
                    "reporterDesc",
                    "primaryValue",
                ]
                if c in old_top10.columns
            ]
        ]
        .to_dict("records")
    )

    return {
        "status": status,
        "candidateReporters": int(current_count),
        "previousReporters": int(previous_count),
        "reporterCountRatio": float(count_ratio),
        "priorTop1Present": bool(top1_present),
        "priorTop10Present": int(top10_present),
        "priorTop20ValueCoverage": float(
            top20_value_coverage
        ),
        "missingPriorTop10": missing_top10,
    }
