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
        "system",
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

    # The canonical Automation Passport already uses the top-level
    # ``automation.automation_id`` field.  Only that stable identifier is
    # needed to classify a card; owner, business text and other passport data
    # stay out of the device scan.
    automation = manifest.get("automation")
    if isinstance(automation, dict) and isinstance(
        automation.get("automation_id"), str
    ):
        safe["automation"] = {
            "automation_id": automation["automation_id"][:80]
        }

    nested_keys = {
        "agent": ("platform_agent_id", "platformAgentId"),
        "synthAgent": ("id",),
        "params": ("agent_id",),
        "runtime": ("platform_agent_id", "platformAgentId"),
        "service": ("port", "healthPath", "statePath"),
        "ui": ("port", "healthPath", "statePath"),
    }
    for key, allowed in nested_keys.items():
        value = manifest.get(key)
        if not isinstance(value, dict):
            continue
        projected = {
            field: value[field]
            for field in allowed
            if (
                isinstance(value.get(field), str)
                or (
                    key in ("service", "ui")
                    and isinstance(value.get(field), (int, float))
                    and not isinstance(value.get(field), bool)
                )
            )
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
            "location",
            "kv_key",
            "kvKey",
            "scheduler_ref",
            "schedulerRef",
            "active_key",
            "activeKey",
            "agent_id",
            "agentId",
            "global",
            "interval_s",
            "required",
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


def _evolution_registry_path(value, fallback=None):
    import re

    candidate = value if isinstance(value, str) else fallback
    if (
        not isinstance(candidate, str)
        or not re.fullmatch(r"/[A-Za-z0-9._~/-]{0,126}", candidate)
    ):
        return None
    return candidate


def _evolution_registry_iso_timestamp(value):
    import datetime
    import re

    if (
        not isinstance(value, str)
        or len(value) > 160
        or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}"
            r"(?::\d{2}(?:\.\d{1,9})?)?"
            r"(?:Z|[+-]\d{2}:\d{2})?",
            value,
        )
    ):
        return False
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        datetime.datetime.fromisoformat(normalized)
    except ValueError:
        return False
    return True


def _evolution_registry_safe_state(value):
    if not isinstance(value, dict):
        return None
    required = (
        "enabled",
        "active_version",
        "last_run",
        "last_result",
        "last_error",
        "schedules",
        "checked_at",
    )
    if any(key not in value for key in required):
        return None
    if not isinstance(value.get("enabled"), bool):
        return None
    if value.get("active_version") is not None and not isinstance(
        value.get("active_version"), str
    ):
        return None
    if value.get("last_result") not in (None, "ok", "failed", "partial"):
        return None
    if value.get("checked_at") is not None and not isinstance(
        value.get("checked_at"), str
    ):
        return None

    last_run = value.get("last_run")
    if last_run is not None:
        if isinstance(last_run, str):
            if not _evolution_registry_iso_timestamp(last_run):
                return None
        elif isinstance(last_run, dict):
            last_run = {
                key: (
                    last_run[key][:160]
                    if isinstance(last_run.get(key), str)
                    else last_run[key]
                )
                for key in ("id", "at", "ts", "status", "kind")
                if isinstance(last_run.get(key), (str, int, float))
            }
        else:
            return None

    last_error = value.get("last_error")
    if last_error is not None:
        if not isinstance(last_error, dict):
            return None
        if any(
            not isinstance(last_error.get(key), str) or not last_error.get(key)
            for key in ("code", "message_ru", "message_en")
        ):
            return None
        last_error = {
            key: last_error[key][:1000]
            for key in ("code", "message_ru", "message_en")
        }

    schedules = value.get("schedules")
    if not isinstance(schedules, list) or len(schedules) > 200:
        return None
    safe_schedules = []
    for schedule in schedules:
        if (
            not isinstance(schedule, dict)
            or not isinstance(schedule.get("id"), str)
            or not isinstance(schedule.get("active"), bool)
            or (
                schedule.get("next_run") is not None
                and not isinstance(schedule.get("next_run"), (str, int, float))
            )
        ):
            return None
        safe_schedule = {
            "id": schedule["id"][:160],
            "active": schedule["active"],
            "next_run": schedule.get("next_run"),
        }
        for key in ("location", "kind", "cadence"):
            if isinstance(schedule.get(key), str):
                safe_schedule[key] = schedule[key][:160]
        safe_schedules.append(safe_schedule)

    return {
        "enabled": value["enabled"],
        "active_version": (
            value["active_version"][:160]
            if isinstance(value.get("active_version"), str)
            else None
        ),
        "last_run": last_run,
        "last_result": (
            value["last_result"][:160]
            if isinstance(value.get("last_result"), str)
            else None
        ),
        "last_error": last_error,
        "schedules": safe_schedules,
        "checked_at": value.get("checked_at"),
    }


def _evolution_registry_http_json(port, path):
    import http.client
    import json

    result = {
        "available": False,
        "responded": False,
        "status_code": None,
        "value": None,
        "error_code": None,
    }
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2.5)
    try:
        connection.request(
            "GET",
            path,
            headers={"Accept": "application/json", "Connection": "close"},
        )
        response = connection.getresponse()
        result["responded"] = True
        result["status_code"] = int(response.status)
        body = response.read(131073)
        if len(body) > 131072:
            result["error_code"] = "RESPONSE_TOO_LARGE"
            return result
        if response.status < 200 or response.status >= 300:
            result["error_code"] = "HTTP_STATUS"
            return result
        try:
            parsed = json.loads(body.decode("utf-8"))
        except Exception:
            result["error_code"] = "INVALID_JSON"
            return result
        result["available"] = True
        result["value"] = parsed
        return result
    except Exception:
        result["error_code"] = "CONNECTION_UNAVAILABLE"
        return result
    finally:
        connection.close()


def _evolution_registry_probe_runtime(manifest):
    service = manifest.get("service")
    ui = manifest.get("ui")
    service = service if isinstance(service, dict) else {}
    ui = ui if isinstance(ui, dict) else {}
    raw_port = service.get("port", ui.get("port"))
    if (
        isinstance(raw_port, bool)
        or not isinstance(raw_port, (int, float))
        or int(raw_port) != raw_port
        or not 1 <= int(raw_port) <= 65535
    ):
        return {
            "configured": False,
            "port": None,
            "health": None,
            "state": None,
        }

    health_path = _evolution_registry_path(
        service.get("healthPath", ui.get("healthPath")),
        "/api/health",
    )
    state_source = "CARD"
    state_path = _evolution_registry_path(
        service.get("statePath", ui.get("statePath"))
    )
    if not state_path and manifest.get("id") == "extella_1c_agent":
        state_path = "/api/state"
        state_source = "REVIEWED_MIGRATION"

    runtime = {
        "configured": bool(health_path and state_path),
        "port": int(raw_port),
        "health": None,
        "state": None,
        "state_path_source": state_source if state_path else None,
    }
    if not health_path or not state_path:
        return runtime

    health = _evolution_registry_http_json(runtime["port"], health_path)
    state = _evolution_registry_http_json(runtime["port"], state_path)
    if state["available"]:
        safe_state = _evolution_registry_safe_state(state["value"])
        if safe_state is None:
            state["available"] = False
            state["value"] = None
            state["error_code"] = "STATE_CONTRACT_INVALID"
        else:
            state["value"] = safe_state
    if health["available"]:
        value = health["value"]
        health["value"] = {
            key: value[key]
            for key in ("ok", "service", "version", "mode")
            if isinstance(value, dict)
            and isinstance(value.get(key), (str, int, float, bool))
        }
    runtime["health"] = health
    runtime["state"] = state
    return runtime


def _evolution_registry_device_refs(device_refs_json):
    import json
    import os
    import re

    allowed = {"~/extella_baga/panel.json:data_device"}
    target = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$")
    output = {}
    try:
        requested = json.loads(device_refs_json or "[]")
    except Exception:
        requested = []
    if not isinstance(requested, list) or len(requested) > 8:
        return output
    for ref in requested:
        if not isinstance(ref, str) or ref not in allowed:
            continue
        result = {"available": False, "value": None, "error_code": None}
        path_text, key = ref.rsplit(":", 1)
        path = os.path.abspath(os.path.expanduser(path_text))
        expected = os.path.abspath(
            os.path.expanduser("~/extella_baga/panel.json")
        )
        if path != expected or os.path.islink(path):
            result["error_code"] = "DEVICE_REF_PATH_INVALID"
        elif not os.path.isfile(path):
            result["error_code"] = "DEVICE_REF_FILE_UNAVAILABLE"
        elif os.path.getsize(path) > 65536:
            result["error_code"] = "DEVICE_REF_FILE_TOO_LARGE"
        else:
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    document = json.load(handle)
                value = document.get(key) if isinstance(document, dict) else None
                if not isinstance(value, str) or not target.fullmatch(value):
                    result["error_code"] = "DEVICE_REF_VALUE_INVALID"
                else:
                    result["available"] = True
                    result["value"] = value
            except Exception:
                result["error_code"] = "DEVICE_REF_READ_FAILED"
        output[ref] = result
    return output


def _etb_evolution_registry_scan_v1(device_refs_json="[]") -> str:
    import concurrent.futures
    import json
    import os
    import re

    root = os.path.expanduser("~/extella-plugins/_registry")
    strict = re.compile(r"^[a-z0-9][a-z0-9._-]{1,79}\.json$")
    output = {
        "entries": [],
        "device_refs": _evolution_registry_device_refs(device_refs_json),
        "matched_count": 0,
        "ignored_backup_count": 0,
        "rejected_count": 0,
    }
    if not os.path.isdir(root):
        return json.dumps(output, ensure_ascii=False)

    candidates = []
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
        entry = {
            "filename": name,
            "manifest": _evolution_registry_safe_manifest(manifest),
        }
        output["entries"].append(entry)
        if (
            (
                manifest.get("category") == "automations"
                and manifest.get("type") == "process"
            )
            or manifest.get("schemaVersion") == "extella-process-pack-v1"
            or manifest.get("id") in (
                "extella_1c_agent",
                "extella_contract_agent",
                "extella_travel_agency",
            )
        ):
            candidates.append((entry, manifest))
        output["matched_count"] += 1

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        pending = [
            (entry, executor.submit(_evolution_registry_probe_runtime, manifest))
            for entry, manifest in candidates
        ]
        for entry, future in pending:
            try:
                entry["runtime"] = future.result()
            except Exception:
                entry["runtime"] = {
                    "configured": False,
                    "port": None,
                    "health": None,
                    "state": None,
                }

    return json.dumps(output, ensure_ascii=False)
