// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * PrismaLens's own MCP gateway as an agent sees it (#848): one streamable-HTTP
 * entry in ACP `mcpServers`, or a run file for an agent that ignores that field.
 * Only HTTP is offered, since every agent that honours the field takes it.
 */
import { randomBytes } from "node:crypto";
import type { McpCapabilities, McpServer } from "@agentclientprotocol/sdk";
import type { Artifact, RecordedFinding } from "@prismalens/contracts/schemas";
import type { Findings } from "./findings.js";

/** Where the run's gateway answers, the bearer valid for this run only, and what it offers. */
export interface GatewayEntry {
	url: string;
	token: string;
	/** The run's random server name; agents name its tools `mcp__<serverName>__<tool>`. */
	serverName: string;
	/** The prompt's tools paragraph, built at lease without probes. */
	promptLine: string;
	/** PrismaLens's own harness tool names, the only ones the gateway serves. */
	tools: readonly string[];
	/** The tools the permission policy answers without a card; an `ask` or `act` tool is never one (#848). */
	autoAllow?: readonly string[];
	/** True once a request carrying the run's token reached the gateway. */
	connected(): boolean;
	waitConnected(ms: number): Promise<boolean>;
	/** Hears every `tools/call` of a tool the gateway serves; returns the unsubscribe. */
	onCall(listener: (c: GatewayCall) => void): () => void;
	/** Per tool called during this lease: the first time and how often. */
	calls(): GatewayCallCount[];
	/** A tool output the run saw, for resolving recorded quotes against (#930). */
	sawOutput?(toolCallId: string, text: string): void;
	/** Hears each evidence item or hypothesis the agent records; returns the unsubscribe. */
	onFinding?(listener: (f: RecordedFinding) => void): () => void;
	/** What the agent recorded during this lease, quotes resolved again. */
	findings?(): Findings;
	/** Seeds the lease with what earlier turns of the run recorded. */
	restore?(found: Findings): void;
	/** The engine stopped hearing this lease: nothing more is recorded or published on it (#848). */
	closeRecording?(): void;
	/** Every page published on this lease, so one acknowledged late still reaches the stream (#871). */
	artifacts?(): Artifact[];
	/** Hears each HTML artifact the agent publishes (#871); returns the unsubscribe. */
	onArtifact?(listener: (a: Artifact) => void): () => void;
}

/** One call as the gateway executed it; what replay needs rides on the event (#848). */
export interface GatewayCall {
	name: string;
	at: string;
	callId?: string;
	input?: unknown;
	inputDropped?: true;
	output?: string;
	isError?: boolean;
	ms?: number;
	schemaHash?: string;
	via?: "tools_call";
}

export interface GatewayCallCount {
	name: string;
	firstCalledAt: string;
	count: number;
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** Random per run and kept on it, so a server of the user's own never shares the name (#848). */
export function newGatewayServerName(): string {
	return `prismalens-${[...randomBytes(10)].map((b) => BASE32[b & 31]).join("")}`;
}

export function gatewayServer(entry: GatewayEntry): McpServer {
	return {
		type: "http",
		name: entry.serverName,
		url: entry.url,
		headers: [{ name: "Authorization", value: `Bearer ${entry.token}` }],
	};
}

/**
 * Picks `mcpServers` from `initialize`'s capabilities. "Taken" means connected: only an
 * authenticated request proves the agent loaded our server (OBJ-011).
 */
export function gatewayOffer(
	entry: GatewayEntry,
	delivery?: "mcp-config-file",
): {
	pick: (capabilities: McpCapabilities | undefined) => McpServer[];
	/** The agent was handed the server, so waiting for its first request can pay off. */
	offered: () => boolean;
	taken: () => boolean;
} {
	let offered = delivery === "mcp-config-file";
	return {
		pick: (capabilities) => {
			if (delivery === "mcp-config-file" || capabilities?.http !== true)
				return [];
			offered = true;
			return [gatewayServer(entry)];
		},
		offered: () => offered,
		taken: () => entry.connected(),
	};
}
