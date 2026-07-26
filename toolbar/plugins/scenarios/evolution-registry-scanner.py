def _evolution_registry_safe_manifest(manifest: dict) -> dict:
    safe = {}
    for key in (
        "id",
        "version",
        "status",
        "category",
        "type",
        "schemaVersion",
        "schema_version",
        "platform_agent_id",
        "platformAgentId",
        "orchestrator",
    ):
        value = manifest.get(key)
        if key in manifest and isinstance(value, (str, int, float, bool)):
            safe[key] = value

    for key in ("name", "title"):
        value = manifest.get(key)
        if isinstance(value, str):
            safe[key] = value
        elif isinstance(value, dict):
            safe[key] = {
                language: value[language]
                for language in ("ru", "en")
                if isinstance(value.get(language), str)
            }

    nested_keys = {
        "agent": ("platform_agent_id", "platformAgentId"),
        "synthAgent": ("id",),
        "params": ("agent_id",),
        "runtime": ("platform_agent_id", "platformAgentId"),
    }
    for key, allowed in nested_keys.items():
        value = manifest.get(key)
        if not isinstance(value, dict):
            continue
        projected = {
            field: value[field]
            for field in allowed
            if isinstance(value.get(field), str)
        }
        if projected:
            safe[key] = projected

    for key in ("experts", "optionalExperts", "expert_defs", "expertDefs"):
        value = manifest.get(key)
        if not isinstance(value, list):
            continue
        projected = []
        for item in value:
            if isinstance(item, str):
                projected.append(item)
            elif isinstance(item, dict):
                reference = {
                    field: item[field]
                    for field in ("name", "id", "expert_id")
                    if isinstance(item.get(field), str)
                }
                if reference:
                    projected.append(reference)
        safe[key] = projected

    def safe_schedules(value):
        if not isinstance(value, list):
            return []
        allowed = (
            "id",
            "name",
            "kind",
            "kv_key",
            "kvKey",
            "active_key",
            "activeKey",
            "agent_id",
            "agentId",
            "global",
            "interval_s",
        )
        return [
            {
                key: item[key]
                for key in allowed
                if key in item
                and isinstance(item[key], (str, int, float, bool))
            }
            for item in value
            if isinstance(item, dict)
        ]

    schedules = safe_schedules(manifest.get("schedules"))
    component_schedules = safe_schedules(
        manifest.get("components", {}).get("schedules")
        if isinstance(manifest.get("components"), dict)
        else None
    )
    if schedules:
        safe["schedules"] = schedules
    if component_schedules:
        safe["components"] = {"schedules": component_schedules}
    return safe


def _etb_evolution_registry_scan_v1() -> str:
    import json
    import os
    import re

    root = os.path.expanduser("~/extella-plugins/_registry")
    strict = re.compile(r"^[a-z0-9][a-z0-9._-]{1,79}\.json$")
    output = {
        "entries": [],
        "matched_count": 0,
        "ignored_backup_count": 0,
        "rejected_count": 0,
    }
    if not os.path.isdir(root):
        return json.dumps(output, ensure_ascii=False)

    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name)
        if not os.path.isfile(path):
            continue
        if ".bak_" in name:
            output["ignored_backup_count"] += 1
            continue
        if os.path.islink(path) or not strict.fullmatch(name):
            output["rejected_count"] += 1
            continue
        manifest_id = name[:-5]
        try:
            with open(path, "r", encoding="utf-8") as handle:
                manifest = json.load(handle)
        except Exception:
            output["rejected_count"] += 1
            continue
        if (
            not isinstance(manifest, dict)
            or str(manifest.get("id") or "") != manifest_id
        ):
            output["rejected_count"] += 1
            continue
        output["entries"].append(
            {
                "filename": name,
                "manifest": _evolution_registry_safe_manifest(manifest),
            }
        )
        output["matched_count"] += 1

    return json.dumps(output, ensure_ascii=False)
