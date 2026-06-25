// A tool registry so the engine's toolset is extensible (M3 adds integrations) rather
// than a hardcoded list. The loop reads `defs()` to advertise tools to the model and
// `get(name)` to execute a requested call. `submit_report` is NOT registered here — it
// is the loop's terminal signal, handled specially.

import type { ToolDef } from "./types.js";

export interface ToolRunResult {
	output: string;
	isError: boolean;
}

export interface Tool {
	def: ToolDef;
	run(args: Record<string, unknown>): Promise<ToolRunResult>;
}

export class ToolRegistry {
	private tools = new Map<string, Tool>();

	register(tool: Tool): this {
		this.tools.set(tool.def.name, tool);
		return this;
	}

	get(name: string): Tool | undefined {
		return this.tools.get(name);
	}

	defs(): ToolDef[] {
		return [...this.tools.values()].map((t) => t.def);
	}

	get size(): number {
		return this.tools.size;
	}
}
