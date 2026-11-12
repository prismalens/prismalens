// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
/// <reference lib="dom" />

/**
 * Functions that run inside the page, serialised by Playwright: each is
 * self-contained and touches nothing outside its argument.
 */
import type { ElementFacts } from "./browser-risk.js";

/** What a secret field looks like, tested in the page and named here once. */
export const SECRET_FIELD = {
	types: ["password"],
	autocomplete: /^(current-password|new-password|one-time-code|cc-.*)$/i,
	name: /pass|otp|token|secret|cvv|cvc|card.?num|security.?code/i,
} as const;

export interface PageFacts extends ElementFacts {
	/** Tag, name, form action and a hash of the form's values: what an approval binds to. */
	fingerprint: string;
}

/** The facts of one element, for `locator.evaluate`. */
export function elementFacts(
	el: Element,
	rule: { types: string[]; autocomplete: string; name: string },
): PageFacts {
	const input = el as HTMLInputElement;
	const tag = el.tagName.toLowerCase();
	const type = (el.getAttribute("type") ?? "").toLowerCase();
	const autocomplete = new RegExp(rule.autocomplete, "i");
	const named = new RegExp(rule.name, "i");
	const isSecret = (f: Element) => {
		const i = f as HTMLInputElement;
		const t = (f.getAttribute("type") ?? "").toLowerCase();
		return (
			(f.tagName === "INPUT" || f.tagName === "TEXTAREA") &&
			(rule.types.includes(t) ||
				autocomplete.test(f.getAttribute("autocomplete") ?? "") ||
				named.test(`${i.name ?? ""} ${f.id ?? ""}`))
		);
	};
	const name = (
		el.getAttribute("aria-label") ||
		(tag === "input"
			? input.value || input.placeholder || ""
			: ((el as HTMLElement).innerText ?? ""))
	)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 200);
	const form = (input.form ?? el.closest("form")) as HTMLFormElement | null;
	let values = "";
	if (form)
		for (const f of Array.from(form.elements))
			if (!isSecret(f))
				values += `${(f as HTMLInputElement).name}=${(f as HTMLInputElement).value};`;
	let h = 0;
	for (let i = 0; i < values.length; i++)
		h = (h * 31 + values.charCodeAt(i)) | 0;
	const href = el.closest("a")?.href ?? null;
	return {
		tag,
		type,
		role: el.getAttribute("role") ?? "",
		name,
		inForm: !!form,
		secret: isSecret(el),
		href,
		fingerprint: [
			tag,
			type,
			name,
			form?.action ?? "",
			form?.method ?? "",
			href ?? "",
			h,
		].join("|"),
	};
}

/** Whether one element is a secret field, for hiding its value in a snapshot. */
export function isSecretElement(
	el: Element,
	rule: { types: string[]; autocomplete: string; name: string },
): boolean {
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

/** The rule as plain strings, the shape a page function can take. */
export const secretRule = {
	types: [...SECRET_FIELD.types],
	autocomplete: SECRET_FIELD.autocomplete.source,
	name: SECRET_FIELD.name.source,
};

/** The focused element, for a key press with no ref. */
export function focusedFacts(rule: {
	types: string[];
	autocomplete: string;
	name: string;
}): { inForm: boolean; secret: boolean } {
	const el = document.activeElement;
	if (!el || el === document.body) return { inForm: false, secret: false };
	const t = (el.getAttribute("type") ?? "").toLowerCase();
	const i = el as HTMLInputElement;
	return {
		inForm: !!el.closest("form"),
		secret:
			rule.types.includes(t) ||
			new RegExp(rule.autocomplete, "i").test(
				el.getAttribute("autocomplete") ?? "",
			) ||
			new RegExp(rule.name, "i").test(`${i.name ?? ""} ${el.id ?? ""}`),
	};
}
