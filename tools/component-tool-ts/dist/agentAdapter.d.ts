/**
 * Agent adapters for invoking AI review agents via subprocess.
 */
export interface AgentRunResult {
    raw_output: string;
    exit_code: number;
    parsed_json: Record<string, unknown> | null;
}
export interface AgentAdapter {
    runReview(prompt: string, cwd: string, timeoutSec?: number): AgentRunResult;
}
export declare class ClaudeAdapter implements AgentAdapter {
    private model;
    constructor(model?: string);
    runReview(prompt: string, cwd: string, timeoutSec?: number): AgentRunResult;
}
export declare class CodexAdapter implements AgentAdapter {
    runReview(prompt: string, cwd: string, timeoutSec?: number): AgentRunResult;
}
export declare class FakeAdapter implements AgentAdapter {
    private responses;
    constructor(responses?: Record<string, Record<string, unknown>>);
    runReview(prompt: string, _cwd: string, _timeoutSec?: number): AgentRunResult;
}
