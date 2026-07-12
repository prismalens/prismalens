// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
/**
 * Claude Code harness runner (Tier-2 deep path, ADR-0008). Drives the Claude Agent
 * SDK (`query()` — which spawns the user's Claude Code CLI + subscription) and
 * yields the canonical event stream via {@link ClaudeCodeAdapter}.
 *
 * Headless + read-only: `permissionMode: "bypassPermissions"` (no interactive
 * prompts) with mutation tools blocked via `disallowedTools`. The Agent SDK's
 * `canUseTool` programmatic gate is the cleaner HITL seam for the act phase later
 * (ADR-0009); for Phase-1 read-only diagnosis the deny-list + bypass is enough.
 * The stream ALWAYS terminates (result → branch_done/error, or a thrown failure).
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
	HARNESS_REGISTRY,
	type PermissionMode,
} from "@prismalens/config/harness";
import type { CanonicalEvent } from "@prismalens/contracts";
import type { AdapterContext } from "../adapter/acp-adapter.js";
import {
	ClaudeCodeAdapter,
	type SdkMessage,
} from "../adapter/claude-code-adapter.js";
import { createProcessFloorSandbox } from "../sandbox/process-floor.js";
import type { Sandbox, SandboxLimits } from "../sandbox/types.js";
import { sandboxSpawnClaudeCodeProcess } from "./claude-code-sandbox-spawn.js";

export interface ClaudeCodeConfig {
	/** Working directory the agent runs in (it reads the app source here). */
	cwd: string;
	/** The investigation prompt (first user turn). */
	prompt: string;
	/** Claude model id; omit to use the CLI/subscription default. */
	model?: string;
	/** Hard cap on agent turns (runaway guard). */
	maxTurns?: number;
	/** Tools the agent may NOT use. Default blocks mutation (read-only). */
	disallowedTools?: string[];
	/** External cancellation. */
	abortController?: AbortController;
	/**
	 * prismalens posture dial (ADR-0017). Absent → "read-only". Translated to the
	 * Agent SDK's native permissionMode + a disallowedTools read-only floor:
	 *  - read-only/supervised → bypassPermissions + deny Edit/Write/… (deny holds
	 *    under bypass AND unions with the user's own settings.json deny; headless-safe)
	 *  - auto                 → acceptEdits, no floor
	 *  - dangerous            → bypassPermissions, no floor
	 */
	permissionMode?: PermissionMode;
	/**
	 * Native passthrough (ADR-0017): arbitrary Agent SDK query options. Spread FIRST,
	 * so prismalens's posture keys (settingSources/permissionMode/disallowedTools) win.
	 */
	native?: Record<string, unknown>;
	/** The isolation boundary to spawn the SDK's CLI subprocess into (ADR-0020). Defaults to the process floor. */
	sandbox?: Sandbox;
	/** Best-effort resource caps for the sandboxed run (ADR-0020), threaded to the sandbox spawn. */
	limits?: SandboxLimits;
	/** If true, stops host settings/hooks/plugins/MCP servers from leaking into the rented harness. */
	isolateSettings?: boolean;
}

// The read-only floor is the registry SSOT (ADR-0017 Amendment 2) — the SAME array
// the reported fidelity mechanism is derived from, so enforcement can't drift from
// what the report claims.
const READ_ONLY_DENY = [
	...(HARNESS_REGISTRY["claude-code"].readOnlyDeny ?? []),
];

export async function* runClaudeCodeBranch(
	config: ClaudeCodeConfig,
	ctx: AdapterContext,
): AsyncGenerator<CanonicalEvent> {
	const adapter = new ClaudeCodeAdapter(ctx);
	let sawTerminal = false;
	// Translate the prismalens posture (ADR-0017) → the Agent SDK's native config.
	const mode: PermissionMode = config.permissionMode ?? "read-only";
	const readOnlyFloor = mode === "read-only" || mode === "supervised";
	// auto → acceptEdits (no floor); read-only/supervised/dangerous → bypassPermissions.
	const permissionMode = mode === "auto" ? "acceptEdits" : "bypassPermissions";
	// Read-only floor: deny mutation tools. The SDK checks DENY rules BEFORE the
	// permission mode, so this holds even under bypassPermissions and unions with the
	// user's own settings.json deny (deny-wins). auto/dangerous apply NO floor.
	const disallowedTools = readOnlyFloor
		? (config.disallowedTools ?? READ_ONLY_DENY)
		: config.disallowedTools;
	// Spawn the SDK's CLI subprocess THROUGH the Sandbox port (ADR-0020, issue #64) — mirror the
	// ACP path: a caller-supplied sandbox is caller-owned; the default floor is ours to destroy.
	const sandbox = config.sandbox ?? createProcessFloorSandbox();
	const ownsSandbox = config.sandbox === undefined;

	let configDir: string | undefined;
	try {
		if (config.isolateSettings) {
			// Note: Endpoint-managed policy settings are org-enforced by design — we do NOT attempt to bypass them.
			// This isolates only the global user/host configuration (~/.claude.json).
			configDir = await mkdtemp(join(tmpdir(), "claude-config-"));
		}

		const response = query({
			prompt: config.prompt,
			options: {
				// NATIVE PASSTHROUGH first, so our posture keys below win on overlap.
				...(config.native ?? {}),
				cwd: config.cwd,
				...(config.model ? { model: config.model } : {}),
				// Behave as the real Claude Code harness (its tools + subagents).
				systemPrompt: { type: "preset", preset: "claude_code" },
				...(config.maxTurns ? { maxTurns: config.maxTurns } : {}),
				...(config.abortController
					? { abortController: config.abortController }
					: {}),
				// prismalens posture-derived keys LAST — the read-only floor wins.
				settingSources: config.isolateSettings
					? []
					: ["user", "project", "local"],
				permissionMode,
				...(disallowedTools ? { disallowedTools } : {}),
				spawnClaudeCodeProcess: sandboxSpawnClaudeCodeProcess(sandbox, {
					cwd: config.cwd,
					...(config.limits ? { limits: config.limits } : {}),
					...(configDir ? { env: { CLAUDE_CONFIG_DIR: configDir } } : {}),
				}),
			},
		});
		for await (const message of response) {
			const m = message as unknown as SdkMessage;
			for (const ev of adapter.normalize(m)) yield ev;
			if (m.type === "result") {
				sawTerminal = true;
				yield adapter.terminalFromResult(m);
			}
		}
		if (!sawTerminal) yield adapter.branchDone("submitted");
	} catch (err) {
		yield adapter.error(err instanceof Error ? err.message : String(err));
	} finally {
		if (ownsSandbox) await sandbox.destroy();
		if (configDir) {
			await rm(configDir, { recursive: true, force: true });
		}
	}
}
