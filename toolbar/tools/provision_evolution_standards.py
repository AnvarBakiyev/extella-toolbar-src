#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Validate and provision an Evolution standards package into managed KV.

The default mode is offline validation only. A network write requires all of
``--apply``, ``--confirm APPLY``, an exact owner account id, an exact live
agent id, and a token file. Content-addressed chunks are written and read back
before the fixed root manifest is changed. Ambiguous writes are never retried.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import socket
import sys
import urllib.error
import urllib.request


sys.dont_write_bytecode = True

PACKAGE_SCHEMA = "extella.evolution.standards_kv_package.v1"
MANIFEST_SCHEMA = "extella.evolution.standards_kv_manifest.v1"
CHUNK_ENCODING = "canonical-json-chunks.v1"
BUNDLE_SCHEMA = "extella.evolution.standards_bundle.v1"
ATTESTATION_SCHEMA = "extella.evolution.standards_bundle.attestation.v1"
BUNDLE_KEY = "xtl_evolution:production_standards_bundle:v1"
DELIVERY_MODE = "ACCOUNT_SCOPED_HOST_PROVIDER"
PIN_SCHEMA = "extella.evolution.standards_pin.v1"
PRODUCTION_REGISTRY_SCHEMA = "extella.evolution.production_registry.v1"
REPORT_SCHEMA = "extella.agent_passport.check_report.v1"
CABINET_SCHEMA = "extella.agent_cabinet.v1.1"
SHARED_GENE_SCHEMA = "extella.shared_genes.map.v1"
REQUIRED_ARTIFACTS = (
    "checker",
    "builder",
    "passport_template",
    "cabinet_widget",
    "help_widget",
)
MAX_CHUNKS = 128
MAX_BUNDLE_BYTES = 2 * 1024 * 1024
MAX_CHUNK_BYTES = 9000
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
EXACT_ID_RE = re.compile(r"^[^\s*?\[\]{}]{1,240}$")
MISSING_RE = re.compile(
    r"key not found|kv[^ ]* not found|ключ[^ ]* не найден",
    re.IGNORECASE,
)


class ProvisionError(RuntimeError):
    """A deterministic validation or provisioning failure."""


class OperationOutcomeUnknown(ProvisionError):
    """The server may have accepted a write whose response was not observed."""


def _canonical_json(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _sha256_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _exact_keys(value, expected, label):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ProvisionError(
            "%s must contain exactly: %s"
            % (label, ", ".join(sorted(expected)))
        )


def _read_json(path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as exc:
        raise ProvisionError("cannot read managed-KV package: %s" % exc) from exc
    if not isinstance(value, dict):
        raise ProvisionError("managed-KV package must be a JSON object")
    return value


def _sha256_value(value):
    return _sha256_text(_canonical_json(value))


def _required_path(value, label):
    path = str(value or "")
    if (
        not path
        or path != path.strip()
        or path.startswith(("/", "\\"))
        or re.search(r"(^|[\\/])\.\.([\\/]|$)", path)
        or re.search(r"[\x00-\x1f\x7f]", path)
    ):
        raise ProvisionError("%s must be a safe relative path" % label)
    return path


def _validate_checker_report(report, label, expected_ready=None):
    _exact_keys(
        report,
        ("schema", "ready", "counts", "issues"),
        "%s checker_report" % label,
    )
    counts = report.get("counts")
    issues = report.get("issues")
    _exact_keys(
        counts,
        ("errors", "warnings", "issues"),
        "%s checker_report counts" % label,
    )
    if (
        report.get("schema") != REPORT_SCHEMA
        or not isinstance(report.get("ready"), bool)
        or not isinstance(issues, list)
    ):
        raise ProvisionError("%s checker_report is invalid" % label)
    error_count = 0
    warning_count = 0
    for issue_index, issue in enumerate(issues):
        _exact_keys(
            issue,
            ("code", "severity", "path", "message_ru", "message_en"),
            "%s checker_report issue %d" % (label, issue_index),
        )
        if (
            not str(issue.get("code") or "")
            or issue.get("severity") not in {"error", "warning"}
            or not isinstance(issue.get("path"), str)
            or not isinstance(issue.get("message_ru"), str)
            or not isinstance(issue.get("message_en"), str)
        ):
            raise ProvisionError(
                "%s checker_report issue %d is invalid"
                % (label, issue_index)
            )
        if issue["severity"] == "error":
            error_count += 1
        else:
            warning_count += 1
    expected_counts = {
        "errors": error_count,
        "warnings": warning_count,
        "issues": len(issues),
    }
    if counts != expected_counts or report["ready"] is not (error_count == 0):
        raise ProvisionError("%s checker_report counts are inconsistent" % label)
    if expected_ready is not None and report["ready"] is not expected_ready:
        raise ProvisionError("%s checker_report readiness is inconsistent" % label)


def _validate_pin_contract(bundle, pin):
    _exact_keys(
        pin,
        ("schema", "standards_git_commit", "artifacts"),
        "standards pin",
    )
    if pin.get("schema") != PIN_SCHEMA:
        raise ProvisionError("standards pin schema is invalid")
    standards = bundle.get("standards")
    _exact_keys(standards, ("git_commit", "artifacts"), "bundle standards")
    commit = str(standards.get("git_commit") or "")
    if (
        not re.fullmatch(r"[a-f0-9]{40}", commit)
        or pin.get("standards_git_commit") != commit
    ):
        raise ProvisionError("bundle standards commit does not match pin")
    artifacts = standards.get("artifacts")
    pin_artifacts = pin.get("artifacts")
    _exact_keys(artifacts, REQUIRED_ARTIFACTS, "bundle standards artifacts")
    _exact_keys(pin_artifacts, REQUIRED_ARTIFACTS, "standards pin artifacts")
    for role in REQUIRED_ARTIFACTS:
        record = artifacts[role]
        definition = pin_artifacts[role]
        expected_keys = (
            ("path", "sha256", "source", "source_encoding")
            if role in {"cabinet_widget", "help_widget"}
            else ("path", "sha256")
        )
        _exact_keys(record, expected_keys, "bundle artifact %s" % role)
        _exact_keys(definition, ("path", "sha256"), "pin artifact %s" % role)
        artifact_path = _required_path(
            record.get("path"),
            "bundle artifact %s path" % role,
        )
        artifact_sha = str(record.get("sha256") or "")
        if (
            artifact_path != definition.get("path")
            or artifact_sha != definition.get("sha256")
            or not SHA256_RE.fullmatch(artifact_sha)
        ):
            raise ProvisionError("bundle artifact %s does not match pin" % role)
        if role in {"cabinet_widget", "help_widget"} and (
            record.get("source_encoding") != "utf-8"
            or not isinstance(record.get("source"), str)
            or hashlib.sha256(
                record["source"].encode("utf-8")
            ).hexdigest() != artifact_sha
        ):
            raise ProvisionError(
                "embedded bundle artifact %s bytes do not match SHA-256" % role
            )


def _validate_agent_rows(bundle):
    agents = bundle.get("agents")
    if not isinstance(agents, list):
        raise ProvisionError("production bundle agents must be an array")
    seen = set()
    by_id = {}
    base_keys = {
        "platform_agent_id",
        "passport_present",
        "passport_ready",
        "passport_sha256",
        "platform_status",
        "platform_metadata",
        "checker_report",
        "cabinet",
        "shared_genes",
        "capability_count",
        "has_shared_genes",
    }
    for index, row in enumerate(agents):
        label = "agents[%d]" % index
        if not isinstance(row, dict) or (
            frozenset(row) not in {frozenset(base_keys), frozenset(base_keys | {
                "last_activity_at"
            })}
        ):
            raise ProvisionError("%s has an unexpected shape" % label)
        platform_id = str(row.get("platform_agent_id") or "")
        ready = row.get("passport_ready")
        metadata = row.get("platform_metadata")
        if (
            not EXACT_ID_RE.fullmatch(platform_id)
            or platform_id in seen
            or row.get("passport_present") is not True
            or not isinstance(ready, bool)
            or not SHA256_RE.fullmatch(str(row.get("passport_sha256") or ""))
            or row.get("platform_status") not in {"PRESENT", "DEAD_REFERENCE"}
            or not isinstance(row.get("shared_genes"), list)
        ):
            raise ProvisionError("%s identity or state is invalid" % label)
        _validate_checker_report(row.get("checker_report"), label, ready)
        if metadata is None:
            if row["platform_status"] != "DEAD_REFERENCE" or (
                "last_activity_at" in row
            ):
                raise ProvisionError("%s platform evidence is inconsistent" % label)
        else:
            _exact_keys(
                metadata,
                (
                    "platform_agent_id",
                    "name",
                    "provider",
                    "model",
                    "last_activity_at",
                ),
                "%s platform_metadata" % label,
            )
            if (
                metadata.get("platform_agent_id") != platform_id
                or row["platform_status"] != "PRESENT"
                or row.get("last_activity_at") != metadata.get(
                    "last_activity_at"
                )
            ):
                raise ProvisionError("%s platform evidence is inconsistent" % label)
        cabinet = row.get("cabinet")
        if ready:
            if (
                not isinstance(cabinet, dict)
                or cabinet.get("schema") != CABINET_SCHEMA
            ):
                raise ProvisionError("%s Agent Cabinet is invalid" % label)
            steps = cabinet.get("declared_behaviour", {}).get("steps")
            cabinet_genes = (
                cabinet.get("passport", {})
                .get("attention", {})
                .get("shared_genes")
            )
            if (
                not isinstance(steps, list)
                or not isinstance(cabinet_genes, list)
                or row.get("capability_count") != len(steps)
                or _canonical_json(cabinet_genes)
                != _canonical_json(row["shared_genes"])
                or row.get("has_shared_genes") is not bool(cabinet_genes)
            ):
                raise ProvisionError("%s canonical Cabinet facts differ" % label)
        elif (
            cabinet is not None
            or row.get("capability_count") is not None
            or row.get("has_shared_genes") is not None
            or row["shared_genes"]
        ):
            raise ProvisionError("%s failed passport exposes derived facts" % label)
        seen.add(platform_id)
        by_id[platform_id] = row
    if list(by_id) != sorted(by_id):
        raise ProvisionError("production bundle agents must be sorted by stable id")
    return by_id


def _validate_shared_gene_index(bundle, agents_by_id):
    index = bundle.get("shared_gene_index")
    _exact_keys(
        index,
        (
            "schema",
            "data_mode",
            "complete",
            "provenance",
            "genes",
            "by_agent",
            "content_sha256",
        ),
        "Shared Genes index",
    )
    expected_by_agent = {}
    genes_by_id = {}
    for platform_id, row in agents_by_id.items():
        gene_ids = []
        for gene_index, gene in enumerate(row["shared_genes"]):
            _exact_keys(
                gene,
                (
                    "consumer_agent_id",
                    "gene_id",
                    "kind",
                    "name",
                    "version",
                    "provenance",
                ),
                "agent Shared Gene %s[%d]" % (platform_id, gene_index),
            )
            gene_id = str(gene.get("gene_id") or "")
            if (
                not gene_id
                or gene.get("consumer_agent_id") != platform_id
                or gene_id in gene_ids
            ):
                raise ProvisionError("agent Shared Gene identity is invalid")
            definition = {
                "gene_id": gene_id,
                "kind": gene.get("kind"),
                "name": gene.get("name"),
                "version": gene.get("version"),
                "provenance": gene.get("provenance"),
            }
            current = genes_by_id.setdefault(
                gene_id,
                {"definition": definition, "consumers": []},
            )
            if current["definition"] != definition:
                raise ProvisionError("Shared Gene declarations conflict")
            current["consumers"].append(platform_id)
            gene_ids.append(gene_id)
        expected_by_agent[platform_id] = sorted(gene_ids)
    expected_genes = []
    for gene_id in sorted(genes_by_id):
        current = dict(genes_by_id[gene_id]["definition"])
        current["consumer_agent_ids"] = sorted(
            genes_by_id[gene_id]["consumers"]
        )
        current["consumer_count"] = len(current["consumer_agent_ids"])
        expected_genes.append(current)
    unsigned = {
        "schema": SHARED_GENE_SCHEMA,
        "data_mode": "PRODUCTION",
        "complete": True,
        "provenance": "DECLARED_VALID_AGENT_PASSPORTS",
        "genes": expected_genes,
        "by_agent": expected_by_agent,
    }
    expected = dict(unsigned)
    expected["content_sha256"] = _sha256_value(unsigned)
    if index != expected:
        raise ProvisionError("Shared Genes index differs from exact Agent rows")


def _validate_sources(bundle, agents_by_id):
    sources = bundle.get("sources")
    _exact_keys(
        sources,
        ("registry", "standards_pin", "platform_agents", "passports"),
        "bundle sources",
    )
    _exact_keys(
        sources.get("registry"),
        ("path", "sha256", "schema"),
        "production registry source",
    )
    _exact_keys(
        sources.get("standards_pin"),
        ("path", "sha256", "schema"),
        "standards pin source",
    )
    _exact_keys(
        sources.get("platform_agents"),
        ("path", "sha256"),
        "platform agents source",
    )
    if (
        sources["registry"].get("schema") != PRODUCTION_REGISTRY_SCHEMA
        or sources["standards_pin"].get("schema") != PIN_SCHEMA
    ):
        raise ProvisionError("bundle source schemas are invalid")
    for label, source in (
        ("registry", sources["registry"]),
        ("standards pin", sources["standards_pin"]),
        ("platform agents", sources["platform_agents"]),
    ):
        _required_path(source.get("path"), "%s source path" % label)
        if not SHA256_RE.fullmatch(str(source.get("sha256") or "")):
            raise ProvisionError("%s source SHA-256 is invalid" % label)
    rows = sources.get("passports")
    if not isinstance(rows, list):
        raise ProvisionError("passport sources must be an array")
    bound = {}
    unbound = {}
    seen_paths = set()
    for index, row in enumerate(rows):
        label = "passport source %d" % index
        if not isinstance(row, dict):
            raise ProvisionError("%s is invalid" % label)
        platform_id = row.get("platform_agent_id")
        expected_keys = (
            ("path", "platform_agent_id", "sha256")
            if platform_id is not None
            else (
                "path",
                "platform_agent_id",
                "source_passport_id",
                "sha256",
            )
        )
        _exact_keys(row, expected_keys, label)
        source_path = _required_path(row.get("path"), "%s path" % label)
        source_sha = str(row.get("sha256") or "")
        if source_path in seen_paths or not SHA256_RE.fullmatch(source_sha):
            raise ProvisionError("%s path or SHA-256 is invalid" % label)
        seen_paths.add(source_path)
        if platform_id is None:
            source_id = str(row.get("source_passport_id") or "")
            if source_id in unbound:
                raise ProvisionError("duplicate unbound passport source")
            unbound[source_id] = row
        else:
            platform_id = str(platform_id)
            if platform_id in bound:
                raise ProvisionError("duplicate bound passport source")
            bound[platform_id] = row
    if set(bound) != set(agents_by_id):
        raise ProvisionError("bound passport sources differ from Agent rows")
    for platform_id, row in agents_by_id.items():
        if bound[platform_id]["sha256"] != row["passport_sha256"]:
            raise ProvisionError("Agent row differs from passport source SHA-256")
    return unbound


def _validate_attestation(bundle, owner_account_id):
    attestation = bundle.get("attestation")
    _exact_keys(
        attestation,
        (
            "schema",
            "type",
            "content_sha256",
            "standards_git_commit",
            "owner_account_id",
        ),
        "bundle attestation",
    )
    content_hash = str(attestation.get("content_sha256") or "")
    if (
        attestation.get("schema") != ATTESTATION_SCHEMA
        or attestation.get("type") != "HOST_PROVIDER_CONTENT_HASH"
        or str(attestation.get("owner_account_id") or "") != owner_account_id
        or not SHA256_RE.fullmatch(content_hash)
        or not re.fullmatch(
            r"[a-f0-9]{40}",
            str(attestation.get("standards_git_commit") or ""),
        )
        or attestation.get("standards_git_commit")
        != bundle.get("standards", {}).get("git_commit")
    ):
        raise ProvisionError("bundle attestation is invalid")
    unsigned = dict(bundle)
    del unsigned["attestation"]
    if _sha256_text(_canonical_json(unsigned)) != content_hash:
        raise ProvisionError("bundle attestation content_sha256 does not match")


def _validate_unbound_passports(bundle, unbound_sources):
    rows = bundle.get("unbound_passports")
    if not isinstance(rows, list):
        raise ProvisionError("production bundle must declare unbound_passports")
    seen = set()
    expected = {
        "source_passport_id",
        "source_path",
        "passport_sha256",
        "passport_canonical_sha256",
        "passport",
        "checker_report",
    }
    for index, row in enumerate(rows):
        label = "unbound_passports[%d]" % index
        _exact_keys(row, expected, label)
        source_id = str(row.get("source_passport_id") or "")
        source_path = _required_path(
            row.get("source_path"),
            "%s source_path" % label,
        )
        source_sha = str(row.get("passport_sha256") or "")
        passport = row.get("passport")
        report = row.get("checker_report")
        if (
            not re.fullmatch(r"passport_[a-f0-9]{32}", source_id)
            or source_id in seen
            or not SHA256_RE.fullmatch(source_sha)
            or not SHA256_RE.fullmatch(
                str(row.get("passport_canonical_sha256") or "")
            )
            or not isinstance(passport, dict)
        ):
            raise ProvisionError("%s identity or hash fields are invalid" % label)
        expected_source_id = "passport_" + _sha256_value(
            {"path": source_path, "passport_sha256": source_sha}
        )[:32]
        source = unbound_sources.get(source_id)
        agent = passport.get("agent") if isinstance(passport, dict) else None
        if (
            source_id != expected_source_id
            or not isinstance(source, dict)
            or source.get("path") != source_path
            or source.get("sha256") != source_sha
            or not isinstance(agent, dict)
            or str(agent.get("platform_agent_id") or "").strip()
        ):
            raise ProvisionError("%s source identity is inconsistent" % label)
        if (
            _sha256_text(_canonical_json(passport))
            != row["passport_canonical_sha256"]
        ):
            raise ProvisionError(
                "%s passport_canonical_sha256 does not match passport" % label
            )
        _validate_checker_report(report, label, False)
        if not any(
            issue.get("code") == "AGENT_PLATFORM_ID_REQUIRED"
            and issue.get("severity") == "error"
            and issue.get("path") == "agent.platform_agent_id"
            for issue in report["issues"]
        ):
            raise ProvisionError(
                "%s lacks canonical stable-ID remediation evidence" % label
            )
        seen.add(source_id)
    if seen != set(unbound_sources):
        raise ProvisionError(
            "unbound passport sources differ from unbound_passports"
        )


def validate_package(package, expected_pin):
    _exact_keys(
        package,
        ("schema", "owner_account_id", "root", "chunks"),
        "managed-KV package",
    )
    owner_account_id = str(package.get("owner_account_id") or "").strip()
    if (
        package.get("schema") != PACKAGE_SCHEMA
        or not EXACT_ID_RE.fullmatch(owner_account_id)
    ):
        raise ProvisionError("managed-KV package schema or owner is invalid")

    root = package.get("root")
    _exact_keys(root, ("key", "value"), "managed-KV package root")
    if root.get("key") != BUNDLE_KEY:
        raise ProvisionError("managed-KV package root key is invalid")
    manifest = root.get("value")
    _exact_keys(
        manifest,
        (
            "schema",
            "owner_account_id",
            "encoding",
            "bundle_sha256",
            "bundle_byte_length",
            "chunk_count",
        ),
        "managed-KV manifest",
    )
    bundle_hash = str(manifest.get("bundle_sha256") or "")
    bundle_bytes = manifest.get("bundle_byte_length")
    chunk_count = manifest.get("chunk_count")
    if (
        manifest.get("schema") != MANIFEST_SCHEMA
        or manifest.get("encoding") != CHUNK_ENCODING
        or str(manifest.get("owner_account_id") or "") != owner_account_id
        or not SHA256_RE.fullmatch(bundle_hash)
        or not isinstance(bundle_bytes, int)
        or isinstance(bundle_bytes, bool)
        or bundle_bytes < 2
        or bundle_bytes > MAX_BUNDLE_BYTES
        or not isinstance(chunk_count, int)
        or isinstance(chunk_count, bool)
        or chunk_count < 1
        or chunk_count > MAX_CHUNKS
    ):
        raise ProvisionError("managed-KV manifest is invalid")

    chunks = package.get("chunks")
    if not isinstance(chunks, list) or len(chunks) != chunk_count:
        raise ProvisionError("managed-KV chunk_count does not match chunks")
    values = []
    seen_keys = set()
    for index, entry in enumerate(chunks):
        label = "managed-KV chunk %d" % index
        _exact_keys(entry, ("key", "value"), label)
        expected_key = "%s:chunk:%s:%d" % (
            BUNDLE_KEY,
            bundle_hash[:20],
            index,
        )
        value = entry.get("value")
        if (
            entry.get("key") != expected_key
            or expected_key in seen_keys
            or not isinstance(value, str)
            or not value
            or len(value.encode("utf-8")) > MAX_CHUNK_BYTES
        ):
            raise ProvisionError("%s is invalid" % label)
        seen_keys.add(expected_key)
        values.append(value)

    canonical_bundle = "".join(values)
    if len(canonical_bundle.encode("utf-8")) != bundle_bytes:
        raise ProvisionError("managed-KV bundle byte length does not match")
    if _sha256_text(canonical_bundle) != bundle_hash:
        raise ProvisionError("managed-KV bundle SHA-256 does not match")
    try:
        bundle = json.loads(canonical_bundle)
    except ValueError as exc:
        raise ProvisionError("managed-KV chunks are not valid JSON") from exc
    if not isinstance(bundle, dict) or _canonical_json(bundle) != canonical_bundle:
        raise ProvisionError("managed-KV chunks are not canonical JSON")
    _exact_keys(
        bundle,
        (
            "schema",
            "data_mode",
            "production_eligible",
            "live_projection_allowed",
            "runtime_policy",
            "standards",
            "passport_template",
            "agents",
            "shared_gene_index",
            "sources",
            "unbound_passports",
            "owner_account_id",
            "delivery_mode",
            "attestation",
        ),
        "production standards bundle",
    )
    if (
        bundle.get("schema") != BUNDLE_SCHEMA
        or bundle.get("data_mode") != "PRODUCTION"
        or bundle.get("delivery_mode") != DELIVERY_MODE
        or bundle.get("owner_account_id") != owner_account_id
        or bundle.get("production_eligible") is not True
        or bundle.get("live_projection_allowed") is not True
    ):
        raise ProvisionError("managed-KV package contains no eligible bundle")
    _exact_keys(
        bundle.get("runtime_policy"),
        ("live_projection", "production_merge", "purpose"),
        "production runtime policy",
    )
    if bundle["runtime_policy"] != {
        "live_projection": "ALLOWED",
        "production_merge": "ALLOWED",
        "purpose": "STRICT_PINNED_PRODUCTION_REGISTRY",
    }:
        raise ProvisionError("production runtime policy is invalid")
    _validate_pin_contract(bundle, expected_pin)
    template = bundle.get("passport_template")
    _exact_keys(
        template,
        ("artifact_path", "sha256", "draft_state", "parsed"),
        "Agent Passport template",
    )
    template_artifact = bundle["standards"]["artifacts"][
        "passport_template"
    ]
    if (
        template.get("artifact_path") != template_artifact["path"]
        or template.get("sha256") != template_artifact["sha256"]
        or template.get("draft_state") != "NOT_VALIDATED"
        or not isinstance(template.get("parsed"), dict)
    ):
        raise ProvisionError("Agent Passport template is incompatible")
    agents_by_id = _validate_agent_rows(bundle)
    _validate_shared_gene_index(bundle, agents_by_id)
    unbound_sources = _validate_sources(bundle, agents_by_id)
    _validate_attestation(bundle, owner_account_id)
    _validate_unbound_passports(bundle, unbound_sources)
    return {
        "owner_account_id": owner_account_id,
        "bundle_sha256": bundle_hash,
        "bundle_byte_length": bundle_bytes,
        "chunk_count": chunk_count,
        "root": root,
        "chunks": chunks,
        "bundle": bundle,
        "pin": expected_pin,
    }


def _response_message(response):
    values = []
    for key in ("message", "error", "detail"):
        value = response.get(key) if isinstance(response, dict) else None
        if isinstance(value, dict):
            value = value.get("message") or value.get("msg")
        if isinstance(value, list):
            value = "; ".join(
                str(item.get("message") or item.get("msg") or item)
                if isinstance(item, dict)
                else str(item)
                for item in value
            )
        if value:
            values.append(str(value))
    return " ".join(values)


def _is_missing(response):
    if not isinstance(response, dict):
        return False
    status = str(response.get("status") or "").lower()
    http_status = int(response.get("_http_status") or 0)
    return (
        status in {"error", "failed", "not_found"}
        or http_status in {404, 500}
    ) and bool(MISSING_RE.search(_response_message(response)))


def _response_error(response):
    if not isinstance(response, dict):
        return "managed KV returned a non-object response"
    status = str(response.get("status") or "").lower()
    http_status = int(response.get("_http_status") or 0)
    if status in {"error", "failed", "not_found"} or http_status >= 400:
        return _response_message(response) or "managed KV request failed"
    return ""


def _extract_value(response):
    if _is_missing(response):
        return None
    error = _response_error(response)
    if error:
        raise ProvisionError(error)
    if "value" in response:
        return response["value"]
    if "kv_value" in response:
        return response["kv_value"]
    result = response.get("result")
    if isinstance(result, dict) and "value" in result:
        return result["value"]
    return None


def _same_value(left, right):
    if isinstance(left, str) and isinstance(right, (dict, list)):
        try:
            left = json.loads(left)
        except ValueError:
            return False
    if isinstance(right, str) and isinstance(left, (dict, list)):
        try:
            right = json.loads(right)
        except ValueError:
            return False
    if isinstance(left, (dict, list)) and isinstance(right, (dict, list)):
        return _canonical_json(left) == _canonical_json(right)
    return left == right


class ApiClient:
    def __init__(self, api_base, token, profile_id, agent_id, timeout):
        self.api_base = api_base.rstrip("/")
        self.token = token
        self.profile_id = profile_id
        self.agent_id = agent_id
        self.timeout = timeout

    def _post(self, path, body, mutating=False):
        request = urllib.request.Request(
            self.api_base + path,
            data=_canonical_json(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-Auth-Token": self.token,
                "X-Profile-Id": self.profile_id,
                "X-Agent-Id": self.agent_id,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=self.timeout,
            ) as response:
                raw = response.read().decode("utf-8")
                status = response.status
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", "replace")
            status = exc.code
        except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
            if mutating:
                raise OperationOutcomeUnknown(
                    "OPERATION_OUTCOME_UNKNOWN: managed KV write response "
                    "was not observed; do not retry blindly"
                ) from exc
            raise ProvisionError("managed KV read failed: %s" % exc) from exc
        try:
            value = json.loads(raw) if raw.strip() else {}
        except ValueError as exc:
            raise ProvisionError(
                "managed KV returned invalid JSON (HTTP %s)" % status
            ) from exc
        if not isinstance(value, dict):
            raise ProvisionError("managed KV returned a non-object response")
        value["_http_status"] = status
        return value

    def get(self, key):
        return _extract_value(
            self._post("/api/kv/get", {"key": key}, mutating=False)
        )

    def set(self, key, value):
        response = self._post(
            "/api/kv/set",
            {
                "key": key,
                "value": value,
                "description": (
                    "Extella Evolution production Agent Passport registry"
                ),
            },
            mutating=True,
        )
        error = _response_error(response)
        if error:
            raise ProvisionError(error)

    def list_live_agent_ids(self):
        response = self._post("/api/agent/list", {}, mutating=False)
        error = _response_error(response)
        if error:
            raise ProvisionError(error)
        rows = (
            response.get("agents")
            or response.get("results")
            or response.get("items")
            or []
        )
        if not isinstance(rows, list):
            raise ProvisionError("agent/list returned no exact live fleet")
        ids = []
        seen = set()
        for row in rows:
            agent_id = str(
                row.get("id") or row.get("agent_id") or ""
            ) if isinstance(row, dict) else ""
            if not EXACT_ID_RE.fullmatch(agent_id) or agent_id in seen:
                raise ProvisionError(
                    "agent/list returned an invalid or duplicate stable id"
                )
            ids.append(agent_id)
            seen.add(agent_id)
        observed_owner = (
            response.get("owner_account_id")
            or response.get("account_id")
            or response.get("user_id")
        )
        return ids, (
            str(observed_owner).strip() if observed_owner is not None else None
        )


def _write_and_verify(client, key, value):
    client.set(key, value)
    read_back = client.get(key)
    if not _same_value(read_back, value):
        raise ProvisionError("managed KV read-back mismatch for %s" % key)


def _preflight_live_scope(plan, client, agent_id):
    live_ids, observed_owner = client.list_live_agent_ids()
    if agent_id not in live_ids:
        raise ProvisionError(
            "selected --agent-id is not in the exact current agent/list fleet"
        )
    if (
        observed_owner is not None
        and observed_owner != plan["owner_account_id"]
    ):
        raise ProvisionError(
            "authenticated account does not match package owner_account_id"
        )


def _verify_published(plan, client):
    root_before = client.get(plan["root"]["key"])
    if not _same_value(root_before, plan["root"]["value"]):
        raise ProvisionError("published managed KV root does not match")
    if isinstance(root_before, str):
        try:
            root_value = json.loads(root_before)
        except ValueError as exc:
            raise ProvisionError(
                "published managed KV root is not valid JSON"
            ) from exc
    else:
        root_value = root_before
    observed_chunks = []
    for expected in plan["chunks"]:
        observed = client.get(expected["key"])
        if not _same_value(observed, expected["value"]):
            raise ProvisionError(
                "published managed KV chunk does not match: %s"
                % expected["key"]
            )
        observed_chunks.append(
            {"key": expected["key"], "value": observed}
        )
    validate_package(
        {
            "schema": PACKAGE_SCHEMA,
            "owner_account_id": plan["owner_account_id"],
            "root": {"key": BUNDLE_KEY, "value": root_value},
            "chunks": observed_chunks,
        },
        plan["pin"],
    )
    root_after = client.get(plan["root"]["key"])
    if not _same_value(root_after, root_before):
        raise ProvisionError(
            "managed KV root changed during final bundle verification"
        )


def provision(plan, client, agent_id, replace_root=False):
    _preflight_live_scope(plan, client, agent_id)
    written = 0
    reused = 0
    for entry in plan["chunks"]:
        existing = client.get(entry["key"])
        if existing is None:
            _write_and_verify(client, entry["key"], entry["value"])
            written += 1
        elif _same_value(existing, entry["value"]):
            reused += 1
        else:
            raise ProvisionError(
                "content-addressed managed KV chunk conflicts: %s"
                % entry["key"]
            )

    root = plan["root"]
    existing_root = client.get(root["key"])
    if existing_root is None:
        _write_and_verify(client, root["key"], root["value"])
        written += 1
    elif _same_value(existing_root, root["value"]):
        reused += 1
    elif replace_root:
        _write_and_verify(client, root["key"], root["value"])
        written += 1
    else:
        raise ProvisionError(
            "managed KV root already points to another bundle; "
            "use --replace-root with the explicit APPLY confirmation"
        )
    _verify_published(plan, client)
    return {"written": written, "reused": reused}


def _seal_bundle(bundle, commit):
    sealed = json.loads(json.dumps(bundle))
    sealed.pop("attestation", None)
    sealed["attestation"] = {
        "schema": ATTESTATION_SCHEMA,
        "type": "HOST_PROVIDER_CONTENT_HASH",
        "content_sha256": _sha256_value(sealed),
        "standards_git_commit": commit,
        "owner_account_id": sealed.get("owner_account_id"),
    }
    return sealed


def _package_from_bundle(bundle):
    encoded = _canonical_json(bundle)
    bundle_hash = _sha256_text(encoded)
    values = []
    current = []
    current_bytes = 0
    for character in encoded:
        character_bytes = len(character.encode("utf-8"))
        if current and current_bytes + character_bytes > MAX_CHUNK_BYTES:
            values.append("".join(current))
            current = []
            current_bytes = 0
        current.append(character)
        current_bytes += character_bytes
    if current:
        values.append("".join(current))
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "owner_account_id": bundle["owner_account_id"],
        "encoding": CHUNK_ENCODING,
        "bundle_sha256": bundle_hash,
        "bundle_byte_length": len(encoded.encode("utf-8")),
        "chunk_count": len(values),
    }
    return {
        "schema": PACKAGE_SCHEMA,
        "owner_account_id": bundle["owner_account_id"],
        "root": {"key": BUNDLE_KEY, "value": manifest},
        "chunks": [
            {
                "key": "%s:chunk:%s:%d"
                % (BUNDLE_KEY, bundle_hash[:20], index),
                "value": value,
            }
            for index, value in enumerate(values)
        ],
    }


def _selftest_package():
    commit = "3" * 40
    cabinet_source = "var canonicalCabinetSelftest = true;\n"
    help_source = "var canonicalHelpSelftest = true;\n"
    artifacts = {
        "checker": {
            "path": "tools/check_agent_passport.py",
            "sha256": "4" * 64,
        },
        "builder": {
            "path": "tools/build_agent_cabinet.py",
            "sha256": "5" * 64,
        },
        "passport_template": {
            "path": "templates/agent_passport.template.yaml",
            "sha256": "6" * 64,
        },
        "cabinet_widget": {
            "path": "templates/cabinet_widget.js",
            "sha256": hashlib.sha256(
                cabinet_source.encode("utf-8")
            ).hexdigest(),
            "source": cabinet_source,
            "source_encoding": "utf-8",
        },
        "help_widget": {
            "path": "templates/help_widget.js",
            "sha256": hashlib.sha256(
                help_source.encode("utf-8")
            ).hexdigest(),
            "source": help_source,
            "source_encoding": "utf-8",
        },
    }
    pin = {
        "schema": PIN_SCHEMA,
        "standards_git_commit": commit,
        "artifacts": {
            role: {
                "path": record["path"],
                "sha256": record["sha256"],
            }
            for role, record in artifacts.items()
        },
    }
    passport = {
        "agent": {
            "name": "Legacy",
            "platform_agent_id": "",
        }
    }
    source_path = "passports/legacy.json"
    source_sha = "2" * 64
    source_id = "passport_" + _sha256_value(
        {"path": source_path, "passport_sha256": source_sha}
    )[:32]
    unbound = {
        "source_passport_id": source_id,
        "source_path": source_path,
        "passport_sha256": source_sha,
        "passport_canonical_sha256": _sha256_value(passport),
        "passport": passport,
        "checker_report": {
            "schema": REPORT_SCHEMA,
            "ready": False,
            "counts": {"errors": 1, "warnings": 0, "issues": 1},
            "issues": [
                {
                    "code": "AGENT_PLATFORM_ID_REQUIRED",
                    "severity": "error",
                    "path": "agent.platform_agent_id",
                    "message_ru": "Выберите точного агента",
                    "message_en": "Select the exact agent",
                }
            ],
        },
    }
    bound_id = "agent_selftest"
    bound_sha = "7" * 64
    bound_report = {
        "schema": REPORT_SCHEMA,
        "ready": True,
        "counts": {"errors": 0, "warnings": 0, "issues": 0},
        "issues": [],
    }
    cabinet = {
        "schema": CABINET_SCHEMA,
        "passport": {"attention": {"shared_genes": []}},
        "declared_behaviour": {"steps": []},
        "actual_behaviour": {},
        "evolution": {},
    }
    agent = {
        "platform_agent_id": bound_id,
        "passport_present": True,
        "passport_ready": True,
        "passport_sha256": bound_sha,
        "platform_status": "PRESENT",
        "platform_metadata": {
            "platform_agent_id": bound_id,
            "name": "Selftest agent",
            "provider": "alibaba",
            "model": "qwen-selftest",
            "last_activity_at": "2026-07-26T00:00:00Z",
        },
        "checker_report": bound_report,
        "cabinet": cabinet,
        "shared_genes": [],
        "capability_count": 0,
        "has_shared_genes": False,
        "last_activity_at": "2026-07-26T00:00:00Z",
    }
    shared_unsigned = {
        "schema": SHARED_GENE_SCHEMA,
        "data_mode": "PRODUCTION",
        "complete": True,
        "provenance": "DECLARED_VALID_AGENT_PASSPORTS",
        "genes": [],
        "by_agent": {bound_id: []},
    }
    shared_index = dict(shared_unsigned)
    shared_index["content_sha256"] = _sha256_value(shared_unsigned)
    bundle = {
        "schema": BUNDLE_SCHEMA,
        "data_mode": "PRODUCTION",
        "production_eligible": True,
        "live_projection_allowed": True,
        "runtime_policy": {
            "live_projection": "ALLOWED",
            "production_merge": "ALLOWED",
            "purpose": "STRICT_PINNED_PRODUCTION_REGISTRY",
        },
        "standards": {
            "git_commit": commit,
            "artifacts": artifacts,
        },
        "passport_template": {
            "artifact_path": artifacts["passport_template"]["path"],
            "sha256": artifacts["passport_template"]["sha256"],
            "draft_state": "NOT_VALIDATED",
            "parsed": {"agent": {"platform_agent_id": ""}},
        },
        "agents": [agent],
        "shared_gene_index": shared_index,
        "sources": {
            "registry": {
                "path": "registry.json",
                "sha256": "8" * 64,
                "schema": PRODUCTION_REGISTRY_SCHEMA,
            },
            "standards_pin": {
                "path": "standards-pin.fixture",
                "sha256": "9" * 64,
                "schema": PIN_SCHEMA,
            },
            "platform_agents": {
                "path": "platform-agents.json",
                "sha256": "a" * 64,
            },
            "passports": [
                {
                    "path": source_path,
                    "platform_agent_id": None,
                    "source_passport_id": source_id,
                    "sha256": source_sha,
                },
                {
                    "path": "passports/bound.json",
                    "platform_agent_id": bound_id,
                    "sha256": bound_sha,
                },
            ],
        },
        "unbound_passports": [unbound],
        "owner_account_id": "account_selftest",
        "delivery_mode": DELIVERY_MODE,
    }
    sealed = _seal_bundle(bundle, commit)
    return _package_from_bundle(sealed), pin, sealed


class _FakeClient:
    def __init__(
        self,
        values=None,
        live_ids=None,
        owner_account_id="account_selftest",
    ):
        self.values = dict(values or {})
        self.events = []
        self.live_ids = list(live_ids or ["agent_selftest"])
        self.owner_account_id = owner_account_id

    def get(self, key):
        self.events.append(("get", key))
        return self.values.get(key)

    def set(self, key, value):
        self.events.append(("set", key))
        self.values[key] = value

    def list_live_agent_ids(self):
        self.events.append(("agent/list", ""))
        return list(self.live_ids), self.owner_account_id


def selftest():
    package, pin, bundle = _selftest_package()
    plan = validate_package(package, pin)
    client = _FakeClient()
    result = provision(plan, client, "agent_selftest")
    set_events = [event for event in client.events if event[0] == "set"]
    expected_writes = len(plan["chunks"]) + 1
    if (
        result != {"written": expected_writes, "reused": 0}
        or set_events[-1][1] != BUNDLE_KEY
        or any(event[1] == BUNDLE_KEY for event in set_events[:-1])
    ):
        raise ProvisionError("selftest did not write chunks before root")

    client.events = []
    result = provision(plan, client, "agent_selftest")
    if result != {"written": 0, "reused": expected_writes} or any(
        event[0] == "set" for event in client.events
    ):
        raise ProvisionError("selftest idempotency failed")

    conflict = _FakeClient(
        {plan["chunks"][0]["key"]: "conflicting-content"}
    )
    try:
        provision(plan, conflict, "agent_selftest")
    except ProvisionError:
        pass
    else:
        raise ProvisionError("selftest accepted a conflicting chunk")
    if BUNDLE_KEY in conflict.values:
        raise ProvisionError("selftest changed root after a chunk conflict")

    wrong_target = _FakeClient(live_ids=["agent_other"])
    try:
        provision(plan, wrong_target, "agent_selftest")
    except ProvisionError:
        pass
    else:
        raise ProvisionError("selftest accepted a non-live agent target")
    if any(event[0] == "set" for event in wrong_target.events):
        raise ProvisionError("selftest wrote before live-fleet preflight")

    wrong_owner = _FakeClient(owner_account_id="account_other")
    try:
        provision(plan, wrong_owner, "agent_selftest")
    except ProvisionError:
        pass
    else:
        raise ProvisionError("selftest accepted a different account owner")
    if any(event[0] == "set" for event in wrong_owner.events):
        raise ProvisionError("selftest wrote before account preflight")

    class TamperAfterRootClient(_FakeClient):
        def set(self, key, value):
            super().set(key, value)
            if key == BUNDLE_KEY:
                self.values[plan["chunks"][0]["key"]] += "tampered"

    concurrent_tamper = TamperAfterRootClient()
    try:
        provision(plan, concurrent_tamper, "agent_selftest")
    except ProvisionError:
        pass
    else:
        raise ProvisionError(
            "selftest accepted a post-chunk pre-root content change"
        )

    tampered = json.loads(json.dumps(package))
    tampered["chunks"][0]["value"] += "x"
    try:
        validate_package(tampered, pin)
    except ProvisionError:
        pass
    else:
        raise ProvisionError("selftest accepted a tampered package")

    for missing_field in (
        "runtime_policy",
        "standards",
        "passport_template",
        "agents",
        "shared_gene_index",
        "sources",
        "unbound_passports",
    ):
        incompatible = json.loads(json.dumps(bundle))
        del incompatible[missing_field]
        incompatible = _seal_bundle(incompatible, "3" * 40)
        try:
            validate_package(_package_from_bundle(incompatible), pin)
        except ProvisionError:
            pass
        else:
            raise ProvisionError(
                "selftest accepted a bundle missing %s" % missing_field
            )

    missing_report = json.loads(json.dumps(bundle))
    del missing_report["agents"][0]["checker_report"]
    missing_report = _seal_bundle(missing_report, "3" * 40)
    try:
        validate_package(_package_from_bundle(missing_report), pin)
    except ProvisionError:
        pass
    else:
        raise ProvisionError(
            "selftest accepted an Agent row without canonical checker facts"
        )

    wrong_pin = json.loads(json.dumps(pin))
    wrong_pin["artifacts"]["checker"]["sha256"] = "f" * 64
    try:
        validate_package(package, wrong_pin)
    except ProvisionError:
        pass
    else:
        raise ProvisionError("selftest accepted a different standards pin")
    print("Evolution standards managed-KV provision selftest: PASS")


def _parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path)
    parser.add_argument(
        "--pin",
        type=Path,
        default=(
            Path(__file__).resolve().parents[1]
            / "plugins"
            / "scenarios"
            / "evolution-standards"
            / "standards-pin.fixture"
        ),
    )
    parser.add_argument("--api-base", default="https://api.extella.ai")
    parser.add_argument("--profile-id", default="default")
    parser.add_argument("--agent-id")
    parser.add_argument("--owner-account-id")
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--timeout", type=float, default=90.0)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--replace-root", action="store_true")
    parser.add_argument("--confirm")
    parser.add_argument("--selftest", action="store_true")
    return parser


def main(argv=None):
    parser = _parser()
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    try:
        if args.selftest:
            selftest()
            return 0
        if args.package is None:
            parser.error("--package is required unless --selftest is used")
        plan = validate_package(
            _read_json(args.package.resolve()),
            _read_json(args.pin.resolve()),
        )
        if args.owner_account_id and (
            args.owner_account_id != plan["owner_account_id"]
        ):
            raise ProvisionError(
                "--owner-account-id does not match the package owner"
            )
        if not args.apply:
            if args.replace_root:
                parser.error("--replace-root requires --apply")
            print(
                _canonical_json(
                    {
                        "status": "VALIDATED_DRY_RUN",
                        "owner_account_id": plan["owner_account_id"],
                        "bundle_sha256": plan["bundle_sha256"],
                        "bundle_byte_length": plan["bundle_byte_length"],
                        "chunk_count": plan["chunk_count"],
                        "root_key": BUNDLE_KEY,
                        "external_writes": 0,
                    }
                )
            )
            return 0

        if args.confirm != "APPLY":
            parser.error("--apply requires the exact gate --confirm APPLY")
        if args.profile_id != "default":
            parser.error("--apply supports only --profile-id default")
        if not args.owner_account_id:
            parser.error("--apply requires --owner-account-id")
        if not args.agent_id or not EXACT_ID_RE.fullmatch(args.agent_id):
            parser.error("--apply requires one exact live --agent-id")
        if args.token_file is None:
            parser.error("--apply requires --token-file")
        try:
            token = args.token_file.read_text(encoding="utf-8").strip()
        except (OSError, UnicodeError) as exc:
            raise ProvisionError("cannot read token file: %s" % exc) from exc
        if not token:
            raise ProvisionError("token file is empty")
        if args.timeout <= 0 or args.timeout > 300:
            parser.error("--timeout must be greater than 0 and at most 300")
        client = ApiClient(
            args.api_base,
            token,
            args.profile_id,
            args.agent_id,
            args.timeout,
        )
        result = provision(
            plan,
            client,
            args.agent_id,
            replace_root=args.replace_root,
        )
        print(
            _canonical_json(
                {
                    "status": "APPLIED_AND_READ_BACK_VERIFIED",
                    "owner_account_id": plan["owner_account_id"],
                    "agent_id": args.agent_id,
                    "bundle_sha256": plan["bundle_sha256"],
                    "written": result["written"],
                    "reused": result["reused"],
                    "root_written_last": True,
                }
            )
        )
        return 0
    except OperationOutcomeUnknown as exc:
        print("ERROR: %s" % exc, file=sys.stderr)
        return 3
    except ProvisionError as exc:
        print("ERROR: %s" % exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
