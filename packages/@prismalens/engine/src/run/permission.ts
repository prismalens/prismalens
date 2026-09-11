// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The runtime gate (ADR 0003 §1, 0004): every ACP permission request is
 * answered here, for every harness. Read-only today; the act phase changes the
 * policy, not the seam. Bash walks through any text rule, so the sandbox (0004)
 * is the boundary and this is the guardrail.
 */

export interface PermissionOption {
	optionId: string;
	name?: string;
	/** allow_once | allow_always | reject_once | reject_always */
	kind?: string;
}

export interface PermissionRequest {
	options: PermissionOption[];
	toolCall?: {
		title?: string;
		toolCallId?: string;
		/** ACP ToolKind: read | edit | delete | move | search | execute | think | fetch | other */
		kind?: string;
		rawInput?: unknown;
	};
}

export type PermissionDecision =
	| { allow: true; optionId: string }
	| { allow: false; optionId?: string; why: string };

export type PermissionPolicy = (req: PermissionRequest) => PermissionDecision;

const MUTATING_KINDS = new Set(["edit", "delete", "move"]);

/**
 * Shell commands that change the tree, the repo, or the machine. A regex is a
 * guardrail, not a boundary; it exists so an honest agent gets a clean refusal
 * instead of a sandbox error.
 */
const MUTATING_SHELL =
	/(^|[\s;&|(])(>|>>|\btee\b|\btouch\b|\brm\b|\bmv\b|\bcp\b|\bmkdir\b|\bchmod\b|\bchown\b|\bln\b|\bsed\s+-i|\bperl\s+-i|\bgit\s+(commit|push|pull|fetch|checkout|switch|reset|clean|rebase|merge|stash|apply|am|cherry-pick|tag\s+\S|branch(?!\s*(?:$|-(?:a|r|v+|l|-list|-all|-remotes|-show-current|-contains|-merged|-no-merged|-points-at)\b)))|\bnpm\s+(install|i|ci|uninstall|publish)|\bpnpm\s+(install|i|add|remove|publish)|\byarn\b|\bpip\s+install|\bapt(-get)?\b|\bbrew\b|\bdocker\b|\bkubectl\s+(apply|delete|scale|rollout|edit|patch|create|exec|cp)|\bhelm\s+(install|upgrade|uninstall|rollback)|\bterraform\s+(apply|destroy)|\bsystemctl\b|\bkill(all)?\b|\bcurl\b[^|]*\s(-X|--request)\s*(POST|PUT|PATCH|DELETE)|\bwget\b)/i;

function commandOf(req: PermissionRequest): string {
	const tc = req.toolCall ?? {};
	const raw = tc.rawInput;
	if (raw && typeof raw === "object") {
		const r = raw as Record<string, unknown>;
		for (const key of ["command", "cmd", "script"]) {
			if (typeof r[key] === "string") return r[key] as string;
		}
	}
	return tc.title ?? "";
}

function pick(
	options: PermissionOption[],
	prefix: string,
): PermissionOption | undefined {
	return (
		options.find((o) => o.kind === `${prefix}_once`) ??
		options.find((o) => (o.kind ?? "").startsWith(prefix))
	);
}

export const readOnlyPolicy: PermissionPolicy = (req) => {
	const kind = req.toolCall?.kind ?? "";
	const command = commandOf(req);
	let why: string | null = null;
	if (MUTATING_KINDS.has(kind)) why = `tool kind "${kind}" is a write`;
	else if (kind === "execute" && MUTATING_SHELL.test(command))
		why = "shell command would mutate";
	else if (!kind && MUTATING_SHELL.test(command)) why = "command would mutate";

	if (why) {
		const reject = pick(req.options, "reject");
		return {
			allow: false,
			why,
			...(reject ? { optionId: reject.optionId } : {}),
		};
	}
	const allow = pick(req.options, "allow") ?? req.options[0];
	if (!allow) return { allow: false, why: "harness offered no allow option" };
	return { allow: true, optionId: allow.optionId };
};
