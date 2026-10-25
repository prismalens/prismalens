#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// A scripted model on loopback: OpenAI chat completions, the OpenAI Responses API and Anthropic Messages, all as SSE.
// The reply is a pure function of the request, so a rerun gives the same stream (#884).
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const ADMISSION_STEP = /ADMISSION STEP, required: run (?:exactly )?`([^`]+)`/;
const FOLLOW_UP = /Reply with the alert name from our conversation/;
const CLASSIFIER = /<severity>N<\/severity>/;

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
					observation:
						"The scripted model ran the step the admission asked for.",
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

/**
 * @param {unknown} content
 * @returns {string}
 */
function textOf(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((b) => (b && typeof b.text === "string" ? b.text : ""))
		.join("\n");
}

/**
 * One request in the shape the three wires share.
 * @param {"openai" | "anthropic" | "responses"} wire
 * @param {any} body
 * @returns {import("./fake-model-server.d.mts").ModelRequest}
 */
export function viewOf(wire, body) {
	// The Responses API sends `input` items: messages, and `function_call_output` for a tool's result.
	const items =
		wire === "responses"
			? Array.isArray(body?.input)
				? body.input
				: [{ role: "user", content: String(body?.input ?? "") }]
			: Array.isArray(body?.messages)
				? body.messages
				: [];
	const messages = items.filter(
		(/** @type {any} */ m) => m?.role !== "system" && m?.role !== "developer",
	);
	const last = messages.at(-1);
	const toolNames = (Array.isArray(body?.tools) ? body.tools : []).map(
		(/** @type {any} */ t) =>
			String(t?.function?.name ?? t?.name ?? t?.type ?? ""),
	);
	const toolResult =
		wire === "openai"
			? last?.role === "tool"
			: wire === "responses"
				? typeof last?.type === "string" && /_output$/.test(last.type)
				: Array.isArray(last?.content) &&
					last.content.some(
						(/** @type {any} */ b) => b?.type === "tool_result",
					);
	return {
		wire,
		model: String(body?.model ?? ""),
		stream: body?.stream === true,
		toolNames,
		lastText: textOf(last?.content),
		lastIsToolResult: toolResult,
		structured: Object.keys(body?.text?.format?.schema?.properties ?? {}),
		lastToolName: toolResult ? calledName(wire, messages, last) : "",
		turnText: turnTextOf(wire, messages),
		n: 0,
	};
}

/** The shell tool each agent offers, and the arguments it takes for a command. */
const SHELL_TOOLS = {
	bash: (/** @type {string} */ c) => ({
		command: c,
		description: "Admission step",
	}),
	shell_command: (/** @type {string} */ c) => ({ command: c }),
	exec_command: (/** @type {string} */ c) => ({ cmd: c }),
	shell: (/** @type {string} */ c) => ({ command: ["bash", "-lc", c] }),
};

/**
 * The tool a trailing tool result answers, from the assistant message that called it.
 * @param {"openai" | "anthropic" | "responses"} wire
 * @param {any[]} messages
 * @param {any} last
 */
function calledName(wire, messages, last) {
	if (wire === "responses") {
		const call = messages.findLast(
			(/** @type {any} */ m) =>
				typeof m?.type === "string" &&
				/_call$/.test(m.type) &&
				m.call_id === last?.call_id,
		);
		return String(call?.name ?? "");
	}
	const id =
		wire === "openai"
			? last?.tool_call_id
			: last?.content?.find((/** @type {any} */ b) => b?.type === "tool_result")
					?.tool_use_id;
	for (const m of [...messages].reverse()) {
		if (m?.role !== "assistant") continue;
		const hit =
			wire === "openai"
				? m.tool_calls?.find((/** @type {any} */ c) => c?.id === id)?.function
						?.name
				: Array.isArray(m.content)
					? m.content.find(
							(/** @type {any} */ b) => b?.type === "tool_use" && b.id === id,
						)?.name
					: undefined;
		if (hit) return String(hit);
	}
	return "";
}

/**
 * The text of the turn's user message: the last user message that carries no tool result.
 * @param {"openai" | "anthropic" | "responses"} wire
 * @param {any[]} messages
 */
function turnTextOf(wire, messages) {
	for (const m of [...messages].reverse()) {
		if (m?.role !== "user") continue;
		if (
			wire === "anthropic" &&
			Array.isArray(m.content) &&
			m.content.some((/** @type {any} */ b) => b?.type === "tool_result")
		)
			continue;
		return textOf(m.content);
	}
	return "";
}

/**
 * What the scripted model does with a request: say a text, or call a tool. Offered
 * PrismaLens's `incident_get`, it calls it once at the start of every user turn (#848).
 * @type {import("./fake-model-server.d.mts").Script}
 */
export function admissionScript(req) {
	// Codex's Approve-for-me mode asks the model to review each action, and it titles the chat: both want JSON.
	if (req.structured.includes("outcome"))
		return {
			say: JSON.stringify({
				outcome: "allow",
				risk_level: "low",
				user_authorization: "high",
				rationale: "scripted",
			}),
		};
	if (req.structured.includes("title"))
		return { say: JSON.stringify({ title: "Admission probe" }) };
	// Claude Code's auto-mode classifier grades a PrismaLens tool call; it reads only <severity>.
	if (
		req.toolNames.length === 0 &&
		CLASSIFIER.test(req.lastText) &&
		/incident_get/.test(req.lastText)
	)
		return { say: "<severity>0</severity>" };
	if (req.toolNames.length === 0) return { say: "Admission probe" };
	const incident = req.toolNames.find((n) => /incident_get$/.test(n));
	if (!incident) return answer(req, req.lastText, req.lastIsToolResult);
	if (!req.lastIsToolResult) return { tool: { name: incident, input: {} } };
	return req.lastToolName === incident
		? answer(req, req.turnText, false)
		: answer(req, req.lastText, true);
}

/**
 * The turn's answer to `text`: the follow-up's alert name, the report after a tool, else the step.
 * @param {import("./fake-model-server.d.mts").ModelRequest} req
 * @param {string} text
 * @param {boolean} afterTool
 * @returns {import("./fake-model-server.d.mts").Reply}
 */
function answer(req, text, afterTool) {
	if (FOLLOW_UP.test(text)) return { say: "AdmissionProbe" };
	if (afterTool) return { say: REPORT_TEXT };
	const step = ADMISSION_STEP.exec(text);
	const shell = req.toolNames.find((n) => n.toLowerCase() in SHELL_TOOLS);
	if (step && shell)
		return {
			tool: {
				name: shell,
				input: SHELL_TOOLS[
					/** @type {keyof typeof SHELL_TOOLS} */ (shell.toLowerCase())
				](step[1] ?? ""),
			},
		};
	return { say: REPORT_TEXT };
}

const sse = (
	/** @type {string | undefined} */ event,
	/** @type {unknown} */ data,
) =>
	`${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

const USAGE = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };

/**
 * @param {import("./fake-model-server.d.mts").ModelRequest} req
 * @param {import("./fake-model-server.d.mts").Reply} reply
 */
function openaiStream(req, reply) {
	const chunk = (
		/** @type {any} */ delta,
		/** @type {string | null} */ finish,
	) =>
		sse(undefined, {
			id: `chatcmpl-${req.n}`,
			object: "chat.completion.chunk",
			created: 0,
			model: req.model,
			choices: [{ index: 0, delta, finish_reason: finish }],
		});
	const head = chunk({ role: "assistant", content: "" }, null);
	const tail = sse(undefined, {
		id: `chatcmpl-${req.n}`,
		object: "chat.completion.chunk",
		created: 0,
		model: req.model,
		choices: [],
		usage: USAGE,
	});
	if ("tool" in reply)
		return (
			head +
			chunk(
				{
					tool_calls: [
						{
							index: 0,
							id: `call_${req.n}`,
							type: "function",
							function: {
								name: reply.tool.name,
								arguments: JSON.stringify(reply.tool.input),
							},
						},
					],
				},
				null,
			) +
			chunk({}, "tool_calls") +
			tail +
			sse(undefined, "[DONE]")
		);
	return (
		head +
		chunk({ content: reply.say }, null) +
		chunk({}, "stop") +
		tail +
		sse(undefined, "[DONE]")
	);
}

/**
 * The Responses API: one output item, a message or a function call, between created and completed.
 * @param {import("./fake-model-server.d.mts").ModelRequest} req
 * @param {import("./fake-model-server.d.mts").Reply} reply
 */
function responsesStream(req, reply) {
	const response = (
		/** @type {string} */ status,
		/** @type {unknown[]} */ output,
	) => ({
		id: `resp_${req.n}`,
		object: "response",
		created_at: 0,
		status,
		model: req.model,
		output,
		parallel_tool_calls: false,
		usage:
			status === "completed"
				? {
						input_tokens: 1,
						input_tokens_details: { cached_tokens: 0 },
						output_tokens: 1,
						output_tokens_details: { reasoning_tokens: 0 },
						total_tokens: 2,
					}
				: null,
	});
	const created = sse("response.created", {
		type: "response.created",
		response: response("in_progress", []),
	});
	if ("tool" in reply) {
		const item = {
			type: "function_call",
			id: `fc_${req.n}`,
			call_id: `call_${req.n}`,
			name: reply.tool.name,
			arguments: JSON.stringify(reply.tool.input),
			status: "completed",
		};
		return (
			created +
			sse("response.output_item.added", {
				type: "response.output_item.added",
				output_index: 0,
				item: { ...item, arguments: "", status: "in_progress" },
			}) +
			sse("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 0,
				item,
			}) +
			sse("response.completed", {
				type: "response.completed",
				response: response("completed", [item]),
			})
		);
	}
	const id = `msg_${req.n}`;
	const item = {
		type: "message",
		id,
		role: "assistant",
		status: "completed",
		content: [{ type: "output_text", text: reply.say, annotations: [] }],
	};
	return (
		created +
		sse("response.output_item.added", {
			type: "response.output_item.added",
			output_index: 0,
			item: { ...item, status: "in_progress", content: [] },
		}) +
		sse("response.content_part.added", {
			type: "response.content_part.added",
			item_id: id,
			output_index: 0,
			content_index: 0,
			part: { type: "output_text", text: "", annotations: [] },
		}) +
		sse("response.output_text.delta", {
			type: "response.output_text.delta",
			item_id: id,
			output_index: 0,
			content_index: 0,
			delta: reply.say,
		}) +
		sse("response.output_text.done", {
			type: "response.output_text.done",
			item_id: id,
			output_index: 0,
			content_index: 0,
			text: reply.say,
		}) +
		sse("response.output_item.done", {
			type: "response.output_item.done",
			output_index: 0,
			item,
		}) +
		sse("response.completed", {
			type: "response.completed",
			response: response("completed", [item]),
		})
	);
}

/**
 * @param {import("./fake-model-server.d.mts").ModelRequest} req
 * @param {import("./fake-model-server.d.mts").Reply} reply
 */
function anthropicStream(req, reply) {
	const block =
		"tool" in reply
			? {
					type: "tool_use",
					id: `toolu_${req.n}`,
					name: reply.tool.name,
					input: {},
				}
			: { type: "text", text: "" };
	const delta =
		"tool" in reply
			? {
					type: "input_json_delta",
					partial_json: JSON.stringify(reply.tool.input),
				}
			: { type: "text_delta", text: reply.say };
	return (
		sse("message_start", {
			type: "message_start",
			message: {
				id: `msg_${req.n}`,
				type: "message",
				role: "assistant",
				model: req.model,
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: 1, output_tokens: 1 },
			},
		}) +
		sse("content_block_start", {
			type: "content_block_start",
			index: 0,
			content_block: block,
		}) +
		sse("content_block_delta", {
			type: "content_block_delta",
			index: 0,
			delta,
		}) +
		sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
		sse("message_delta", {
			type: "message_delta",
			delta: {
				stop_reason: "tool" in reply ? "tool_use" : "end_turn",
				stop_sequence: null,
			},
			usage: { output_tokens: 1 },
		}) +
		sse("message_stop", { type: "message_stop" })
	);
}

/**
 * @param {import("./fake-model-server.d.mts").ModelRequest} req
 * @param {import("./fake-model-server.d.mts").Reply} reply
 */
function wholeBody(req, reply) {
	if (req.wire === "responses") {
		const stream = responsesStream(req, reply);
		const done = stream.match(/event: response\.completed\ndata: (.*)\n/);
		return JSON.parse(done?.[1] ?? "{}").response;
	}
	if (req.wire === "openai")
		return {
			id: `chatcmpl-${req.n}`,
			object: "chat.completion",
			created: 0,
			model: req.model,
			choices: [
				{
					index: 0,
					finish_reason: "tool" in reply ? "tool_calls" : "stop",
					message:
						"tool" in reply
							? {
									role: "assistant",
									content: null,
									tool_calls: [
										{
											id: `call_${req.n}`,
											type: "function",
											function: {
												name: reply.tool.name,
												arguments: JSON.stringify(reply.tool.input),
											},
										},
									],
								}
							: { role: "assistant", content: reply.say },
				},
			],
			usage: USAGE,
		};
	return {
		id: `msg_${req.n}`,
		type: "message",
		role: "assistant",
		model: req.model,
		content:
			"tool" in reply
				? [
						{
							type: "tool_use",
							id: `toolu_${req.n}`,
							name: reply.tool.name,
							input: reply.tool.input,
						},
					]
				: [{ type: "text", text: reply.say }],
		stop_reason: "tool" in reply ? "tool_use" : "end_turn",
		stop_sequence: null,
		usage: { input_tokens: 1, output_tokens: 1 },
	};
}

/**
 * @param {{ port?: number, host?: string, script?: import("./fake-model-server.d.mts").Script }} [options]
 * @returns {Promise<import("./fake-model-server.d.mts").FakeModelServer>}
 */
export async function startFakeModelServer(options = {}) {
	const host = options.host ?? "127.0.0.1";
	const script = options.script ?? admissionScript;
	/** @type {import("./fake-model-server.d.mts").ModelRequest[]} */
	const seen = [];

	const server = createServer((httpReq, res) => {
		handle(httpReq, res).catch((err) => {
			if (!res.headersSent)
				res.writeHead(500, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: `fake-model-server: ${String(err)}` }));
		});
	});
	async function handle(
		/** @type {import("node:http").IncomingMessage} */ httpReq,
		/** @type {import("node:http").ServerResponse} */ res,
	) {
		const path = (httpReq.url ?? "/").split("?")[0];
		const json = (
			/** @type {number} */ status,
			/** @type {unknown} */ body,
		) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(body));
		};
		if (httpReq.method === "GET" && /\/models$/.test(path ?? ""))
			return json(200, {
				object: "list",
				data: [{ id: "scripted", object: "model", type: "model" }],
			});
		const wire = /\/chat\/completions$/.test(path ?? "")
			? "openai"
			: /\/v1\/messages$/.test(path ?? "")
				? "anthropic"
				: /\/responses$/.test(path ?? "")
					? "responses"
					: null;
		if (httpReq.method !== "POST" || !wire)
			return json(404, {
				error: `fake-model-server: no route ${httpReq.method} ${path}`,
			});
		const chunks = [];
		for await (const c of httpReq) chunks.push(c);
		let body;
		try {
			body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {
			return json(400, { error: "fake-model-server: body is not JSON" });
		}
		const req = { ...viewOf(wire, body), n: seen.length + 1 };
		seen.push(req);
		const reply = script(req);
		if (!req.stream) return json(200, wholeBody(req, reply));
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
		});
		res.end(
			wire === "openai"
				? openaiStream(req, reply)
				: wire === "responses"
					? responsesStream(req, reply)
					: anthropicStream(req, reply),
		);
	}

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port ?? 0, host, () => resolve(undefined));
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("fake-model-server: no port");
	const root = `http://${host}:${address.port}`;
	return {
		url: root,
		openaiBaseUrl: `${root}/v1`,
		requests: () => [...seen],
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve(undefined));
			}),
	};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const portArg = process.argv.indexOf("--port");
	const fake = await startFakeModelServer({
		port: portArg > -1 ? Number(process.argv[portArg + 1]) : 0,
	});
	console.log(fake.url);
	process.on("SIGTERM", () => void fake.close().then(() => process.exit(0)));
}
