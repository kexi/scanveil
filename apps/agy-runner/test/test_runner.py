# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "pydantic==2.12.5",
# ]
# ///
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scanveil_agy_runner.runner as runner_module
from scanveil_agy_runner.runner import (
    ReviewFile,
    RunnerError,
    annotate_added_line_numbers,
    build_prompt,
    create_local_agent_config,
    parse_response_findings,
    parse_response_fix_proposal,
    read_antigravity_response_text,
    read_mcp_servers,
    read_settings,
    run_payload,
)


def finding_payload() -> dict:
    return {
        "title": "DOM XSS",
        "severity": "high",
        "file": "src/app.ts",
        "startLine": 12,
        "endLine": 12,
        "category": "xss",
        "evidence": "innerHTML receives user input.",
        "recommendation": "Use textContent.",
        "confidence": 0.9,
    }


def payload() -> dict:
    return {
        "files": [
            {
                "path": "src/app.ts",
                "addedLines": [12],
                "raw": "\n".join(
                    [
                        "diff --git a/src/app.ts b/src/app.ts",
                        "--- a/src/app.ts",
                        "+++ b/src/app.ts",
                        "@@ -11,2 +11,3 @@",
                        "+target.innerHTML = userInput;",
                    ]
                ),
            }
        ],
        "config": {
            "scan": {
                "llm": {
                    "agent": {
                        "timeoutSeconds": 2,
                        "skills": {
                            "enabled": True,
                        },
                        "plugins": {
                            "enabled": False,
                        },
                        "mcp": {
                            "enabled": False,
                        },
                    }
                }
            }
        },
    }


class RunnerTest(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["GOOGLE_CLOUD_PROJECT"] = "scanveil-test"
        os.environ["GOOGLE_CLOUD_REGION"] = "us-central1"
        os.environ["GOOGLE_CLOUD_LOCATION"] = "global"
        os.environ.pop("SCANVEIL_REPOSITORY_DIR", None)

    def test_returns_only_findings_inside_added_line_allowlist(self) -> None:
        async def fake_chat(_prompt: str) -> str:
            return json.dumps(
                [
                    {
                        "title": "DOM XSS",
                        "severity": "high",
                        "file": "src/app.ts",
                        "startLine": 12,
                        "endLine": 12,
                        "category": "xss",
                        "evidence": "innerHTML receives user input.",
                        "recommendation": "Use textContent.",
                        "confidence": 0.91,
                    },
                    {
                        "title": "Out of scope",
                        "severity": "high",
                        "file": "src/app.ts",
                        "startLine": 13,
                        "endLine": 13,
                        "category": "xss",
                        "evidence": "Not an added line.",
                        "recommendation": "Ignore.",
                        "confidence": 0.91,
                    },
                ]
            )

        findings = asyncio.run(run_payload(payload(), fake_chat))

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["file"], "src/app.ts")
        self.assertEqual(findings[0]["startLine"], 12)

    def test_returns_fix_pr_proposal_for_requested_source_file(self) -> None:
        async def fake_chat(prompt: str) -> str:
            self.assertIn("Scanveil experimental Antigravity security fix agent", prompt)
            return json.dumps(
                {
                    "title": "Fix DOM XSS",
                    "body": "Replaces unsafe DOM sink.",
                    "files": [
                        {
                            "path": "src/app.ts",
                            "content": "target.textContent = userInput;\n",
                        }
                    ],
                }
            )

        source = {
            "config": payload()["config"],
            "finding": {
                "evidence": "innerHTML receives user input.",
                "findingId": "AIVULN-1",
                "recommendation": "Use textContent.",
                "severity": "high",
                "sveId": "SVE-1",
                "title": "DOM XSS",
            },
            "mode": "fix_pr",
            "source": {
                "content": "target.innerHTML = userInput;\n",
                "endLine": 1,
                "path": "src/app.ts",
                "startLine": 1,
            },
        }

        proposal = asyncio.run(run_payload(source, fake_chat))

        self.assertEqual(proposal["files"][0]["path"], "src/app.ts")
        self.assertIn("textContent", proposal["files"][0]["content"])

    def test_rejects_fix_pr_proposal_for_other_files(self) -> None:
        with self.assertRaisesRegex(RunnerError, "must modify only the requested file"):
            parse_response_fix_proposal(
                json.dumps(
                    {
                        "title": "Fix",
                        "body": "Body",
                        "files": [{"path": "src/other.ts", "content": ""}],
                    }
                ),
                "src/app.ts",
            )

    def test_accepts_no_change_fix_pr_proposal(self) -> None:
        proposal = parse_response_fix_proposal(
            json.dumps(
                {
                    "title": "No change required",
                    "body": "The finding is a scanner false positive.",
                    "files": [],
                }
            ),
            "src/app.ts",
        )

        self.assertEqual(proposal["files"], [])
        self.assertEqual(proposal["title"], "No change required")

    def test_accepts_replacement_content_fix_pr_alias(self) -> None:
        proposal = parse_response_fix_proposal(
            json.dumps(
                {
                    "title": "Fix",
                    "body": "Body",
                    "files": [
                        {
                            "path": "src/app.ts",
                            "replacementContent": "target.textContent = userInput;\n",
                        }
                    ],
                }
            ),
            "src/app.ts",
        )

        self.assertEqual(proposal["files"][0]["content"], "target.textContent = userInput;\n")

    def test_accepts_fix_pr_json_after_agent_warning_text(self) -> None:
        proposal = parse_response_fix_proposal(
            "\n".join(
                [
                    "WARNING:root:System step error (HTTP 0): invalid tool call",
                    json.dumps(
                        {
                            "title": "Fix",
                            "body": "Body",
                            "files": [
                                {
                                    "path": "src/app.ts",
                                    "content": "target.textContent = userInput;\n",
                                }
                            ],
                        }
                    ),
                ]
            ),
            "src/app.ts",
        )

        self.assertEqual(proposal["title"], "Fix")
        self.assertEqual(proposal["files"][0]["path"], "src/app.ts")

    def test_times_out_agent_chat(self) -> None:
        async def slow_chat(_prompt: str) -> str:
            await asyncio.sleep(0.05)
            return "[]"

        source = payload()
        source["config"]["scan"]["llm"]["agent"]["timeoutSeconds"] = 1

        with self.assertRaisesRegex(RunnerError, "antigravity_runner_timeout"):
            asyncio.run(
                run_payload(
                    source, lambda prompt: asyncio.wait_for(slow_chat(prompt), timeout=0.001)
                )
            )

    def test_loads_skill_markdown_into_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            skills_dir = Path(directory) / ".scanveil" / "skills" / "secure-js"
            skills_dir.mkdir(parents=True)
            (skills_dir / "SKILL.md").write_text(
                "---\nname: secure-js\n---\nPrefer DOM sinks.", encoding="utf-8"
            )
            os.environ["SCANVEIL_REPOSITORY_DIR"] = directory

            settings = read_settings(payload()["config"])
            prompt = build_prompt([], settings)

        self.assertIn("SCANVEIL_SKILLS", prompt)
        self.assertIn("Prefer DOM sinks.", prompt)

    def test_prompt_forbids_truncation_artifact_findings(self) -> None:
        settings = read_settings(payload()["config"])

        prompt = build_prompt([], settings)

        self.assertIn("Never report", prompt)
        self.assertIn("truncation artifacts", prompt)

    def test_annotates_added_lines_with_authoritative_numbers(self) -> None:
        review_file = ReviewFile(
            path="src/app.ts",
            added_lines={41, 42},
            raw="\n".join(
                [
                    "diff --git a/src/app.ts b/src/app.ts",
                    "--- a/src/app.ts",
                    "+++ b/src/app.ts",
                    "@@ -40,2 +40,3 @@",
                    " const before = 1;",
                    "+const injected = eval(userInput);",
                    "+const after = 2;",
                    " const context = 3;",
                ]
            ),
        )

        annotated = annotate_added_line_numbers(review_file)

        self.assertIn("+41| const injected = eval(userInput);", annotated)
        self.assertIn("+42| const after = 2;", annotated)
        self.assertIn("+++ b/src/app.ts", annotated)
        self.assertIn(" const before = 1;", annotated)

    def test_prompt_embeds_line_number_annotations_and_instruction(self) -> None:
        settings = read_settings(payload()["config"])
        review_file = ReviewFile(
            path="src/app.ts",
            added_lines={7},
            raw="\n".join(["+++ b/src/app.ts", "+return eval(expression);"]),
        )

        prompt = build_prompt([review_file], settings)

        self.assertIn("+7| return eval(expression);", prompt)
        self.assertIn("never count or estimate line numbers yourself", prompt)

    def test_prompt_explains_partial_snapshot_and_anchoring(self) -> None:
        settings = read_settings(payload()["config"])

        prompt = build_prompt([], settings)

        self.assertIn("partial snapshot", prompt)
        self.assertIn("never report such an absence as a finding", prompt)
        self.assertIn("directly evidence the finding", prompt)
        self.assertIn("Do not anchor a finding to an unrelated file or line", prompt)

    def test_reads_cloud_run_and_vertex_locations(self) -> None:
        settings = read_settings(payload()["config"])

        self.assertEqual(settings.runner_region, "us-central1")
        self.assertEqual(settings.location, "global")

    def test_reads_requested_model_from_payload(self) -> None:
        settings = read_settings(payload()["config"], "gemini-2.5-pro")

        self.assertEqual(settings.model, "gemini-2.5-pro")

    def test_reads_scan_policies_from_payload(self) -> None:
        settings = read_settings(
            payload()["config"],
            None,
            [
                {
                    "name": "pnpm minimumReleaseAge",
                    "rule": "minimumReleaseAge must be 1440 or higher.",
                },
                {"name": " ", "rule": "ignored: blank name"},
                {"name": "missing rule"},
                "not-a-dict",
            ],
        )

        self.assertEqual(
            settings.scan_policies,
            (("pnpm minimumReleaseAge", "minimumReleaseAge must be 1440 or higher."),),
        )

    def test_builds_scan_policy_prompt_block(self) -> None:
        settings = read_settings(
            payload()["config"],
            None,
            [
                {
                    "name": "pnpm minimumReleaseAge",
                    "rule": "minimumReleaseAge must be 1440 or higher.",
                }
            ],
        )

        prompt = build_prompt([], settings)

        self.assertIn("SCANVEIL_SCAN_POLICIES:", prompt)
        self.assertIn(
            "POLICY: pnpm minimumReleaseAge\nminimumReleaseAge must be 1440 or higher.",
            prompt,
        )

    def test_omits_scan_policy_block_without_policies(self) -> None:
        settings = read_settings(payload()["config"])

        prompt = build_prompt([], settings)

        self.assertNotIn("SCANVEIL_SCAN_POLICIES", prompt)

    def test_omits_model_for_older_local_agent_config(self) -> None:
        class FakeLocalAgentConfig:
            def __init__(
                self,
                vertex: bool,
                project: str,
                location: str,
                mcp_servers: list[object],
                policies: list[object],
                system_instructions: str,
            ) -> None:
                self.project = project
                self.vertex = vertex

        settings = read_settings(payload()["config"], "gemini-2.5-pro")
        config = create_local_agent_config(FakeLocalAgentConfig, settings, [])

        self.assertEqual(config.project, "scanveil-test")
        self.assertTrue(config.vertex)

    def test_passes_model_to_supported_local_agent_config(self) -> None:
        class FakeLocalAgentConfig:
            def __init__(self, model: str | None = None, **kwargs: object) -> None:
                self.model = model
                self.kwargs = kwargs

        settings = read_settings(payload()["config"], "gemini-2.5-pro")
        config = create_local_agent_config(FakeLocalAgentConfig, settings, [])

        self.assertEqual(config.model, "gemini-2.5-pro")

    def test_can_disable_view_file_policy_for_fix_pr_mode(self) -> None:
        calls: list[bool] = []
        original_create_safety_policies = runner_module.create_safety_policies

        def fake_create_safety_policies(*, allow_view_file: bool = True) -> list[object]:
            calls.append(allow_view_file)
            return []

        class FakeLocalAgentConfig:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        try:
            runner_module.create_safety_policies = fake_create_safety_policies
            settings = read_settings(payload()["config"], "gemini-2.5-pro")
            runner_module.create_local_agent_config(
                FakeLocalAgentConfig,
                settings,
                [],
                allow_view_file=False,
            )
        finally:
            runner_module.create_safety_policies = original_create_safety_policies

        self.assertEqual(calls, [False])

    def test_loads_plugin_manifests_into_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            plugin_dir = Path(directory) / ".scanveil" / "plugins" / "scanveil-js"
            plugin_dir.mkdir(parents=True)
            (plugin_dir / "plugin.json").write_text(
                json.dumps({"name": "scanveil-js", "version": "0.0.0"}),
                encoding="utf-8",
            )
            os.environ["SCANVEIL_REPOSITORY_DIR"] = directory
            source = payload()
            source["config"]["scan"]["llm"]["agent"]["plugins"]["enabled"] = True

            settings = read_settings(source["config"])
            prompt = build_prompt([], settings)

        self.assertIn("SCANVEIL_PLUGINS", prompt)
        self.assertIn("scanveil-js", prompt)

    def test_rejects_npx_mcp_commands(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mcp_dir = Path(directory) / ".scanveil" / "mcp"
            mcp_dir.mkdir(parents=True)
            (mcp_dir / "server.json").write_text(
                json.dumps({"name": "bad", "command": "npx", "args": ["example"]}),
                encoding="utf-8",
            )
            os.environ["SCANVEIL_REPOSITORY_DIR"] = directory
            source = payload()
            source["config"]["scan"]["llm"]["agent"]["mcp"]["enabled"] = True
            settings = read_settings(source["config"])

            with self.assertRaisesRegex(RunnerError, "npx MCP commands are not allowed"):
                read_mcp_servers(settings)

    def test_reads_antigravity_stream_tokens(self) -> None:
        class FakeStreamResponse:
            def __aiter__(self) -> FakeStreamResponse:
                self.tokens = iter(["[", "]"])
                return self

            async def __anext__(self) -> str:
                try:
                    return next(self.tokens)
                except StopIteration as error:
                    raise StopAsyncIteration from error

        events: list[dict] = []

        async def stream_sink(event: dict) -> None:
            events.append(event)

        text = asyncio.run(read_antigravity_response_text(FakeStreamResponse(), stream_sink))

        self.assertEqual(text, "[]")
        self.assertEqual(
            events,
            [
                {"kind": "agent_message", "text": "["},
                {"kind": "agent_message", "text": "]"},
            ],
        )

    def test_reads_antigravity_text_property_response(self) -> None:
        class FakeTextResponse:
            text = "[]"

        text = asyncio.run(read_antigravity_response_text(FakeTextResponse()))

        self.assertEqual(text, "[]")

    def test_wraps_invalid_agent_json_as_runner_error(self) -> None:
        with self.assertRaisesRegex(RunnerError, "agent_response_invalid_json"):
            parse_response_findings("not json")

    def test_reads_final_fenced_json_after_prose_with_quoted_code(self) -> None:
        response = "\n".join(
            [
                "### Analysis of Organization Policies",
                "The reviewed code defines policies like this:",
                "```python",
                'policies = [deny("*")]',
                "{",
                '    "message": "agy_policy_import_skipped",',
                '    "severity": "WARNING",',
                "}",
                "```",
                "No violations found.",
                "### Output JSON Findings",
                "```json",
                "[]",
                "```",
            ]
        )

        findings = parse_response_findings(response)

        self.assertEqual(findings, [])

    def test_reads_final_fenced_findings_array_after_prose(self) -> None:
        response = "\n".join(
            [
                "Reviewing the diff against the organization policies.",
                "Earlier examples include snippets like { not json } and [broken.",
                "```json",
                json.dumps([finding_payload()]),
                "```",
            ]
        )

        findings = parse_response_findings(response)

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["title"], "DOM XSS")

    def test_accepts_label_and_string_confidence_values(self) -> None:
        findings = parse_response_findings(
            json.dumps(
                [
                    {**finding_payload(), "confidence": "high"},
                    {**finding_payload(), "confidence": "0.75"},
                    {**finding_payload(), "confidence": 2},
                ]
            )
        )

        self.assertEqual([f["confidence"] for f in findings], [0.9, 0.75, 1.0])

    def test_drops_findings_with_unrecognizable_confidence(self) -> None:
        findings = parse_response_findings(
            json.dumps(
                [
                    {**finding_payload(), "confidence": "maybe?"},
                    finding_payload(),
                ]
            )
        )

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["confidence"], 0.9)


if __name__ == "__main__":
    unittest.main()
