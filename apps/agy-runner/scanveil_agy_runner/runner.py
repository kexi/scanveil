from __future__ import annotations

import asyncio
import inspect
import json
import os
import re
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, Field, ValidationError

Finding = dict[str, Any]
StreamEvent = dict[str, Any]
StreamSink = Callable[[StreamEvent], Awaitable[None]]
AgentChat = Callable[[str], Awaitable[str]]


class RunnerError(Exception):
    pass


@dataclass(frozen=True)
class ReviewFile:
    path: str
    added_lines: set[int]
    raw: str


@dataclass(frozen=True)
class AgentSettings:
    timeout_seconds: int
    skills_enabled: bool
    plugins_enabled: bool
    mcp_enabled: bool
    repository_dir: Path | None
    project: str
    location: str
    runner_region: str | None
    model: str | None
    scan_policies: tuple[tuple[str, str], ...] = ()


# Why not require a numeric confidence outright: the model drifts between
# numbers and labels ("high"), and a ValidationError here silently dropped
# real critical findings behind a clean zero-finding scan.
_CONFIDENCE_LABELS = {
    "certain": 1.0,
    "very high": 0.95,
    "high": 0.9,
    "medium": 0.6,
    "moderate": 0.6,
    "low": 0.3,
    "very low": 0.1,
}


def normalize_confidence(value: Any) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return min(1.0, max(0.0, float(value)))
    if isinstance(value, str):
        label = _CONFIDENCE_LABELS.get(value.strip().lower())
        if label is not None:
            return label
        try:
            return min(1.0, max(0.0, float(value)))
        except ValueError:
            return value
    return value


class FindingModel(BaseModel):
    title: str = Field(min_length=1)
    severity: str = Field(min_length=1)
    file: str = Field(min_length=1)
    startLine: int = Field(ge=1)
    endLine: int = Field(ge=1)
    category: str = Field(min_length=1)
    evidence: str = Field(min_length=1)
    recommendation: str = Field(min_length=1)
    confidence: Annotated[float, BeforeValidator(normalize_confidence)] = Field(ge=0, le=1)


class FixProposalFileModel(BaseModel):
    path: str = Field(min_length=1)
    content: str


class FixProposalModel(BaseModel):
    title: str = Field(min_length=1)
    body: str = Field(min_length=1)
    # Why not require at least one file: the agent legitimately returns no files
    # when the finding needs no code change (for example a scanner false
    # positive), and that verdict must survive schema validation.
    files: list[FixProposalFileModel] = Field(default_factory=list)


async def run_payload(
    payload: dict[str, Any],
    agent_chat: AgentChat | None = None,
    stream_sink: StreamSink | None = None,
) -> Any:
    mode = payload.get("mode")
    is_fix_pr_mode = mode == "fix_pr"
    if is_fix_pr_mode:
        return await run_fix_pr_payload(payload, agent_chat, stream_sink)

    files = read_files(payload.get("files"))
    settings = read_settings(
        payload.get("config"), payload.get("model"), payload.get("scanPolicies")
    )
    write_structured_log(
        {
            "message": "agy_runner_started",
            "provider": "vertex_ai",
            "location": settings.location,
            "runnerRegion": settings.runner_region,
            "reviewedFileCount": len(files),
            "severity": "INFO",
        }
    )
    prompt = build_prompt(files, settings)
    chat = agent_chat or create_antigravity_chat(settings, stream_sink)

    try:
        response_text = await asyncio.wait_for(chat(prompt), timeout=settings.timeout_seconds)
    except TimeoutError as error:
        raise RunnerError("antigravity_runner_timeout") from error

    raw_findings = parse_response_findings(response_text)
    write_agy_usage_log(settings)
    findings = [finding for finding in raw_findings if is_finding_in_scope(finding, files)]
    write_structured_log(
        {
            "droppedFindingCount": len(raw_findings) - len(findings),
            "inputFindingCount": len(raw_findings),
            "message": "agy_runner_finished",
            "outputFindingCount": len(findings),
            "severity": "INFO",
        }
    )
    return findings


async def run_fix_pr_payload(
    payload: dict[str, Any],
    agent_chat: AgentChat | None = None,
    stream_sink: StreamSink | None = None,
) -> dict[str, Any]:
    settings = read_settings(payload.get("config"), payload.get("model"))
    source = read_fix_source(payload.get("source"))
    finding = read_fix_finding(payload.get("finding"))
    write_structured_log(
        {
            "file": source["path"],
            "message": "agy_fix_pr_started",
            "provider": "vertex_ai",
            "runnerRegion": settings.runner_region,
            "severity": "INFO",
        }
    )
    prompt = build_fix_prompt(source, finding, settings)
    chat = agent_chat or create_antigravity_chat(settings, stream_sink, allow_view_file=False)

    try:
        response_text = await asyncio.wait_for(chat(prompt), timeout=settings.timeout_seconds)
    except TimeoutError as error:
        raise RunnerError("antigravity_runner_timeout") from error

    proposal = parse_response_fix_proposal(response_text, source["path"])
    write_agy_usage_log(settings)
    write_structured_log(
        {
            "fileCount": len(proposal["files"]),
            "message": "agy_fix_pr_finished",
            "severity": "INFO",
        }
    )
    return proposal


def read_files(value: Any) -> list[ReviewFile]:
    is_list = isinstance(value, list)
    if not is_list:
        raise RunnerError("payload.files must be an array")

    files: list[ReviewFile] = []
    for item in value:
        is_item_object = isinstance(item, dict)
        if not is_item_object:
            raise RunnerError("payload.files entries must be objects")

        path = item.get("path")
        raw = item.get("raw")
        added_lines = item.get("addedLines")
        has_valid_shape = (
            isinstance(path, str) and isinstance(raw, str) and isinstance(added_lines, list)
        )
        if not has_valid_shape:
            raise RunnerError("payload.files entries require path, raw, and addedLines")

        line_set = {int(line) for line in added_lines if isinstance(line, int)}
        files.append(ReviewFile(path=path, raw=raw, added_lines=line_set))

    return files


def read_settings(value: Any, model: Any = None, scan_policies: Any = None) -> AgentSettings:
    config = value if isinstance(value, dict) else {}
    scan = config.get("scan") if isinstance(config.get("scan"), dict) else {}
    llm = scan.get("llm") if isinstance(scan.get("llm"), dict) else {}
    agent = llm.get("agent") if isinstance(llm.get("agent"), dict) else {}

    timeout_seconds = agent.get("timeoutSeconds", 900)
    is_timeout_valid = isinstance(timeout_seconds, int) and 1 <= timeout_seconds <= 1800
    if not is_timeout_valid:
        timeout_seconds = 900

    repository_dir_value = os.environ.get("SCANVEIL_REPOSITORY_DIR")
    repository_dir = Path(repository_dir_value) if repository_dir_value else None

    return AgentSettings(
        timeout_seconds=timeout_seconds,
        skills_enabled=read_enabled(agent, "skills", True),
        plugins_enabled=read_enabled(agent, "plugins", False),
        mcp_enabled=read_enabled(agent, "mcp", False),
        repository_dir=repository_dir,
        project=read_required_env("GOOGLE_CLOUD_PROJECT"),
        location=os.environ.get("GOOGLE_CLOUD_LOCATION", "global"),
        runner_region=os.environ.get("GOOGLE_CLOUD_REGION"),
        model=model if isinstance(model, str) and len(model) > 0 else None,
        scan_policies=read_scan_policies(scan_policies),
    )


def read_scan_policies(value: Any) -> tuple[tuple[str, str], ...]:
    is_list = isinstance(value, list)
    if not is_list:
        return ()

    policies: list[tuple[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        rule = item.get("rule")
        has_valid_shape = (
            isinstance(name, str)
            and len(name.strip()) > 0
            and isinstance(rule, str)
            and len(rule.strip()) > 0
        )
        if not has_valid_shape:
            continue
        policies.append((name.strip(), rule.strip()))

    return tuple(policies)


def write_agy_usage_log(settings: AgentSettings) -> None:
    write_structured_log(
        {
            "costStatus": "unavailable",
            "location": settings.location,
            "message": "agy_usage",
            "model": settings.model or "antigravity_default",
            "provider": "vertex_ai",
            "runnerRegion": settings.runner_region,
            "severity": "INFO",
        }
    )


def read_enabled(agent: dict[str, Any], key: str, fallback: bool) -> bool:
    value = agent.get(key)
    is_object = isinstance(value, dict)
    if not is_object:
        return fallback

    enabled = value.get("enabled")
    is_boolean = isinstance(enabled, bool)
    if not is_boolean:
        return fallback

    return enabled


def annotate_added_line_numbers(file: ReviewFile) -> str:
    # Why not let the model count lines: 数百行の snapshot では LLM の行数推定が
    # 20〜40 行ずれ、finding が無関係な行にアンカーされる。追加行に番号を直接
    # 埋め込めば数える必要がなくなる。
    numbers = iter(sorted(file.added_lines))
    annotated: list[str] = []
    for line in file.raw.split("\n"):
        is_added_line = line.startswith("+") and not line.startswith("+++")
        if not is_added_line:
            annotated.append(line)
            continue

        number = next(numbers, None)
        if number is None:
            annotated.append(line)
            continue

        annotated.append(f"+{number}| {line[1:]}")

    return "\n".join(annotated)


def build_prompt(files: list[ReviewFile], settings: AgentSettings) -> str:
    skill_text = read_skill_text(settings)
    plugin_text = read_plugin_text(settings)
    policy_text = build_scan_policy_text(settings)
    file_text = "\n\n".join(
        [
            "\n".join(
                [
                    f"FILE: {file.path}",
                    f"ADDED_LINES: {', '.join(str(line) for line in sorted(file.added_lines))}",
                    "UNIFIED_DIFF:",
                    annotate_added_line_numbers(file),
                ]
            )
            for file in files
        ]
    )
    return "\n\n".join(
        [
            "You are the Scanveil experimental Antigravity security scan agent.",
            "Use ADDED_LINES as the authoritative annotation allowlist.",
            (
                "Added lines in UNIFIED_DIFF are prefixed with '+N| ' where N is "
                "the authoritative 1-based line number of that line in the new "
                "file. Copy those numbers verbatim into startLine and endLine; "
                "never count or estimate line numbers yourself. The '+N| ' "
                "prefix is annotation only and is not part of the source code."
            ),
            (
                "The FILE blocks are a partial snapshot of the repository; other "
                "files exist but are not shown. Never conclude that a file or "
                "setting is missing from the repository just because it is not in "
                "the snapshot, and never report such an absence as a finding."
            ),
            (
                "file, startLine, and endLine must point at snapshot lines that "
                "directly evidence the finding. Do not anchor a finding to an "
                "unrelated file or line. Report a missing setting only when the "
                "file where the setting belongs is in the snapshot, anchored to "
                "that file."
            ),
            (
                "A trailing '\\ scanveil: file truncated for review' marker means the "
                "snapshot was cut for size and the real file continues. Never report "
                "truncation artifacts (incomplete code, unfinished logic, or syntax "
                "errors at the end of a marked file)."
            ),
            (
                "Return JSON only. Each finding must include title, severity, file, "
                "startLine, endLine, category, evidence, recommendation, confidence. "
                "confidence must be a number between 0 and 1."
            ),
            skill_text,
            plugin_text,
            policy_text,
            file_text,
        ]
    )


def build_scan_policy_text(settings: AgentSettings) -> str:
    has_policies = len(settings.scan_policies) > 0
    if not has_policies:
        return ""

    policy_blocks = [f"POLICY: {name}\n{rule}" for name, rule in settings.scan_policies]
    return "\n\n".join(
        [
            "SCANVEIL_SCAN_POLICIES:",
            (
                "The repository owner enforces the following organization policies "
                "in addition to security review. Check the reviewed code against "
                "every policy and report each violation as a finding, citing the "
                "violated policy name in the evidence. Do not narrate the policy "
                "analysis in prose; the reply must stay JSON findings only."
            ),
            *policy_blocks,
        ]
    )


def read_fix_source(value: Any) -> dict[str, Any]:
    is_object = isinstance(value, dict)
    if not is_object:
        raise RunnerError("payload.source must be an object")

    path = value.get("path")
    content = value.get("content")
    start_line = value.get("startLine")
    end_line = value.get("endLine")
    has_valid_shape = (
        isinstance(path, str)
        and len(path) > 0
        and isinstance(content, str)
        and isinstance(start_line, int)
        and isinstance(end_line, int)
        and start_line > 0
        and end_line >= start_line
    )
    if not has_valid_shape:
        raise RunnerError("payload.source requires path, content, startLine, and endLine")

    return {
        "content": content,
        "endLine": end_line,
        "path": path,
        "startLine": start_line,
    }


def read_fix_finding(value: Any) -> dict[str, Any]:
    is_object = isinstance(value, dict)
    if not is_object:
        raise RunnerError("payload.finding must be an object")

    required = ["title", "severity", "evidence", "recommendation", "sveId", "findingId"]
    result: dict[str, Any] = {}
    for key in required:
        item = value.get(key)
        is_string = isinstance(item, str) and len(item) > 0
        if not is_string:
            raise RunnerError(f"payload.finding requires {key}")
        result[key] = item

    return result


def build_fix_prompt(
    source: dict[str, Any],
    finding: dict[str, Any],
    settings: AgentSettings,
) -> str:
    skill_text = read_skill_text(settings)
    return "\n\n".join(
        [
            "You are the Scanveil experimental Antigravity security fix agent.",
            "Create the smallest safe code change that addresses the finding.",
            "Return JSON only with title, body, and files.",
            "Each files entry must include path and content.",
            "The content value must be the complete replacement content for that file.",
            "Only modify the provided source file path.",
            (
                "If the finding requires no code change (for example a scanner "
                "false positive), return an empty files array and explain the "
                "reason in body."
            ),
            skill_text,
            "FINDING:",
            json.dumps(finding, separators=(",", ":")),
            "SOURCE:",
            json.dumps(source, separators=(",", ":")),
        ]
    )


def read_skill_text(settings: AgentSettings) -> str:
    should_load_skills = settings.skills_enabled and settings.repository_dir is not None
    if not should_load_skills:
        return ""

    skills_dir = settings.repository_dir / ".scanveil" / "skills"
    has_skills_dir = skills_dir.is_dir()
    if not has_skills_dir:
        return ""

    skill_blocks: list[str] = []
    for skill_file in sorted(skills_dir.glob("*/SKILL.md")):
        skill_blocks.append(skill_file.read_text(encoding="utf-8"))

    has_skill_blocks = len(skill_blocks) > 0
    if not has_skill_blocks:
        return ""

    return "\n\n".join(["SCANVEIL_SKILLS:", *skill_blocks])


def read_plugin_text(settings: AgentSettings) -> str:
    should_load_plugins = settings.plugins_enabled and settings.repository_dir is not None
    if not should_load_plugins:
        return ""

    plugins_dir = settings.repository_dir / ".scanveil" / "plugins"
    has_plugins_dir = plugins_dir.is_dir()
    if not has_plugins_dir:
        return ""

    plugin_blocks: list[str] = []
    for plugin_file in sorted(plugins_dir.glob("*/plugin.json")):
        plugin = json.loads(plugin_file.read_text(encoding="utf-8"))
        plugin_blocks.append(json.dumps(plugin, separators=(",", ":")))

    write_structured_log(
        {
            "message": "agy_plugins_loaded",
            "pluginCount": len(plugin_blocks),
            "severity": "INFO",
        }
    )

    has_plugin_blocks = len(plugin_blocks) > 0
    if not has_plugin_blocks:
        return ""

    return "\n\n".join(["SCANVEIL_PLUGINS:", *plugin_blocks])


def create_antigravity_chat(
    settings: AgentSettings,
    stream_sink: StreamSink | None = None,
    *,
    allow_view_file: bool = True,
) -> AgentChat:
    mcp_servers = read_mcp_servers(settings)
    policy_name = "deny_all_allow_view_file" if allow_view_file else "deny_all"
    write_structured_log(
        {
            "message": "agy_policy_configured",
            "policy": policy_name,
            "severity": "INFO",
        }
    )

    async def chat(prompt: str) -> str:
        try:
            from google.antigravity import Agent, LocalAgentConfig
        except ImportError as error:
            raise RunnerError("google-antigravity is not installed") from error

        config = create_local_agent_config(
            LocalAgentConfig, settings, mcp_servers, allow_view_file=allow_view_file
        )
        async with Agent(config) as agent:
            response = await agent.chat(prompt)
            return await read_antigravity_response_text(response, stream_sink)

    return chat


def create_local_agent_config(
    local_agent_config: Any,
    settings: AgentSettings,
    mcp_servers: list[Any],
    *,
    allow_view_file: bool = True,
) -> Any:
    kwargs = {
        "vertex": True,
        "project": settings.project,
        "location": settings.location,
        "mcp_servers": mcp_servers,
        "policies": create_safety_policies(allow_view_file=allow_view_file),
        "system_instructions": "You are the Scanveil security scan agent.",
    }
    supports_model = callable_accepts_keyword(local_agent_config, "model")
    should_pass_model = settings.model is not None and supports_model
    if should_pass_model:
        kwargs["model"] = settings.model

    return local_agent_config(**kwargs)


def callable_accepts_keyword(callable_value: Any, keyword: str) -> bool:
    try:
        signature = inspect.signature(callable_value)
    except (TypeError, ValueError):
        return False

    parameters = signature.parameters.values()
    return any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD or parameter.name == keyword
        for parameter in parameters
    )


async def read_antigravity_response_text(
    response: Any,
    stream_sink: StreamSink | None = None,
) -> str:
    is_streamable = hasattr(response, "__aiter__")
    if not is_streamable:
        text_source = getattr(response, "text", None)
        text = text_source() if callable(text_source) else text_source
        if inspect.isawaitable(text):
            text = await text
        return str(text)

    chunks: list[str] = []
    async for token in response:
        text = str(token)
        chunks.append(text)
        await emit_stream_event(
            {
                "kind": "agent_message",
                "text": text,
            },
            stream_sink,
        )

    return "".join(chunks)


async def emit_stream_event(
    event: StreamEvent,
    stream_sink: StreamSink | None,
) -> None:
    record = {
        **event,
        "message": "agy_stream_chunk",
        "severity": "INFO",
    }
    write_structured_log(record)

    has_stream_sink = stream_sink is not None
    if not has_stream_sink:
        return

    await stream_sink(event)


def create_safety_policies(*, allow_view_file: bool = True) -> list[Any]:
    try:
        from google.antigravity.hooks.policy import allow, deny
    except ImportError:
        write_structured_log(
            {
                "message": "agy_policy_import_skipped",
                "reason": "google_antigravity_policy_unavailable",
                "severity": "WARNING",
            }
        )
        return []

    policies = [deny("*")]
    if allow_view_file:
        policies.append(allow("view_file"))

    return policies


def read_mcp_servers(settings: AgentSettings) -> list[Any]:
    should_load_mcp = settings.mcp_enabled and settings.repository_dir is not None
    if not should_load_mcp:
        return []

    mcp_dir = settings.repository_dir / ".scanveil" / "mcp"
    has_mcp_dir = mcp_dir.is_dir()
    if not has_mcp_dir:
        return []

    definitions: list[dict[str, Any]] = []
    for definition_file in sorted(mcp_dir.glob("*.json")):
        definition = json.loads(definition_file.read_text(encoding="utf-8"))
        command = definition.get("command")
        is_command_valid = isinstance(command, str) and len(command) > 0
        if not is_command_valid:
            raise RunnerError(f"{definition_file.name} requires a command")

        is_npx = Path(command).name == "npx"
        if is_npx:
            raise RunnerError("npx MCP commands are not allowed")

        args = definition.get("args", [])
        are_args_valid = isinstance(args, list) and all(isinstance(arg, str) for arg in args)
        if not are_args_valid:
            raise RunnerError(f"{definition_file.name} args must be strings")

        definitions.append(
            {
                "name": definition.get("name", definition_file.stem),
                "command": command,
                "args": args,
            }
        )

    try:
        from google.antigravity.types import McpStdioServer
    except ImportError as error:
        raise RunnerError("google-antigravity MCP types are not installed") from error

    write_structured_log(
        {
            "mcpServerCount": len(definitions),
            "message": "agy_mcp_servers_loaded",
            "severity": "INFO",
        }
    )

    servers: list[Any] = []
    for definition in definitions:
        servers.append(
            McpStdioServer(
                name=str(definition["name"]),
                command=str(definition["command"]),
                args=list(definition["args"]),
            )
        )

    return servers


def parse_response_findings(text: str) -> list[Finding]:
    stripped = strip_json_markdown_fence(text)

    try:
        parsed = parse_json_response(stripped)
    except json.JSONDecodeError as error:
        raise RunnerError("agent_response_invalid_json") from error
    if isinstance(parsed, dict):
        parsed = parsed.get("findings")

    is_list = isinstance(parsed, list)
    if not is_list:
        raise RunnerError("agent response must be a JSON array or findings object")

    findings: list[Finding] = []
    for item in parsed:
        try:
            findings.append(FindingModel.model_validate(item).model_dump())
        except ValidationError as error:
            # Why not stay silent: a dropped finding hides model/prompt drift
            # behind a clean scan, which is how string confidences went unnoticed.
            write_structured_log(
                {
                    "message": "agent_finding_dropped",
                    "severity": "WARNING",
                    "error": str(error)[:500],
                    "findingTitle": str(item.get("title", ""))[:200]
                    if isinstance(item, dict)
                    else "",
                }
            )
            continue

    return findings


def parse_response_fix_proposal(text: str, expected_path: str) -> dict[str, Any]:
    stripped = strip_json_markdown_fence(text)

    try:
        parsed = parse_json_response(stripped)
    except json.JSONDecodeError as error:
        raise RunnerError("agent_response_invalid_json") from error

    try:
        proposal = FixProposalModel.model_validate(normalize_fix_proposal_payload(parsed))
    except ValidationError as error:
        raise RunnerError("agent response did not match fix proposal schema") from error

    files = [file.model_dump() for file in proposal.files]
    is_no_change_proposal = len(files) == 0
    has_single_expected_file = len(files) == 1 and files[0]["path"] == expected_path
    if not is_no_change_proposal and not has_single_expected_file:
        raise RunnerError("fix proposal must modify only the requested file")

    return {
        "body": proposal.body,
        "files": files,
        "title": proposal.title,
    }


def normalize_fix_proposal_payload(value: Any) -> Any:
    is_object = isinstance(value, dict)
    if not is_object:
        return value

    files = value.get("files")
    is_file_list = isinstance(files, list)
    if not is_file_list:
        return value

    normalized_files = [normalize_fix_proposal_file(file) for file in files]
    return {**value, "files": normalized_files}


def normalize_fix_proposal_file(value: Any) -> Any:
    is_object = isinstance(value, dict)
    if not is_object:
        return value

    has_content = isinstance(value.get("content"), str)
    if has_content:
        return value

    replacement_content = value.get("replacementContent")
    has_replacement_content = isinstance(replacement_content, str)
    if not has_replacement_content:
        return value

    return {**value, "content": replacement_content}


def strip_json_markdown_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.removeprefix("```json").removeprefix("```").removesuffix("```").strip()

    return stripped


def parse_json_response(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Why not keep the first-brace heuristic alone: agents sometimes narrate
    # their analysis in prose that quotes JSON-looking code before the final
    # fenced answer, and decoding from the first brace turned those scans
    # into agent_response_invalid_json failures.
    fenced = read_last_fenced_json(text)
    if fenced is not None:
        return fenced

    decoder = json.JSONDecoder()
    stripped = text.strip()
    for json_start in find_json_starts(stripped):
        try:
            parsed, _ = decoder.raw_decode(stripped[json_start:])
            return parsed
        except json.JSONDecodeError:
            continue

    raise json.JSONDecodeError("agent response contains no JSON value", text, 0)


def read_last_fenced_json(text: str) -> Any | None:
    # Why not return JSON null distinctly: the agent contract is an array or
    # findings object, so a fenced null is as unusable as a missing fence.
    blocks = re.findall(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    for block in reversed(blocks):
        try:
            return json.loads(block.strip())
        except json.JSONDecodeError:
            continue

    return None


def find_json_starts(text: str) -> list[int]:
    return [index for index, character in enumerate(text) if character in "{["]


def is_finding_in_scope(finding: Finding, files: list[ReviewFile]) -> bool:
    file = finding.get("file")
    start_line = finding.get("startLine")
    end_line = finding.get("endLine")
    for review_file in files:
        is_same_file = review_file.path == file
        if not is_same_file:
            continue

        lines = range(int(start_line), int(end_line) + 1)
        return all(line in review_file.added_lines for line in lines)

    return False


def read_required_env(name: str) -> str:
    value = os.environ.get(name)
    has_value = value is not None and len(value) > 0
    if not has_value:
        raise RunnerError(f"Missing required environment variable: {name}")

    return value


def write_structured_log(record: dict[str, Any]) -> None:
    print(json.dumps(record, separators=(",", ":")), file=sys.stderr)
