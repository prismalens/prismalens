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
 *  - investigate -> drives the shared conductor (`conductRun`, ADR-0018), emitting
 *      an `investigate/event` NOTIFICATION per canonical event, then resolving with
 *      { runId, report }. A no-evidence run resolves to a JSON-RPC error (-32000).
 *
 * Robustness: a malformed or failed request becomes a JSON-RPC error response —
 * the server never crashes on bad input.
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { conductRun } from "@prismalens/engine";
import {
	JSONRPCErrorException,
	type JSONRPCRequest,
	type JSONRPCResponse,
	JSONRPCServer,
} from "json-rpc-2.0";
import { loadConfig } from "../config/loader.js";
import { resolveRepoSlug } from "../core/detect-repo.js";
import { createFileSessionStore } from "../core/file-session-store.js";
import {
	type ResolvedInvestigation,
	resolveInvestigation,
} from "../core/run-investigation.js";
import { createSessionManager } from "../core/session.js";
import type { JsonRpcNotification } from "./types.js";

const PROTOCOL_VERSION = 1;

// JSON-RPC 2.0 error codes (spec-reserved range + one server-defined code).
const PARSE_ERROR = -32700;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
/** No evidence gathered — the harness branch failed (mirrors the engine guard). */
const NO_EVIDENCE = -32000;

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
	service?: string;
	/** The posture dial (ADR-0017): "read-only" | "supervised" | "auto" | "dangerous". */
	mode?: string;
	/** Alias for `mode: "dangerous"` — wins over `mode` when true. */
	dangerouslySkipPermissions?: boolean;
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
	const service = str(p.service);
	if (service) out.service = service;
	const mode = str(p.mode);
	if (mode) out.mode = mode;
	if (typeof p.dangerouslySkipPermissions === "boolean") {
		out.dangerouslySkipPermissions = p.dangerouslySkipPermissions;
	}
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

	const write = (message: JsonRpcNotification | JSONRPCResponse): void => {
		output.write(`${JSON.stringify(message)}\n`);
	};
	const notify = (method: string, params: unknown): void => {
		write({ jsonrpc: "2.0", method, params });
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

		// The single posture dial (ADR-0017): dangerouslySkipPermissions wins over
		// mode, aliasing straight to "dangerous".
		const permissionMode = params.dangerouslySkipPermissions
			? "dangerous"
			: params.mode;

		let resolved: ResolvedInvestigation;
		try {
			resolved = resolveInvestigation(
				{
					...(params.alert ? { alert: params.alert } : {}),
					...(params.query ? { query: params.query } : {}),
					...(params.repo ? { repo: params.repo } : {}),
					...(params.harness ? { harness: params.harness } : {}),
					...(params.service ? { service: params.service } : {}),
					...(permissionMode ? { permissionMode } : {}),
				},
				config,
			);
		} catch (err) {
			throw new JSONRPCErrorException(
				err instanceof Error ? err.message : String(err),
				INVALID_PARAMS,
			);
		}
		const { context, harness, synth, harnessName, fidelity } = resolved;
		const primaryAlert = context.alerts[0];

		// Persist to the session workspace exactly as the investigate command does,
		// wrapped as a conductRun store adapter (ADR-0018).
		const runId = randomUUID();
		const repoSlug = await resolveRepoSlug(config.repo, cwd);
		const sessions = createSessionManager(config.workspace.base_dir);
		const fileSession = createFileSessionStore(sessions, {
			runId,
			alertname: primaryAlert.alertname,
			agent: harnessName,
			...(repoSlug ? { repo: repoSlug } : {}),
		});

		// Drive the supervisor LIVE via the shared conductor: emit each canonical
		// event as an `investigate/event` notification; conductRun owns persistence
		// + the terminal report/no-evidence/error outcome.
		const outcome = await conductRun(
			{ context, harness, synth, fidelity, runId },
			{
				sink: (event) => {
					notify("investigate/event", { runId, event });
				},
				store: fileSession.store,
			},
		);

		if (!outcome.report) {
			throw new JSONRPCErrorException(
				outcome.error ?? "investigation produced no evidence",
				outcome.failureKind === "no-evidence" ? NO_EVIDENCE : INTERNAL_ERROR,
				{ runId },
			);
		}

		return { runId: outcome.runId, report: outcome.report };
	};

	const server = new JSONRPCServer();
	server.addMethod("initialize", () => handleInitialize());
	server.addMethod("investigate", (params: unknown) =>
		handleInvestigate(params),
	);
	server.mapErrorToJSONRPCErrorResponse = (id, error) => {
		if (error instanceof JSONRPCErrorException) {
			return {
				jsonrpc: "2.0",
				id,
				error: {
					code: error.code,
					message: error.message,
					...(error.data !== undefined ? { data: error.data } : {}),
				},
			};
		}
		return {
			jsonrpc: "2.0",
			id,
			error: {
				code: INTERNAL_ERROR,
				message: error instanceof Error ? error.message : String(error),
			},
		};
	};

	const handleLine = (line: string): void => {
		const trimmed = line.trim();
		if (!trimmed) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			write({
				jsonrpc: "2.0",
				id: null,
				error: { code: PARSE_ERROR, message: "Parse error: invalid JSON" },
			});
			return;
		}
		void server.receive(parsed as JSONRPCRequest).then((response) => {
			if (response) write(response);
		});
	};

	const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	rl.on("line", handleLine);
	await new Promise<void>((resolveClose) => {
		rl.on("close", () => resolveClose());
	});
}
