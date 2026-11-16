// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
/// <reference lib="dom" />

/**
 * Functions that run inside the page, serialised by Playwright: each is
 * self-contained and touches nothing outside its argument.
 */

/** The element an action targets: its name for the pane, and whether it holds a secret. */
export interface ElementFacts {
	/** The accessible name, or the visible text, trimmed. */
	name: string;
	/** A field the user's secrets go in: password, one-time code or card. */
	secret: boolean;
}

/** What a secret field looks like, tested in the page and named here once. */
export const SECRET_FIELD = {
	types: ["password"],
	autocomplete: /^(current-password|new-password|one-time-code|cc-.*)$/i,
	name: /pass|otp|token|secret|cvv|cvc|card.?num|security.?code/i,
} as const;

type Rule = { types: string[]; autocomplete: string; name: string };

/** The rule as plain strings, the shape a page function can take. */
export const secretRule: Rule = {
	types: [...SECRET_FIELD.types],
	autocomplete: SECRET_FIELD.autocomplete.source,
	name: SECRET_FIELD.name.source,
};

/** Whether one element is a secret field, for hiding its value in a snapshot. */
export function isSecretElement(el: Element, rule: Rule): boolean {
	const i = el as HTMLInputElement;
	const t = (el.getAttribute("type") ?? "").toLowerCase();
	return (
		(el.tagName === "INPUT" || el.tagName === "TEXTAREA") &&
		(rule.types.includes(t) ||
			new RegExp(rule.autocomplete, "i").test(
				el.getAttribute("autocomplete") ?? "",
			) ||
			new RegExp(rule.name, "i").test(`${i.name ?? ""} ${el.id ?? ""}`))
	);
}

/** The facts of one element, for `locator.evaluate`. */
export function elementFacts(el: Element, rule: Rule): ElementFacts {
	const input = el as HTMLInputElement;
	const t = (el.getAttribute("type") ?? "").toLowerCase();
	const name = (
		el.getAttribute("aria-label") ||
		(el.tagName === "INPUT"
			? input.value || input.placeholder || ""
			: ((el as HTMLElement).innerText ?? ""))
	)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 200);
	// Inlined, not isSecretElement: a page function cannot call another.
	const secret =
		(el.tagName === "INPUT" || el.tagName === "TEXTAREA") &&
		(rule.types.includes(t) ||
			new RegExp(rule.autocomplete, "i").test(
				el.getAttribute("autocomplete") ?? "",
			) ||
			new RegExp(rule.name, "i").test(`${input.name ?? ""} ${el.id ?? ""}`));
	return { name, secret };
}

/** Whether the focused element is a secret field, for a key press with no ref. */
export function focusedSecret(rule: Rule): boolean {
	const el = document.activeElement;
	if (!el || el === document.body) return false;
	const t = (el.getAttribute("type") ?? "").toLowerCase();
	const i = el as HTMLInputElement;
	return (
		rule.types.includes(t) ||
		new RegExp(rule.autocomplete, "i").test(
			el.getAttribute("autocomplete") ?? "",
		) ||
		new RegExp(rule.name, "i").test(`${i.name ?? ""} ${el.id ?? ""}`)
	);
}

/** Typing or pressing keys in a secret field is the user's to do (#1061). */
export function secretRefusal(
	action: { kind: string },
	facts: ElementFacts | null,
): { message: string; next: string } | null {
	if ((action.kind === "type" || action.kind === "press") && facts?.secret)
		return {
			message:
				"Sign-in, one-time code and card fields are the user's to fill in.",
			next: "Ask the user to fill it in the browser pane, then take a new snapshot.",
		};
	return null;
}
