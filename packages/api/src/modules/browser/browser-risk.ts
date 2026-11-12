// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What the owner is asked before the agent acts in the host browser, and what is
 * refused outright (#1061). The host decides, whatever the page told the agent.
 */

/** What the page says about the element an action targets, read in the page. */
export interface ElementFacts {
	tag: string;
	type: string;
	role: string;
	/** The accessible name, or the visible text, trimmed. */
	name: string;
	/** Inside a form whose submit would send it. */
	inForm: boolean;
	/** A field the user's secrets go in: password, one-time code or card. */
	secret: boolean;
	/** The link's target, for a link. */
	href: string | null;
}

export type AgentAction =
	| { kind: "click"; double?: boolean }
	| { kind: "type"; text: string; submit?: boolean }
	| { kind: "press"; key: string }
	| { kind: "select"; values: string[] }
	| { kind: "hover" }
	| { kind: "scroll" };

export interface Ask {
	title: string;
	detail: string;
	/** The full request, redacted, for the card's disclosure. */
	request?: string;
}

export interface Refusal {
	message: string;
	next: string;
}

/** Names that pay, post, send or destroy: a change they cause gets their name on its card. */
const CONSEQUENTIAL =
	/\b(pay|buy|purchase|order|checkout|check out|subscribe|donate|transfer|post|publish|send|reply|comment|share|submit|delete|remove|destroy|drop|revoke|merge|approve|deploy|rollback|roll back|restart|confirm|sign up|place)\b/i;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Read-query paths an owner may allow per thread and origin; never allowed without the owner. */
const READ_PATHS = [
	/\/api\/v1\/(query|query_range|query_exemplars|series|labels|label\/[^/]+\/values)$/,
	/\/api\/ds\/query$/,
	/\/(_search|_msearch|_count)$/,
];

export const isSafeMethod = (method: string): boolean =>
	SAFE_METHODS.has(method.toUpperCase());

/** Whether the card for this POST may also offer "Allow … in this thread". */
export function isReadQueryPath(method: string, url: string): boolean {
	if (method.toUpperCase() !== "POST") return false;
	try {
		const path = new URL(url).pathname;
		return READ_PATHS.some((p) => p.test(path));
	} catch {
		return false;
	}
}

const host = (url: string): string => {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
};

const quoted = (name: string): string =>
	name
		? `"${name.length > 80 ? `${name.slice(0, 79)}…` : name}"`
		: "an unnamed control";

const SUBMIT_KEY = /(^|\+)(Enter|NumpadEnter|Space| )$/;

/** Typing or pressing keys in a secret field is the user's to do, never asked. */
export function refusal(
	action: AgentAction,
	f: ElementFacts | null,
): Refusal | null {
	if ((action.kind === "type" || action.kind === "press") && f?.secret)
		return {
			message:
				"Sign-in, one-time code and card fields are the user's to fill in.",
			next: "Ask the user to fill it in the browser pane, then take a new snapshot.",
		};
	return null;
}

/** Keys whose values are credentials: hidden on a card, which is stored with the thread. */
const CREDENTIAL_KEY =
	/csrf|xsrf|token|secret|pass|pwd?$|^pw|pin$|auth|session|cookie|api.?key|otp|cvv|cvc|card/i;

/** A URL or body with credential-like values replaced, JSON and form bodies alike. */
export function redact(text: string): string {
	try {
		const json = JSON.parse(text) as unknown;
		const walk = (v: unknown): unknown =>
			Array.isArray(v)
				? v.map(walk)
				: v && typeof v === "object"
					? Object.fromEntries(
							Object.entries(v).map(([k, x]) => [
								k,
								CREDENTIAL_KEY.test(k) ? "[hidden]" : walk(x),
							]),
						)
					: v;
		return JSON.stringify(walk(json), null, 1);
	} catch {}
	return text.replace(
		/([?&;]|^)([^=&;?\s]+)=([^&;\s]*)/g,
		(all, sep: string, k: string) =>
			CREDENTIAL_KEY.test(decodeURIComponent(k)) ? `${sep}${k}=[hidden]` : all,
	);
}

const BODY_CHARS = 4_000;

/** The card for a change the page sent while the agent acted, worded by what started it. */
export function changeAsk(
	trigger: { action: AgentAction; facts: ElementFacts | null } | null,
	method: string,
	url: string,
	body: string | null,
): Ask {
	const target = redact(url.length > 2_000 ? `${url.slice(0, 2_000)}…` : url);
	const detail = `Sends ${method.toUpperCase()} ${target}`;
	const request = body
		? `${method.toUpperCase()} ${target}

${redact(body.length > BODY_CHARS ? `${body.slice(0, BODY_CHARS)}…` : body)}`
		: `${method.toUpperCase()} ${target}`;
	const f = trigger?.facts ?? null;
	const a = trigger?.action;
	const submits =
		!!f?.inForm &&
		((a?.kind === "click" &&
			((f.tag === "button" && (f.type === "" || f.type === "submit")) ||
				(f.tag === "input" && (f.type === "submit" || f.type === "image")))) ||
			(a?.kind === "press" && SUBMIT_KEY.test(a.key)) ||
			(a?.kind === "type" && a.submit === true));
	if (submits)
		return { title: `Submit a form on ${host(url)}?`, detail, request };
	if (a?.kind === "click" && f && CONSEQUENTIAL.test(f.name))
		return {
			title: `Click ${quoted(f.name)} on ${host(url)}?`,
			detail,
			request,
		};
	return {
		title: `Let the agent send a change to ${host(url)}?`,
		detail,
		request,
	};
}

/** Text the agent typed, carried in a request to an origin the owner has not allowed (#1061). */
export function carriesTyped(
	url: string,
	body: string | null,
	typed: Iterable<string>,
): string | null {
	const hay = `${url}
${body ?? ""}`;
	let decoded = hay;
	try {
		decoded = decodeURIComponent(hay.replace(/\+/g, " "));
	} catch {}
	for (const t of typed) if (hay.includes(t) || decoded.includes(t)) return t;
	return null;
}

export function typedAsk(url: string, method: string): Ask {
	const target = redact(url.length > 2_000 ? `${url.slice(0, 2_000)}…` : url);
	return {
		title: `Send what the agent typed to ${host(url)}?`,
		detail: `The page sends text the agent typed: ${method.toUpperCase()} ${target}`,
		request: `${method.toUpperCase()} ${target}`,
	};
}

/** Opening `target` asks unless the owner allowed its origin in this thread (#1061). */
export function originAsk(
	target: URL,
	allowed: ReadonlySet<string>,
): Ask | null {
	if (allowed.has(target.origin)) return null;
	return {
		title: `Let the agent open ${target.host}?`,
		detail: `The agent wants to open ${target.href}.`,
	};
}

/** The first use in a thread: one card, naming the first page. */
export function firstUseAsk(target: URL): Ask {
	return {
		title: "Let the agent use the browser?",
		detail: `It wants to open ${target.href}. It can read pages you are signed in to.`,
	};
}
