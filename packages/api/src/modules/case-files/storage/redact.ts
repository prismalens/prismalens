// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Redaction of host-owned captures (R2): a structural pass over the workload
 * JSON, then a secretlint text pass over everything. Fails closed: on any
 * error no redacted copy exists.
 */
import { Worker } from "node:worker_threads";
import type { ArtifactPurpose } from "@prismalens/contracts";
import { lintSource } from "@secretlint/core";
import { creator as patternRule } from "@secretlint/secretlint-rule-pattern";
import { rules as recommendRules } from "@secretlint/secretlint-rule-preset-recommend";

export type RedactConfig = Parameters<
	typeof lintSource
>[0]["options"]["config"];
export type RedactCounts = Record<string, number>;
export type RedactResult =
	| { redacted: Buffer; counts: RedactCounts }
	| { error: string };
export type RedactTextResult =
	| { text: string; counts: RedactCounts }
	| { error: string };

const RULE_PREFIX = "@secretlint/secretlint-rule-";
const ENV_MARK = "[REDACTED:env]";
const ARGV_MARK = "[REDACTED:argv]";
const HEADER_MARK = "[REDACTED:header]";
const ARGV_KEYS: ReadonlySet<string> = new Set(["command", "args"]);
const DIAGNOSTIC_WITHHELD = "[diagnostic withheld: redaction failed]";
const DIAGNOSTIC_CAP = 4096;

/** Per artifact; past it the artifact is withheld, never stored unredacted (#842). */
export const REDACT_DEADLINE_MS = 15_000;
// Sources run under Node's type stripping, builds as the emitted .js beside this file.
const WORKER_URL = new URL(
	`./redact-worker.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`,
	import.meta.url,
);
const LAST_APPLIED = "kubectl.kubernetes.io/last-applied-configuration";
const LABEL_MARK = "[REDACTED:label]";
const STRUCTURAL: ReadonlySet<ArtifactPurpose> = new Set([
	"deployments",
	"replicasets",
	"pods",
]);
const POD_SPEC_CONTAINERS = [
	"containers",
	"initContainers",
	"ephemeralContainers",
] as const;

// secretlint's pattern matcher dedups hits quadratically, so text is linted in windows;
// any secret with its key up to OVERLAP chars long lies wholly inside one window.
const WINDOW = 64 * 1024;
const OVERLAP = 16 * 1024;

// Generic names on purpose (#842 OBJ-016): over-redaction is the accepted direction.
const KEY =
	"PASS(?:WORD|WD|PHRASE)?|PWD|SECRET|TOKEN|KEY|CREDENTIALS?|CREDS?|AUTH|SESSION|COOKIE|SIGNATURE|SALT";

// A bare token; a backslash only as an escape pair, so a JSON string's closing quote survives.
const TOKEN = String.raw`(?:[^\s"'\\&,;]|\\[^"\s])`;
const BARE_TOKEN = String.raw`${TOKEN}+(?!${TOKEN})(?!\\?["']\s*:)`;
// The rest of a line, stopping at an unescaped `"` or an escaped newline inside a JSON string.
const BARE_LINE = String.raw`(?=\S)(?:[^\r\n"\\]|\\[^nr"])+`;
// A newline, raw or JSON-escaped, then the indent of a YAML value on the next line.
const NEXT_LINE = String.raw`(?:(?:\r?\n|(?:\\r)?\\n)[ \t]+)`;
const RAW_NL = String.raw`\r?\n`;
const ESC_NL = String.raw`(?:\\r)?\\n`;
const END_OF_TEXT = String.raw`(?![\s\S])`;
// A block value's key line up to the newline that opens its body.
const keyLine = (nl: string, indicator: string): string =>
	String.raw`[\w.-]*(?:${KEY})[\w.-]*(?:[ \t]+[\w.-]+)?[ \t]*:[ \t]*${indicator}[ \t]*${nl}`;
const INDICATOR = "[|>][-+]?[0-9]?";
// Blank and whitespace-only lines continue a block; it ends at a line whose indent is no deeper than `indent`.
const blockBody = (
	nl: string,
	text: string,
	end: string,
	indent: string,
): string => {
	const blank = String.raw`[ \t]*(?:${nl}|${end})`;
	const line = String.raw`${indent}[ \t]+(?=\S)${text}+(?:${nl}|${end})`;
	return `(?:${blank})*${line}(?:${blank}|${line})*`;
};
// Inside a JSON string a line stops at an unescaped quote, so redacted JSON still parses.
const ESC_TEXT = String.raw`(?:[^\r\n"\\]|\\(?!n|r\\n)[\s\S])`;
const ESC_END = `(?=")|${END_OF_TEXT}`;
const ESC_LINE_START = String.raw`(?:^|\\n|")`;

/**
 * The value after `prefix`: a quoted run (plain, JSON-escaped or single), else one token.
 * Quotes stay outside the match; a `"` before `,:]}` ends a JSON string and one before `:`
 * is an object key, so redacted JSON still parses for the case builder.
 */
const valueAfter = (prefix: string, bare = BARE_TOKEN): string =>
	[
		String.raw`(?<=${prefix}")(?!\s*[,:\]}])[^"\n]+(?="(?!\s*:))`,
		String.raw`(?<=${prefix}\\")[^"\n]+?(?=\\")`,
		String.raw`(?<=${prefix}')[^'\n]+(?=')`,
		String.raw`(?<=${prefix}(?:\\?["'])?)${bare}`,
	].join("|");

/** #272's Done-when shapes plus argv forms (#842). Lookbehinds keep the key visible and replace only the value. */
export const SECRET_PATTERNS = [
	{
		name: "key=value",
		patterns: [
			`/${valueAfter(String.raw`\b[\w.-]*(?:${KEY})[\w.-]*\s*=\s*`)}/i`,
		],
	},
	{
		name: "flag value",
		patterns: [
			`/${valueAfter(String.raw`(?:^|[\s"'\[,(])--?[\w.-]*(?:${KEY})[\w.-]*(?:\\?["'])?(?:[ \t]*,\s*|[ \t]+)`)}/i`,
		],
	},
	{
		// `password: x`, YAML block and next-line values, `api key: x`; unquoted keys only, as JSON keys
		// are quoted and json-key-value covers them. The whole rest of the line goes.
		name: "key: value",
		patterns: [
			`/${valueAfter(String.raw`\b[\w.-]*(?:${KEY})[\w.-]*(?:[ \t]+[\w.-]+)?[ \t]*:[ \t]*(?:[|>][-+]?[ \t]*)?${NEXT_LINE}?`, BARE_LINE)}/i`,
		],
	},
	{
		// A YAML block or folded value under such a key: every line indented past the key's own.
		name: "key: block",
		patterns: [
			`/(?<=^([ \t]*)${keyLine(RAW_NL, `(?:${INDICATOR})?`)})${blockBody(RAW_NL, String.raw`[^\r\n]`, END_OF_TEXT, String.raw`\1`)}/im`,
			// Inside a JSON string the lines are separated by an escaped `\n`; a key mid-line has no indent to
			// compare, so it takes a `|` or `>` and every indented line after it.
			`/(?<=${ESC_LINE_START}([ \t]*)${keyLine(ESC_NL, `(?:${INDICATOR})?`)})${blockBody(ESC_NL, ESC_TEXT, ESC_END, String.raw`\1`)}/im`,
			`/(?<=(?<![w.-])(?<!${ESC_LINE_START}[ \t]*)${keyLine(ESC_NL, INDICATOR)})${blockBody(ESC_NL, ESC_TEXT, ESC_END, "")}/im`,
		],
	},
	{
		// mysql-style `-p value` and `-pvalue`; case-sensitive, as `-P` is mysql's port.
		name: "short password flag",
		patterns: [
			`/${valueAfter(String.raw`(?:^|[\s"'\[,(])-p(?:(?:\\?["'])?(?:[ \t]*,\s*|[ \t]+))?`)}/`,
		],
	},
	{
		name: "url-userinfo",
		patterns: [
			String.raw`/(?<=\b[a-z][a-z0-9+.-]*:\/\/[^\s\/?#@:"'\\]*:)[^\s\/?#@"'\\]+(?=@)/i`,
		],
	},
	{
		name: "json-key-value",
		patterns: [
			String.raw`/(?<="[\w.-]*(?:${KEY})[\w.-]*"\s*:\s*")(?:[^"\\]|\\.)+/i`,
		],
	},
	{
		// From BEGIN through its body lines, with or without END: `--limit-bytes` can cut it.
		name: "private-key-block",
		patterns: [
			String.raw`/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:(?:\r?\n|\\n)(?:(?:[A-Za-z0-9+/=]+|[A-Za-z-]+: [^\r\n"\\]*)(?=\r?\n|\\n|$))?)*(?:(?:\r?\n|\\n)-----END [A-Z0-9 ]*PRIVATE KEY-----)?/`,
		],
	},
	{
		// A body whose BEGIN `--tail` cut off: runs of 64-character base64 lines, and the short last
		// line before END. Each line is matched once, so a base64-heavy log stays linear.
		name: "private-key-body",
		patterns: [
			String.raw`/(?:^|(?<=\n|\\n))[A-Za-z0-9+/=]{1,64}(?:\r?\n|\\n)-----END [A-Z0-9 ]*PRIVATE KEY-----/`,
			String.raw`/(?:^|(?<=\n|\\n))[A-Za-z0-9+/]{64}(?:(?:\r?\n|\\n)[A-Za-z0-9+/=]{1,64}(?=\r?\n|\\n|$))+/`,
			// Other wraps, such as OpenSSH's 70: three or more full lines of 60 to 76, then a short last.
			String.raw`/(?:^|(?<=\n|\\n))[A-Za-z0-9+/]{60,76}(?:(?:\r?\n|\\n)[A-Za-z0-9+/]{60,76}(?=\r?\n|\\n|$)){2,}(?:(?:\r?\n|\\n)[A-Za-z0-9+/=]{1,76}(?=\r?\n|\\n|$))?/`,
		],
	},
	{
		name: "jwt",
		patterns: [
			String.raw`/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/`,
		],
	},
	{
		name: "authorization-bearer",
		patterns: [
			String.raw`/(?<=authorization\s*[:=]\s*["']?bearer\s+)[\w.~+/=-]+/i`,
		],
	},
	{
		name: "x-api-key",
		patterns: [String.raw`/(?<=x-api-key\s*[:=]\s*["']?)[^\s"',;]+/i`],
	},
	{
		name: "query-token",
		patterns: [String.raw`/(?<=[?&](?:token|api_?key)=)[^&\s"'#]+/i`],
	},
];

const FILTER_COMMENTS = "@secretlint/secretlint-rule-filter-comments";

export const REDACT_CONFIG: RedactConfig = {
	rules: [
		// The preset's rules one by one, minus the filter that lets `secretlint-disable` comments in
		// captured text switch redaction off; core ignores `disabled` inside a preset (#842).
		...recommendRules
			.filter((rule) => rule.meta.id !== FILTER_COMMENTS)
			.map((rule) => ({
				id: rule.meta.id,
				rule,
				// Access key ids are off by default upstream; a key pair must lose both halves.
				...(rule.meta.id === "@secretlint/secretlint-rule-aws"
					? { options: { enableIDScanRule: true } }
					: {}),
			})),
		{
			id: "@secretlint/secretlint-rule-pattern",
			rule: patternRule,
			options: { patterns: SECRET_PATTERNS },
		},
	],
};

type JsonObject = Record<string, unknown>;

const isObject = (v: unknown): v is JsonObject =>
	typeof v === "object" && v !== null && !Array.isArray(v);

function bump(counts: RedactCounts, rule: string, by = 1): void {
	counts[rule] = (counts[rule] ?? 0) + by;
}

/** Every argv (the container's, its probes', its hooks') and probe header value, item by item. */
function scrubArgv(node: unknown, counts: RedactCounts): void {
	if (Array.isArray(node)) {
		for (const item of node) scrubArgv(item, counts);
		return;
	}
	if (!isObject(node)) return;
	for (const [key, value] of Object.entries(node)) {
		if (ARGV_KEYS.has(key) && Array.isArray(value)) {
			node[key] = value.map(() => ARGV_MARK);
			bump(counts, "argv", value.length);
		} else if (key === "httpHeaders" && Array.isArray(value)) {
			for (const header of value) {
				if (isObject(header) && "value" in header) {
					header.value = HEADER_MARK;
					bump(counts, "header");
				}
			}
		} else scrubArgv(value, counts);
	}
}

function scrubPodSpec(spec: unknown, counts: RedactCounts): void {
	if (!isObject(spec)) return;
	for (const key of POD_SPEC_CONTAINERS) {
		const containers = spec[key];
		if (!Array.isArray(containers)) continue;
		for (const container of containers) {
			if (!isObject(container)) continue;
			scrubArgv(container, counts);
			if (!Array.isArray(container.env)) continue;
			for (const env of container.env) {
				if (isObject(env) && "value" in env) {
					env.value = ENV_MARK;
					bump(counts, "env");
				}
			}
		}
	}
}

// A label is free text under a key the operator chose, so a secret-like key or a generated-looking value goes.
const SECRET_KEY = /token|secret|pass|pwd|key|auth|cred|session|cookie|sig/i;
const GENERATED_RUN = /[A-Za-z0-9]{8,}/g;
const STRUCTURAL_HASHES: ReadonlySet<string> = new Set([
	"pod-template-hash",
	"controller-revision-hash",
]);

function secretLabel(key: string, value: string): boolean {
	if (SECRET_KEY.test(key)) return true;
	if (STRUCTURAL_HASHES.has(key) && /^[0-9a-f]{8,10}$/.test(value))
		return false;
	return [...value.matchAll(GENERATED_RUN)].some(
		([run]) => /[A-Za-z]/.test(run) && /[0-9]/.test(run),
	);
}

/** Labels and nodeSelector: a value is kept only under a key that does not read as secret. */
function scrubLabels(map: unknown, counts: RedactCounts): void {
	if (!isObject(map)) return;
	for (const [key, value] of Object.entries(map)) {
		if (typeof value !== "string" || !secretLabel(key, value)) continue;
		map[key] = LABEL_MARK;
		bump(counts, "label");
	}
}

function scrubObject(item: unknown, counts: RedactCounts): void {
	if (!isObject(item)) return;
	const meta = item.metadata;
	if (isObject(meta)) {
		delete meta.managedFields;
		if (isObject(meta.annotations) && LAST_APPLIED in meta.annotations) {
			delete meta.annotations[LAST_APPLIED];
			bump(counts, "last-applied-configuration");
		}
		scrubLabels(meta.labels, counts);
	}
	const spec = item.spec;
	if (!isObject(spec)) return;
	scrubPodSpec(spec, counts);
	scrubLabels(spec.nodeSelector, counts);
	if (isObject(spec.selector)) scrubLabels(spec.selector.matchLabels, counts);
	const template = spec.template;
	if (!isObject(template)) return;
	if (isObject(template.metadata))
		scrubLabels(template.metadata.labels, counts);
	scrubPodSpec(template.spec, counts);
	if (isObject(template.spec)) scrubLabels(template.spec.nodeSelector, counts);
}

type Span = readonly [start: number, end: number];

// A Kubernetes name, key or label value; anything else in a reference field is scanned as usual.
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,252}$/;
const HAS_JWT = /eyJ[A-Za-z0-9_-]{6,}\./;
const ALNUM_RUN = /[A-Za-z0-9]{12,}/g;
const MARKED = /\\u0001([^"\\]*)\\u0002/g;

/** A run of 12+ letters and digits holding 3+ of each reads as a generated secret, not a name. */
const secretLike = (value: string): boolean =>
	[...value.matchAll(ALNUM_RUN)].some(
		([run]) =>
			(run.match(/[A-Za-z]/g)?.length ?? 0) >= 3 &&
			(run.match(/[0-9]/g)?.length ?? 0) >= 3,
	);

const each = (value: unknown): JsonObject[] =>
	Array.isArray(value) ? value.filter(isObject) : [];

/** Marks `holder[field]` as a kept reference name when it has a name's shape and not a secret's. */
function markField(holder: unknown, field: string): void {
	if (!isObject(holder)) return;
	const value = holder[field];
	if (
		typeof value === "string" &&
		(value === LABEL_MARK ||
			(REFERENCE.test(value) && !HAS_JWT.test(value) && !secretLike(value)))
	)
		holder[field] = `\u0001${value}\u0002`;
}

function markValues(map: unknown): void {
	if (isObject(map))
		for (const field of Object.keys(map)) markField(map, field);
}

/** Every `matchExpressions[].key` and `topologyKey` inside an affinity. */
function markAffinity(node: unknown): void {
	if (Array.isArray(node)) {
		for (const item of node) markAffinity(item);
		return;
	}
	if (!isObject(node)) return;
	for (const [field, value] of Object.entries(node)) {
		if (field === "matchExpressions")
			for (const e of each(value)) markField(e, "key");
		else if (field === "topologyKey") markField(node, field);
		else markAffinity(value);
	}
}

function markPodSpec(spec: unknown): void {
	if (!isObject(spec)) return;
	for (const key of POD_SPEC_CONTAINERS)
		for (const container of each(spec[key]))
			for (const env of each(container.env)) {
				const from = env.valueFrom;
				if (!isObject(from)) continue;
				markField(from.secretKeyRef, "key");
				markField(from.configMapKeyRef, "key");
			}
	for (const volume of each(spec.volumes)) {
		markField(volume.secret, "secretName");
		for (const source of [volume.secret, volume.configMap])
			if (isObject(source))
				for (const item of each(source.items)) markField(item, "key");
	}
	for (const t of each(spec.tolerations)) markField(t, "key");
	for (const t of each(spec.topologySpreadConstraints))
		markField(t, "topologyKey");
	markValues(spec.nodeSelector);
	markAffinity(spec.affinity);
}

/** The reference names a workload reads, by path: never annotations, never anywhere else (#842). */
function markReferences(item: unknown): void {
	if (!isObject(item)) return;
	if (isObject(item.metadata)) markValues(item.metadata.labels);
	const spec = item.spec;
	if (!isObject(spec)) return;
	if (isObject(spec.selector)) markValues(spec.selector.matchLabels);
	markPodSpec(spec);
	const template = spec.template;
	if (!isObject(template)) return;
	if (isObject(template.metadata)) markValues(template.metadata.labels);
	markPodSpec(template.spec);
}

/**
 * Structural pass (R2.1); a JSON list's items, or a single object. Also returns the spans of
 * reference names (#842), which the generic-name patterns must not redact.
 */
function structural(
	text: string,
	counts: RedactCounts,
): { text: string; kept: Span[] } {
	const doc: unknown = JSON.parse(text);
	const items = isObject(doc) && Array.isArray(doc.items) ? doc.items : [doc];
	for (const item of items) scrubObject(item, counts);
	// Fails closed: input that already carries the markers keeps nothing (JSON can only escape them).
	const markable = !/\\u000[12]/.test(text);
	if (markable) for (const item of items) markReferences(item);
	const marked = JSON.stringify(doc, null, 4);
	const kept: Span[] = [];
	const parts: string[] = [];
	let cursor = 0;
	let length = 0;
	for (const m of marked.matchAll(MARKED)) {
		const before = marked.slice(cursor, m.index);
		parts.push(before, m[1]);
		length += before.length;
		kept.push([length, length + m[1].length]);
		length += m[1].length;
		cursor = m.index + m[0].length;
	}
	parts.push(marked.slice(cursor));
	return { text: parts.join(""), kept };
}

function replaceRanges(
	text: string,
	hits: Array<{ start: number; end: number; rule: string }>,
): string {
	const sorted = [...hits].sort((a, b) => a.start - b.start || b.end - a.end);
	const merged: typeof sorted = [];
	for (const hit of sorted) {
		const last = merged.at(-1);
		if (last && hit.start <= last.end) last.end = Math.max(last.end, hit.end);
		else merged.push({ ...hit });
	}
	const parts: string[] = [];
	let cursor = 0;
	for (const { start, end, rule } of merged) {
		parts.push(text.slice(cursor, start), `[REDACTED:${rule}]`);
		cursor = end;
	}
	parts.push(text.slice(cursor));
	return parts.join("");
}

/** Names the error's class only: parser and rule messages can quote the input (#842). */
const failure = (pass: string, err: unknown): string =>
	`${pass} pass failed (${err instanceof Error ? err.name : typeof err})`;

// `kubectl logs --timestamps` puts one before every line, which breaks line-anchored shapes.
const TIMESTAMP =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}) /gm;

type Hit = { start: number; end: number; rule: string };

/** The text without line timestamps, and a map from its ranges back to pieces of the original. */
function withoutTimestamps(text: string): {
	scanned: string;
	pieces: (hit: Hit) => Hit[];
} {
	const from = [0];
	const to = [0];
	const parts: string[] = [];
	let cursor = 0;
	let removed = 0;
	for (const m of text.matchAll(TIMESTAMP)) {
		parts.push(text.slice(cursor, m.index));
		cursor = m.index + m[0].length;
		removed += m[0].length;
		from.push(cursor - removed);
		to.push(cursor);
	}
	parts.push(text.slice(cursor));
	const scanned = parts.join("");
	const pieces = (hit: Hit): Hit[] => {
		const out: Hit[] = [];
		for (let i = 0; i < from.length; i++) {
			const segEnd = i + 1 < from.length ? from[i + 1] : scanned.length;
			const lo = Math.max(hit.start, from[i]);
			const hi = Math.min(hit.end, segEnd);
			if (lo >= hi) continue;
			let end = to[i] + hi - from[i];
			const start = to[i] + lo - from[i];
			// Newlines stay, so each kept timestamp still starts its own line.
			while (end > start && (text[end - 1] === "\n" || text[end - 1] === "\r"))
				end--;
			if (end > start) out.push({ start, end, rule: hit.rule });
		}
		return out;
	};
	return { scanned, pieces };
}

/** Whether `hit` lies inside one of the sorted, disjoint `spans`. */
function within(spans: readonly Span[], hit: Hit): boolean {
	let lo = 0;
	let hi = spans.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const [start, end] = spans[mid];
		if (hit.end <= start) hi = mid - 1;
		else if (hit.start >= end) lo = mid + 1;
		else return hit.start >= start && hit.end <= end;
	}
	return false;
}

async function textPass(
	original: string,
	counts: RedactCounts,
	config: RedactConfig,
	kept: readonly Span[] = [],
): Promise<string> {
	const { scanned: text, pieces } = withoutTimestamps(original);
	const hits = new Map<string, Hit>();
	for (let base = 0; base < text.length; base += WINDOW) {
		const result = await lintSource({
			source: {
				content: text.slice(base, base + WINDOW + OVERLAP),
				filePath: "capture.txt",
				contentType: "text",
			},
			options: { config, noPhysicFilePath: true },
		});
		for (const m of result.messages) {
			if (m.type !== "message") continue;
			const rule = m.ruleId.startsWith(RULE_PREFIX)
				? m.ruleId.slice(RULE_PREFIX.length)
				: m.ruleId;
			const hit = { start: base + m.range[0], end: base + m.range[1], rule };
			hits.set(`${hit.start}:${hit.end}:${rule}`, hit);
		}
	}
	const ranges: Hit[] = [];
	for (const hit of hits.values()) {
		// Only our own patterns yield to a kept reference name; a provider-shaped token never does.
		const left = pieces(hit).filter(
			(p) => p.rule !== "pattern" || !within(kept, p),
		);
		if (left.length === 0) continue;
		bump(counts, hit.rule);
		ranges.push(...left);
	}
	return replaceRanges(original, ranges);
}

/** A URL without userinfo, query or fragment, for a diagnostic or a DB column; unparseable is withheld. */
export function redactUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return "[REDACTED:url]";
	}
	if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash)
		return url;
	parsed.username = "";
	parsed.password = "";
	parsed.search = "";
	parsed.hash = "";
	return parsed.toString();
}

/** Text pass alone, for `stderrTail` and diagnostics: small inputs, so it runs in-process. */
export async function redactText(
	text: string,
	config: RedactConfig = REDACT_CONFIG,
): Promise<RedactTextResult> {
	const counts: RedactCounts = {};
	try {
		return { text: await textPass(text, counts, config), counts };
	} catch (err) {
		return { error: failure("text", err) };
	}
}

/** Failure text bound for a DB column or an API error: redacted, or withheld whole. */
export async function redactDiagnostic(text: string): Promise<string> {
	const out = await redactText(text.slice(0, DIAGNOSTIC_CAP));
	return "error" in out ? DIAGNOSTIC_WITHHELD : out.text;
}

/** Both passes over one artifact in this thread; `redact` runs it in a worker. */
export async function redactInProcess(
	purpose: ArtifactPurpose,
	raw: Buffer,
	config: RedactConfig = REDACT_CONFIG,
): Promise<RedactResult> {
	const counts: RedactCounts = {};
	if (raw.length === 0) return { redacted: Buffer.alloc(0), counts };
	let text = raw.toString("utf8");
	let kept: Span[] = [];
	if (STRUCTURAL.has(purpose)) {
		try {
			({ text, kept } = structural(text, counts));
		} catch (err) {
			return { error: failure("structural", err) };
		}
	}
	try {
		text = await textPass(text, counts, config, kept);
	} catch (err) {
		return { error: failure("text", err) };
	}
	return { redacted: Buffer.from(text, "utf8"), counts };
}

type WorkerResult =
	| { redacted: Uint8Array; counts: RedactCounts }
	| { error: string };

/**
 * Both passes over one artifact; the raw buffer is never modified. The scan runs in a worker
 * because secretlint dedups hits quadratically and would hold the API's event loop on dense
 * input (#842); the deadline terminates it.
 */
export function redact(
	purpose: ArtifactPurpose,
	raw: Buffer,
	{ deadlineMs = REDACT_DEADLINE_MS }: { deadlineMs?: number } = {},
): Promise<RedactResult> {
	return new Promise((resolve) => {
		const worker = new Worker(WORKER_URL, { workerData: { purpose, raw } });
		worker.unref();
		let settled = false;
		const finish = (result: RedactResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			void worker.terminate();
			resolve(result);
		};
		const timer = setTimeout(
			() => finish({ error: `redaction deadline exceeded (${deadlineMs} ms)` }),
			deadlineMs,
		);
		worker.once("message", (out: WorkerResult) =>
			finish(
				"error" in out
					? out
					: {
							redacted: Buffer.from(
								out.redacted.buffer,
								out.redacted.byteOffset,
								out.redacted.byteLength,
							),
							counts: out.counts,
						},
			),
		);
		worker.once("error", (err) => finish({ error: failure("worker", err) }));
		worker.once("exit", () =>
			finish({ error: "redaction worker exited without a result" }),
		);
	});
}
