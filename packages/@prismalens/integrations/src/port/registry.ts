// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SourceCategory } from "@prismalens/contracts/schemas";
import {
	SERVED_SIDE_EFFECTS,
	SOURCE_TOOL_NAME,
	type SourceTool,
	type SourceToolContext,
	SourceToolRefused,
	type SourceToolResult,
} from "./source-tool.js";

const served = (tool: SourceTool): boolean =>
	SERVED_SIDE_EFFECTS.includes(tool.sideEffect);

/** The PrismaLens tools a gateway serves: read-only by construction (#848). */
export class SourceRegistry {
	private readonly tools = new Map<string, SourceTool>();

	/** `failureReason` words a thrown error; never upstream text. */
	constructor(
		private readonly failureReason: (e: unknown) => string = () =>
			"the tool failed",
	) {}

	register(tool: SourceTool): void {
		if (!SOURCE_TOOL_NAME.test(tool.name) || tool.name.includes("__"))
			throw new SourceToolRefused(`"${tool.name}" is not a valid tool name`);
		if (this.tools.has(tool.name))
			throw new SourceToolRefused(`"${tool.name}" is already registered`);
		if (!served(tool))
			throw new SourceToolRefused(
				`"${tool.name}" is ${tool.sideEffect ?? "missing a side-effect level"}; PrismaLens serves read-only tools only`,
			);
		this.tools.set(tool.name, tool);
	}

	list(): readonly SourceTool[] {
		return [...this.tools.values()];
	}

	byCategory(category: SourceCategory): string[] {
		return this.list()
			.filter((t) => t.category === category)
			.map((t) => t.name);
	}

	/** Never throws: every failure is an `isError` result in PrismaLens's words. */
	async call(
		name: string,
		input: unknown,
		ctx: SourceToolContext,
	): Promise<SourceToolResult> {
		const tool = this.tools.get(name);
		if (!tool)
			return { isError: true, value: { error: "No such PrismaLens tool" } };
		if (!served(tool))
			return {
				isError: true,
				value: { error: "PrismaLens serves read-only tools only" },
			};
		const parsed = tool.input.safeParse(input ?? {});
		if (!parsed.success)
			return { isError: true, value: { error: parsed.error.issues } };
		try {
			return await tool.run(parsed.data, ctx);
		} catch (e) {
			return { isError: true, value: { error: this.failureReason(e) } };
		}
	}
}
