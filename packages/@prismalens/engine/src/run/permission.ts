// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The runtime gate (ADR 0003 §1, 0004): every ACP permission request is
 * answered here, for every harness, at the run's access level (r4 R4.1). Bash
 * walks through any text rule; there is no OS boundary (0004 §3), so this is a guardrail, not a boundary.
 */
import { readdirSync, realpathSync } from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	parse,
	resolve,
	sep,
} from "node:path";
import type { PermissionMode } from "@prismalens/config/harness";

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
		/** ACP `ToolCallLocation[]`: the files the call touches. */
		locations?: { path?: string }[];
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
 * Shell text that writes files or the repo: lifted at `workspace-write`, where
 * the path rule keeps every word inside the snapshot. Runs on the marked text,
 * so a quoted `>` is data (walk f23).
 */
const FILE_WRITES =
	/(^|[\s;&|(])((tee|touch|rm|rmdir|mv|cp|mkdir|chmod|chown|ln|truncate|dd|shred|patch|c?split|zip)(?![\w./-])|\bsed\s+-i|\bperl\s+-i|\bgit\s+(commit|push|pull|fetch|checkout|switch|reset|clean|rebase|merge|stash|apply|am|cherry-pick|tag\s+\S|branch(?!\s*(?:$|-(?:a|r|v+|l|-list|-all|-remotes|-show-current|-contains|-merged|-no-merged|-points-at)\b))))/i;

/**
 * Installers and machine changes, refused below Full access wherever the words appear; a net under the parsed rules.
 * A name ends where a filename could not go on (`yarn.lock` is not yarn), and `yarn test` is left to the test-runner rule.
 */
const MACHINE_WRITES =
	/(^|[\s;&|(])(npm\s+(install|i|ci|uninstall|publish)|pnpm\s+(install|i|add|remove|publish)|yarn(?![\w./-])(?!\s+(test|run\s+test)(?![\w./-]))|pip3?\s+install|apt(-get)?|brew|kubectl\s+(apply|delete|scale|rollout|edit|patch|create|exec|cp)|helm\s+(install|upgrade|uninstall|rollback)|terraform\s+(apply|destroy)|systemctl|p?kill(all)?)(?![\w./-])/i;

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
/** A backslash separates path components on Windows only; elsewhere it is a legal name character. */
const SEPARATORS = process.platform === "win32" ? /[/\\]/ : /\//;

function physicalLocation(base: string, path: string): string | null {
	const root = isAbsolute(path) ? parse(path).root : resolve(base);
	const realRoot = realpathOrMissing(root);
	if (realRoot === null) return null;
	let exists = realRoot !== undefined;
	let cursor = realRoot ?? root;
	for (const segment of path
		.slice(isAbsolute(path) ? root.length : 0)
		.split(SEPARATORS)) {
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

/** A backslash before one of these is a shell escape on POSIX, never a separator. */
const ESCAPABLE = `*?[{'"\\ $\`=<>();&|`;

/**
 * What a shell word may name. On Windows the platform path module reads it.
 * On POSIX an unquoted backslash escapes the next character, a backslash in
 * double quotes before an ordinary character is kept (`"b\\d"` names `b\\d`),
 * and a command written for Windows would read it as a separator. Quoting is
 * gone by now, so every reading is judged, and the word stays inside only if
 * all of them do. A path read back from the filesystem is taken as it is.
 */
function shellReadings(word: string): string[] {
	if (process.platform === "win32" || !word.includes("\\")) return [word];
	let posix = "";
	let windows = "";
	for (let i = 0; i < word.length; i++) {
		const c = word[i];
		if (c === "\\" && i + 1 < word.length) {
			const next = word[i + 1];
			posix += next;
			windows += ESCAPABLE.includes(next) ? next : `/${next}`;
			i++;
		} else {
			posix += c;
			windows += c;
		}
	}
	return [posix, word, windows];
}

/** Whether a shell word lands outside `cwd` under any of its readings. */
function wordOutside(word: string, cwd: string): boolean {
	return shellReadings(word).some((reading) => pathOutside(reading, cwd));
}

/** Whether one path, taken as it is, lands outside `cwd`. */
function pathOutside(word: string, cwd: string): boolean {
	if (word.startsWith("~") || /\$\{?HOME\b/.test(word)) return true;
	if (DOTDOT_SEGMENT.test(word) && SHELL_VARIABLE.test(word)) return true;
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
 * Characters the shell gives meaning to, each with the Private Use Area
 * stand-in that marks it quoted or escaped: a quoted `'a.*'` is a grep
 * pattern, an unquoted `*` is a list of paths; a quoted `>` or `=` is part of
 * one argument, an unquoted one is a redirect or a separator. The quotes that
 * delimit a region become GLUE, which joins the word and vanishes on unmark.
 */
const EXPANDING = "*?[{=<>()'\"`;&|";
const LITERAL =
	"\uE000\uE001\uE002\uE003\uE004\uE005\uE006\uE007\uE008\uE009\uE00A\uE00B\uE00C\uE00D";
const GLUE = "\uE00E";
/** Inside double quotes `$(…)` and backticks still run, so those stay separators there. */
const DOUBLE_QUOTE_KEEPS = "()`";
/** Past this many candidate paths the word is refused rather than judged. */
const EXPANSION_LIMIT = 10_000;

/**
 * `text` with every quoted or backslash-escaped expanding character swapped
 * for its stand-in; same length. Quoting follows the shell: nothing escapes
 * inside single quotes, and elsewhere a backslash makes the next character
 * literal, a quote included, so `\'` never opens a quoted region (#685 review).
 */
function markLiterals(text: string): string {
	const mark = (ch: string) => {
		const k = EXPANDING.indexOf(ch);
		return k >= 0 ? LITERAL[k] : ch;
	};
	let out = "";
	let quote: "'" | '"' | null = null;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quote === "'") {
			if (c === "'") {
				quote = null;
				out += GLUE;
			} else out += mark(c);
		} else if (c === "\\" && i + 1 < text.length) {
			out += c + mark(text[i + 1]);
			i++;
		} else if (quote === '"') {
			if (c === '"') {
				quote = null;
				out += GLUE;
			} else out += DOUBLE_QUOTE_KEEPS.includes(c) ? c : mark(c);
		} else if (c === "'" || c === '"') {
			quote = c;
			out += GLUE;
		} else out += c;
	}
	return out;
}

const unmark = (s: string): string =>
	Array.from(s, (c) =>
		c === GLUE ? "" : (EXPANDING[LITERAL.indexOf(c)] ?? c),
	).join("");

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

/** The longest name a filesystem allows; a longer glob segment is refused, not judged. */
const MAX_SEGMENT = 255;

type GlobToken =
	| { star: true }
	| { star: false; test: (ch: string) => boolean };

/**
 * One path component's glob as a matcher: null when it holds no unquoted
 * glob, "refuse" for a form this does not judge (a POSIX class such as
 * `[[:alpha:]]`, or a segment longer than any name). Matching is the linear
 * wildcard walk, never a regex, so a run of `*` cannot backtrack for ever.
 */
function segmentMatcher(
	segment: string,
): ((name: string) => boolean) | null | "refuse" {
	if (!/[*?[]/.test(segment)) return null;
	if (segment.length > MAX_SEGMENT) return "refuse";
	const tokens: GlobToken[] = [];
	for (let i = 0; i < segment.length; i++) {
		const c = segment[i];
		if (c === GLUE) continue;
		if (c === "*") {
			if (!tokens.at(-1)?.star) tokens.push({ star: true });
		} else if (c === "?") {
			tokens.push({ star: false, test: () => true });
		} else if (c === "[") {
			let j = i + 1;
			const negate = segment[j] === "!" || segment[j] === "^";
			if (negate) j++;
			const bodyStart = j;
			if (segment[j] === "]") j++;
			const end = segment.indexOf("]", j);
			if (end < 0) {
				tokens.push({ star: false, test: (ch) => ch === "[" });
				continue;
			}
			const body = unmark(segment.slice(bodyStart, end));
			if (body.includes("[")) return "refuse";
			const test = (ch: string) => {
				for (let k = 0; k < body.length; k++) {
					if (body[k + 1] === "-" && k + 2 < body.length) {
						if (ch >= body[k] && ch <= body[k + 2]) return true;
						k += 2;
					} else if (body[k] === ch) return true;
				}
				return false;
			};
			tokens.push({ star: false, test: negate ? (ch) => !test(ch) : test });
			i = end;
		} else {
			const literal = unmark(c);
			tokens.push({ star: false, test: (ch) => ch === literal });
		}
	}
	return (name) => {
		let t = 0;
		let n = 0;
		let starT = -1;
		let starN = 0;
		while (n < name.length) {
			const token = tokens[t];
			if (token && !token.star && token.test(name[n])) {
				t++;
				n++;
			} else if (token?.star) {
				starT = t++;
				starN = n;
			} else if (starT >= 0) {
				t = starT + 1;
				n = ++starN;
			} else return false;
		}
		while (tokens[t]?.star) t++;
		return t === tokens.length;
	};
}

/**
 * The paths an unquoted word expands to, the way the shell does it: braces,
 * then one component at a time. Null when the answer cannot be trusted: a
 * pattern that could match `.` or `..` (dash and older bash include them), a
 * sequence, or more candidates than the limit. A glob with no match stays the
 * literal word, as it does in the shell.
 */
function expandWord(
	marked: string,
	cwd: string,
): { path: string; shell: boolean }[] | null {
	const words = expandBraces(marked);
	if (!words) return null;
	const out: { path: string; shell: boolean }[] = [];
	for (const word of words) {
		const absolute = word.startsWith("/");
		let candidates = [absolute ? "/" : ""];
		for (const segment of word.split("/")) {
			if (!segment) continue;
			const matches = segmentMatcher(segment);
			if (matches === "refuse") return null;
			if (!matches) {
				// A literal segment is shell text: its escapes are the shell's.
				const literal = shellReadings(unmark(segment))[0];
				candidates = candidates.map((c) => `${c + literal}/`);
				continue;
			}
			if (segment.startsWith(".") && (matches(".") || matches("..")))
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
					if (matches(name)) next.push(`${c}${name}/`);
				}
				if (next.length > EXPANSION_LIMIT) return null;
			}
			candidates = next;
			if (candidates.length === 0) break;
		}
		// No match leaves the word as typed, as the shell does; a match is a real path.
		if (candidates.length === 0) out.push({ path: unmark(word), shell: true });
		else
			out.push(
				...candidates.map((c) => ({
					path: c.length > 1 ? c.slice(0, -1) : c,
					shell: false,
				})),
			);
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
			// A quoted flag's value is still a path: `'--file=/etc/x'`.
			const eq = token.indexOf("=");
			if (token.startsWith("-") && eq > 0) {
				const value = token.slice(eq + 1);
				if (wordOutside(value, cwd)) return value;
			}
			continue;
		}
		const paths = expandWord(marked, cwd);
		if (
			!paths ||
			paths.some((p) =>
				p.shell ? wordOutside(p.path, cwd) : pathOutside(p.path, cwd),
			)
		)
			return token;
	}
	return null;
}

/** `cwd` params and file-path params the harness may pass beside the command. */
function pathParamsOf(req: PermissionRequest): string[] {
	const raw = req.toolCall?.rawInput;
	const out = (req.toolCall?.locations ?? []).flatMap((l) =>
		typeof l?.path === "string" ? [l.path] : [],
	);
	if (!raw || typeof raw !== "object") return out;
	const r = raw as Record<string, unknown>;
	return [
		...out,
		...["cwd", "path", "filePath", "file_path", "file"].flatMap((k) =>
			typeof r[k] === "string" ? [r[k] as string] : [],
		),
	];
}

/** Where a write-kind call lands: its path params, a move's two ends, a patch's file keys. */
function writeTargetsOf(req: PermissionRequest): string[] {
	const raw = req.toolCall?.rawInput;
	const r =
		raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const extra = [
		"source",
		"destination",
		"oldPath",
		"newPath",
		"old_path",
		"new_path",
	].flatMap((k) => (typeof r[k] === "string" ? [r[k] as string] : []));
	const changes =
		r.changes && typeof r.changes === "object" ? Object.keys(r.changes) : [];
	return [...pathParamsOf(req), ...extra, ...changes].filter(
		(p) => p !== r.cwd,
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

// ---------------------------------------------------------------------------
// Access levels (r4 R4.1 and its rev). Every class below is refused below Full
// access; the red-team corpus in __fixtures__ is the oracle, not this code.
// ---------------------------------------------------------------------------

/** A credential directory or file by name, inside or outside the snapshot. */
const CREDENTIAL_PATH =
	/(^|[/\\])\.(ssh|aws|kube|netrc|npmrc|env|config[/\\]gcloud)\b/;

const WHY = {
	host: (origin: string) => `reaches a host outside the brief: ${origin}`,
	body: "sends a request body",
	routing: "routes or configures the request outside the brief",
	network: "uses a network client",
	secondInterpreter: "runs a second interpreter",
	program: "runs a program from the copied code",
	spawn: "can start another command",
	download: "downloads or runs code from outside the copy",
	credential: (path: string) => `reads a credential path: ${path}`,
	mutate: "shell command would mutate",
	notReadVerb: (what: string) => `${what} is not a read verb`,
	notAtReadOnly: (what: string) => `${what} is not allowed at Read-only`,
} as const;

const LEVEL_RANK: Record<PermissionMode, number> = {
	"read-only": 0,
	"read-only-tools": 1,
	"workspace-write": 2,
	"full-access": 3,
};
const atLeast = (level: PermissionMode, floor: PermissionMode): boolean =>
	LEVEL_RANK[level] >= LEVEL_RANK[floor];

/** Stands in for a `$(…)` or backtick result inside a word: unreadable here. */
const SUBSTITUTION = "\u0000";

interface Word {
	/** The word as the program receives it, quotes removed; `$NAME` kept as written. */
	text: string;
	/** Holds an unquoted or double-quoted expansion or substitution. */
	dynamic: boolean;
	/** Holds an unquoted glob or brace the shell would expand into other words. */
	expands?: boolean;
	/** A redirection operator (`>`, `<`, `>>`, `>&`, …), not an argument. */
	redirect?: boolean;
}

/** `$'…'` as bash decodes it: the common escapes, hex, octal and \u. */
function decodeAnsiC(body: string): string {
	return body.replace(
		/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3}|c.|.)/g,
		(_, e: string) => {
			const simple: Record<string, string> = {
				n: "\n",
				t: "\t",
				r: "\r",
				a: "\u0007",
				b: "\b",
				e: "\u001b",
				E: "\u001b",
				f: "\f",
				v: "\v",
				"\\": "\\",
				"'": "'",
				'"': '"',
				"?": "?",
			};
			if (e[0] === "x" || e[0] === "u" || e[0] === "U")
				return String.fromCodePoint(Number.parseInt(e.slice(1), 16));
			if (/^[0-7]/.test(e))
				return String.fromCharCode(Number.parseInt(e, 8) & 0xff);
			if (e[0] === "c") return String.fromCharCode(e.charCodeAt(1) & 0x1f);
			return simple[e] ?? `\\${e}`;
		},
	);
}

/**
 * The simple commands in a shell line, nested `$(…)`, backticks and process
 * substitutions included, each as its words. A reading for judging, not a
 * shell: what it cannot read becomes `dynamic` and is refused where it matters.
 */
function parseShell(text: string): Word[][] {
	const commands: Word[][] = [];
	let i = 0;

	const parseList = (close: ")" | "`" | null): void => {
		let words: Word[] = [];
		let text_ = "";
		let dynamic = false;
		let expands = false;
		let inWord = false;
		let depth = 0;
		const endWord = () => {
			if (inWord)
				words.push({ text: text_, dynamic, ...(expands ? { expands } : {}) });
			text_ = "";
			dynamic = false;
			expands = false;
			inWord = false;
		};
		const endCommand = () => {
			endWord();
			if (words.length) commands.push(words);
			words = [];
		};
		const substitution = (closer: ")" | "`") => {
			endCommandSaved();
			parseList(closer);
			restoreSaved();
			text_ += SUBSTITUTION;
			dynamic = true;
			inWord = true;
		};
		// A substitution's commands are judged on their own; the outer word resumes after it.
		let saved: {
			words: Word[];
			text: string;
			dynamic: boolean;
			expands: boolean;
			inWord: boolean;
		}[] = [];
		const endCommandSaved = () => {
			saved.push({ words, text: text_, dynamic, expands, inWord });
			words = [];
			text_ = "";
			dynamic = false;
			expands = false;
			inWord = false;
		};
		const restoreSaved = () => {
			const s = saved.pop();
			if (!s) return;
			words = s.words;
			text_ = s.text;
			dynamic = s.dynamic;
			expands = s.expands;
			inWord = s.inWord;
		};
		const variable = () => {
			// `$NAME`, `${…}`, `$1`, `$?`: kept as written, marked unreadable.
			let v = "$";
			i++;
			if (text[i] === "{") {
				const end = text.indexOf("}", i);
				const stop = end < 0 ? text.length : end + 1;
				v += text.slice(i, stop);
				i = stop;
			} else {
				const m = /^([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(text.slice(i));
				if (m) {
					v += m[0];
					i += m[0].length;
				}
			}
			text_ += v;
			dynamic = v.length > 1 || dynamic;
			inWord = true;
		};

		while (i < text.length) {
			const c = text[i];
			if (close && c === close && depth === 0) {
				i++;
				endCommand();
				saved = [];
				return;
			}
			if (c === "\\") {
				const next = text[i + 1];
				i += 2;
				if (next === undefined || next === "\n") continue;
				text_ += next;
				inWord = true;
				continue;
			}
			if (c === "'") {
				const end = text.indexOf("'", i + 1);
				const stop = end < 0 ? text.length : end;
				text_ += text.slice(i + 1, stop);
				i = stop + 1;
				inWord = true;
				continue;
			}
			if (c === "$" && text[i + 1] === "'") {
				let j = i + 2;
				while (j < text.length && text[j] !== "'")
					j += text[j] === "\\" ? 2 : 1;
				text_ += decodeAnsiC(text.slice(i + 2, j));
				i = j + 1;
				inWord = true;
				continue;
			}
			if (c === '"' || (c === "$" && text[i + 1] === '"')) {
				i += c === "$" ? 2 : 1;
				inWord = true;
				while (i < text.length && text[i] !== '"') {
					const d = text[i];
					if (d === "\\" && i + 1 < text.length) {
						const n = text[i + 1];
						text_ += '$`"\\\n'.includes(n) ? (n === "\n" ? "" : n) : `\\${n}`;
						i += 2;
					} else if (d === "$" && text[i + 1] === "(") {
						i += 2;
						substitution(")");
					} else if (d === "`") {
						i++;
						substitution("`");
					} else if (d === "$") variable();
					else {
						text_ += d;
						i++;
					}
				}
				i++;
				continue;
			}
			if (c === "$" && text[i + 1] === "(") {
				i += 2;
				substitution(")");
				continue;
			}
			if (c === "`") {
				i++;
				substitution("`");
				continue;
			}
			if (c === "$") {
				variable();
				continue;
			}
			if (c === "<" || c === ">" || (c === "&" && text[i + 1] === ">")) {
				endWord();
				let op = c;
				i++;
				while (i < text.length && "<>&|".includes(text[i]) && op.length < 3) {
					if (text[i] === "&" && op.endsWith("&")) break;
					op += text[i];
					i++;
				}
				if (text[i] === "(") {
					// Process substitution `<(…)` / `>(…)`: its commands run too.
					i++;
					endCommandSaved();
					parseList(")");
					restoreSaved();
					words.push({ text: SUBSTITUTION, dynamic: true });
					continue;
				}
				words.push({ text: op, dynamic: false, redirect: true });
				continue;
			}
			if (c === "(") {
				depth++;
				i++;
				endCommand();
				continue;
			}
			if (c === ")") {
				if (depth > 0) depth--;
				i++;
				endCommand();
				continue;
			}
			if (";&|\n".includes(c)) {
				i++;
				endCommand();
				continue;
			}
			if (/\s/.test(c)) {
				i++;
				endWord();
				continue;
			}
			if ("{*?[".includes(c)) expands = true;
			text_ += c;
			inWord = true;
			i++;
		}
		endCommand();
	};

	parseList(null);
	return commands;
}

/** Shell words that open a construct or pass the next word through as the command. */
const TRANSPARENT = new Set([
	"!",
	"{",
	"}",
	"if",
	"then",
	"else",
	"elif",
	"fi",
	"do",
	"done",
	"while",
	"until",
	"time",
	"command",
	"builtin",
	"exec",
	"coproc",
	"esac",
]);
/** Words whose segment holds data, never a command. */
const DATA_CONSTRUCTS = new Set(["for", "select", "case", "in"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

interface Simple {
	/** The command word's name: basename, lowercased, `.exe` dropped. */
	name: string;
	program: Word;
	/** Arguments after the command word, redirections and their targets removed. */
	args: Word[];
}

/** `NAME=value` words before the command word: the environment it runs with. */
function assignmentsOf(words: Word[]): string[] {
	const names: string[] = [];
	for (const w of words) {
		if (w.redirect) continue;
		const m = ASSIGNMENT.exec(w.text);
		if (!m) break;
		names.push(m[0].replace(/\+?=$/, ""));
	}
	return names;
}

/** The command a word list runs, or null when it runs none. */
function simpleCommand(words: Word[]): Simple | null {
	let k = 0;
	const skipRedirect = () => {
		while (words[k]?.redirect) k += 2;
	};
	for (;;) {
		skipRedirect();
		const w = words[k];
		if (!w) return null;
		if (!w.dynamic && ASSIGNMENT.test(w.text)) {
			k++;
			continue;
		}
		if (!w.dynamic && TRANSPARENT.has(w.text)) {
			k++;
			// `command -p curl`, `exec -a name curl`: the flags belong to the keyword.
			while (isFlag(words[k])) k += words[k].text === "-a" ? 2 : 1;
			continue;
		}
		if (!w.dynamic && w.text === "function") {
			k += 2;
			continue;
		}
		if (!w.dynamic && DATA_CONSTRUCTS.has(w.text)) return null;
		break;
	}
	const program = words[k];
	if (!program) return null;
	const args: Word[] = [];
	for (let j = k + 1; j < words.length; j++) {
		if (words[j].redirect) {
			j++;
			continue;
		}
		args.push(words[j]);
	}
	const name = basename(program.text.replace(/\\/g, "/"))
		.toLowerCase()
		.replace(/\.exe$/, "");
	return { name, program, args };
}

const isFlag = (w: Word | undefined): boolean =>
	!!w && !w.dynamic && w.text.startsWith("-") && w.text !== "-";
const positionals = (args: Word[]): Word[] => args.filter((a) => !isFlag(a));

interface Ctx {
	level: PermissionMode;
	origins: Set<string>;
	/** Paths the command names inside an argument (`-d @file`), judged by the path rule. */
	extraPaths: string[];
}

// --- interpreters (classes 4 and the R4.1 second interpreters) ---------------

const SHELLS = new Set([
	"sh",
	"bash",
	"zsh",
	"dash",
	"ksh",
	"mksh",
	"ash",
	"fish",
	"tcsh",
	"csh",
]);
const ALWAYS_SECOND = new Set(["pwsh", "powershell", "cmd", "osascript"]);
const INTERPRETERS =
	/^(python[0-9.]*|pypy[0-9.]*|node|nodejs|deno|bun|tsx|ts-node|perl|ruby|irb|php|lua|luajit|rscript|r|java|jshell|groovy|scala|kotlin|elixir|iex|erl|escript|julia|swift|guile|racket|tclsh|wish)$/;
/** Flags that put the program on the command line itself, per interpreter. */
const INLINE_FLAGS: [RegExp, RegExp][] = [
	[/^python|^pypy/, /^-[A-Za-z]*c/],
	[/^node|^bun|^tsx|^ts-node/, /^(-e|-p|-pe|--eval|--print)(=|$)/],
	[/^deno$/, /^(-e|--eval)$/],
	[/^perl$/, /^-[A-Za-z]*[eE]/],
	[/^ruby$|^irb$/, /^-[A-Za-z]*e/],
	[/^php$/, /^-[A-Za-z]*[rBRFEa]/],
	[/^lua|^luajit$|^rscript$/, /^(-e|--expr)/],
	[/^(r|julia|elixir|iex|erl|swift|guile|racket)$/, /^(-e|-eval|--eval|-c)$/],
];
const VERSION_FLAGS = new Set([
	"--version",
	"-v",
	"-V",
	"--help",
	"-h",
	"-version",
]);

function judgeInterpreter(cmd: Simple): string | null {
	const { name, args } = cmd;
	if (ALWAYS_SECOND.has(name)) return WHY.secondInterpreter;
	if (name === "eval") return WHY.secondInterpreter;
	if (name === "source" || name === ".")
		return args.length ? WHY.program : null;
	const shell = SHELLS.has(name);
	if (!shell && !INTERPRETERS.test(name)) return null;
	if (shell) {
		if (args.some((a) => /^-[A-Za-z]*c/.test(a.text) || a.text === "--command"))
			return WHY.secondInterpreter;
	} else {
		const inline = INLINE_FLAGS.find(([n]) => n.test(name))?.[1];
		if (inline && args.some((a) => isFlag(a) && inline.test(a.text)))
			return WHY.secondInterpreter;
		if (name === "deno" && args[0]?.text === "eval")
			return WHY.secondInterpreter;
	}
	if (args.some((a) => !isFlag(a))) return WHY.program;
	if (args.length && args.every((a) => VERSION_FLAGS.has(a.text))) return null;
	// No program named: it reads one from stdin.
	return WHY.secondInterpreter;
}

// --- test runners (allowed from Edit the copy up) ----------------------------

const TEST_BINARIES = new Set([
	"pytest",
	"py.test",
	"jest",
	"vitest",
	"mocha",
	"rspec",
	"phpunit",
	"tox",
	"nox",
	"ctest",
]);
const TEST_SUBCOMMANDS: Record<string, RegExp> = {
	npm: /^(test|t|run test|run-script test)$/,
	pnpm: /^(test|t|run test)$/,
	yarn: /^(test|run test)$/,
	bun: /^test$/,
	go: /^test$/,
	cargo: /^test$/,
	mvn: /^test$/,
	mvnw: /^test$/,
	gradle: /^test$/,
	gradlew: /^test$/,
	dotnet: /^test$/,
	deno: /^test$/,
	mix: /^test$/,
};

function isTestRunner(cmd: Simple): boolean {
	if (TEST_BINARIES.has(cmd.name)) return true;
	const p = positionals(cmd.args).map((a) => a.text);
	const sub = TEST_SUBCOMMANDS[cmd.name];
	if (sub && (sub.test(p[0] ?? "") || sub.test(p.slice(0, 2).join(" "))))
		return true;
	return (
		/^python[0-9.]*$/.test(cmd.name) &&
		cmd.args[0]?.text === "-m" &&
		/^(pytest|unittest)$/.test(cmd.args[1]?.text ?? "")
	);
}

// --- command spawners (class 5) ----------------------------------------------

const ALWAYS_SPAWN = new Set([
	"xargs",
	"make",
	"gmake",
	"just",
	"sudo",
	"doas",
	"su",
	"pkexec",
	"runuser",
	"chroot",
	"nsenter",
	"unshare",
	"busybox",
	"parallel",
	"watch",
	"script",
	"expect",
	"strace",
	"ltrace",
	"gdb",
	"lldb",
	"tmux",
	"screen",
	"flock",
	"firejail",
	"bwrap",
	"systemd-run",
	"vim",
	"vi",
	"nvim",
	"view",
	"ex",
	"emacs",
	"less",
	"more",
	"most",
	"man",
	"pager",
	"open",
	"xdg-open",
	"start",
	"at",
	"batch",
	"sg",
	"newgrp",
]);
/** Shell builtins that keep a command string for later. */
const DEFERRED_BUILTINS: Record<string, RegExp | null> = {
	trap: null,
	fc: null,
	alias: /=/,
	enable: /^-[a-z]*f/,
	bind: /^-[a-z]*x/,
	hash: /^-[a-z]*p/,
	complete: /^-[A-Z]*[CF]/,
	compgen: /^-[A-Z]*[CF]/,
	mapfile: /^-[a-z]*C/i,
	readarray: /^-[a-z]*C/i,
};
const WRAPPERS = new Set([
	"env",
	"nice",
	"nohup",
	"timeout",
	"setsid",
	"stdbuf",
	"unbuffer",
	"ionice",
	"taskset",
	"chrt",
	"caffeinate",
]);

/** A sed script's commands that run a program or write a file: `e`, `w`, `W`, or `s///e|w`. */
function sedSpawns(script: string): boolean {
	for (const part of script.split(/[;\n{}]/)) {
		const body = part
			.trim()
			.replace(
				/^(\d+|\$|\/(?:[^/\\]|\\.)*\/)(\s*[,~+]\s*(\d+|\$|\/(?:[^/\\]|\\.)*\/))?\s*!?\s*/,
				"",
			);
		if (/^[ewW](\s|$)/.test(body)) return true;
		const s = /^s(.)/.exec(body);
		if (s) {
			// Past the replacement's closing delimiter come the flags: `e` runs, `w` writes.
			let n = 0;
			let j = 2;
			for (; j < body.length && n < 2; j++) {
				if (body[j] === "\\") j++;
				else if (body[j] === s[1]) n++;
			}
			if (/^[^\s]*[ewW]/.test(body.slice(j))) return true;
		}
	}
	return false;
}

function judgeSpawner(cmd: Simple): string | null {
	const { name, args } = cmd;
	if (ALWAYS_SPAWN.has(name)) return WHY.spawn;
	if (name in DEFERRED_BUILTINS) {
		const marker = DEFERRED_BUILTINS[name];
		if (
			marker === null ? args.length > 0 : args.some((a) => marker.test(a.text))
		)
			return WHY.spawn;
		return null;
	}
	if (
		name === "tar" &&
		args.some((a) =>
			/^(--to-command|--use-compress-program|-I|--checkpoint-action|--info-script|--new-volume-script|-F|--rsh-command|--rmt-command)/.test(
				a.text,
			),
		)
	)
		return WHY.spawn;
	if (
		name === "sort" &&
		args.some((a) => a.text.startsWith("--compress-program"))
	)
		return WHY.spawn;
	if (name === "split" && args.some((a) => a.text.startsWith("--filter")))
		return WHY.spawn;
	if (name === "zip" && args.some((a) => /^(-TT|--unzip-command)/.test(a.text)))
		return WHY.spawn;
	if (name === "kubectl" && args.some((a) => a.text.startsWith("--kubeconfig")))
		return WHY.spawn;
	if (name === "docker" && args.some((a) => /^--config(=|$)/.test(a.text)))
		return WHY.spawn;
	if (WRAPPERS.has(name)) {
		const rest = args.filter(
			(a) => !isFlag(a) && !(name === "env" && ASSIGNMENT.test(a.text)),
		);
		if (rest.length || args.some((a) => /^(-S|--split-string)/.test(a.text)))
			return WHY.spawn;
		return null;
	}
	if (name === "find") {
		if (args.some((a) => /^-(exec|execdir|ok|okdir|delete)$/.test(a.text)))
			return WHY.spawn;
		return null;
	}
	if (/^(awk|gawk|mawk|nawk)$/.test(name)) {
		if (args.some((a) => /^(-f|--file|-E|--exec)/.test(a.text)))
			return WHY.spawn;
		const program = positionals(args)[0];
		if (!program || program.dynamic) return program ? WHY.spawn : null;
		if (
			/system\s*\(|\||getline|@load|\b(print|printf)\b[^;}]*>/.test(
				program.text,
			)
		)
			return WHY.spawn;
		return null;
	}
	if (name === "sed") {
		const scripts: string[] = [];
		let explicit = false;
		for (let j = 0; j < args.length; j++) {
			const t = args[j].text;
			if (/^(-f|--file)/.test(t)) return WHY.spawn;
			if (t === "-e" || t === "--expression") {
				explicit = true;
				scripts.push(args[j + 1]?.text ?? "");
				j++;
			} else if (t.startsWith("--expression=")) {
				explicit = true;
				scripts.push(t.slice(13));
			} else if (/^-[A-Za-z]*e$/.test(t) && t !== "-e") {
				explicit = true;
				scripts.push(args[j + 1]?.text ?? "");
				j++;
			}
		}
		if (!explicit) {
			const first = positionals(args)[0];
			if (first) scripts.push(first.text);
		}
		return scripts.some(sedSpawns) ? WHY.spawn : null;
	}
	if (name === "git") {
		if (args.some((a) => /^(-c|--config-env|--exec-path)(=|$)/.test(a.text)))
			return WHY.spawn;
		const sub = gitSubcommand(args);
		if (
			/^(difftool|mergetool|filter-branch|filter-repo)$/.test(sub?.text ?? "")
		)
			return WHY.spawn;
		if (sub?.text === "bisect" && args.some((a) => a.text === "run"))
			return WHY.spawn;
		if (sub?.text === "rebase" && args.some((a) => /^(-x|--exec)/.test(a.text)))
			return WHY.spawn;
		if (
			sub?.text === "grep" &&
			args.some((a) => /^(-O|--open-files-in-pager)/.test(a.text))
		)
			return WHY.spawn;
		if (/^credential/.test(sub?.text ?? "")) return WHY.spawn;
		return null;
	}
	if (name === "go" && positionals(args)[0]?.text === "generate")
		return WHY.spawn;
	return null;
}

/** git's subcommand word, past `-C <dir>` and the other global options. */
function gitSubcommand(args: Word[]): Word | undefined {
	for (let j = 0; j < args.length; j++) {
		const t = args[j].text;
		if (
			t === "-C" ||
			t === "-c" ||
			t === "--git-dir" ||
			t === "--work-tree" ||
			t === "--namespace"
		) {
			j++;
			continue;
		}
		if (isFlag(args[j])) continue;
		return args[j];
	}
	return undefined;
}

// --- downloaders and executors (class 6), installers (R4.1) ------------------

const ALWAYS_DOWNLOAD = new Set(["npx", "pnpx", "bunx", "uvx", "pipx"]);
const DOWNLOAD_SUBCOMMANDS: Record<string, RegExp> = {
	pnpm: /^(dlx|exec)$/,
	npm: /^(exec|x)$/,
	yarn: /^dlx$/,
	bun: /^x$/,
	cargo: /^(run|install)$/,
	go: /^(run|install|get)$/,
	deno: /^(run|install|compile)$/,
	uv: /^(run|tool)$/,
	poetry: /^run$/,
	pipenv: /^run$/,
	git: /^(clone|ls-remote|submodule|lfs|fetch|pull|push|remote)$/,
};
/** Package-script and build runners: the copy's own code runs. */
const PROGRAM_SUBCOMMANDS: Record<string, RegExp> = {
	npm: /^(run|run-script|start|restart|stop)$/,
	pnpm: /^(run|start)$/,
	bun: /^(run|start)$/,
	deno: /^task$/,
	cargo: /^(build|check|clippy|bench)$/,
};
const INSTALLERS = new Set([
	"apt",
	"apt-get",
	"aptitude",
	"dpkg",
	"yum",
	"dnf",
	"rpm",
	"apk",
	"zypper",
	"pacman",
	"snap",
	"flatpak",
	"brew",
	"port",
	"nix-env",
	"choco",
	"winget",
	"scoop",
	"yarn",
]);
const INSTALL_SUBCOMMANDS: Record<string, RegExp> = {
	npm: /^(install|i|ci|add|uninstall|un|rm|remove|update|up|link|publish|unpublish|deprecate)$/,
	pnpm: /^(install|i|add|remove|rm|up|update|publish|link|unlink|setup)$/,
	bun: /^(install|i|add|remove|rm|update|link|publish|pm)$/,
	pip: /^(install|uninstall|download)$/,
	pip3: /^(install|uninstall|download)$/,
	uv: /^(pip|add|remove|sync)$/,
	poetry: /^(add|install|remove|update)$/,
	pipenv: /^(install|uninstall|update)$/,
	gem: /^(install|uninstall|update)$/,
	bundle: /^(install|update|add)$/,
	composer: /^(install|require|update|remove)$/,
	cargo: /^(add|remove)$/,
	helm: /^(install|upgrade|uninstall|rollback|delete|push|plugin)$/,
	terraform: /^(apply|destroy|import|taint|untaint|state)$/,
	tofu: /^(apply|destroy|import|taint|untaint|state)$/,
};
const MACHINE = new Set([
	"systemctl",
	"service",
	"launchctl",
	"kill",
	"killall",
	"pkill",
	"shutdown",
	"reboot",
	"halt",
	"poweroff",
	"crontab",
	"mount",
	"umount",
	"iptables",
	"ufw",
	"sysctl",
]);

function judgeDownloadOrInstall(cmd: Simple): string | null {
	const { name, args } = cmd;
	if (ALWAYS_DOWNLOAD.has(name)) return WHY.download;
	const sub =
		(name === "git" ? gitSubcommand(args) : positionals(args)[0])?.text ?? "";
	if (DOWNLOAD_SUBCOMMANDS[name]?.test(sub)) return WHY.download;
	if (
		name === "git" &&
		sub === "archive" &&
		args.some((a) => a.text.startsWith("--remote"))
	)
		return WHY.download;
	if (MACHINE.has(name) || INSTALLERS.has(name)) return WHY.mutate;
	if (INSTALL_SUBCOMMANDS[name]?.test(sub)) return WHY.mutate;
	if (PROGRAM_SUBCOMMANDS[name]?.test(sub)) return WHY.program;
	return null;
}

// --- network clients without a URL (class 3, R4.1) ---------------------------

const NETWORK_CLIENTS = new Set([
	"ssh",
	"scp",
	"sftp",
	"rsync",
	"nc",
	"ncat",
	"netcat",
	"telnet",
	"psql",
	"mysql",
	"mariadb",
	"redis-cli",
	"mongosh",
	"mongo",
	"sqlcmd",
	"cqlsh",
	"dig",
	"nslookup",
	"host",
	"drill",
	"resolvectl",
	"getent",
	"ping",
	"ping6",
	"traceroute",
	"traceroute6",
	"tracepath",
	"mtr",
	"socat",
	"ftp",
	"tftp",
	"lftp",
	"nmap",
	"whois",
	"arping",
	// HTTP clients other than curl and wget: not parsed here, so not allowed.
	"http",
	"https",
	"xh",
	"xhs",
	"httpie",
	"curlie",
	"aria2c",
	"axel",
	"lynx",
	"w3m",
	"links",
	"elinks",
	// Cloud and cluster CLIs outside the read-verb table: each reaches its API.
	"helm",
	"terraform",
	"tofu",
	"pulumi",
	"gsutil",
	"bq",
	"eksctl",
	"doctl",
	"flyctl",
	"fly",
	"heroku",
	"vercel",
	"netlify",
	"firebase",
	"wrangler",
	"oc",
	"argocd",
	"vault",
	"consul",
	"nomad",
	"s3cmd",
	"rclone",
	"istioctl",
	"linkerd",
	"kubectx",
	"kubens",
	"k9s",
	"stern",
	"skaffold",
	"tilt",
	"minikube",
	"kind",
	"k3d",
	"aws-vault",
	"sam",
	"cdk",
	"serverless",
	"sls",
	"ansible",
	"ansible-playbook",
	"podman",
	"nerdctl",
]);

/** Package-manager subcommands that ask a registry. */
const REGISTRY_SUBCOMMANDS: Record<string, RegExp> = {
	npm: /^(view|v|info|show|search|s|audit|outdated|ping|whoami|login|logout|adduser|token|owner|access|dist-tag|star|unstar|stars|doctor|repo|docs|bugs|home|fund)$/,
	pnpm: /^(view|info|show|search|audit|outdated|ping|whoami|login|logout|adduser|dist-tag|doctor|repo|docs|bugs|home)$/,
	yarn: /^(info|npm|audit|outdated|login|logout)$/,
	bun: /^(outdated|pm)$/,
	pip: /^(index|search)$/,
	pip3: /^(index|search)$/,
	go: /^mod$/,
	cargo: /^(search|fetch|update|login|publish|yank|owner)$/,
	gem: /^(search|fetch|query|list --remote|owner|push)$/,
};

function judgeNetworkClient(cmd: Simple): string | null {
	if (NETWORK_CLIENTS.has(cmd.name)) return WHY.network;
	if (
		REGISTRY_SUBCOMMANDS[cmd.name]?.test(positionals(cmd.args)[0]?.text ?? "")
	)
		return WHY.network;
	if (
		cmd.name === "openssl" &&
		/^(s_client|s_server|s_time|ocsp)$/.test(
			positionals(cmd.args)[0]?.text ?? "",
		)
	)
		return WHY.network;
	return null;
}

// --- the signed-in CLIs' read verbs (Read-only with your tools) --------------

const TOOL_VALUE_FLAGS: Record<string, Set<string>> = {
	kubectl: new Set([
		"-n",
		"--namespace",
		"--context",
		"--cluster",
		"--user",
		"-s",
		"--server",
		"--kubeconfig",
		"--token",
		"--as",
		"--as-group",
		"--as-uid",
		"--cache-dir",
		"--certificate-authority",
		"--client-certificate",
		"--client-key",
		"--request-timeout",
		"--tls-server-name",
		"-v",
		"--v",
		"--vmodule",
		"--log-file",
		"--log-dir",
		"--profile",
		"--profile-output",
		"--username",
		"--password",
		"--log-flush-frequency",
	]),
	docker: new Set([
		"-H",
		"--host",
		"--context",
		"-c",
		"--config",
		"--log-level",
		"-l",
		"--tlscacert",
		"--tlscert",
		"--tlskey",
	]),
	aws: new Set([
		"--region",
		"--profile",
		"--output",
		"--endpoint-url",
		"--query",
		"--cli-read-timeout",
		"--cli-connect-timeout",
		"--color",
		"--ca-bundle",
		"--cli-binary-format",
	]),
	gcloud: new Set([
		"--project",
		"--account",
		"--configuration",
		"--format",
		"--verbosity",
		"--impersonate-service-account",
		"--billing-project",
		"--filter",
		"--limit",
		"--page-size",
		"--sort-by",
		"--zone",
		"--region",
	]),
	az: new Set([
		"--subscription",
		"--output",
		"-o",
		"--query",
		"-g",
		"--resource-group",
		"-n",
		"--name",
	]),
	gh: new Set([
		"-R",
		"--repo",
		"--hostname",
		"-L",
		"--limit",
		"-s",
		"--state",
		"--json",
		"-q",
		"--jq",
		"-t",
		"--template",
	]),
};
const TOOL_BOOL_FLAGS = new Set([
	"--insecure-skip-tls-verify",
	"--match-server-version",
	"--warnings-as-errors",
	"--disable-compression",
	"-D",
	"--debug",
	"--tls",
	"--tlsverify",
	"--no-cli-pager",
	"--no-paginate",
	"--no-verify-ssl",
	"--quiet",
	"-q",
	"--verbose",
	"--all-namespaces",
	"-A",
]);
const GH_GROUPS = new Set([
	"pr",
	"issue",
	"run",
	"repo",
	"release",
	"workflow",
	"gist",
	"cache",
	"secret",
	"variable",
	"label",
	"project",
	"ruleset",
	"search",
	"codespace",
	"org",
	"ssh-key",
	"gpg-key",
	"auth",
	"config",
	"extension",
	"alias",
	"attestation",
]);
const CLOUD_VERBISH =
	/^(describe|list|show|create|delete|update|patch|set|add|remove|start|stop|restart|reset|resize|ssh|scp|deploy|import|export|move|rm|cp|run|exec|submit|cancel|suspend|resume|rollback|promote|approve|abandon|copy|rename|restore|backup|clone|failover|upgrade|enable|disable|activate|revoke|login|logout|connect|attach|detach|apply|invoke|call|publish|purge|seek|ack|pull|push|send|write|put|post|tag|untag|sign|encrypt|decrypt|generate|configure|init|install|uninstall|kill|reboot|redeploy|swap|scale|sync|upload|download|mount|unmount|lock|unlock|archive|unarchive|release|reserve|transfer|grant|regenerate|renew|rotate|reinstall|reimage|repair|wait|interactive|tunnel|port-forward|proxy|open|browse|get|print)(-|$)/;

/** `kubectl get`, `aws ec2 describe-x`, …: what the tool would do, or why it cannot be read. */
function toolVerb(cmd: Simple): { what: string; read: boolean } | null {
	const { name, args } = cmd;
	const values = TOOL_VALUE_FLAGS[name];
	if (!values) return null;
	const words: string[] = [];
	for (let j = 0; j < args.length; j++) {
		const a = args[j];
		if (a.dynamic) return { what: `${name} ${a.text}`, read: false };
		if (!isFlag(a)) {
			words.push(a.text);
			continue;
		}
		if (a.text.includes("=") && a.text.startsWith("--")) continue;
		if (values.has(a.text)) {
			j++;
			continue;
		}
		if (/^--flags-file/.test(a.text))
			return { what: `${name} ${a.text}`, read: false };
		// An unknown flag before the verb may have swallowed it; refuse rather than guess.
		if (
			!words.length &&
			!TOOL_BOOL_FLAGS.has(a.text) &&
			(name === "kubectl" || name === "docker")
		)
			return { what: `${name} ${a.text}`, read: false };
	}
	const say = (n: number) => [name, ...words.slice(0, n)].join(" ");
	switch (name) {
		case "kubectl":
			return {
				what: say(1),
				read: /^(get|describe|logs|top|explain)$/.test(words[0] ?? ""),
			};
		case "docker":
			return { what: say(1), read: /^(ps|logs|inspect)$/.test(words[0] ?? "") };
		case "aws": {
			const op = words[1] ?? "";
			return {
				what: say(2),
				read: /^(describe|get|list)-/.test(op) && !/^get-object/.test(op),
			};
		}
		case "gh": {
			if (!GH_GROUPS.has(words[0] ?? ""))
				return { what: say(1), read: words[0] === "status" };
			return {
				what: say(2),
				read:
					words[0] !== "auth" && /^(view|list|status)$/.test(words[1] ?? ""),
			};
		}
		default: {
			const k = words.findIndex((w) => CLOUD_VERBISH.test(w));
			if (k < 0) return { what: say(Math.min(words.length, 3)), read: false };
			const readVerb =
				name === "gcloud" ? /^(describe|list)$/ : /^(show|list)$/;
			return { what: say(k + 1), read: readVerb.test(words[k]) };
		}
	}
}

function judgeTool(cmd: Simple, level: PermissionMode): string | null {
	const verb = toolVerb(cmd);
	if (!verb) return null;
	if (!verb.read) return WHY.notReadVerb(verb.what);
	return level === "read-only" ? WHY.notAtReadOnly(verb.what) : null;
}

// --- curl and wget (the brief's own clients) ----------------------------------

const CURL_SHORT_VALUE = "AbcCdDeEFHKmoPQrtTuUwxXyYz";
const CURL_LONG_VALUE = new Set([
	"data",
	"data-ascii",
	"data-binary",
	"data-raw",
	"data-urlencode",
	"form",
	"form-string",
	"json",
	"upload-file",
	"request",
	"url",
	"output",
	"output-dir",
	"dump-header",
	"cookie",
	"cookie-jar",
	"header",
	"user",
	"user-agent",
	"referer",
	"proxy",
	"preproxy",
	"proxy-user",
	"socks4",
	"socks4a",
	"socks5",
	"socks5-hostname",
	"resolve",
	"connect-to",
	"dns-servers",
	"dns-interface",
	"dns-ipv4-addr",
	"dns-ipv6-addr",
	"doh-url",
	"interface",
	"unix-socket",
	"abstract-unix-socket",
	"config",
	"netrc-file",
	"proto",
	"proto-default",
	"proto-redir",
	"variable",
	"max-time",
	"connect-timeout",
	"retry",
	"retry-delay",
	"retry-max-time",
	"write-out",
	"range",
	"cert",
	"key",
	"cacert",
	"capath",
	"ciphers",
	"trace",
	"trace-ascii",
	"stderr",
	"libcurl",
	"etag-save",
	"etag-compare",
	"hsts",
	"alt-svc",
	"limit-rate",
	"max-filesize",
	"oauth2-bearer",
	"aws-sigv4",
	"url-query",
	"local-port",
	"max-redirs",
]);
const CURL_DATA =
	/^(data|data-ascii|data-binary|data-raw|data-urlencode|json)$/;
const CURL_ALWAYS_BODY = /^(form|form-string|upload-file)$/;
const CURL_ROUTING =
	/^(proxy.*|preproxy|socks.*|resolve|connect-to|dns-.*|doh-url|interface|unix-socket|abstract-unix-socket|config|netrc.*|proto.*|variable|expand-.*|haproxy-.*|ipfs-gateway|local-port)$/;
const CURL_OUTPUT =
	/^(output|remote-name|remote-name-all|output-dir|create-dirs|dump-header|cookie-jar|trace|trace-ascii|stderr|libcurl|etag-save|hsts|alt-svc)$/;
/** An output that is not a file: stdout, stderr or nothing. */
const NOT_A_FILE = new Set([
	"-",
	"/dev/null",
	"/dev/stdout",
	"/dev/stderr",
	"%",
]);

const WGET_SHORT_VALUE = "aABDeiIloOPQRtTUwXY";
const WGET_LONG_VALUE = new Set([
	"output-document",
	"output-file",
	"append-output",
	"directory-prefix",
	"execute",
	"input-file",
	"config",
	"post-data",
	"post-file",
	"body-data",
	"body-file",
	"method",
	"header",
	"user",
	"password",
	"user-agent",
	"referer",
	"tries",
	"timeout",
	"wait",
	"save-cookies",
	"load-cookies",
	"use-askpass",
	"base",
	"level",
	"accept",
	"reject",
	"domains",
	"exclude-domains",
	"bind-address",
	"warc-file",
	"rejected-log",
]);

/**
 * curl and wget (getopt) take any unambiguous prefix of a long option, and an
 * ambiguous one may still be read differently by another version: a prefix of
 * any option this policy names is read as the most dangerous it could be.
 */
function resolveLong(
	name: string,
	known: readonly string[],
	danger: (n: string) => boolean,
): string {
	if (known.includes(name)) return name;
	const candidates = known.filter((k) => k.startsWith(name));
	return (
		candidates.find(danger) ?? (candidates.length === 1 ? candidates[0] : name)
	);
}

const CURL_NAMED = [
	...CURL_LONG_VALUE,
	"get",
	"netrc",
	"netrc-optional",
	"remote-name",
	"remote-name-all",
	"create-dirs",
	"expand-url",
	"expand-data",
	"haproxy-protocol",
	"ipfs-gateway",
];
const curlDanger = (n: string): boolean =>
	CURL_DATA.test(n) ||
	CURL_ALWAYS_BODY.test(n) ||
	CURL_ROUTING.test(n) ||
	CURL_OUTPUT.test(n) ||
	n === "request" ||
	n === "url";
const WGET_NAMED = [
	...WGET_LONG_VALUE,
	"recursive",
	"mirror",
	"page-requisites",
	"span-hosts",
	"force-directories",
];
const wgetDanger = (n: string): boolean =>
	/^(post-data|post-file|body-data|body-file|method|execute|input-file|config|use-askpass|base|recursive|mirror|page-requisites|span-hosts|bind-address|output-document|output-file|append-output|directory-prefix|save-cookies|warc-file|rejected-log|force-directories)$/.test(
		n,
	);

interface Request {
	urls: Word[];
	get: boolean;
	body: boolean;
	method: string | null;
	routing: boolean;
	output: boolean;
	dataPaths: string[];
}

/** A curl argument list read as curl reads it: bundles, attached values, `--opt=value`. */
function readCurl(args: Word[]): Request {
	const r: Request = {
		urls: [],
		get: false,
		body: false,
		method: null,
		routing: false,
		output: false,
		dataPaths: [],
	};
	const long = (opt: string, value: Word | undefined) => {
		const v = value?.text ?? "";
		if (opt === "get") r.get = true;
		// These read a file named after `@` and send or print it (#778).
		else if ((opt === "header" || opt === "write-out") && v.startsWith("@"))
			r.dataPaths.push(v.slice(1));
		else if (opt === "url-query") {
			const at = v.indexOf("@");
			if (at >= 0) r.dataPaths.push(v.slice(at + 1));
		} else if (CURL_DATA.test(opt) || CURL_ALWAYS_BODY.test(opt)) {
			r.body = true;
			if (CURL_ALWAYS_BODY.test(opt)) r.method = r.method ?? "POST";
			const at = v.indexOf("@");
			if (at >= 0) r.dataPaths.push(v.slice(at + 1).replace(/;.*$/, ""));
			if (opt === "upload-file") r.dataPaths.push(v);
		} else if (opt === "request") r.method = v;
		else if (opt === "url" && value) r.urls.push(value);
		else if (CURL_ROUTING.test(opt)) r.routing = true;
		else if (CURL_OUTPUT.test(opt) && !NOT_A_FILE.has(v)) r.output = true;
	};
	const LONG_OF: Record<string, string> = {
		H: "header",
		w: "write-out",
		d: "data",
		F: "form",
		T: "upload-file",
		X: "request",
		x: "proxy",
		o: "output",
		K: "config",
		D: "dump-header",
		c: "cookie-jar",
		G: "get",
		O: "remote-name",
		n: "netrc",
		J: "remote-header-name",
		Q: "quote",
		P: "ftp-port",
	};
	let positional = false;
	for (let j = 0; j < args.length; j++) {
		const a = args[j];
		const t = a.text;
		if (positional || a.dynamic || !t.startsWith("-") || t === "-") {
			r.urls.push(a);
			continue;
		}
		if (t === "--") {
			positional = true;
			continue;
		}
		if (t.startsWith("--")) {
			const eq = t.indexOf("=");
			const opt = resolveLong(
				eq > 0 ? t.slice(2, eq) : t.slice(2),
				CURL_NAMED,
				curlDanger,
			);
			let value: Word | undefined;
			if (eq > 0) value = { text: t.slice(eq + 1), dynamic: a.dynamic };
			else if (CURL_LONG_VALUE.has(opt)) value = args[++j];
			long(opt, value);
			continue;
		}
		for (let k = 1; k < t.length; k++) {
			const ch = t[k];
			if (CURL_SHORT_VALUE.includes(ch)) {
				const rest = t.slice(k + 1);
				const value = rest ? { text: rest, dynamic: false } : args[++j];
				long(LONG_OF[ch] ?? ch, value);
				if (ch === "Q" || ch === "P") r.routing = true;
				break;
			}
			if (ch === "G") r.get = true;
			else if (ch === "O") r.output = true;
			else if (ch === "n") r.routing = true;
		}
	}
	return r;
}

/** wget, the same way: `-qO-` bundles, `--opt=value`, `-e` commands. */
function readWget(args: Word[]): Request {
	const r: Request = {
		urls: [],
		get: true,
		body: false,
		method: null,
		routing: false,
		output: false,
		dataPaths: [],
	};
	const opt = (name: string, value: Word | undefined) => {
		const v = value?.text ?? "";
		if (/^(post-data|post-file|body-data|body-file)$/.test(name)) {
			r.body = true;
			if (/file$/.test(name)) r.dataPaths.push(v);
		} else if (name === "method") r.method = v.toUpperCase();
		else if (
			/^(execute|e|input-file|i|config|use-askpass|base|B|recursive|r|mirror|m|page-requisites|p|span-hosts|H|bind-address|proxy-user|proxy-password)$/.test(
				name,
			)
		)
			r.routing = true;
		else if (/^(output-document|O)$/.test(name) && !NOT_A_FILE.has(v))
			r.output = true;
		else if (
			/^(output-file|o|append-output|a|directory-prefix|P|save-cookies|warc-file|rejected-log|force-directories|x)$/.test(
				name,
			)
		)
			r.output = true;
	};
	for (let j = 0; j < args.length; j++) {
		const a = args[j];
		const t = a.text;
		if (a.dynamic || !t.startsWith("-") || t === "-") {
			r.urls.push(a);
			continue;
		}
		if (t.startsWith("--")) {
			const eq = t.indexOf("=");
			const name = resolveLong(
				eq > 0 ? t.slice(2, eq) : t.slice(2),
				WGET_NAMED,
				wgetDanger,
			);
			let value: Word | undefined;
			if (eq > 0) value = { text: t.slice(eq + 1), dynamic: a.dynamic };
			else if (WGET_LONG_VALUE.has(name)) value = args[++j];
			opt(name, value);
			continue;
		}
		if (/^-n[a-zA-Z]$/.test(t)) continue;
		for (let k = 1; k < t.length; k++) {
			const ch = t[k];
			if (WGET_SHORT_VALUE.includes(ch)) {
				const rest = t.slice(k + 1);
				opt(ch, rest ? { text: rest, dynamic: false } : args[++j]);
				break;
			}
			opt(ch, undefined);
		}
	}
	return r;
}

/** The origin a URL word reaches, or why it cannot be read: curl and wget take a bare host as http. */
function urlOrigin(
	w: Word,
): { origin: string } | { unreadable: string } | { scheme: string } {
	const text = w.text;
	// `file:/etc/x` needs no slashes; a colon before a digit is a port.
	const named = /^([A-Za-z][A-Za-z0-9+.-]*):(?!\d)/.exec(text);
	if (named && !/^https?$/i.test(named[1])) return { scheme: named[1] };
	const scheme = /^https?:\/\//i.test(text);
	const full = scheme ? text : `http://${text}`;
	const authority = full.slice(full.indexOf("//") + 2).split(/[/?#]/)[0];
	if (
		!authority ||
		authority.includes(SUBSTITUTION) ||
		/[$\\@`{}*?]/.test(authority) ||
		authority.indexOf("[") > 0
	)
		return { unreadable: text };
	try {
		const url = new URL(full);
		return { origin: url.origin };
	} catch {
		return { unreadable: text };
	}
}

function judgeUrl(w: Word, ctx: Ctx): string | null {
	const u = urlOrigin(w);
	if ("scheme" in u) return WHY.routing;
	if ("unreadable" in u) {
		if (ctx.level === "read-only") return WHY.host(u.unreadable);
		// Any host is fine above Read-only, but an unreadable word may hide a `file://`.
		return /^https?:\/\//i.test(w.text) ? null : WHY.routing;
	}
	if (ctx.level !== "read-only") return null;
	// A bare host is http to curl and wget, so it matches only an http brief origin (#778).
	return ctx.origins.has(u.origin) ? null : WHY.host(u.origin);
}

function judgeHttpClient(cmd: Simple, ctx: Ctx): string | null {
	if (cmd.name !== "curl" && cmd.name !== "wget") return null;
	const r = cmd.name === "curl" ? readCurl(cmd.args) : readWget(cmd.args);
	if (r.routing) return WHY.routing;
	if (r.output && !atLeast(ctx.level, "workspace-write")) return WHY.routing;
	const method = r.method?.trim() ?? null;
	if (method !== null && method !== "GET" && method !== "HEAD") return WHY.body;
	if (r.body && (cmd.name === "wget" || !r.get || r.method === "POST"))
		return WHY.body;
	for (const p of r.dataPaths) if (p) ctx.extraPaths.push(p);
	for (const u of r.urls) {
		const why = judgeUrl(u, ctx);
		if (why) return why;
	}
	return null;
}

// --- the decision ------------------------------------------------------------

/** Environment a command reads to find its proxy, its config or another program to run. */
const ROUTING_ENV =
	/(^|_)(proxy|PROXY)$|^(CURL_HOME|CURL_CA_BUNDLE|WGETRC|SYSTEM_WGETRC|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE)$/;
const SPAWNING_ENV =
	/^(LD_[A-Z_]+|DYLD_[A-Z_]+|HOME|XDG_[A-Z_]+|PATH|BASH_ENV|ENV|PROMPT_COMMAND|SHELLOPTS|BASHOPTS|PS4|IFS|NODE_OPTIONS|NODE_PATH|PYTHON[A-Z_]*|PERL5[A-Z_]*|PERLLIB|RUBY[A-Z_]*|GIT_[A-Z_]+|PAGER|MANPAGER|EDITOR|VISUAL|LESSOPEN|LESSCLOSE|SSH_[A-Z_]+|KUBECONFIG|AWS_[A-Z_]+|CLOUDSDK_[A-Z_]+|AZURE_[A-Z_]+|GH_[A-Z_]+|GITHUB_[A-Z_]+|DOCKER_[A-Z_]+|TMPDIR|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|MAVEN_OPTS|GRADLE_OPTS|npm_config_[A-Za-z_]+|NPM_CONFIG_[A-Z_]+|PIP_[A-Z_]+|PNPM_[A-Z_]+|YARN_[A-Z_]+|BUN_[A-Z_]+|GOFLAGS|GOPROXY|CARGO_[A-Z_]+|RUSTC_WRAPPER|RUSTFLAGS)$/;
const DECLARERS = new Set([
	"export",
	"declare",
	"typeset",
	"local",
	"readonly",
]);

function judgeEnvironment(names: string[]): string | null {
	for (const n of names) {
		if (ROUTING_ENV.test(n)) return WHY.routing;
		if (SPAWNING_ENV.test(n)) return WHY.spawn;
	}
	return null;
}

/** A redirection that writes a file: `>`, `>>`, `&>`, `<>`, not a dup onto another descriptor or /dev/null. */
function redirectWrites(words: Word[]): boolean {
	for (let j = 0; j < words.length; j++) {
		const op = words[j];
		if (!op.redirect || !op.text.includes(">")) continue;
		const target = words[j + 1]?.text ?? "";
		if (op.text.endsWith("&") && /^(\d+|-)$/.test(target)) continue;
		if (!NOT_A_FILE.has(target)) return true;
	}
	return false;
}

const COMPILERS = new Set([
	"gcc",
	"g++",
	"cc",
	"c++",
	"clang",
	"clang++",
	"rustc",
	"javac",
	"swiftc",
	"ghc",
	"tsc",
	"ld",
]);

/** Writes a parsed command makes that the text rule cannot see: compilers, `git config`, `go build`. */
function judgeWrites(cmd: Simple, level: PermissionMode): string | null {
	const { name, args } = cmd;
	const below = !atLeast(level, "workspace-write");
	if (COMPILERS.has(name))
		return below && !args.some((a) => /^--noEmit/.test(a.text))
			? WHY.mutate
			: null;
	if (name === "go" && positionals(args)[0]?.text === "build")
		return below ? WHY.mutate : null;
	if (name === "git" && gitSubcommand(args)?.text === "config") {
		const after = args.slice(args.findIndex((a) => a.text === "config") + 1);
		const scoped = after.some((a) =>
			/^(--global|--system|--file|-f|--worktree)(=|$)/.test(a.text),
		);
		const write =
			after.some((a) =>
				/^(--add|--unset|--unset-all|--replace-all|--rename-section|--remove-section|-e|--edit)$/.test(
					a.text,
				),
			) ||
			/^(set|unset|edit|rename-section|remove-section)$/.test(
				positionals(after)[0]?.text ?? "",
			) ||
			(positionals(after).length >= 2 &&
				!after.some((a) =>
					/^(--get|--get-all|--get-regexp|--list|-l)$/.test(a.text),
				));
		if (write && (scoped || below)) return WHY.mutate;
	}
	if (/^(tar|bsdtar)$/.test(name)) {
		const mode = args[0]?.text ?? "";
		if (
			below &&
			(/^-?[A-Za-z]*[xcru]/.test(mode) ||
				args.some((a) =>
					/^--(extract|create|append|update|delete|get)$/.test(a.text),
				))
		)
			return WHY.mutate;
	}
	if (
		name === "sort" &&
		below &&
		args.some((a) => /^(-o|--output)/.test(a.text))
	)
		return WHY.mutate;
	if (
		name === "unzip" &&
		below &&
		!args.some((a) => /^-[a-zA-Z]*[ltpvZ]/.test(a.text))
	)
		return WHY.mutate;
	return null;
}

/**
 * The text rules applied to the command as the shell runs it, quotes and
 * escapes removed, so `to"uch"` or `r\m` is still touch or rm (#776 review).
 * Only a match at the command word counts; `grep rm` is a read.
 */
function judgeWriteVerb(cmd: Simple, level: PermissionMode): string | null {
	const line = [cmd.name, ...cmd.args.map((a) => a.text)].join(" ");
	if (MACHINE_WRITES.exec(line)?.index === 0) return WHY.mutate;
	if (!atLeast(level, "workspace-write") && FILE_WRITES.exec(line)?.index === 0)
		return WHY.mutate;
	return null;
}

function judgeExecute(
	command: string,
	ctx: Ctx,
	cwd: string | undefined,
): string | null {
	const commands = parseShell(command);
	const words = commands.flat();
	for (const w of words) {
		if (!w.redirect && CREDENTIAL_PATH.test(w.text))
			return WHY.credential(w.text);
	}
	if (cwd) {
		const hidden = credentialByGlob(command, cwd);
		if (hidden) return WHY.credential(hidden);
	}
	for (const ws of commands) {
		const env = judgeEnvironment(assignmentsOf(ws));
		if (env) return env;
		if (!atLeast(ctx.level, "workspace-write") && redirectWrites(ws))
			return WHY.mutate;
		const cmd = simpleCommand(ws);
		if (!cmd) continue;
		if (
			cmd.program.dynamic ||
			(cmd.program.expands && !/^\[\[?$/.test(cmd.program.text))
		)
			return WHY.secondInterpreter;
		if (DECLARERS.has(cmd.name)) {
			const declared = judgeEnvironment(
				assignmentsOf(cmd.args.filter((a) => !isFlag(a))),
			);
			if (declared) return declared;
			continue;
		}
		if (isTestRunner(cmd)) {
			if (!atLeast(ctx.level, "workspace-write")) return WHY.program;
			continue;
		}
		const why =
			judgeDownloadOrInstall(cmd) ??
			judgeInterpreter(cmd) ??
			judgeSpawner(cmd) ??
			judgeNetworkClient(cmd) ??
			judgeTool(cmd, ctx.level) ??
			judgeHttpClient(cmd, ctx) ??
			judgeWrites(cmd, ctx.level) ??
			judgeWriteVerb(cmd, ctx.level);
		if (why) return why;
		const url = cmd.args.findIndex(
			(a) => a.text === "--url" || a.text.startsWith("--url="),
		);
		if (url >= 0 && cmd.name !== "curl" && ctx.level === "read-only") {
			const a = cmd.args[url];
			const v = a.text.startsWith("--url=")
				? { text: a.text.slice(6), dynamic: a.dynamic }
				: cmd.args[url + 1];
			const w = v ? judgeUrl(v, ctx) : null;
			if (w) return w;
		}
	}
	const marked = markLiterals(command);
	if (MACHINE_WRITES.test(marked)) return WHY.mutate;
	if (!atLeast(ctx.level, "workspace-write") && FILE_WRITES.test(marked))
		return WHY.mutate;
	if (ctx.level === "read-only") {
		for (const w of words) {
			for (const m of w.text.matchAll(/https?:\/\/[^\s'"]+/gi)) {
				const why = judgeUrl({ text: m[0], dynamic: w.dynamic }, ctx);
				if (why) return why;
			}
		}
	}
	return null;
}

/** A glob in the command that the shell would expand to a credential path inside the snapshot. */
function credentialByGlob(text: string, cwd: string): string | null {
	for (const marked of markLiterals(text).split(SHELL_SPLIT)) {
		if (!marked || !/[*?[{]/.test(marked)) continue;
		const paths = expandWord(marked, cwd);
		const hit = paths?.find((p) => CREDENTIAL_PATH.test(p.path));
		if (hit) return hit.path;
	}
	return null;
}

export interface ReadOnlyPolicyOptions {
	/** The snapshot the run works in; paths outside it are refused. Absent means no path rule. */
	cwd?: string;
	/** The run's access level (r4 R4.1); Read-only when absent. */
	level?: PermissionMode;
	/** The brief's telemetry origins (`telemetryOrigins`); a bare `host[:port]` means http. The only addresses Read-only reaches. */
	allowedOrigins?: readonly string[];
}

export function readOnlyPolicyFor(
	options: ReadOnlyPolicyOptions = {},
): PermissionPolicy {
	const origins = new Set<string>();
	for (const entry of options.allowedOrigins ?? []) {
		try {
			const url = new URL(
				/^https?:\/\//i.test(entry) ? entry : `http://${entry}`,
			);
			origins.add(url.origin);
		} catch {
			// not an address
		}
	}
	const level = options.level ?? "read-only";
	return (req) => decide(req, options.cwd, { level, origins, extraPaths: [] });
}

export const readOnlyPolicy: PermissionPolicy = readOnlyPolicyFor();

function decide(
	req: PermissionRequest,
	cwd: string | undefined,
	ctx: Ctx,
): PermissionDecision {
	const kind = req.toolCall?.kind ?? "";
	const command = commandOf(req);
	const allow = pick(req.options, "allow") ?? req.options[0];
	if (ctx.level === "full-access") {
		if (!allow) return { allow: false, why: "harness offered no allow option" };
		return {
			allow: true,
			optionId: allow.optionId,
			warn: `full access: allowed tool kind "${kind || "(none)"}": ${req.toolCall?.title ?? command}`,
		};
	}
	const why = judge(req, kind, command, cwd, { ...ctx, extraPaths: [] });
	if (why) {
		const reject = pick(req.options, "reject");
		return {
			allow: false,
			why,
			...(reject ? { optionId: reject.optionId } : {}),
		};
	}
	if (!allow) return { allow: false, why: "harness offered no allow option" };
	if (NAMED_KINDS.has(kind) || MUTATING_KINDS.has(kind))
		return { allow: true, optionId: allow.optionId };
	return {
		allow: true,
		optionId: allow.optionId,
		warn: `allowed tool kind "${kind || "(none)"}", which the policy does not name: ${req.toolCall?.title ?? command}`,
	};
}

function judge(
	req: PermissionRequest,
	kind: string,
	command: string,
	cwd: string | undefined,
	ctx: Ctx,
): string | null {
	if (NETWORK_KINDS.has(kind)) return `tool kind "${kind}" reaches the network`;
	for (const p of pathParamsOf(req)) {
		if (CREDENTIAL_PATH.test(p)) return WHY.credential(p);
	}
	if (MUTATING_KINDS.has(kind)) {
		if (!atLeast(ctx.level, "workspace-write"))
			return `tool kind "${kind}" is a write`;
		const targets = writeTargetsOf(req);
		if (!cwd || targets.length === 0)
			return `tool kind "${kind}" names no path inside the snapshot`;
		for (const t of targets) {
			if (CREDENTIAL_PATH.test(t)) return WHY.credential(t);
			if (t.startsWith("~") || !insideSnapshot(t, cwd))
				return `writes outside the snapshot: ${t}`;
		}
	}
	if (kind === "execute" || !kind) {
		const why = judgeExecute(command, ctx, cwd);
		if (why) return why;
		if (cwd) {
			for (const p of ctx.extraPaths) {
				if (wordOutside(p, cwd)) return `reads outside the snapshot: ${p}`;
			}
		}
	}
	const outside = outsideSnapshot(req, cwd);
	return outside ? `reads outside the snapshot: ${outside}` : null;
}
