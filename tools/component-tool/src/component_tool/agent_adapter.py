"""Agent adapters for invoking AI review agents via subprocess."""

from __future__ import annotations

import json
import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass
class AgentRunResult:
    """Result of an agent invocation."""

    raw_output: str
    exit_code: int
    parsed_json: dict | None = None


class AgentAdapter(ABC):
    """Abstract base for AI agent adapters."""

    @abstractmethod
    def run_review(
        self,
        prompt: str,
        cwd: Path,
        timeout_sec: int = 300,
    ) -> AgentRunResult:
        """Run a review prompt and return the result."""
        ...

    def _try_parse_json(self, output: str) -> dict | None:
        """Try to extract JSON from agent output."""
        # Try the whole output first
        try:
            return json.loads(output)
        except (json.JSONDecodeError, ValueError):
            pass

        # Try to find a JSON block in the output
        import re
        json_match = re.search(r"```json\s*\n(.*?)\n```", output, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except (json.JSONDecodeError, ValueError):
                pass

        # Try to find a bare JSON object
        brace_start = output.find("{")
        if brace_start >= 0:
            # Find matching closing brace
            depth = 0
            for i in range(brace_start, len(output)):
                if output[i] == "{":
                    depth += 1
                elif output[i] == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(output[brace_start:i + 1])
                        except (json.JSONDecodeError, ValueError):
                            break

        return None


class ClaudeAdapter(AgentAdapter):
    """Adapter for Claude Code CLI."""

    def __init__(self, model: str = "sonnet"):
        self.model = model

    def run_review(
        self,
        prompt: str,
        cwd: Path,
        timeout_sec: int = 300,
    ) -> AgentRunResult:
        """Run a review via Claude Code CLI."""
        try:
            result = subprocess.run(
                [
                    "claude",
                    "-p", prompt,
                    "--output-format", "text",
                    "--model", self.model,
                ],
                cwd=str(cwd),
                capture_output=True,
                text=True,
                timeout=timeout_sec,
            )
            parsed = self._try_parse_json(result.stdout)
            return AgentRunResult(
                raw_output=result.stdout,
                exit_code=result.returncode,
                parsed_json=parsed,
            )
        except subprocess.TimeoutExpired:
            return AgentRunResult(
                raw_output="Review timed out",
                exit_code=-1,
            )
        except FileNotFoundError:
            return AgentRunResult(
                raw_output="claude CLI not found",
                exit_code=-1,
            )


class CodexAdapter(AgentAdapter):
    """Adapter for OpenAI Codex CLI."""

    def run_review(
        self,
        prompt: str,
        cwd: Path,
        timeout_sec: int = 300,
    ) -> AgentRunResult:
        """Run a review via Codex CLI."""
        try:
            result = subprocess.run(
                ["codex", "--prompt", prompt],
                cwd=str(cwd),
                capture_output=True,
                text=True,
                timeout=timeout_sec,
            )
            parsed = self._try_parse_json(result.stdout)
            return AgentRunResult(
                raw_output=result.stdout,
                exit_code=result.returncode,
                parsed_json=parsed,
            )
        except subprocess.TimeoutExpired:
            return AgentRunResult(
                raw_output="Review timed out",
                exit_code=-1,
            )
        except FileNotFoundError:
            return AgentRunResult(
                raw_output="codex CLI not found",
                exit_code=-1,
            )


class FakeAdapter(AgentAdapter):
    """Fake adapter for testing - returns deterministic results."""

    def __init__(self, responses: dict[str, dict] | None = None):
        self.responses = responses or {}

    def run_review(
        self,
        prompt: str,
        cwd: Path,
        timeout_sec: int = 300,
    ) -> AgentRunResult:
        """Return a deterministic fake review result."""
        # Try to find a matching response by component_id in the prompt
        for key, response in self.responses.items():
            if key in prompt:
                output = json.dumps(response)
                return AgentRunResult(
                    raw_output=output,
                    exit_code=0,
                    parsed_json=response,
                )

        # Default response
        default = {
            "component_id": "unknown",
            "status": "ok",
            "issues": [],
            "proposed_invariants": [],
        }
        return AgentRunResult(
            raw_output=json.dumps(default),
            exit_code=0,
            parsed_json=default,
        )
