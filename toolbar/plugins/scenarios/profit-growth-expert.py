def xtl_capability_studio_profitability_v1(
    revenue: int = 0,
    cogs: int = 0,
    returns_loss: int = 0,
    commission: int = 0,
    logistics: int = 0,
    ad_spend: int = 0
) -> str:
    import hashlib
    import json
    import math

    values = {
        "revenue": revenue,
        "cogs": cogs,
        "returns_loss": returns_loss,
        "commission": commission,
        "logistics": logistics,
        "ad_spend": ad_spend,
    }

    for field, value in values.items():
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
        ):
            return json.dumps({
                "status": "error",
                "error_code": "INVALID_TYPE",
                "field": field,
                "capability_version": "CALC_V1",
            }, sort_keys=True)
        if value < 0:
            return json.dumps({
                "status": "error",
                "error_code": "NEGATIVE_VALUE",
                "field": field,
                "capability_version": "CALC_V1",
            }, sort_keys=True)

    if revenue <= 0:
        return json.dumps({
            "status": "error",
            "error_code": "REVENUE_MUST_BE_POSITIVE",
            "field": "revenue",
            "capability_version": "CALC_V1",
        }, sort_keys=True)

    profit = revenue - cogs - returns_loss - commission - logistics - ad_spend
    ratio = profit * 10000 / revenue
    if not math.isfinite(profit) or not math.isfinite(ratio):
        return json.dumps({
            "status": "error",
            "error_code": "ARITHMETIC_OVERFLOW",
            "capability_version": "CALC_V1",
        }, sort_keys=True)
    margin_bps = round(ratio)
    canonical_input = json.dumps(values, sort_keys=True, separators=(",", ":"))

    result = {
        "status": "success",
        "capability_id": "profitability_calculation",
        "capability_version": "CALC_V1",
        "source_marker": "FULL_CONTRIBUTION_MARGIN_20260724",
        "profit": profit,
        "margin_bps": margin_bps,
        "input_sha256": hashlib.sha256(canonical_input.encode("utf-8")).hexdigest(),
        "applied_costs": [
            "cogs",
            "returns_loss",
            "commission",
            "logistics",
            "ad_spend",
        ],
        "external_writes": False,
    }
    canonical_result = json.dumps(result, sort_keys=True, separators=(",", ":"))
    result["result_sha256"] = hashlib.sha256(
        canonical_result.encode("utf-8")
    ).hexdigest()
    return json.dumps(result, sort_keys=True)
