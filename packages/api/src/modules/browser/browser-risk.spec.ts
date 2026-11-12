// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	carriesTyped,
	changeAsk,
	type ElementFacts,
	firstUseAsk,
	isReadQueryPath,
	isSafeMethod,
	originAsk,
	redact,
	refusal,
} from "./browser-risk.js";

const secretField: ElementFacts = {
	tag: "input",
	type: "password",
	role: "textbox",
	name: "Password",
	inForm: true,
	secret: true,
	href: null,
};

const plainField: ElementFacts = {
	tag: "input",
	type: "text",
	role: "textbox",
	name: "Username",
	inForm: true,
	secret: false,
	href: null,
};

describe("browser-risk (#1061)", () => {
	describe("refusal", () => {
		it("Given type or press on a secret field, When refusal is evaluated, Then it returns the exact refusal message and next step", () => {
			const expected = {
				message:
					"Sign-in, one-time code and card fields are the user's to fill in.",
				next: "Ask the user to fill it in the browser pane, then take a new snapshot.",
			};
			expect(refusal({ kind: "type", text: "secret123" }, secretField)).toEqual(
				expected,
			);
			expect(refusal({ kind: "press", key: "Enter" }, secretField)).toEqual(
				expected,
			);
		});

		it("Given click on a secret field or type on a plain field, When refusal is evaluated, Then it returns null", () => {
			expect(refusal({ kind: "click" }, secretField)).toBeNull();
			expect(refusal({ kind: "type", text: "alice" }, plainField)).toBeNull();
		});
	});

	describe("changeAsk", () => {
		it("Given a click on a button with empty type in a form, When changeAsk is called, Then it returns submit form title, detail, and request", () => {
			const trigger = {
				action: { kind: "click" as const },
				facts: {
					tag: "button",
					type: "",
					role: "button",
					name: "Submit",
					inForm: true,
					secret: false,
					href: null,
				},
			};
			const ask = changeAsk(
				trigger,
				"POST",
				"https://example.com/api/save",
				"data=1",
			);
			expect(ask.title).toBe("Submit a form on example.com?");
			expect(ask.detail).toBe("Sends POST https://example.com/api/save");
			expect(ask.request).toBe("POST https://example.com/api/save\n\ndata=1");
		});

		it("Given press Control+Enter in a form, When changeAsk is called, Then it returns submit wording", () => {
			const trigger = {
				action: { kind: "press" as const, key: "Control+Enter" },
				facts: {
					tag: "textarea",
					type: "",
					role: "textbox",
					name: "Comment",
					inForm: true,
					secret: false,
					href: null,
				},
			};
			const ask = changeAsk(
				trigger,
				"POST",
				"https://example.com/api/comment",
				"text=hello",
			);
			expect(ask.title).toBe("Submit a form on example.com?");
			expect(ask.detail).toBe("Sends POST https://example.com/api/comment");
			expect(ask.request).toBe("POST https://example.com/api/comment\n\ntext=hello");
		});

		it('Given a click on a non-form element named "Place order", When changeAsk is called, Then it returns Click "Place order" on example.com?', () => {
			const trigger = {
				action: { kind: "click" as const },
				facts: {
					tag: "div",
					type: "",
					role: "button",
					name: "Place order",
					inForm: false,
					secret: false,
					href: null,
				},
			};
			const ask = changeAsk(
				trigger,
				"POST",
				"https://example.com/order",
				"order=1",
			);
			expect(ask.title).toBe('Click "Place order" on example.com?');
			expect(ask.detail).toBe("Sends POST https://example.com/order");
			expect(ask.request).toBe("POST https://example.com/order\n\norder=1");
		});

		it('Given a click named "Open panel", When changeAsk is called, Then it returns Let the agent send a change to example.com?', () => {
			const trigger = {
				action: { kind: "click" as const },
				facts: {
					tag: "button",
					type: "button",
					role: "button",
					name: "Open panel",
					inForm: false,
					secret: false,
					href: null,
				},
			};
			const ask = changeAsk(
				trigger,
				"POST",
				"https://example.com/panel",
				"action=open",
			);
			expect(ask.title).toBe("Let the agent send a change to example.com?");
			expect(ask.detail).toBe("Sends POST https://example.com/panel");
			expect(ask.request).toBe("POST https://example.com/panel\n\naction=open");
		});

		it("Given a null trigger, When changeAsk is called, Then it returns generic change wording and formats null body", () => {
			const ask = changeAsk(null, "POST", "https://example.com/api", null);
			expect(ask.title).toBe("Let the agent send a change to example.com?");
			expect(ask.detail).toBe("Sends POST https://example.com/api");
			expect(ask.request).toBe("POST https://example.com/api");
		});

		it("Given a body over 4,000 characters, When changeAsk is called, Then detail has full url and request body is cut with ellipsis", () => {
			const longBody = "x".repeat(4_005);
			const ask = changeAsk(
				null,
				"POST",
				"https://example.com/api/data",
				longBody,
			);
			expect(ask.detail).toBe("Sends POST https://example.com/api/data");
			const expectedCut = `${"x".repeat(4_000)}…`;
			expect(ask.request).toBe(
				`POST https://example.com/api/data\n\n${expectedCut}`,
			);
		});
	});

	describe("redact", () => {
		it("Given JSON with csrf_token, password and nested auth.token keys, When redact is called, Then they become [hidden] with one-space indent", () => {
			const jsonInput = JSON.stringify({
				csrf_token: "csrf123",
				password: "secretpassword",
				"auth.token": "token123",
			});
			const expected =
				'{\n "csrf_token": "[hidden]",\n "password": "[hidden]",\n "auth.token": "[hidden]"\n}';
			expect(redact(jsonInput)).toBe(expected);
		});

		it("Given a form body note=hello&pw=secret1&pin=12, When redact is called, Then credential keys become [hidden]", () => {
			expect(redact("note=hello&pw=secret1&pin=12")).toBe(
				"note=hello&pw=[hidden]&pin=[hidden]",
			);
		});

		it("Given a URL query ?q=x&api_key=abc, When redact is called, Then only api_key is hidden", () => {
			expect(redact("?q=x&api_key=abc")).toBe("?q=x&api_key=[hidden]");
		});

		it("Given plain text with no equals sign, When redact is called, Then text is unchanged", () => {
			expect(redact("plain text with no equals")).toBe(
				"plain text with no equals",
			);
		});
	});

	describe("carriesTyped", () => {
		it("Given a typed string, When checked against URL query, URL-encoded forms, and body, Then carriesTyped finds it or returns null when absent", () => {
			expect(
				carriesTyped("https://example.com/search?q=findme", null, ["findme"]),
			).toBe("findme");
			expect(
				carriesTyped("https://example.com/form", "text=hello%20world", [
					"hello world",
				]),
			).toBe("hello world");
			expect(
				carriesTyped("https://example.com/form", "text=hello+world", [
					"hello world",
				]),
			).toBe("hello world");
			expect(
				carriesTyped("https://example.com/form", "body with payload data", [
					"payload",
				]),
			).toBe("payload");
			expect(
				carriesTyped("https://example.com/form", "text=unrelated", [
					"hello world",
				]),
			).toBeNull();
		});
	});

	describe("isReadQueryPath", () => {
		it("Given read query paths, When checked with POST, Then isReadQueryPath returns true", () => {
			expect(
				isReadQueryPath("POST", "https://example.com/api/v1/query_range"),
			).toBe(true);
			expect(isReadQueryPath("POST", "https://example.com/api/ds/query")).toBe(
				true,
			);
			expect(isReadQueryPath("POST", "https://example.com/logs/_search")).toBe(
				true,
			);
		});

		it("Given GET requests, delete series, or graphql, When checked, Then isReadQueryPath returns false", () => {
			expect(
				isReadQueryPath("GET", "https://example.com/api/v1/query_range"),
			).toBe(false);
			expect(isReadQueryPath("GET", "https://example.com/api/ds/query")).toBe(
				false,
			);
			expect(isReadQueryPath("GET", "https://example.com/logs/_search")).toBe(
				false,
			);
			expect(
				isReadQueryPath(
					"POST",
					"https://example.com/api/v1/admin/tsdb/delete_series",
				),
			).toBe(false);
			expect(isReadQueryPath("POST", "https://example.com/graphql")).toBe(
				false,
			);
		});
	});

	describe("isSafeMethod", () => {
		it("Given GET, head, or OPTIONS, When isSafeMethod is checked, Then it returns true", () => {
			expect(isSafeMethod("GET")).toBe(true);
			expect(isSafeMethod("head")).toBe(true);
			expect(isSafeMethod("OPTIONS")).toBe(true);
		});

		it("Given POST or DELETE, When isSafeMethod is checked, Then it returns false", () => {
			expect(isSafeMethod("POST")).toBe(false);
			expect(isSafeMethod("DELETE")).toBe(false);
		});
	});

	describe("originAsk and firstUseAsk", () => {
		it("Given target URL and allowed set, When originAsk is called, Then it returns exact title and detail, or null for an allowed origin", () => {
			const target = new URL("https://example.com/page");
			expect(originAsk(target, new Set(["https://other.com"]))).toEqual({
				title: "Let the agent open example.com?",
				detail: "The agent wants to open https://example.com/page.",
			});
			expect(originAsk(target, new Set(["https://example.com"]))).toBeNull();
		});

		it("Given target URL, When firstUseAsk is called, Then it returns exact title and detail", () => {
			const target = new URL("https://example.com/page");
			expect(firstUseAsk(target)).toEqual({
				title: "Let the agent use the browser?",
				detail:
					"It wants to open https://example.com/page. It can read pages you are signed in to.",
			});
		});
	});
});
