// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Redaction of host-owned captures (R2): a structural pass over the workload
 * JSON, then a secretlint text pass over everything. Fails closed: on any
 * error no redacted copy exists.
 */
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
const LAST_APPLIED = "kubectl.kubernetes.io/last-applied-configuration";
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

const KEY = "PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_KEY";

// A bare token; a backslash only as an escape pair, so a JSON string's closing quote survives.
const TOKEN = String.raw`(?:[^\s"'\\&,;]|\\[^"\s])`;

/**
 * The value after `prefix`: a quoted run (plain, JSON-escaped or single), else one token.
 * Quotes stay outside the match; a `"` before `,:]}` ends a JSON string and one before `:`
 * is an object key, so redacted JSON still parses for the case builder.
 */
const valueAfter = (prefix: string): string =>
	[
		String.raw`(?<=${prefix}")(?!\s*[,:\]}])[^"\n]+(?="(?!\s*:))`,
		String.raw`(?<=${prefix}\\")[^"\n]+?(?=\\")`,
		String.raw`(?<=${prefix}')[^'\n]+(?=')`,
		String.raw`(?<=${prefix}(?:\\?["'])?)${TOKEN}+(?!${TOKEN})(?!\\?["']\s*:)`,
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

function scrubObject(item: unknown, counts: RedactCounts): void {
	if (!isObject(item)) return;
	const meta = item.metadata;
	if (isObject(meta)) {
		delete meta.managedFields;
		if (isObject(meta.annotations) && LAST_APPLIED in meta.annotations) {
			delete meta.annotations[LAST_APPLIED];
			bump(counts, "last-applied-configuration");
		}
	}
	const spec = item.spec;
	if (!isObject(spec)) return;
	scrubPodSpec(spec, counts);
	if (isObject(spec.template)) scrubPodSpec(spec.template.spec, counts);
}

/** Structural pass (R2.1); a JSON list's items, or a single object. */
function structural(text: string, counts: RedactCounts): string {
	const doc: unknown = JSON.parse(text);
	const items = isObject(doc) && Array.isArray(doc.items) ? doc.items : [doc];
	for (const item of items) scrubObject(item, counts);
	return JSON.stringify(doc, null, 4);
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

async function textPass(
	text: string,
	counts: RedactCounts,
	config: RedactConfig,
): Promise<string> {
	const hits = new Map<string, { start: number; end: number; rule: string }>();
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
	for (const hit of hits.values()) bump(counts, hit.rule);
	return replaceRanges(text, [...hits.values()]);
}

/** Text pass alone, for `stderrTail`. */
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
	const out = await redactText(text);
	return "error" in out ? DIAGNOSTIC_WITHHELD : out.text;
}

/** Both passes over one artifact; the raw buffer is never modified. */
export async function redact(
	purpose: ArtifactPurpose,
	raw: Buffer,
	config: RedactConfig = REDACT_CONFIG,
): Promise<RedactResult> {
	const counts: RedactCounts = {};
	if (raw.length === 0) return { redacted: Buffer.alloc(0), counts };
	let text = raw.toString("utf8");
	if (STRUCTURAL.has(purpose)) {
		try {
			text = structural(text, counts);
		} catch (err) {
			return { error: failure("structural", err) };
		}
	}
	try {
		text = await textPass(text, counts, config);
	} catch (err) {
		return { error: failure("text", err) };
	}
	return { redacted: Buffer.from(text, "utf8"), counts };
}
