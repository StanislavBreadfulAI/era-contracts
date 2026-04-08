/**
 * Agent adapters for invoking AI review agents via subprocess.
 */
import { execSync } from "child_process";
function tryParseJson(output) {
    // Try the whole output
    try {
        return JSON.parse(output);
    }
    catch {
        // ignore
    }
    // Try to find a JSON code block
    const jsonBlockMatch = output.match(/```json\s*\n([\s\S]*?)\n```/);
    if (jsonBlockMatch) {
        try {
            return JSON.parse(jsonBlockMatch[1]);
        }
        catch {
            // ignore
        }
    }
    // Try to find a bare JSON object
    const braceStart = output.indexOf("{");
    if (braceStart >= 0) {
        let depth = 0;
        for (let i = braceStart; i < output.length; i++) {
            if (output[i] === "{")
                depth++;
            else if (output[i] === "}") {
                depth--;
                if (depth === 0) {
                    try {
                        return JSON.parse(output.slice(braceStart, i + 1));
                    }
                    catch {
                        break;
                    }
                }
            }
        }
    }
    return null;
}
export class ClaudeAdapter {
    model;
    constructor(model = "sonnet") {
        this.model = model;
    }
    runReview(prompt, cwd, timeoutSec = 300) {
        try {
            const result = execSync(`claude -p ${JSON.stringify(prompt)} --output-format text --model ${this.model}`, {
                cwd,
                encoding: "utf-8",
                timeout: timeoutSec * 1000,
                stdio: ["pipe", "pipe", "pipe"],
            });
            return {
                raw_output: result,
                exit_code: 0,
                parsed_json: tryParseJson(result),
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return {
                raw_output: message,
                exit_code: -1,
                parsed_json: null,
            };
        }
    }
}
export class CodexAdapter {
    runReview(prompt, cwd, timeoutSec = 300) {
        try {
            const result = execSync(`codex --prompt ${JSON.stringify(prompt)}`, {
                cwd,
                encoding: "utf-8",
                timeout: timeoutSec * 1000,
                stdio: ["pipe", "pipe", "pipe"],
            });
            return {
                raw_output: result,
                exit_code: 0,
                parsed_json: tryParseJson(result),
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return {
                raw_output: message,
                exit_code: -1,
                parsed_json: null,
            };
        }
    }
}
export class FakeAdapter {
    responses;
    constructor(responses = {}) {
        this.responses = responses;
    }
    runReview(prompt, _cwd, _timeoutSec = 300) {
        for (const [key, response] of Object.entries(this.responses)) {
            if (prompt.includes(key)) {
                const output = JSON.stringify(response);
                return {
                    raw_output: output,
                    exit_code: 0,
                    parsed_json: response,
                };
            }
        }
        const defaultResponse = {
            component_id: "unknown",
            status: "ok",
            issues: [],
            proposed_invariants: [],
        };
        return {
            raw_output: JSON.stringify(defaultResponse),
            exit_code: 0,
            parsed_json: defaultResponse,
        };
    }
}
//# sourceMappingURL=agentAdapter.js.map