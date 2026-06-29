/**
 * JSON-RPC 2.0 server over stdio (newline-delimited JSON) — the LIVE channel for
 * the desktop app / API (ADR-0007/0010). This REPLACES file-read as the live
 * channel; the ~/.prismalens workspace stays the durable record (events.jsonl +
 * report.json), written exactly as the `investigate` command writes it.
 *
 * Wire framing: one JSON value per line in BOTH directions — requests on stdin,
 * responses + notifications on stdout.
 *
 * Methods:
 *  - initialize  -> { protocolVersion, serverInfo: { name, version } }
 *  - investigate -> drives investigateIncidentStream, emitting an
 *      `investigate/event` NOTIFICATION per canonical event, then resolving with
 *      { runId, report }. A no-evidence run resolves to a JSON-RPC error (-32000).
 *
 * Robustness: a malformed or failed request becomes a JSON-RPC error response —
 * the server never crashes on bad input.
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { InvestigationReport } from "@prismalens/contracts";
import { investigateIncidentStream } from "@prismalens/engine";
import { loadConfig } from "../config/loader.js";
import { detectRepo } from "../core/detect-repo.js";
import {
	type ResolvedInvestigation,
	resolveInvestigation,
} from "../core/run-investigation.js";
import { createSessionManager } from "../core/session.js";

const PROTOCOL_VERSION = 1;

// JSON-RPC 2.0 error codes (spec-reserved range + one server-defined code).
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
/** No evidence gathered — the harness branch failed (mirrors the engine guard). */
const NO_EVIDENCE = -32000;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: JsonRpcId;
	method: string;
	params?: unknown;
}

interface JsonRpcSuccess {
	jsonrpc: "2.0";
	id: JsonRpcId;
	result: unknown;
}

interface JsonRpcErrorResponse {
	jsonrpc: "2.0";
	id: JsonRpcId;
	error: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params: unknown;
}

type OutgoingMessage =
	| JsonRpcSuccess
	| JsonRpcErrorResponse
	| JsonRpcNotification;

/** Thrown by a method handler to produce a JSON-RPC error response (never crashes). */
class RpcError extends Error {
	constructor(
		readonly code: number,
		message: string,
		readonly data?: unknown,
	) {
		super(message);
		this.name = "RpcError";
	}
}

export interface JsonRpcServerOptions {
	/** serverInfo.version reported by `initialize`. */
	version: string;
	/** Request stream (newline-delimited). Defaults to process.stdin. */
	input?: NodeJS.ReadableStream;
	/** Response/notification stream. Defaults to process.stdout. */
	output?: NodeJS.WritableStream;
}

// ---------------------------------------------------------------------------
// Param parsing (typesafe — no `as any`)
// ---------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
	return x !== null && typeof x === "object" && !Array.isArray(x);
}

function isJsonRpcId(x: unknown): x is JsonRpcId {
	return x === null || typeof x === "string" || typeof x === "number";
}

function isJsonRpcRequest(x: unknown): x is JsonRpcRequest {
	return (
		isRecord(x) &&
		x.jsonrpc === "2.0" &&
		typeof x.method === "string" &&
		(x.id === undefined || isJsonRpcId(x.id))
	);
}

function str(x: unknown): string | undefined {
	return typeof x === "string" ? x : undefined;
}

interface InvestigateParams {
	alert?: Record<string, unknown>;
	query?: string;
	repo?: string;
	harness?: string;
	model?: string;
	config?: string;
}

/** Coerce raw RPC params into the typed investigate shape (drops anything else). */
function parseInvestigateParams(raw: unknown): InvestigateParams {
	const p = isRecord(raw) ? raw : {};
	const out: InvestigateParams = {};
	if (isRecord(p.alert)) out.alert = p.alert;
	const query = str(p.query);
	if (query) out.query = query;
	const repo = str(p.repo);
	if (repo) out.repo = repo;
	const harness = str(p.harness);
	if (harness) out.harness = harness;
	const model = str(p.model);
	if (model) out.model = model;
	const config = str(p.config);
	if (config) out.config = config;
	return out;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/**
 * Run the JSON-RPC server until the input stream closes. Reads requests
 * line-by-line, dispatches by method, and writes responses/notifications back as
 * newline-delimited JSON. Resolves when stdin ends.
 */
export async function runJsonRpcServer(
	options: JsonRpcServerOptions,
): Promise<void> {
	const input = options.input ?? process.stdin;
	const output = options.output ?? process.stdout;

	const write = (message: OutgoingMessage): void => {
		output.write(`${JSON.stringify(message)}\n`);
	};
	const notify = (method: string, params: unknown): void => {
		write({ jsonrpc: "2.0", method, params });
	};
	const ok = (id: JsonRpcId, result: unknown): void => {
		write({ jsonrpc: "2.0", id, result });
	};
	const fail = (
		id: JsonRpcId,
		code: number,
		message: string,
		data?: unknown,
	): void => {
		write({
			jsonrpc: "2.0",
			id,
			error: { code, message, ...(data !== undefined ? { data } : {}) },
		});
	};

	// --- methods ---

	const handleInitialize = (): unknown => ({
		protocolVersion: PROTOCOL_VERSION,
		serverInfo: { name: "prismalens", version: options.version },
	});

	const handleInvestigate = async (rawParams: unknown): Promise<unknown> => {
		const params = parseInvestigateParams(rawParams);

		// cwd = --repo (a local repo path) else the current directory. Merge config
		// (global -> project -> --model), mirroring the `investigate` command.
		const cwd = params.repo ? resolve(params.repo) : process.cwd();
		const config = await loadConfig({
			...(params.config ? { configPath: params.config } : {}),
			cwd,
			cliOverrides: { ...(params.model ? { model: params.model } : {}) },
		});

		let resolved: ResolvedInvestigation;
		try {
			resolved = resolveInvestigation(
				{
					...(params.alert ? { alert: params.alert } : {}),
					...(params.query ? { query: params.query } : {}),
					...(params.repo ? { repo: params.repo } : {}),
					...(params.harness ? { harness: params.harness } : {}),
				},
				config,
			);
		} catch (err) {
			throw new RpcError(
				INVALID_PARAMS,
				err instanceof Error ? err.message : String(err),
			);
		}
		const { alert, telemetry, harness, synth, harnessName } = resolved;

		// Persist to the session workspace exactly as the investigate command does.
		const runId = randomUUID();
		const repoSlug = await detectRepo(cwd);
		const sessions = createSessionManager(config.workspace.base_dir);
		await sessions.create({
			runId,
			alertname: alert.alertname,
			agent: harnessName,
			...(repoSlug ? { repo: repoSlug } : {}),
		});

		// Drive the supervisor LIVE: append each canonical event to the session AND
		// emit it as an `investigate/event` notification; capture the report event.
		let report: InvestigationReport | null = null;
		let lastErrorMessage: string | undefined;
		try {
			for await (const event of investigateIncidentStream({
				alert,
				telemetry,
				harness,
				synth,
				runId,
			})) {
				await sessions.appendEvent(runId, event);
				notify("investigate/event", { runId, event });
				if (event.kind === "report") report = event.report;
				else if (event.kind === "error") lastErrorMessage = event.message;
			}
		} catch (err) {
			await sessions.update(runId, { status: "errored" });
			throw new RpcError(
				INTERNAL_ERROR,
				`Investigation failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
				{ runId },
			);
		}

		// No-evidence guard (mirrors the engine): a branch that gathered nothing and
		// errored emits no report — surface a JSON-RPC error, not a fabricated RCA.
		if (!report) {
			await sessions.update(runId, { status: "errored" });
			throw new RpcError(
				NO_EVIDENCE,
				`investigation produced no evidence — the harness branch failed: ${
					lastErrorMessage ?? "no evidence gathered"
				}`,
				{ runId },
			);
		}

		await sessions.writeReport(runId, report);
		await sessions.update(runId, {
			status: "done",
			completedAt: new Date().toISOString(),
		});

		return { runId, report };
	};

	const dispatch = async (request: JsonRpcRequest): Promise<void> => {
		const id = request.id ?? null;
		try {
			switch (request.method) {
				case "initialize":
					ok(id, handleInitialize());
					return;
				case "investigate":
					ok(id, await handleInvestigate(request.params));
					return;
				default:
					fail(id, METHOD_NOT_FOUND, `Unknown method: ${request.method}`);
					return;
			}
		} catch (err) {
			if (err instanceof RpcError) {
				fail(id, err.code, err.message, err.data);
			} else {
				fail(
					id,
					INTERNAL_ERROR,
					err instanceof Error ? err.message : String(err),
				);
			}
		}
	};

	const handleLine = (line: string): void => {
		const trimmed = line.trim();
		if (!trimmed) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			fail(null, PARSE_ERROR, "Parse error: invalid JSON");
			return;
		}
		if (!isJsonRpcRequest(parsed)) {
			const id = isRecord(parsed) && isJsonRpcId(parsed.id) ? parsed.id : null;
			fail(id, INVALID_REQUEST, "Invalid JSON-RPC request");
			return;
		}
		// Fire-and-forget: requests run independently and interleave their
		// notifications (each carries runId). dispatch() catches every error and
		// turns it into a JSON-RPC error response, so the server never crashes.
		void dispatch(parsed);
	};

	const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	rl.on("line", handleLine);
	await new Promise<void>((resolveClose) => {
		rl.on("close", () => resolveClose());
	});
}
