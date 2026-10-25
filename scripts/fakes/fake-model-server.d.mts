// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export interface ModelRequest {
	wire: "openai" | "anthropic" | "responses";
	model: string;
	stream: boolean;
	toolNames: string[];
	lastText: string;
	lastIsToolResult: boolean;
	/** Property names of the JSON schema the request demands its answer fit; empty for free text. */
	structured: string[];
	/** The tool a trailing tool result answers; "" when the last message is not one. */
	lastToolName: string;
	/** The text of the turn's last user message that is not a tool result. */
	turnText: string;
	/** 1-based position of the request in the server's run; ids derive from it. */
	n: number;
}

export type Reply =
	| { say: string }
	| { tool: { name: string; input: Record<string, unknown> } };

export type Script = (req: ModelRequest) => Reply;

export interface FakeModelServer {
	url: string;
	/** The OpenAI-compatible base URL, `<url>/v1`. */
	openaiBaseUrl: string;
	requests(): ModelRequest[];
	close(): Promise<void>;
}

export const SCRIPTED_REPORT: Record<string, unknown>;

export function viewOf(
	wire: "openai" | "anthropic" | "responses",
	body: unknown,
): ModelRequest;

export const admissionScript: Script;

export function startFakeModelServer(options?: {
	port?: number;
	host?: string;
	script?: Script;
}): Promise<FakeModelServer>;
