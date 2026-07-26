#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build a deterministic Evolution standards bundle from an explicit registry.

The adapter deliberately contains no Agent Passport validation rules. It loads
the exact pinned checker and Agent Cabinet builder from ``--standards-dir``,
then records their structured output verbatim. The default remains the
checked-in DEMO_FIXTURE registry. PRODUCTION requires an explicit, separately
typed registry and output path for an account-scoped host provider. Production
output is never a static toolbar/release-embedding artifact.
"""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys


sys.dont_write_bytecode = True

BUNDLE_SCHEMA = "extella.evolution.standards_bundle.v1"
PIN_SCHEMA = "extella.evolution.standards_pin.v1"
REGISTRY_SCHEMA = "extella.evolution.demo_fixture_registry.v1"
PLATFORM_FIXTURE_SCHEMA = "extella.evolution.demo_platform_agents.v1"
DATA_MODE = "DEMO_FIXTURE"
PRODUCTION_REGISTRY_SCHEMA = "extella.evolution.production_registry.v1"
PRODUCTION_PLATFORM_SCHEMA = "extella.evolution.production_platform_agents.v1"
PRODUCTION_DATA_MODE = "PRODUCTION"
PRODUCTION_DELIVERY_MODE = "ACCOUNT_SCOPED_HOST_PROVIDER"
PRODUCTION_ATTESTATION_SCHEMA = (
    "extella.evolution.standards_bundle.attestation.v1"
)
PRODUCTION_PLATFORM_METADATA_FIELDS = (
    "platform_agent_id",
    "name",
    "provider",
    "model",
    "last_activity_at",
)
REQUIRED_ARTIFACTS = (
    "checker",
    "builder",
    "passport_template",
    "cabinet_widget",
    "help_widget",
)
EMBEDDED_SOURCE_ARTIFACTS = {"cabinet_widget", "help_widget"}
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
GIT_COMMIT_RE = re.compile(r"^[a-f0-9]{40}$")
NON_PRODUCTION_PATH_MARKERS = ("fixture", "demo")


class AdapterError(RuntimeError):
    """A deterministic, user-actionable adapter failure."""


def _read_bytes(path):
    try:
        return path.read_bytes()
    except OSError as exc:
        raise AdapterError("cannot read %s: %s" % (path, exc)) from exc


def _read_text(path):
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise AdapterError("cannot read UTF-8 file %s: %s" % (path, exc)) from exc


def _read_json(path, label):
    try:
        value = json.loads(_read_text(path))
    except ValueError as exc:
        raise AdapterError("%s is not valid JSON: %s" % (label, exc)) from exc
    if not isinstance(value, dict):
        raise AdapterError("%s must be a JSON object" % label)
    return value


def _sha256_file(path):
    return hashlib.sha256(_read_bytes(path)).hexdigest()


def _canonical_sha256(value):
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _resolve_under(root, relative_path, label):
    raw = str(relative_path or "")
    if not raw or Path(raw).is_absolute():
        raise AdapterError("%s must be a non-empty relative path" % label)
    root = root.resolve()
    candidate = (root / raw).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise AdapterError("%s escapes %s" % (label, root)) from exc
    if not candidate.is_file():
        raise AdapterError("%s is not a file: %s" % (label, candidate))
    return candidate


def _reject_production_path(path, label):
    normalized = Path(str(path or "")).as_posix().casefold()
    if any(marker in normalized for marker in NON_PRODUCTION_PATH_MARKERS):
        raise AdapterError(
            "%s must not contain fixture or demo path markers" % label
        )


def _git(standards_dir, *args):
    try:
        result = subprocess.run(
            ["git", "-C", str(standards_dir), *args],
            check=False,
            capture_output=True,
            encoding="utf-8",
        )
    except OSError as exc:
        raise AdapterError("cannot execute git: %s" % exc) from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise AdapterError("git %s failed: %s" % (" ".join(args), detail))
    return result.stdout.strip()


def _git_bytes(standards_dir, *args):
    try:
        result = subprocess.run(
            ["git", "-C", str(standards_dir), *args],
            check=False,
            capture_output=True,
        )
    except OSError as exc:
        raise AdapterError("cannot execute git: %s" % exc) from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).decode(
            "utf-8",
            errors="replace",
        ).strip()
        raise AdapterError("git %s failed: %s" % (" ".join(args), detail))
    return result.stdout


def _load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    if spec is None or spec.loader is None:
        raise AdapterError("cannot import canonical module %s from %s" % (name, path))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except Exception as exc:
        raise AdapterError(
            "canonical module %s failed to import from %s: %s" % (name, path, exc)
        ) from exc
    if Path(module.__file__).resolve() != path.resolve():
        raise AdapterError("canonical module %s resolved to an unexpected path" % name)
    return module


def _validate_standards_pin(standards_dir, pin, production=False):
    if pin.get("schema") != PIN_SCHEMA:
        raise AdapterError("standards pin schema must be %s" % PIN_SCHEMA)
    expected_commit = str(pin.get("standards_git_commit") or "")
    if not GIT_COMMIT_RE.fullmatch(expected_commit):
        raise AdapterError("standards_git_commit must be a full lowercase git SHA")

    actual_commit = _git(standards_dir, "rev-parse", "HEAD")
    if actual_commit != expected_commit:
        raise AdapterError(
            "standards git commit pin mismatch: expected %s, got %s"
            % (expected_commit, actual_commit)
        )
    dirty = _git(standards_dir, "status", "--porcelain", "--untracked-files=no")
    if dirty:
        raise AdapterError("standards worktree has tracked changes; pinned build refused")
    if production:
        dirty = _git(
            standards_dir,
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--ignored",
        )
        if dirty:
            raise AdapterError(
                "production standards checkout must be fully clean, "
                "including untracked and ignored files"
            )

    definitions = pin.get("artifacts")
    if not isinstance(definitions, dict):
        raise AdapterError("standards pin artifacts must be an object")

    resolved = {}
    records = {}
    for role in REQUIRED_ARTIFACTS:
        definition = definitions.get(role)
        if not isinstance(definition, dict):
            raise AdapterError("standards pin is missing artifact %s" % role)
        relative_path = str(definition.get("path") or "")
        expected_sha = str(definition.get("sha256") or "")
        if not SHA256_RE.fullmatch(expected_sha):
            raise AdapterError("artifact %s has an invalid SHA-256 pin" % role)
        artifact_path = _resolve_under(
            standards_dir,
            relative_path,
            "standards artifact %s" % role,
        )
        actual_sha = _sha256_file(artifact_path)
        if actual_sha != expected_sha:
            raise AdapterError(
                "standards artifact pin mismatch for %s: expected %s, got %s"
                % (role, expected_sha, actual_sha)
            )
        if production:
            tracked_path = artifact_path.relative_to(
                standards_dir.resolve()
            ).as_posix()
            try:
                _git(
                    standards_dir,
                    "ls-files",
                    "--error-unmatch",
                    "--",
                    tracked_path,
                )
            except AdapterError as exc:
                raise AdapterError(
                    "production standards artifact %s is not tracked by git"
                    % role
                ) from exc
            committed_bytes = _git_bytes(
                standards_dir,
                "show",
                "%s:%s" % (expected_commit, tracked_path),
            )
            if committed_bytes != _read_bytes(artifact_path):
                raise AdapterError(
                    "production standards artifact %s bytes differ from "
                    "git commit %s" % (role, expected_commit)
                )
            if hashlib.sha256(committed_bytes).hexdigest() != expected_sha:
                raise AdapterError(
                    "production standards artifact %s pin differs from "
                    "git commit %s" % (role, expected_commit)
                )
        record = {"path": relative_path, "sha256": actual_sha}
        if role in EMBEDDED_SOURCE_ARTIFACTS:
            record["source"] = _read_text(artifact_path)
            record["source_encoding"] = "utf-8"
        resolved[role] = artifact_path
        records[role] = record
    return expected_commit, resolved, records


def _load_canonical_modules(artifacts):
    tools_dir = str(artifacts["checker"].parent)
    if tools_dir not in sys.path:
        sys.path.insert(0, tools_dir)
    checker = _load_module("check_agent_passport", artifacts["checker"])
    builder = _load_module("build_agent_cabinet", artifacts["builder"])
    for name in ("check_report", "check", "load_passport"):
        if not callable(getattr(checker, name, None)):
            raise AdapterError("canonical checker does not expose %s()" % name)
    if not callable(getattr(builder, "build", None)):
        raise AdapterError("canonical Agent Cabinet builder does not expose build()")
    if getattr(builder, "check_report", None) is not checker.check_report:
        raise AdapterError("canonical builder is not using the exact pinned checker module")
    return checker, builder


def _validate_report_and_legacy(checker, passport, report):
    if not isinstance(report, dict) or not isinstance(report.get("issues"), list):
        raise AdapterError("canonical checker returned an invalid structured report")
    errors, warnings = checker.check(passport)
    report_errors = [
        issue.get("message_ru")
        for issue in report["issues"]
        if issue.get("severity") == "error"
    ]
    report_warnings = [
        issue.get("message_ru")
        for issue in report["issues"]
        if issue.get("severity") == "warning"
    ]
    if list(errors) != report_errors or list(warnings) != report_warnings:
        raise AdapterError("canonical check_report() and legacy check() disagree")


def _load_fixture_inputs(registry_path):
    registry = _read_json(registry_path, "fixture registry")
    if registry.get("schema") != REGISTRY_SCHEMA:
        raise AdapterError("fixture registry schema must be %s" % REGISTRY_SCHEMA)
    if registry.get("data_mode") != DATA_MODE:
        raise AdapterError("fixture registry must declare data_mode=%s" % DATA_MODE)
    if registry.get("production_eligible") is not False:
        raise AdapterError("fixture registry must set production_eligible=false")
    if registry.get("live_projection_allowed") is not False:
        raise AdapterError("fixture registry must set live_projection_allowed=false")

    root = registry_path.parent.resolve()
    platform_path = _resolve_under(
        root,
        registry.get("platform_agents_file"),
        "platform_agents_file",
    )
    platform_doc = _read_json(platform_path, "platform agents fixture")
    if platform_doc.get("schema") != PLATFORM_FIXTURE_SCHEMA:
        raise AdapterError(
            "platform agents fixture schema must be %s" % PLATFORM_FIXTURE_SCHEMA
        )
    if platform_doc.get("data_mode") != DATA_MODE:
        raise AdapterError("platform agents fixture must be DEMO_FIXTURE")
    platform_rows = platform_doc.get("agents")
    if not isinstance(platform_rows, list):
        raise AdapterError("platform agents fixture agents must be a list")

    platform_by_id = {}
    for row in platform_rows:
        if not isinstance(row, dict):
            raise AdapterError("every platform fixture row must be an object")
        platform_agent_id = str(row.get("platform_agent_id") or "")
        if not platform_agent_id:
            raise AdapterError("platform fixture row is missing platform_agent_id")
        if platform_agent_id in platform_by_id:
            raise AdapterError(
                "duplicate platform fixture platform_agent_id %s" % platform_agent_id
            )
        platform_by_id[platform_agent_id] = row

    passport_files = registry.get("passport_files")
    if not isinstance(passport_files, list) or not passport_files:
        raise AdapterError("fixture registry passport_files must be a non-empty list")
    normalized_files = sorted(str(value) for value in passport_files)
    if len(set(normalized_files)) != len(normalized_files):
        raise AdapterError("fixture registry contains duplicate passport paths")
    passport_paths = [
        _resolve_under(root, value, "passport fixture")
        for value in normalized_files
    ]
    return registry, root, platform_path, platform_by_id, passport_paths


def _load_production_inputs(registry_path):
    registry = _read_json(registry_path, "production registry")
    if registry.get("schema") != PRODUCTION_REGISTRY_SCHEMA:
        raise AdapterError(
            "production registry schema must be %s" % PRODUCTION_REGISTRY_SCHEMA
        )
    if registry.get("data_mode") != PRODUCTION_DATA_MODE:
        raise AdapterError("production registry must declare data_mode=PRODUCTION")
    if registry.get("production_eligible") is not True:
        raise AdapterError("production registry must set production_eligible=true")
    if registry.get("live_projection_allowed") is not True:
        raise AdapterError(
            "production registry must set live_projection_allowed=true"
        )
    owner_account_id = registry.get("owner_account_id")
    if (
        not isinstance(owner_account_id, str)
        or not owner_account_id.strip()
        or len(owner_account_id.strip()) > 240
    ):
        raise AdapterError(
            "production registry owner_account_id must be a non-empty string"
        )
    if registry.get("delivery_mode") != PRODUCTION_DELIVERY_MODE:
        raise AdapterError(
            "production registry delivery_mode must be %s; generic release "
            "embedding is forbidden" % PRODUCTION_DELIVERY_MODE
        )
    runtime_policy = registry.get("runtime_policy")
    if not isinstance(runtime_policy, dict):
        raise AdapterError("production registry runtime_policy must be an object")
    if runtime_policy.get("live_projection") != "ALLOWED":
        raise AdapterError(
            "production registry runtime_policy.live_projection must be ALLOWED"
        )
    if runtime_policy.get("production_merge") != "ALLOWED":
        raise AdapterError(
            "production registry runtime_policy.production_merge must be ALLOWED"
        )
    if registry.get("passport_files_complete") is not True:
        raise AdapterError(
            "production registry must set passport_files_complete=true"
        )

    passport_files = registry.get("passport_files")
    if not isinstance(passport_files, list):
        raise AdapterError("production registry passport_files must be a list")
    passport_count = registry.get("passport_count")
    if (
        isinstance(passport_count, bool)
        or not isinstance(passport_count, int)
        or passport_count < 0
    ):
        raise AdapterError(
            "production registry passport_count must be a non-negative integer"
        )
    if passport_count != len(passport_files):
        raise AdapterError(
            "production registry passport_count must equal the explicit "
            "passport_files list"
        )

    root = registry_path.parent.resolve()
    _reject_production_path(registry_path.resolve(), "production registry path")
    platform_reference = registry.get("platform_agents_file")
    if not isinstance(platform_reference, str) or not platform_reference.strip():
        raise AdapterError(
            "production registry platform_agents_file must be a relative path"
        )
    _reject_production_path(platform_reference, "platform_agents_file")
    platform_path = _resolve_under(
        root,
        platform_reference,
        "platform_agents_file",
    )
    _reject_production_path(platform_path, "resolved platform_agents_file")
    platform_doc = _read_json(platform_path, "production platform agents")
    if platform_doc.get("schema") != PRODUCTION_PLATFORM_SCHEMA:
        raise AdapterError(
            "production platform agents schema must be %s"
            % PRODUCTION_PLATFORM_SCHEMA
        )
    if platform_doc.get("data_mode") != PRODUCTION_DATA_MODE:
        raise AdapterError("production platform agents must declare PRODUCTION")
    if platform_doc.get("inventory_complete") is not True:
        raise AdapterError(
            "production platform agents must set inventory_complete=true"
        )
    platform_rows = platform_doc.get("agents")
    if not isinstance(platform_rows, list):
        raise AdapterError("production platform agents must be a list")

    platform_by_id = {}
    for row in platform_rows:
        if not isinstance(row, dict):
            raise AdapterError("every production platform row must be an object")
        platform_agent_id = row.get("platform_agent_id")
        if (
            not isinstance(platform_agent_id, str)
            or not platform_agent_id.strip()
        ):
            raise AdapterError(
                "production platform row is missing platform_agent_id"
            )
        platform_agent_id = platform_agent_id.strip()
        if platform_agent_id in platform_by_id:
            raise AdapterError(
                "duplicate production platform_agent_id %s" % platform_agent_id
            )
        platform_by_id[platform_agent_id] = {
            key: row[key]
            for key in PRODUCTION_PLATFORM_METADATA_FIELDS
            if key in row
        }
        platform_by_id[platform_agent_id]["platform_agent_id"] = platform_agent_id

    normalized_files = []
    for value in passport_files:
        if not isinstance(value, str) or not value.strip():
            raise AdapterError(
                "every production passport_files entry must be a relative path"
            )
        _reject_production_path(value, "production passport path")
        normalized_files.append(value)
    normalized_files.sort()
    if len(set(normalized_files)) != len(normalized_files):
        raise AdapterError("production registry contains duplicate passport paths")
    passport_paths = []
    seen_resolved_paths = set()
    for value in normalized_files:
        passport_path = _resolve_under(root, value, "production Agent Passport")
        _reject_production_path(
            passport_path,
            "resolved production passport path",
        )
        resolved_key = str(passport_path)
        if resolved_key in seen_resolved_paths:
            raise AdapterError(
                "production registry passport paths resolve to the same file"
            )
        seen_resolved_paths.add(resolved_key)
        passport_paths.append(passport_path)
    return registry, root, platform_path, platform_by_id, passport_paths


def _build_shared_gene_index(agent_rows, data_mode=DATA_MODE):
    genes_by_id = {}
    by_agent = {}
    for row in agent_rows:
        platform_agent_id = row["platform_agent_id"]
        canonical_genes = row.get("shared_genes") or []
        by_agent[platform_agent_id] = sorted(
            str(gene.get("gene_id") or "") for gene in canonical_genes
        )
        for gene in canonical_genes:
            gene_id = str(gene.get("gene_id") or "")
            definition = {
                "gene_id": gene_id,
                "kind": gene.get("kind"),
                "name": gene.get("name"),
                "version": gene.get("version"),
                "provenance": gene.get("provenance"),
            }
            current = genes_by_id.get(gene_id)
            if current is None:
                current = dict(definition)
                current["consumer_agent_ids"] = []
                genes_by_id[gene_id] = current
            elif any(current.get(key) != value for key, value in definition.items()):
                raise AdapterError(
                    "canonical Shared Gene %s has conflicting declarations" % gene_id
                )
            current["consumer_agent_ids"].append(platform_agent_id)

    genes = []
    for gene_id in sorted(genes_by_id):
        record = genes_by_id[gene_id]
        record["consumer_agent_ids"] = sorted(set(record["consumer_agent_ids"]))
        record["consumer_count"] = len(record["consumer_agent_ids"])
        genes.append(record)
    index_payload = {
        "schema": "extella.shared_genes.map.v1",
        "data_mode": data_mode,
        "complete": True,
        "provenance": "DECLARED_VALID_AGENT_PASSPORTS",
        "genes": genes,
        "by_agent": {key: by_agent[key] for key in sorted(by_agent)},
    }
    index_payload["content_sha256"] = _canonical_sha256(index_payload)
    return index_payload


def build_bundle(standards_dir, registry_path, pin_path, mode=DATA_MODE):
    standards_dir = standards_dir.resolve()
    if not standards_dir.is_dir():
        raise AdapterError("--standards-dir is not a directory: %s" % standards_dir)
    pin = _read_json(pin_path, "standards pin")
    commit, artifact_paths, artifact_records = _validate_standards_pin(
        standards_dir,
        pin,
        production=mode == PRODUCTION_DATA_MODE,
    )
    checker, builder = _load_canonical_modules(artifact_paths)
    if mode == DATA_MODE:
        (
            registry,
            source_root,
            platform_path,
            platform_by_id,
            passport_paths,
        ) = _load_fixture_inputs(registry_path)
    elif mode == PRODUCTION_DATA_MODE:
        (
            registry,
            source_root,
            platform_path,
            platform_by_id,
            passport_paths,
        ) = _load_production_inputs(registry_path)
    else:
        raise AdapterError(
            "mode must be %s or %s" % (DATA_MODE, PRODUCTION_DATA_MODE)
        )

    agents = []
    passport_sources = []
    seen_passport_ids = set()
    for passport_path in passport_paths:
        passport = _read_json(
            passport_path,
            (
                "Agent Passport fixture"
                if mode == DATA_MODE
                else "production Agent Passport"
            ),
        )
        agent = passport.get("agent") if isinstance(passport.get("agent"), dict) else {}
        platform_agent_id = str(agent.get("platform_agent_id") or "")
        if not platform_agent_id:
            raise AdapterError(
                "Agent Passport %s has no agent.platform_agent_id"
                % passport_path
            )
        if mode == PRODUCTION_DATA_MODE:
            hosting_profile = str(agent.get("hosting_profile") or "").casefold()
            if hosting_profile in {"demo", "demo_fixture", "fixture"}:
                raise AdapterError(
                    "production Agent Passport %s declares a demo/fixture "
                    "hosting_profile" % passport_path
                )
        if platform_agent_id in seen_passport_ids:
            raise AdapterError(
                "duplicate Agent Passport platform_agent_id %s" % platform_agent_id
            )
        seen_passport_ids.add(platform_agent_id)

        report = checker.check_report(passport)
        _validate_report_and_legacy(checker, passport, report)
        ready = report.get("ready") is True
        cabinet = builder.build(passport) if ready else None
        if cabinet is not None and cabinet.get("schema") != builder.CABINET_SCHEMA:
            raise AdapterError("canonical builder returned an unexpected Cabinet schema")
        canonical_genes = (
            cabinet.get("passport", {})
            .get("attention", {})
            .get("shared_genes", [])
            if cabinet is not None
            else []
        )
        if not isinstance(canonical_genes, list):
            raise AdapterError("canonical builder returned invalid shared_genes")

        platform_metadata = platform_by_id.get(platform_agent_id)
        relative_passport = passport_path.relative_to(source_root).as_posix()
        passport_sha = _sha256_file(passport_path)
        row = {
            "platform_agent_id": platform_agent_id,
            "passport_present": True,
            "passport_ready": ready,
            "passport_sha256": passport_sha,
            "platform_status": (
                "PRESENT" if platform_metadata is not None else "DEAD_REFERENCE"
            ),
            "platform_metadata": platform_metadata,
            "checker_report": report,
            "cabinet": cabinet,
            "shared_genes": canonical_genes,
            "capability_count": (
                len(cabinet.get("declared_behaviour", {}).get("steps", []))
                if cabinet is not None
                else None
            ),
            "has_shared_genes": bool(canonical_genes) if cabinet is not None else None,
        }
        if platform_metadata is not None:
            row["last_activity_at"] = platform_metadata.get("last_activity_at")
        agents.append(row)
        passport_sources.append(
            {
                "path": relative_passport,
                "platform_agent_id": platform_agent_id,
                "sha256": passport_sha,
            }
        )

    agents.sort(key=lambda row: row["platform_agent_id"])
    passport_sources.sort(key=lambda row: row["platform_agent_id"])
    template = checker.load_passport(str(artifact_paths["passport_template"]))
    if not isinstance(template, dict):
        raise AdapterError("canonical Agent Passport template did not parse as an object")

    production = mode == PRODUCTION_DATA_MODE
    runtime_policy = (
        {
            "live_projection": "ALLOWED",
            "production_merge": "ALLOWED",
            "purpose": "STRICT_PINNED_PRODUCTION_REGISTRY",
        }
        if production
        else {
            "live_projection": "FORBIDDEN",
            "production_merge": "FORBIDDEN",
            "purpose": "BUILD_TIME_DEMO_FIXTURE_ONLY",
        }
    )
    bundle = {
        "schema": BUNDLE_SCHEMA,
        "data_mode": mode,
        "production_eligible": production,
        "live_projection_allowed": production,
        "runtime_policy": runtime_policy,
        "standards": {
            "git_commit": commit,
            "artifacts": artifact_records,
        },
        "passport_template": {
            "artifact_path": artifact_records["passport_template"]["path"],
            "sha256": artifact_records["passport_template"]["sha256"],
            "draft_state": "NOT_VALIDATED",
            "parsed": template,
        },
        "agents": agents,
        "shared_gene_index": _build_shared_gene_index(agents, mode),
        "sources": {
            "registry": {
                "path": registry_path.name,
                "sha256": _sha256_file(registry_path),
                "schema": registry["schema"],
            },
            "standards_pin": {
                "path": pin_path.name,
                "sha256": _sha256_file(pin_path),
                "schema": pin["schema"],
            },
            "platform_agents": {
                "path": platform_path.relative_to(source_root).as_posix(),
                "sha256": _sha256_file(platform_path),
            },
            "passports": passport_sources,
        },
    }
    if production:
        bundle["owner_account_id"] = registry["owner_account_id"].strip()
        bundle["delivery_mode"] = PRODUCTION_DELIVERY_MODE
        bundle["attestation"] = {
            "schema": PRODUCTION_ATTESTATION_SCHEMA,
            "type": "HOST_PROVIDER_CONTENT_HASH",
            "content_sha256": _canonical_sha256(bundle),
            "standards_git_commit": commit,
            "owner_account_id": bundle["owner_account_id"],
        }
    return bundle


def _write_bundle(output_path, bundle):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(
        bundle,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ) + "\n"
    temporary = output_path.with_name(output_path.name + ".tmp")
    try:
        temporary.write_text(encoded, encoding="utf-8")
        os.replace(temporary, output_path)
    except OSError as exc:
        try:
            temporary.unlink()
        except OSError:
            pass
        raise AdapterError("cannot write bundle %s: %s" % (output_path, exc)) from exc


def _default_scenario_dir():
    toolbar_dir = Path(__file__).resolve().parents[1]
    return toolbar_dir / "plugins" / "scenarios" / "evolution-standards"


def _validate_output_destination(output_path, mode):
    if mode != PRODUCTION_DATA_MODE:
        return
    toolbar_dir = Path(__file__).resolve().parents[1]
    resolved_output = output_path.resolve()
    try:
        resolved_output.relative_to(toolbar_dir)
    except ValueError:
        return
    raise AdapterError(
        "PRODUCTION delivery_mode=%s forbids static toolbar/release embedding"
        % PRODUCTION_DELIVERY_MODE
    )


def parse_args(argv):
    scenario_dir = _default_scenario_dir()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--standards-dir", required=True, type=Path)
    parser.add_argument(
        "--mode",
        choices=(DATA_MODE, PRODUCTION_DATA_MODE),
        default=DATA_MODE,
    )
    parser.add_argument(
        "--registry",
        type=Path,
        default=None,
    )
    parser.add_argument(
        "--pin",
        type=Path,
        default=scenario_dir / "standards-pin.fixture",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
    )
    args = parser.parse_args(argv)
    if args.mode == PRODUCTION_DATA_MODE:
        if args.registry is None:
            parser.error("--registry is required with --mode PRODUCTION")
        if args.output is None:
            parser.error("--output is required with --mode PRODUCTION")
    if args.registry is None:
        args.registry = scenario_dir / "fixture-registry.fixture"
    if args.output is None:
        args.output = scenario_dir / "evolution-standards-bundle.json"
    return args


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        _validate_output_destination(args.output, args.mode)
        bundle = build_bundle(
            args.standards_dir,
            args.registry.resolve(),
            args.pin.resolve(),
            args.mode,
        )
        _write_bundle(args.output.resolve(), bundle)
    except AdapterError as exc:
        print("ERROR: %s" % exc, file=sys.stderr)
        return 2
    print(
        "Evolution standards bundle: %s (%d agents, %d Shared Genes)"
        % (
            args.output,
            len(bundle["agents"]),
            len(bundle["shared_gene_index"]["genes"]),
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
