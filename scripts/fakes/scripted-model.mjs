#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The scripted model every agent's model calls go to: aimock serving the fixtures under
// scripts/fakes/scenarios/, with the agent's own tool names filled in (#914).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	LLMock,
	normalizeResponse,
	validateFixtures,
} from "@copilotkit/aimock";

export const SCENARIOS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"scenarios",
);
/** The only key aimock accepts; a run without it is a run that is not signed in. */
export const SCRIPTED_KEY = "scripted";

/** A report that validates against ModelReportSchema, with no evidence the host would downgrade. */
export const SCRIPTED_REPORT = {
	summary: "The scripted model found the entry point.",
	rootCause: null,
	rootCauseCategory: null,
	hypotheses: [
		{
			statement: "The repository's main entry point is the package manifest.",
			status: "supported",
			evidence: [
				{
					observation: "The scripted model ran the step it was asked for.",
					source: "scripted model",
					direction: "supports",
					status: "inferred",
					toolCallId: null,
				},
			],
		},
	],
	ruledOut: [],
	coverage: { queried: ["shell"], notQueried: [] },
	nextSteps: [],
};
const REPORT_TEXT = `Done.\n\n\`\`\`json\n${JSON.stringify(SCRIPTED_REPORT)}\n\`\`\`\n`;

const readJson = (/** @type {string} */ file) =>
	JSON.parse(readFileSync(join(SCENARIOS_DIR, file), "utf8"));

/** @returns {Record<string, import("./scripted-model.d.mts").AgentTools>} */
export const agentTools = () => readJson("agents.json").agents;

/** @returns {import("./scripted-model.d.mts").Row[]} */
export function matrixRows() {
	return readdirSync(join(SCENARIOS_DIR, "rows"))
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((f) => readJson(join("rows", f)));
}

const INCIDENT = "$incident_get";
/** @param {import("@copilotkit/aimock").ChatCompletionRequest} req */
const incidentTool = (req) =>
	req.tools?.find((t) => /incident_get$/.test(t.function.name));
/**
 * The name of the tool the request's trailing tool result answers, or "".
 * @param {import("@copilotkit/aimock").ChatCompletionRequest} req
 */
const answeredTool = (req) => {
	const last = req.messages.at(-1);
	if (last?.role !== "tool") return "";
	for (const m of req.messages)
		for (const c of m.tool_calls ?? [])
			if (c.id === last.tool_call_id) return c.function.name;
	return "";
};
/** @param {import("@copilotkit/aimock").ChatMessage} m */
const textOf = (m) =>
	typeof m.content === "string"
		? m.content
		: (m.content ?? []).map((p) => ("text" in p ? p.text : "")).join("\n");

/**
 * One file entry with this agent's names in it: `$shell` and `$command` from the tool map,
 * `$ask` as the arguments that make the agent ask first,
 * `$report` as the report, `$incident_get` as whatever name the agent gave PrismaLens's tool.
 * @param {import("@copilotkit/aimock").FixtureFileEntry} entry
 * @param {import("./scripted-model.d.mts").AgentTools} tools
 * @param {boolean} mainLoop answer only the requests that offer the agent's shell tool
 * @returns {import("@copilotkit/aimock").Fixture}
 */
export function resolveEntry(entry, tools, mainLoop) {
	const raw = /** @type {any} */ (structuredClone(entry.response));
	if (raw.content === "$report") raw.content = REPORT_TEXT;
	for (const call of raw.toolCalls ?? []) {
		if (call.name === "$shell") call.name = tools.shell;
		const args = call.arguments;
		if (args && typeof args === "object" && "$command" in args) {
			const { $command, $ask, ...rest } = args;
			call.arguments = {
				...tools.extra,
				...($ask ? tools.ask : {}),
				...rest,
				[tools.command]: $command,
			};
		}
	}
	const { match: fileMatch, response: _, ...opts } = entry;
	const { inConversation, afterTool, ...rest } = /** @type {any} */ (fileMatch);
	/** @type {import("@copilotkit/aimock").FixtureMatch} */
	const match = { ...rest };
	if (mainLoop && !match.toolName) match.toolName = tools.shell;
	/** @type {((req: import("@copilotkit/aimock").ChatCompletionRequest) => boolean)[]} */
	const tests = [];
	if (match.toolName === INCIDENT) {
		delete match.toolName;
		tests.push((req) => incidentTool(req) !== undefined);
	}
	// The result's text differs by agent (Codex wraps an MCP result); the tool it answers does not.
	if (afterTool === INCIDENT)
		tests.push((req) => /incident_get$/.test(answeredTool(req)));
	// `userMessage` reads only the last user message; a row's marker must also hold on its retries.
	if (typeof inConversation === "string")
		tests.push((req) =>
			req.messages.some(
				(m) => m.role === "user" && textOf(m).includes(inConversation),
			),
		);
	if (tests.length > 0) match.predicate = (req) => tests.every((t) => t(req));
	const response = normalizeResponse(raw);
	const named = (raw.toolCalls ?? []).some(
		(/** @type {{ name: string }} */ c) => c.name === INCIDENT,
	);
	return {
		...opts,
		match,
		response: named
			? (req) => {
					const tool = incidentTool(req);
					const calls = /** @type {any} */ (response).toolCalls.map(
						(/** @type {any} */ c) =>
							c.name === INCIDENT
								? {
										...c,
										name: tool?.function.name ?? c.name,
										...(tool?.namespace ? { namespace: tool.namespace } : {}),
									}
								: c,
					);
					return { ...response, toolCalls: calls };
				}
			: response,
	};
}

/**
 * The fixtures one agent is served, in match order: the admission, every matrix row,
 * then the side requests (titles, classifiers, small-model calls) last.
 * @param {string} harness
 */
export function fixturesFor(harness) {
	const tools = agentTools()[harness];
	if (!tools) throw new Error(`scripted-model: no tool map for ${harness}`);
	const main = [
		...readJson("admission.json").fixtures,
		...matrixRows().flatMap((r) => r.fixtures),
		...readJson("fallback.json").fixtures,
	].map((e) => resolveEntry(e, tools, true));
	const side = readJson("side.json").fixtures.map(
		(/** @type {import("@copilotkit/aimock").FixtureFileEntry} */ e) =>
			resolveEntry(e, tools, false),
	);
	return [...main, ...side];
}

/**
 * Starts aimock on loopback with one agent's fixtures.
 * @param {string} harness
 * @param {{ port?: number }} [options]
 * @returns {Promise<import("./scripted-model.d.mts").ScriptedModel>}
 */
export async function startScriptedModel(harness, options = {}) {
	const fixtures = fixturesFor(harness);
	const problems = validateFixtures(fixtures).filter(
		(p) => p.severity === "error",
	);
	if (problems.length > 0)
		throw new Error(
			`scripted-model: ${problems.map((p) => `#${p.fixtureIndex} ${p.message}`).join("; ")}`,
		);
	const mock = new LLMock({
		port: options.port ?? 0,
		host: "127.0.0.1",
		strict: true,
		enableMisbehavior: true,
		auth: { apiKeys: [SCRIPTED_KEY] },
		// Codex offers MCP tools inside a namespace; extended mode sees and answers them.
		responsesTools: "extended",
	});
	/** @type {ReturnType<typeof requestSummary>[]} */
	const seen = [];
	mock.addFixture({
		match: {
			predicate: (req) => {
				seen.push(requestSummary(req));
				return false;
			},
		},
		response: { content: "" },
	});
	mock.addFixtures(fixtures);
	const url = await mock.start();
	return {
		url,
		openaiBaseUrl: `${url}/v1`,
		journal: () => mock.getRequests(),
		requests: () => [...seen],
		resetMatchCounts: () => {
			mock.resetMatchCounts();
		},
		close: () => mock.stop(),
	};
}

/**
 * What a request looked like, without the agent's prompt: the tools offered, and the
 * opening of its last message. aimock's journal drops bodies over 64 KB, as most are.
 * @param {import("@copilotkit/aimock").ChatCompletionRequest} req
 */
export function requestSummary(req) {
	const last = req.messages.at(-1);
	return {
		model: req.model,
		tools: (req.tools ?? []).map(
			(t) => `${t.namespace ? `${t.namespace}/` : ""}${t.function.name}`,
		),
		last: `${last?.role ?? "?"}: ${last ? textOf(last).slice(0, 160) : ""}`,
	};
}
