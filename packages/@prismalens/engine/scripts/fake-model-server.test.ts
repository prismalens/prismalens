// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ModelReportSchema } from "@prismalens/contracts/schemas";
import { afterEach, describe, expect, it } from "vitest";
import {
	type FakeModelServer,
	SCRIPTED_REPORT,
	admissionScript,
	startFakeModelServer,
	viewOf,
} from "../../../../scripts/fakes/fake-model-server.mjs";
import { parseReport } from "../src/run/report.js";

// SSE frames delimit JSON chunks and finish with [DONE] to end streaming turns.
let server: FakeModelServer | undefined;
let serverB: FakeModelServer | undefined;

afterEach(async () => {
	await server?.close();
	server = undefined;
	await serverB?.close();
	serverB = undefined;
});

describe("fake-model-server pure script", () => {
	it("handles OpenAI body with bash tool and admission step", () => {
		const body = {
			messages: [
				{
					role: "user",
					content:
						"ADMISSION STEP, required: run exactly `cat ./PRISMALENS_CWD_PROBE.txt` with the shell tool.",
				},
			],
			tools: [{ type: "function", function: { name: "bash" } }],
		};
		const view = viewOf("openai", body);
		expect(admissionScript(view)).toEqual({
			tool: {
				name: "bash",
				input: {
					command: "cat ./PRISMALENS_CWD_PROBE.txt",
					description: "Admission step",
				},
			},
		});
	});

	it("handles Anthropic body with Bash tool and 'run `ls` once'", () => {
		const body = {
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "ADMISSION STEP, required: run `ls` once" }],
				},
			],
			tools: [{ name: "Bash" }],
		};
		const view = viewOf("anthropic", body);
		expect(admissionScript(view)).toEqual({
			tool: {
				name: "Bash",
				input: {
					command: "ls",
					description: "Admission step",
				},
			},
		});
	});

	it("returns say text holding json fence when last message is a tool result", () => {
		const openaiBody = {
			messages: [
				{ role: "user", content: "run something" },
				{ role: "tool", content: "file content" },
			],
			tools: [{ type: "function", function: { name: "bash" } }],
		};
		const openaiView = viewOf("openai", openaiBody);
		const openaiReply = admissionScript(openaiView);
		expect("say" in openaiReply).toBe(true);
		if ("say" in openaiReply) {
			expect(openaiReply.say).toContain("```json");
		}

		const anthropicBody = {
			messages: [
				{ role: "user", content: "run something" },
				{
					role: "user",
					content: [{ type: "tool_result", content: "file content" }],
				},
			],
			tools: [{ name: "bash" }],
		};
		const anthropicView = viewOf("anthropic", anthropicBody);
		const anthropicReply = admissionScript(anthropicView);
		expect("say" in anthropicReply).toBe(true);
		if ("say" in anthropicReply) {
			expect(anthropicReply.say).toContain("```json");
		}
	});

	it("prefers follow-up alert question over tool result in Anthropic messages", () => {
		const body = {
			messages: [
				{
					role: "user",
					content: [
						{ type: "tool_result", content: "result" },
						{
							type: "text",
							text: "Reply with the alert name from our conversation",
						},
					],
				},
			],
			tools: [{ name: "bash" }],
		};
		const view = viewOf("anthropic", body);
		expect(admissionScript(view)).toEqual({ say: "AdmissionProbe" });
	});

	it("ignores system messages anywhere when picking the last message", () => {
		const body = {
			messages: [
				{
					role: "user",
					content:
						"ADMISSION STEP, required: run exactly `cat ./PRISMALENS_CWD_PROBE.txt` with the shell tool.",
				},
				{ role: "system", content: "System instruction that should be ignored" },
			],
			tools: [{ type: "function", function: { name: "bash" } }],
		};
		const view = viewOf("openai", body);
		expect(admissionScript(view)).toEqual({
			tool: {
				name: "bash",
				input: {
					command: "cat ./PRISMALENS_CWD_PROBE.txt",
					description: "Admission step",
				},
			},
		});
	});

	it("returns Admission probe when request has no tools", () => {
		const body = {
			messages: [{ role: "user", content: "Hello" }],
			tools: [],
		};
		const view = viewOf("openai", body);
		expect(admissionScript(view)).toEqual({ say: "Admission probe" });
	});

	it("validates SCRIPTED_REPORT against schema and parseReport", () => {
		expect(ModelReportSchema.safeParse(SCRIPTED_REPORT).success).toBe(true);
		const view = viewOf("openai", {
			messages: [{ role: "tool", content: "done" }],
			tools: [{ type: "function", function: { name: "bash" } }],
		});
		const reply = admissionScript(view);
		expect("say" in reply).toBe(true);
		if ("say" in reply) {
			expect(parseReport(reply.say).ok).toBe(true);
		}
	});
});

describe("fake-model-server HTTP", () => {
	it("exposes url and openaiBaseUrl on loopback", async () => {
		server = await startFakeModelServer();
		expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
		expect(server.openaiBaseUrl).toBe(`${server.url}/v1`);
	});

	it("streams OpenAI responses with SSE frames and done marker", async () => {
		server = await startFakeModelServer();

		const toolRes = await fetch(`${server.openaiBaseUrl}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				stream: true,
				messages: [
					{
						role: "user",
						content: "ADMISSION STEP, required: run `ls` once",
					},
				],
				tools: [{ type: "function", function: { name: "bash" } }],
			}),
		});
		expect(toolRes.headers.get("content-type")).toBe("text/event-stream");
		const toolBody = await toolRes.text();
		expect(toolBody).toContain("data: [DONE]\n\n");
		const toolLines = toolBody
			.split("\n\n")
			.filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"))
			.map((l) => JSON.parse(l.slice(6)));
		const toolCallChunk = toolLines.find(
			(c) => c.choices[0]?.delta?.tool_calls?.length > 0,
		);
		expect(toolCallChunk).toBeDefined();
		const args = JSON.parse(
			toolCallChunk.choices[0].delta.tool_calls[0].function.arguments,
		);
		expect(args.command).toBe("ls");
		const finishToolChunk = toolLines.find(
			(c) => c.choices[0]?.finish_reason === "tool_calls",
		);
		expect(finishToolChunk).toBeDefined();

		const textRes = await fetch(`${server.openaiBaseUrl}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				stream: true,
				messages: [{ role: "user", content: "hello" }],
				tools: [],
			}),
		});
		const textBody = await textRes.text();
		expect(textBody).toContain("data: [DONE]\n\n");
		const textLines = textBody
			.split("\n\n")
			.filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"))
			.map((l) => JSON.parse(l.slice(6)));
		const contentChunk = textLines.find(
			(c) => c.choices[0]?.delta?.content === "Admission probe",
		);
		expect(contentChunk).toBeDefined();
		const finishStopChunk = textLines.find(
			(c) => c.choices[0]?.finish_reason === "stop",
		);
		expect(finishStopChunk).toBeDefined();
	});

	it("streams Anthropic responses with ordered events and deltas", async () => {
		server = await startFakeModelServer();

		const toolRes = await fetch(`${server.url}/v1/messages`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				stream: true,
				messages: [
					{
						role: "user",
						content: "ADMISSION STEP, required: run `ls` once",
					},
				],
				tools: [{ name: "bash" }],
			}),
		});
		expect(toolRes.headers.get("content-type")).toBe("text/event-stream");
		const toolBody = await toolRes.text();
		const rawEvents = toolBody.trim().split("\n\n");
		const eventNames = rawEvents.map((e) => {
			const m = e.match(/^event: (\w+)/m);
			return m ? m[1] : "";
		});
		expect(eventNames).toEqual([
			"message_start",
			"content_block_start",
			"content_block_delta",
			"content_block_stop",
			"message_delta",
			"message_stop",
		]);

		const blockStart = JSON.parse(
			rawEvents[1].slice(rawEvents[1].indexOf("data: ") + 6),
		);
		expect(blockStart.content_block.type).toBe("tool_use");

		const blockDelta = JSON.parse(
			rawEvents[2].slice(rawEvents[2].indexOf("data: ") + 6),
		);
		expect(blockDelta.delta.type).toBe("input_json_delta");
		expect(JSON.parse(blockDelta.delta.partial_json).command).toBe("ls");

		const msgDelta = JSON.parse(
			rawEvents[4].slice(rawEvents[4].indexOf("data: ") + 6),
		);
		expect(msgDelta.delta.stop_reason).toBe("tool_use");

		const textRes = await fetch(`${server.url}/v1/messages`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				stream: true,
				messages: [{ role: "user", content: "hello" }],
				tools: [],
			}),
		});
		const textBody = await textRes.text();
		const textEvents = textBody.trim().split("\n\n");
		const textDelta = JSON.parse(
			textEvents[2].slice(textEvents[2].indexOf("data: ") + 6),
		);
		expect(textDelta.delta.type).toBe("text_delta");
		expect(textDelta.delta.text).toBe("Admission probe");

		const textMsgDelta = JSON.parse(
			textEvents[4].slice(textEvents[4].indexOf("data: ") + 6),
		);
		expect(textMsgDelta.delta.stop_reason).toBe("end_turn");
	});

	it("returns single JSON bodies when stream is false", async () => {
		server = await startFakeModelServer();

		const openaiRes = await fetch(`${server.openaiBaseUrl}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				stream: false,
				messages: [{ role: "user", content: "hello" }],
				tools: [],
			}),
		});
		const openaiData = await openaiRes.json();
		expect(openaiData.object).toBe("chat.completion");
		expect(openaiData.choices[0].message.content).toBe("Admission probe");
		expect(openaiData.choices[0].finish_reason).toBe("stop");

		const anthropicRes = await fetch(`${server.url}/v1/messages`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				stream: false,
				messages: [{ role: "user", content: "hello" }],
				tools: [],
			}),
		});
		const anthropicData = await anthropicRes.json();
		expect(anthropicData.type).toBe("message");
		expect(anthropicData.content[0].type).toBe("text");
		expect(anthropicData.content[0].text).toBe("Admission probe");
		expect(anthropicData.stop_reason).toBe("end_turn");
	});

	it("handles routes: models list, unknown 404, non-JSON 400", async () => {
		server = await startFakeModelServer();

		const modelsRes = await fetch(`${server.openaiBaseUrl}/models`);
		expect(modelsRes.status).toBe(200);
		const modelsData = await modelsRes.json();
		expect(modelsData.object).toBe("list");
		expect(modelsData.data[0].id).toBe("scripted");

		const unknownRes = await fetch(`${server.url}/unknown`);
		expect(unknownRes.status).toBe(404);

		const nonJsonRes = await fetch(`${server.openaiBaseUrl}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "invalid-json",
		});
		expect(nonJsonRes.status).toBe(400);
	});

	it("maintains determinism across instances and distinct ids within instance", async () => {
		server = await startFakeModelServer();
		serverB = await startFakeModelServer();

		const sequence = [
			{
				stream: false,
				messages: [
					{
						role: "user",
						content: "ADMISSION STEP, required: run `cat test.txt` with bash",
					},
				],
				tools: [{ type: "function", function: { name: "bash" } }],
			},
			{
				stream: false,
				messages: [{ role: "user", content: "hello" }],
				tools: [],
			},
			{
				stream: false,
				messages: [
					{
						role: "user",
						content: "Reply with the alert name from our conversation",
					},
				],
				tools: [{ type: "function", function: { name: "bash" } }],
			},
		];

		const resA: string[] = [];
		const resB: string[] = [];

		for (const req of sequence) {
			const a = await fetch(`${server.openaiBaseUrl}/chat/completions`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(req),
			});
			resA.push(await a.text());

			const b = await fetch(`${serverB.openaiBaseUrl}/chat/completions`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(req),
			});
			resB.push(await b.text());
		}

		expect(resA).toEqual(resB);

		const idsA = resA.map((t) => JSON.parse(t).id);
		expect(new Set(idsA).size).toBe(3);
		expect(idsA).toEqual(["chatcmpl-1", "chatcmpl-2", "chatcmpl-3"]);
	});

	it("records seen requests with 1-based indexing in requests()", async () => {
		server = await startFakeModelServer();

		await fetch(`${server.openaiBaseUrl}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				stream: false,
				messages: [{ role: "user", content: "req1" }],
				tools: [],
			}),
		});

		await fetch(`${server.url}/v1/messages`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				stream: false,
				messages: [{ role: "user", content: "req2" }],
				tools: [],
			}),
		});

		const reqs = server.requests();
		expect(reqs).toHaveLength(2);
		expect(reqs[0].n).toBe(1);
		expect(reqs[0].wire).toBe("openai");
		expect(reqs[0].lastText).toBe("req1");
		expect(reqs[1].n).toBe(2);
		expect(reqs[1].wire).toBe("anthropic");
		expect(reqs[1].lastText).toBe("req2");
	});

	it("replaces admissionScript when custom script option is provided", async () => {
		server = await startFakeModelServer({
			script: () => ({ say: "custom response" }),
		});

		const res = await fetch(`${server.openaiBaseUrl}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				stream: false,
				messages: [{ role: "user", content: "hello" }],
				tools: [],
			}),
		});
		const data = await res.json();
		expect(data.choices[0].message.content).toBe("custom response");
	});
});
