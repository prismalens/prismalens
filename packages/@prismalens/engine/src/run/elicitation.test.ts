// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	elicitationAccepts,
	elicitationAsk,
	elicitationContent,
} from "./elicitation.js";

const questionForm = {
	mode: "form",
	message: "Which environment?",
	requestedSchema: {
		properties: {
			question_0: {
				type: "string",
				title: "Env",
				oneOf: [
					{ const: "staging", title: "Staging", description: "Safe" },
					{
						const: "prod",
						title: "Production",
						_meta: { "x/opt": { preview: "kubectl -n prod" } },
					},
				],
			},
			question_0_custom: { type: "string", title: "Other" },
		},
	},
};

describe("elicitationAsk (#1024)", () => {
	it("a form of selects becomes a question, with Other and previews", () => {
		expect(elicitationAsk(questionForm)).toEqual({
			kind: "question",
			title: "Which environment?",
			questions: [
				{
					id: "question_0",
					prompt: "Which environment?",
					header: "Env",
					multiSelect: false,
					allowOther: true,
					required: false,
					options: [
						{ id: "staging", label: "Staging", description: "Safe" },
						{ id: "prod", label: "Production", preview: "kubectl -n prod" },
					],
				},
			],
		});
	});

	it("a multi-select array field is a multiSelect question", () => {
		const ask = elicitationAsk({
			message: "Pick",
			requestedSchema: {
				properties: {
					q: { type: "array", items: { enum: ["a", "b", "c"] } },
				},
			},
		});
		expect(ask?.kind === "question" && ask.questions[0]?.multiSelect).toBe(true);
	});

	it("a primitive form is an input ask; an unknown field type or url mode declines", () => {
		const input = elicitationAsk({
			message: "Token name",
			requestedSchema: {
				properties: { name: { type: "string" }, n: { type: "integer" } },
				required: ["name"],
			},
		});
		expect(input?.kind).toBe("input");
		expect(
			elicitationAsk({ requestedSchema: { properties: { x: { type: "object" } } } }),
		).toBeNull();
		expect(elicitationAsk({ mode: "url", message: "open" })).toBeNull();
	});
});

describe("elicitationContent (#1024)", () => {
	it("maps a question answer back to the form, Other included", () => {
		const ask = elicitationAsk(questionForm);
		if (!ask) throw new Error("no ask");
		expect(
			elicitationContent(ask, {
				kind: "question",
				answers: { question_0: { options: ["prod"], other: "and canary" } },
			}),
		).toEqual({ question_0: "prod", question_0_custom: "and canary" });
	});

	it("refuses an input answer that misses a required field or has the wrong type", () => {
		const ask = elicitationAsk({
			requestedSchema: {
				properties: { name: { type: "string" }, n: { type: "integer" } },
				required: ["name"],
			},
		});
		if (!ask) throw new Error("no ask");
		expect(elicitationContent(ask, { kind: "input", values: { n: 1 } })).toBeNull();
		expect(
			elicitationContent(ask, { kind: "input", values: { name: "x", n: 1.5 } }),
		).toBeNull();
		expect(
			elicitationContent(ask, { kind: "input", values: { name: "x", n: 2 } }),
		).toEqual({ name: "x", n: 2 });
	});
});

describe("elicitationContent refuses an answer the form would not take (#1024)", () => {
	const form = elicitationAsk({
		requestedSchema: {
			properties: {
				name: { type: "string", minLength: 2, maxLength: 5 },
				mail: { type: "string", format: "email" },
				env: { type: "string", enum: ["staging", "prod"] },
				hours: { type: "integer", minimum: 1, maximum: 72 },
			},
			required: ["name"],
		},
	});
	if (!form) throw new Error("no form");
	const input = (values: Record<string, string | number | boolean>) =>
		elicitationContent(form, { kind: "input", values });

	it("checks length, format, enum, bounds and unknown fields", () => {
		expect(input({ name: "ok" })).toEqual({ name: "ok" });
		expect(input({ name: "x" })).toBeNull();
		expect(input({ name: "toolong" })).toBeNull();
		expect(input({ name: "ok", mail: "not-an-email" })).toBeNull();
		expect(input({ name: "ok", mail: "a@b.co" })).toEqual({ name: "ok", mail: "a@b.co" });
		expect(input({ name: "ok", env: "dev" })).toBeNull();
		expect(input({ name: "ok", hours: 0 })).toBeNull();
		expect(input({ name: "ok", hours: 73 })).toBeNull();
		expect(input({ name: "ok", extra: "x" })).toBeNull();
	});

	it("a question takes known options only, one for a single select, and Other only where offered", () => {
		const q = elicitationAsk({
			requestedSchema: {
				properties: {
					one: { type: "string", enum: ["a", "b"] },
					many: { type: "array", items: { enum: ["x", "y", "z"] } },
				},
			},
		});
		if (!q) throw new Error("no question");
		const answer = (answers: Record<string, { options: string[]; other?: string }>) =>
			elicitationContent(q, { kind: "question", answers });
		expect(answer({ one: { options: ["a"] }, many: { options: ["x", "z"] } })).toEqual({
			one: "a",
			many: ["x", "z"],
		});
		expect(answer({ one: { options: ["a", "b"] } })).toBeNull();
		expect(answer({ one: { options: ["nope"] } })).toBeNull();
		expect(answer({ one: { options: [], other: "c" } })).toBeNull();
		expect(answer({ ghost: { options: ["a"] } })).toBeNull();
	});
});

describe("elicitationAccepts (#1024)", () => {
	it("settles on a decline or a valid answer, never on an answer the form refuses", () => {
		const ask = elicitationAsk({
			requestedSchema: { properties: { hours: { type: "integer", minimum: 1 } } },
		});
		if (!ask) throw new Error("no ask");
		const accepts = elicitationAccepts(ask);
		expect(accepts({ kind: "decline" })).toBe(true);
		expect(accepts({ kind: "input", values: { hours: 2 } })).toBe(true);
		expect(accepts({ kind: "input", values: { hours: 0 } })).toBe(false);
		expect(accepts({ kind: "question", answers: {} })).toBe(false);
	});
});

describe("required questions and calendar dates (#1024)", () => {
	it("keeps a form's required list on its questions, and refuses an answer that leaves one empty", () => {
		const ask = elicitationAsk({
			requestedSchema: {
				properties: {
					env: { type: "string", enum: ["staging", "prod"] },
					why: { type: "string", enum: ["deploy", "load"] },
				},
				required: ["env"],
			},
		});
		if (ask?.kind !== "question") throw new Error("no question");
		expect(ask.questions.map((q) => [q.id, q.required])).toEqual([
			["env", true],
			["why", false],
		]);
		expect(elicitationContent(ask, { kind: "question", answers: {} })).toBeNull();
		expect(
			elicitationContent(ask, { kind: "question", answers: { env: { options: ["prod"] } } }),
		).toEqual({ env: "prod" });
	});

	it("refuses a date the calendar does not have", () => {
		const ask = elicitationAsk({
			requestedSchema: {
				properties: {
					day: { type: "string", format: "date" },
					at: { type: "string", format: "date-time" },
				},
			},
		});
		if (!ask) throw new Error("no ask");
		const take = (values: Record<string, string>) =>
			elicitationContent(ask, { kind: "input", values });
		expect(take({ day: "2026-02-28" })).toEqual({ day: "2026-02-28" });
		expect(take({ day: "2026-02-31" })).toBeNull();
		expect(take({ day: "2026-13-01" })).toBeNull();
		expect(take({ at: "2026-02-28T10:00:00Z" })).toEqual({ at: "2026-02-28T10:00:00Z" });
		expect(take({ at: "2026-02-31T10:00:00Z" })).toBeNull();
	});
});
