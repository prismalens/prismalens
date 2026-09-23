// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The runtime gate (ADR 0003 §1, 0004): every ACP permission request is
 * answered here, for every harness. Read-only today; the act phase changes the
 * policy, not the seam. Bash walks through any text rule; there is no OS boundary (0004 §3), so this is a guardrail, not a boundary.
 */
import { readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

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
 * instead of a failed write.
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
 * fine. A text rule, not a boundary; #337 run e
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
 * Where `path` (absolute, or relative to `base`) lands when the kernel walks it:
 * one component at a time, each symlink replaced by its real target before the
 * next `..` applies. `resolve` collapses `link/..` lexically, which is not where
 * the kernel goes when `link` points out of the snapshot (the CVE-2026-39861
 * shape). Past the first missing component the rest is appended as written, so
 * a path about to be created is judged where it would land. Null when the
 * filesystem refuses to say (a loop, no permission); callers treat null as outside.
 */
function physicalLocation(base: string, path: string): string | null {
	const root = isAbsolute(path) ? parse(path).root : resolve(base);
	const realRoot = realpathOrMissing(root);
	if (realRoot === null) return null;
	let exists = realRoot !== undefined;
	let cursor = realRoot ?? root;
	for (const segment of path
		.slice(isAbsolute(path) ? root.length : 0)
		.split(/[/\\]/)) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			cursor = dirname(cursor);
			continue;
		}
		const next = join(cursor, segment);
		if (exists) {
			const real = realpathOrMissing(next);
			if (real === null) return null;
			if (real !== undefined) {
				cursor = real;
				continue;
			}
			exists = false;
		}
		cursor = next;
	}
	return cursor;
}

/** The real path; undefined when it does not exist yet, null when the filesystem refuses. */
function realpathOrMissing(path: string): string | undefined | null {
	try {
		return realpathSync(path);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		return code === "ENOENT" || code === "ENOTDIR" ? undefined : null;
	}
}

/**
 * `cwd` comes from the platform `node:path`, so the platform module resolves
 * and compares here as well (drive letters and backslashes on Windows). Both
 * sides are judged where they really live, never lexically.
 */
function insideSnapshot(path: string, cwd: string): boolean {
	const root = physicalLocation(cwd, resolve(cwd));
	const real = physicalLocation(cwd, path);
	if (root === null || real === null) return false;
	return real === root || real.startsWith(root + sep);
}

/** Whether one shell word, taken literally, lands outside `cwd`. */
function wordOutside(word: string, cwd: string): boolean {
	if (word.startsWith("~") || /\$\{?HOME\b/.test(word)) return true;
	if (DOTDOT_SEGMENT.test(word) && SHELL_VARIABLE.test(word)) return true;
	// A backslash is a separator on Windows and a legal name character elsewhere;
	// it is walked as a separator on every platform so the rule stays conservative.
	if (insideSnapshot(word, cwd)) return false;
	if (isAbsolute(word) || word.startsWith("/")) {
		const real = physicalLocation(cwd, word)?.replace(/\\/g, "/");
		if (
			real &&
			HARMLESS_ABSOLUTE.some((p) => real.startsWith(p) || `${real}/` === p)
		)
			return false;
	}
	return true;
}

/**
 * Glob and brace characters the shell expands, each with the stand-in that
 * marks it quoted or escaped: a quoted `'a.*'` is a grep pattern, an unquoted
 * `*` is a list of paths.
 */
const EXPANDING = "*?[{";
const LITERAL = "\u0001\u0002\u0003\u0004";
/** Past this many candidate paths the word is refused rather than judged. */
const EXPANSION_LIMIT = 10_000;

/** `text` with every quoted or backslash-escaped expanding character swapped for its stand-in; same length. */
function markLiterals(text: string): string {
	let out = "";
	let quote: string | null = null;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quote) {
			if (c === quote) quote = null;
			const k = EXPANDING.indexOf(c);
			out += k >= 0 ? LITERAL[k] : c;
		} else if (c === "'" || c === '"') {
			quote = c;
			out += c;
		} else if (c === "\\" && EXPANDING.includes(text[i + 1] ?? "")) {
			out += c + LITERAL[EXPANDING.indexOf(text[i + 1])];
			i++;
		} else {
			out += c;
		}
	}
	return out;
}

const unmark = (s: string): string =>
	Array.from(s, (c) => EXPANDING[LITERAL.indexOf(c)] ?? c).join("");

/** `a{b,c}d` as `abd`, `acd`; null for a sequence (`{1..9}`) or past the limit. */
function expandBraces(word: string): string[] | null {
	const open = word.indexOf("{");
	if (open < 0) return [word];
	let depth = 0;
	const commas: number[] = [];
	for (let i = open; i < word.length; i++) {
		if (word[i] === "{") depth++;
		else if (word[i] === "}" && --depth === 0) {
			const body = word.slice(open + 1, i);
			if (/^[^,]*\.\.[^,]*$/.test(body)) return null;
			if (commas.length === 0) {
				const rest = expandBraces(word.slice(i + 1));
				return rest ? rest.map((r) => word.slice(0, i + 1) + r) : null;
			}
			const bounds = [open, ...commas, i];
			const out: string[] = [];
			for (let b = 0; b < bounds.length - 1; b++) {
				const alt = expandBraces(
					word.slice(0, open) +
						word.slice(bounds[b] + 1, bounds[b + 1]) +
						word.slice(i + 1),
				);
				if (!alt) return null;
				out.push(...alt);
				if (out.length > EXPANSION_LIMIT) return null;
			}
			return out;
		} else if (word[i] === "," && depth === 1) commas.push(i);
	}
	return [word];
}

/** One path component's glob as a regex, or null when it holds no unquoted glob. */
function segmentPattern(segment: string): RegExp | null {
	if (!/[*?[]/.test(segment)) return null;
	let re = "";
	for (let i = 0; i < segment.length; i++) {
		const c = segment[i];
		if (c === "*") re += ".*";
		else if (c === "?") re += ".";
		else if (c === "[" && segment.indexOf("]", i + 2) > 0) {
			const end = segment.indexOf("]", i + 2);
			let body = segment.slice(i + 1, end);
			if (body.startsWith("!")) body = `^${body.slice(1)}`;
			re += `[${unmark(body).replace(/[\\\]]/g, "\\$&")}]`;
			i = end;
		} else re += unmark(c).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${re}$`, "s");
}

/**
 * The paths an unquoted word expands to, the way the shell does it: braces,
 * then one component at a time. Null when the answer cannot be trusted: a
 * pattern that could match `.` or `..` (dash and older bash include them), a
 * sequence, or more candidates than the limit. A glob with no match stays the
 * literal word, as it does in the shell.
 */
function expandWord(marked: string, cwd: string): string[] | null {
	const words = expandBraces(marked);
	if (!words) return null;
	const out: string[] = [];
	for (const word of words) {
		const absolute = word.startsWith("/");
		let candidates = [absolute ? "/" : ""];
		for (const segment of word.split("/")) {
			if (!segment) continue;
			const pattern = segmentPattern(segment);
			if (!pattern) {
				candidates = candidates.map((c) => `${c + unmark(segment)}/`);
				continue;
			}
			if (segment.startsWith(".") && (pattern.test(".") || pattern.test("..")))
				return null;
			const next: string[] = [];
			for (const c of candidates) {
				let names: string[];
				try {
					names = readdirSync(resolve(cwd, c || "."));
				} catch {
					continue;
				}
				for (const name of names) {
					if (name.startsWith(".") && !segment.startsWith(".")) continue;
					if (pattern.test(name)) next.push(`${c}${name}/`);
				}
				if (next.length > EXPANSION_LIMIT) return null;
			}
			candidates = next;
			if (candidates.length === 0) break;
		}
		if (candidates.length === 0) out.push(unmark(word));
		else
			out.push(...candidates.map((c) => (c.length > 1 ? c.slice(0, -1) : c)));
		if (out.length > EXPANSION_LIMIT) return null;
	}
	return out;
}

/**
 * The first word in `text` that resolves outside `cwd`, or null. An unquoted
 * glob or brace word is judged by what the shell would expand it to (#685:
 * `cat *` reads whatever `*` matches, including a symlink out).
 */
function outsideSnapshotToken(text: string, cwd: string): string | null {
	for (const marked of markLiterals(text).split(SHELL_SPLIT)) {
		if (!marked) continue;
		const token = unmark(marked);
		if (!/[*?[{]/.test(marked)) {
			if (wordOutside(token, cwd)) return token;
			continue;
		}
		const paths = expandWord(marked, cwd);
		if (!paths || paths.some((p) => wordOutside(p, cwd))) return token;
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
		if (!insideSnapshot(p, cwd)) return p;
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
