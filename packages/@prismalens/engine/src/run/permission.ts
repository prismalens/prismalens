// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The runtime gate (ADR 0003 §1, 0004): every ACP permission request is
 * answered here, for every harness. Read-only today; the act phase changes the
 * policy, not the seam. Bash walks through any text rule, so the sandbox (0004)
 * is the boundary and this is the guardrail.
 */

import { isAbsolute, normalize, resolve, sep } from "node:path";

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
		/**
		 * ACP ToolKind: RequestPermissionRequest["toolCall"]["kind"]
		 * (read | edit | delete | move | search | execute | think | fetch | other).
		 * Kept as string for tolerant wire decoding.
		 */
		kind?: string;
		rawInput?: unknown;
	};
}

export type PermissionDecision =
	| { allow: true; optionId: string; warn?: string }
	| { allow: false; optionId?: string; why: string };

export type PermissionPolicy = (req: PermissionRequest) => PermissionDecision;

const MUTATING_KINDS = new Set(["edit", "delete", "move"]);
/** `fetch` reaches the network, so a read-only run could send the snapshot anywhere (#637 H3). */
const NETWORK_KINDS = new Set(["fetch"]);
/** Kinds this policy judges on purpose; anything else is allowed with a warning. */
const NAMED_KINDS = new Set(["read", "search", "think", "execute"]);

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

/**
 * Shell tokens that can leave the snapshot: a `~` home, `$HOME`, an absolute
 * path, or any token holding a `..` segment. Every candidate is resolved
 * against the snapshot before judging, so `src/../../..`, `/bin/../etc/shadow`
 * and `<cwd>/../other` are caught and `src/../src` stays allowed. Absolute
 * paths under the snapshot, `/dev/null` and the usual binary directories are
 * fine. A text rule, not a boundary (the sandbox is the boundary); #337 run e
 * saw `ls -la ../..` list every run in the workspace on the cooperative floor.
 */
const SHELL_SPLIT = /[\s;&|()<>'"`=]+/;
const HARMLESS_ABSOLUTE = [
	"/dev/null",
	"/usr/bin/",
	"/bin/",
	"/usr/local/bin/",
];
/** A `..` segment under either separator, so a Windows `..\\..` is seen too. */
const DOTDOT_SEGMENT = /(^|[/\\])\.\.([/\\]|$)/;
/** An unexpanded shell variable: its value is unknown here, so a `..` after it cannot be judged. */
const SHELL_VARIABLE = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/;

/**
 * `cwd` comes from the platform `node:path`, so the platform module resolves
 * and compares here as well (drive letters and backslashes on Windows).
 */
function insideSnapshot(resolved: string, cwd: string): boolean {
	const root = resolve(cwd);
	return resolved === root || resolved.startsWith(root + sep);
}

/** The first path in `text` that resolves outside `cwd`, or null. */
function outsideSnapshotToken(text: string, cwd: string): string | null {
	for (const token of text.split(SHELL_SPLIT)) {
		if (!token) continue;
		if (token.startsWith("~") || /\$\{?HOME\b/.test(token)) return token;
		const dotdot = DOTDOT_SEGMENT.test(token);
		if (dotdot && SHELL_VARIABLE.test(token)) return token;
		if (isAbsolute(token) || token.startsWith("/")) {
			const resolved = normalize(token.replace(/\\/g, sep));
			if (insideSnapshot(resolved, cwd)) continue;
			const posixForm = resolved.replace(/\\/g, "/");
			if (
				HARMLESS_ABSOLUTE.some(
					(p) => posixForm === p || posixForm.startsWith(p),
				)
			)
				continue;
			return token;
		}
		if (dotdot) {
			// A backslash is a separator on Windows and a legal name character elsewhere;
			// judge it as a separator on every platform so the rule stays conservative.
			if (insideSnapshot(resolve(cwd, token.replace(/\\/g, sep)), cwd))
				continue;
			return token;
		}
	}
	return null;
}

/** `cwd` params and file-path params the harness may pass beside the command. */
function pathParamsOf(req: PermissionRequest): string[] {
	const raw = req.toolCall?.rawInput;
	if (!raw || typeof raw !== "object") return [];
	const r = raw as Record<string, unknown>;
	return ["cwd", "path", "filePath", "file_path", "file"].flatMap((k) =>
		typeof r[k] === "string" ? [r[k] as string] : [],
	);
}

function outsideSnapshot(
	req: PermissionRequest,
	cwd: string | undefined,
): string | null {
	if (!cwd) return null;
	const kind = req.toolCall?.kind ?? "";
	for (const p of pathParamsOf(req)) {
		if (p.startsWith("~")) return p;
		if (!insideSnapshot(resolve(cwd, p), cwd)) return p;
	}
	if (kind === "execute" || !kind) {
		return outsideSnapshotToken(commandOf(req), cwd);
	}
	return null;
}

export interface ReadOnlyPolicyOptions {
	/** The snapshot the run works in; paths outside it are refused. Absent means no path rule. */
	cwd?: string;
}

export function readOnlyPolicyFor(
	options: ReadOnlyPolicyOptions = {},
): PermissionPolicy {
	return (req) => decide(req, options.cwd);
}

export const readOnlyPolicy: PermissionPolicy = (req) => decide(req, undefined);

function decide(
	req: PermissionRequest,
	cwd: string | undefined,
): PermissionDecision {
	const kind = req.toolCall?.kind ?? "";
	const command = commandOf(req);
	let why: string | null = null;
	if (MUTATING_KINDS.has(kind)) why = `tool kind "${kind}" is a write`;
	else if (NETWORK_KINDS.has(kind))
		why = `tool kind "${kind}" reaches the network`;
	else if (kind === "execute" && MUTATING_SHELL.test(command))
		why = "shell command would mutate";
	else if (!kind && MUTATING_SHELL.test(command)) why = "command would mutate";
	else {
		const outside = outsideSnapshot(req, cwd);
		if (outside) why = `reads outside the snapshot: ${outside}`;
	}

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
	if (NAMED_KINDS.has(kind)) return { allow: true, optionId: allow.optionId };
	return {
		allow: true,
		optionId: allow.optionId,
		warn: `allowed tool kind "${kind || "(none)"}", which the read-only policy does not name: ${req.toolCall?.title ?? command}`,
	};
}
