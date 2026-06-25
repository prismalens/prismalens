// Public API of the prismalens investigation engine.

export * from "./types.js";
export { investigate, runToReport, SYSTEM, type InvestigateOptions } from "./loop.js";
export { ToolRegistry, type Tool, type ToolRunResult } from "./registry.js";
export { submitReportTool, parseReport } from "./report.js";
export { createBackend, type BackendSpec } from "./providers.js";
export { createGeminiBackend, type GeminiOptions } from "./backends/gemini.js";
export { createOpenAICompatBackend, type OpenAICompatOptions } from "./backends/openai-compat.js";
export {
	loadAllowlist,
	runShellExec,
	checkCommand,
	shellExecTool,
	shellExecToolDef,
	type Allowlist,
	type ShellResult,
} from "./tools/shell-exec.js";

import { ToolRegistry } from "./registry.js";
import { type Allowlist, shellExecTool } from "./tools/shell-exec.js";

/** A registry preloaded with the default read-only shell tool. */
export function defaultTools(allowlist: Allowlist): ToolRegistry {
	return new ToolRegistry().register(shellExecTool(allowlist));
}
