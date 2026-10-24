// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A recorded ACP session: one header line, then one `{dir, at, frame}` line per
 * JSON-RPC message the engine's transport saw. The format is the one in
 * prismalens/gh-workflows `docs/acp-recording.md`, plus a `scenario` field (#914).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";

export const RECORDING_VERSION = 1;
export const REDACTED = "<redacted>";

export interface RecordingHeader {
	acp_recording: number;
	agent: { name: string; version: string };
	adapter: { name: string; version: string };
	model: string;
	recorded_at: string;
	recorder: { name: string; version: string };
	scenario: string;
}

export interface RecordedFrame {
	dir: "in" | "out";
	at: string;
	frame: Record<string, unknown>;
}

export interface Recording {
	header: RecordingHeader;
	frames: RecordedFrame[];
}

/** Anything shaped like a credential, wherever it sits in a string. */
const CREDENTIAL =
	/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g;
const SECRET_FIELD = /(token|secret|key|password|authorization|cookie)/i;

const pathForms = (path: string): string[] => {
	const slashed = path.replaceAll("\\", "/");
	return [...new Set([path, slashed, path.replaceAll("\\", "\\\\")])].filter(
		Boolean,
	);
};

/** Redacts a value in place of copying it: secrets by field name or shape, the home and checkout paths by name. */
export function redact(
	value: unknown,
	paths: { home: string; cwd: string },
): unknown {
	const swaps: [string, string][] = [
		...pathForms(paths.cwd).map((p): [string, string] => [p, "/checkout"]),
		...pathForms(paths.home).map((p): [string, string] => [p, "~"]),
	];
	const text = (s: string): string => {
		let out = s;
		for (const [from, to] of swaps) out = out.split(from).join(to);
		return out.replace(CREDENTIAL, REDACTED);
	};
	const walk = (v: unknown): unknown => {
		if (typeof v === "string") return text(v);
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === "object")
			return Object.fromEntries(
				Object.entries(v).map(([k, x]) => [
					k,
					SECRET_FIELD.test(k) && x !== null && typeof x !== "boolean"
						? REDACTED
						: walk(x),
				]),
			);
		return v;
	};
	return walk(value);
}

/** What still looks like a credential after redaction; the recorder writes nothing when this is not empty. */
export function leftoverCredentials(text: string): string[] {
	return text.match(CREDENTIAL) ?? [];
}

export function serialize(recording: Recording): string {
	return `${[JSON.stringify(recording.header), ...recording.frames.map((f) => JSON.stringify(f))].join("\n")}\n`;
}

export function parseRecording(text: string, source = "recording"): Recording {
	const lines = text.split("\n").filter((l) => l.trim());
	if (lines.length === 0) throw new Error(`${source} is empty`);
	const header = JSON.parse(lines[0] as string) as RecordingHeader;
	if (header.acp_recording !== RECORDING_VERSION)
		throw new Error(
			`${source}: acp_recording ${header.acp_recording} is not version ${RECORDING_VERSION}`,
		);
	for (const field of [
		"agent",
		"adapter",
		"model",
		"recorded_at",
		"recorder",
		"scenario",
	] as const)
		if (header[field] === undefined)
			throw new Error(`${source}: header lacks ${field}`);
	const frames = lines.slice(1).map((line, i) => {
		const row = JSON.parse(line) as RecordedFrame;
		if (
			(row.dir !== "in" && row.dir !== "out") ||
			typeof row.frame !== "object"
		)
			throw new Error(`${source}: line ${i + 2} is not a {dir, at, frame}`);
		return row;
	});
	return { header, frames };
}

export function readRecording(path: string): Recording {
	return parseRecording(readFileSync(path, "utf8"), path);
}

/**
 * The runDir `transcript.jsonl` the engine writes (`{t, d, m}`) as frames: only
 * lines that are JSON-RPC messages, since the engine adds its own notes to it.
 */
export function framesFromTranscript(
	transcript: string,
	paths: { home: string; cwd: string },
): RecordedFrame[] {
	const frames: RecordedFrame[] = [];
	for (const line of transcript.split("\n")) {
		if (!line.trim()) continue;
		const row = JSON.parse(line) as { t: number; d: "in" | "out"; m: string };
		let message: unknown;
		try {
			message = JSON.parse(row.m);
		} catch {
			continue;
		}
		if (
			!message ||
			typeof message !== "object" ||
			(message as { jsonrpc?: string }).jsonrpc !== "2.0"
		)
			continue;
		frames.push({
			dir: row.d,
			at: new Date(row.t).toISOString(),
			frame: redact(message, paths) as Record<string, unknown>,
		});
	}
	return frames;
}

// ---------- schema ----------

const require = createRequire(import.meta.url);
const SCHEMA_ID = "https://agentclientprotocol.com/schema.json";

/** Frame method to the SDK schema definition for its params; `_`-prefixed extension methods have none. */
const PARAMS: Record<string, Record<"in" | "out", string | undefined>> = {
	initialize: { out: "InitializeRequest", in: undefined },
	authenticate: { out: "AuthenticateRequest", in: undefined },
	"session/new": { out: "NewSessionRequest", in: undefined },
	"session/load": { out: "LoadSessionRequest", in: undefined },
	"session/prompt": { out: "PromptRequest", in: undefined },
	"session/set_mode": { out: "SetSessionModeRequest", in: undefined },
	"session/set_config_option": {
		out: "SetSessionConfigOptionRequest",
		in: undefined,
	},
	"session/cancel": { out: "CancelNotification", in: undefined },
	"session/update": { out: undefined, in: "SessionNotification" },
	"session/request_permission": {
		out: undefined,
		in: "RequestPermissionRequest",
	},
};
/** The answer a method gets. */
const RESULT: Record<string, string> = {
	initialize: "InitializeResponse",
	authenticate: "AuthenticateResponse",
	"session/new": "NewSessionResponse",
	"session/load": "LoadSessionResponse",
	"session/prompt": "PromptResponse",
	"session/set_mode": "SetSessionModeResponse",
	"session/set_config_option": "SetSessionConfigOptionResponse",
	"session/request_permission": "RequestPermissionResponse",
};

export interface FrameProblem {
	index: number;
	where: string;
	message: string;
}

let validators: Map<string, ValidateFunction> | null = null;

function validatorFor(definition: string): ValidateFunction {
	if (!validators) {
		const ajv = new Ajv2020({
			strict: false,
			allErrors: false,
			validateFormats: false,
		});
		ajv.addSchema(
			{
				...(require("@agentclientprotocol/sdk/schema/schema.json") as object),
				$id: SCHEMA_ID,
			},
			SCHEMA_ID,
		);
		validators = new Map();
		for (const name of new Set([
			...Object.values(PARAMS).flatMap((p) => [p.in, p.out]),
			...Object.values(RESULT),
		])) {
			if (!name) continue;
			validators.set(
				name,
				ajv.compile({ $ref: `${SCHEMA_ID}#/$defs/${name}` }),
			);
		}
	}
	const found = validators.get(definition);
	if (!found) throw new Error(`no schema definition ${definition}`);
	return found;
}

/**
 * Checks every frame's params or result against `@agentclientprotocol/sdk`'s
 * `schema/schema.json`, and its JSON-RPC envelope. A method the schema has no
 * definition for (an extension such as `_auth/status_update`) is skipped.
 */
export function validateFrames(frames: RecordedFrame[]): FrameProblem[] {
	const problems: FrameProblem[] = [];
	/** Request ids by direction of the request, to find the method a response answers. */
	const asked: Record<"in" | "out", Map<unknown, string>> = {
		in: new Map(),
		out: new Map(),
	};
	frames.forEach(({ dir, frame }, index) => {
		const fail = (where: string, message: string): void => {
			problems.push({ index, where, message });
		};
		if (frame.jsonrpc !== "2.0") {
			fail("envelope", "jsonrpc is not 2.0");
			return;
		}
		const method = frame.method;
		if (typeof method === "string") {
			if (frame.id !== undefined) asked[dir].set(frame.id, method);
			const definition = PARAMS[method]?.[dir];
			if (!definition) return;
			const check = validatorFor(definition);
			if (!check(frame.params ?? {}))
				fail(method, JSON.stringify(check.errors?.slice(0, 3)));
			return;
		}
		if (frame.id === undefined) {
			fail("envelope", "neither a method nor an id");
			return;
		}
		const other = dir === "in" ? "out" : "in";
		const answered = asked[other].get(frame.id);
		if ("error" in frame) {
			const error = frame.error as { code?: unknown; message?: unknown };
			if (typeof error?.code !== "number" || typeof error?.message !== "string")
				fail(
					answered ?? "response",
					"error lacks a numeric code and a message",
				);
			return;
		}
		if (!answered) {
			fail("response", `answers no request (id ${String(frame.id)})`);
			return;
		}
		const definition = RESULT[answered];
		if (!definition) return;
		const check = validatorFor(definition);
		if (!check(frame.result ?? {}))
			fail(`${answered} result`, JSON.stringify(check.errors?.slice(0, 3)));
	});
	return problems;
}
