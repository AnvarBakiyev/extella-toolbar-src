#!/usr/bin/env python3
"""Live, token-safe smoke test for the Profit Growth scenario.

The Extella token is read from stdin and is never printed or persisted.
This test is intentionally additive: saving the deterministic Expert is
idempotent and Agent calls are tool-free dry-runs.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


BASE = "https://api.extella.ai"
DEFAULT_AGENT = "agent_extella_alibaba_default"
EXPERT_NAME = "xtl_capability_studio_profitability_v1"
FIXTURE = {
    "revenue": 1_000_000,
    "cogs": 500_000,
    "returns_loss": 20_000,
    "commission": 50_000,
    "logistics": 30_000,
    "ad_spend": 200_000,
}
ROLES = {
    "one_c": {
        "role": "one_c_controller",
        "actions": {"SCALE": "REPLENISHMENT_ELIGIBLE", "HOLD": "MANUAL_REVIEW"},
    },
    "target": {
        "role": "targetologist",
        "actions": {"SCALE": "INCREASE_BUDGET", "HOLD": "KEEP_BUDGET"},
    },
}


def post(token: str, path: str, body: dict, agent_id: str = DEFAULT_AGENT) -> dict:
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Auth-Token": token,
            "X-Profile-Id": "default",
            "X-Agent-Id": agent_id,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=260) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:1200]
        raise RuntimeError(f"{path} HTTP {error.code}: {detail}") from error


def extract_agent_text(response: dict) -> str:
    parts: list[str] = []
    for item in response.get("output") or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if content.get("type") == "output_text" and content.get("text"):
                parts.append(content["text"])
    value = (
        "\n".join(parts)
        or response.get("answer")
        or response.get("response")
        or response.get("text")
        or response.get("result")
        or ""
    )
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def parse_json_object(text: str) -> dict:
    value = text.strip()
    if value.startswith("```"):
        value = value.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        start, end = value.find("{"), value.rfind("}")
        if start >= 0 and end > start:
            return json.loads(value[start : end + 1])
        raise


def unwrap_expert(response: dict) -> dict:
    value: object = response
    for _ in range(6):
        if isinstance(value, str):
            value = json.loads(value)
            continue
        if not isinstance(value, dict):
            break
        if value.get("capability_id"):
            break
        if "result" in value:
            value = value["result"]
            continue
        if "output" in value:
            value = value["output"]
            continue
        break
    if not isinstance(value, dict) or value.get("status") != "success":
        raise RuntimeError(f"Expert did not return success: {value!r}")
    return value


def choose_agents(response: dict) -> list[dict]:
    agents = response.get("agents") or response.get("results") or []

    def allowed(agent: dict) -> bool:
        text = " ".join(
            str(agent.get(key) or "") for key in ("id", "agent_id", "name", "provider", "model")
        ).lower()
        return bool(agent.get("id") or agent.get("agent_id")) and not any(
            blocked in text for blocked in ("claude", "anthropic")
        )

    def score(agent: dict) -> tuple[int, str]:
        text = " ".join(str(agent.get(key) or "") for key in ("name", "provider", "model")).lower()
        preferred = 2 if ("qwen" in text or "alibaba" in text) else 1
        return preferred, str(agent.get("name") or "")

    return sorted((agent for agent in agents if allowed(agent)), key=score, reverse=True)


def make_prompt(role_key: str, run_id: str, policy: dict, calculation: dict) -> str:
    role = ROLES[role_key]
    contract = {
        "schema_version": "decision.v1",
        "role": role["role"],
        "scenario_run_id": run_id,
        "policy_id": policy["id"],
        "policy_version": policy["version"],
        "policy_sha256": policy["policy_sha256"],
        "result_sha256": calculation["result_sha256"],
        "margin_bps": calculation["margin_bps"],
        "threshold_bps": policy["threshold_bps"],
        "decision_rule": policy["rule"],
        "allowed_decisions": ["SCALE", "HOLD"],
        "allowed_actions": role["actions"],
        "external_writes": False,
    }
    return json.dumps(
        {
            "task": "Interpret one verified profitability result for the assigned business role.",
            "rules": [
                "Do not call tools and do not perform external actions.",
                "Use only the supplied decision contract; do not recalculate or substitute values.",
                "Return exactly one JSON object and no markdown.",
            ],
            "decision_contract": contract,
            "required_response_fields": [
                "schema_version",
                "role",
                "scenario_run_id",
                "policy_id",
                "policy_version",
                "policy_sha256",
                "result_sha256",
                "margin_bps",
                "threshold_bps",
                "gate_decision",
                "action",
                "rationale",
                "external_writes",
            ],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def validate_decision(
    value: dict, role_key: str, run_id: str, policy: dict, calculation: dict
) -> None:
    role = ROLES[role_key]
    expected = "SCALE" if calculation["margin_bps"] >= policy["threshold_bps"] else "HOLD"
    expected_action = role["actions"][expected]
    expected_fields = {
        "schema_version": "decision.v1",
        "role": role["role"],
        "scenario_run_id": run_id,
        "policy_id": policy["id"],
        "policy_version": policy["version"],
        "policy_sha256": policy["policy_sha256"],
        "result_sha256": calculation["result_sha256"],
        "margin_bps": calculation["margin_bps"],
        "threshold_bps": policy["threshold_bps"],
        "gate_decision": expected,
        "action": expected_action,
        "external_writes": False,
    }
    mismatches = {
        key: {"expected": expected_value, "actual": value.get(key)}
        for key, expected_value in expected_fields.items()
        if value.get(key) != expected_value
    }
    if mismatches:
        raise RuntimeError(f"Decision contract mismatch: {mismatches}")


def main() -> int:
    token = sys.stdin.read().strip()
    if len(token) < 20 or any(char.isspace() for char in token):
        raise RuntimeError("stdin does not look like an Extella token")

    expert_path = Path(__file__).parents[1] / "plugins" / "scenarios" / "profit-growth-expert.py"
    expert_code = expert_path.read_text(encoding="utf-8")
    agents = choose_agents(post(token, "/api/agent/list", {}))
    if len(agents) < 2:
        raise RuntimeError(f"Need two non-Anthropic agents, found {len(agents)}")
    owner_agent_id = agents[0].get("id") or agents[0].get("agent_id")

    save = post(
        token,
        "/api/expert/save",
        {
            "name": EXPERT_NAME,
            "description": (
                "Deterministically calculates contribution profit and margin after COGS, "
                "returns, commission, logistics and advertising. Returns canonical hashes "
                "and never performs external writes."
            ),
            "code": expert_code,
            "kwargs": FIXTURE,
            "cspl": "fython",
            "global": True,
        },
        agent_id=owner_agent_id,
    )
    if save.get("status") != "success":
        raise RuntimeError(f"Expert save failed: {save!r}")

    calculation_response = post(
        token,
        "/api/expert/run",
        {"expert_name": EXPERT_NAME, "params": FIXTURE, "global": True, "wait": True},
        agent_id=owner_agent_id,
    )
    calculation = unwrap_expert(calculation_response)
    if calculation.get("profit") != 200_000 or calculation.get("margin_bps") != 2000:
        raise RuntimeError(f"Unexpected calculation: {calculation!r}")

    policy_base = {
        "id": "profitability_gate",
        "version": "POLICY_V1",
        "threshold_bps": 1500,
        "rule": "margin_bps >= threshold_bps => SCALE; otherwise HOLD",
    }
    policy = dict(policy_base)
    policy["policy_sha256"] = hashlib.sha256(
        json.dumps(policy_base, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    run_id = f"live_smoke_{int(time.time())}"

    decisions: list[dict] = []
    for role_key, agent in zip(("one_c", "target"), agents[:2]):
        agent_id = agent.get("id") or agent.get("agent_id")
        response = post(
            token,
            "/api/agent/run",
            {
                "agent_id": agent_id,
                "input": make_prompt(role_key, run_id, policy, calculation),
                "run_timeout": 180,
                "store": False,
                "temperature": 0,
                "max_output_tokens": 700,
                "tool_choice": "none",
                "tools": [],
            },
            agent_id=agent_id,
        )
        value = parse_json_object(extract_agent_text(response))
        validate_decision(value, role_key, run_id, policy, calculation)
        decisions.append(
            {
                "role": role_key,
                "agent_id": agent_id,
                "agent_name": agent.get("name"),
                "provider": agent.get("provider"),
                "model": response.get("model") or agent.get("model"),
                "response_id": response.get("id") or response.get("response_id"),
                "decision": value["gate_decision"],
                "action": value["action"],
                "usage": response.get("usage") or response.get("token_usage"),
            }
        )

    print(
        json.dumps(
            {
                "status": "LIVE_SMOKE_PASSED",
                "expert": {
                    "name": EXPERT_NAME,
                    "global": True,
                    "profit": calculation["profit"],
                    "margin_bps": calculation["margin_bps"],
                    "result_sha256": calculation["result_sha256"],
                },
                "policy": policy,
                "decisions": decisions,
                "agents_changed": 0,
                "external_writes": 0,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(
            json.dumps(
                {
                    "status": "LIVE_SMOKE_FAILED",
                    "error": str(error),
                    "token_persisted": False,
                    "business_system_writes": 0,
                },
                ensure_ascii=False,
                indent=2,
            ),
            file=sys.stderr,
        )
        raise SystemExit(1)
