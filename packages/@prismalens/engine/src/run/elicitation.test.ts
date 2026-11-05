// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { elicitationAsk, elicitationContent } from "./elicitation.js";

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
	it("maps a question answer back to the form, dropping unknown picks", () => {
		const ask = elicitationAsk(questionForm);
		if (!ask) throw new Error("no ask");
		expect(
			elicitationContent(ask, {
				kind: "question",
				answers: { question_0: { options: ["prod", "nope"], other: "and canary" } },
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
