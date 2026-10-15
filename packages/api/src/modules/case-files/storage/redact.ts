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
import { creator as recommendPreset } from "@secretlint/secretlint-rule-preset-recommend";

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

/** #272's Done-when shapes. Lookbehinds keep the key visible and replace only the value. */
export const SECRET_PATTERNS = [
	{
		name: "key=value",
		patterns: [
			String.raw`/(?<=\b[\w.-]*(?:${KEY})[\w.-]*\s*=\s*["']?)[^\s"'&,;]+/i`,
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

export const REDACT_CONFIG: RedactConfig = {
	rules: [
		{
			id: "@secretlint/secretlint-rule-preset-recommend",
			rule: recommendPreset,
			// Access key ids are off by default upstream; a key pair must lose both halves.
			rules: [
				{
					id: "@secretlint/secretlint-rule-aws",
					options: { enableIDScanRule: true },
				},
			],
		},
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

function scrubPodSpec(spec: unknown, counts: RedactCounts): void {
	if (!isObject(spec)) return;
	for (const key of POD_SPEC_CONTAINERS) {
		const containers = spec[key];
		if (!Array.isArray(containers)) continue;
		for (const container of containers) {
			if (!isObject(container) || !Array.isArray(container.env)) continue;
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

const errorText = (err: unknown): string =>
	err instanceof Error ? err.message : String(err);

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
		return { error: errorText(err) };
	}
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
			return { error: `structural pass: ${errorText(err)}` };
		}
	}
	try {
		text = await textPass(text, counts, config);
	} catch (err) {
		return { error: errorText(err) };
	}
	return { redacted: Buffer.from(text, "utf8"), counts };
}
