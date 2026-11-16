// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ATTACHMENT_MAX_BYTES,
	EMPTY_MESSAGE,
	MAX_ATTACHMENTS_PER_MESSAGE,
	MESSAGE_TEXT_MAX,
} from "@prismalens/contracts";

/** What to say when a route refuses one input field: the cause, then the fix (#1101 categories 7, 23). */
interface SendField {
	label: string;
	tooBig?: string;
	tooSmall?: string;
	fix: string;
}

const defineSendField = (f: SendField) => f;
const AGENT_CHOICE = defineSendField({
	label: "The agent choice",
	fix: "Pick the agent and model again, then send.",
});
const DRAFT = defineSendField({
	label: "The draft",
	fix: "Reload the page, then send; the draft is kept.",
});

/** Every field a send or start route checks; the API's validation issues name these by path. */
export const SEND_FIELDS = {
	text: defineSendField({
		label: "The message",
		tooBig: `The message is over ${MESSAGE_TEXT_MAX.toLocaleString("en")} characters.`,
		tooSmall: EMPTY_MESSAGE,
		fix: "Paste it again to fold it into a file chip, or shorten it.",
	}),
	attachments: defineSendField({
		label: "Files",
		tooBig: `One message takes ${MAX_ATTACHMENTS_PER_MESSAGE} files at most.`,
		fix: "Remove a file chip, then send.",
	}),
	attachmentsAt: defineSendField({
		label: "A file's place in the text",
		fix: "Remove the file chip and attach it again.",
	}),
	quotes: defineSendField({
		label: "Quotes",
		tooBig: "Too many quotes on one message.",
		fix: "Remove a quote, then send.",
	}),
	references: defineSendField({
		label: "References",
		tooBig: "Too many references on one message.",
		fix: "Remove a reference chip, then send.",
	}),
	harness: AGENT_CHOICE,
	model: AGENT_CHOICE,
	effort: AGENT_CHOICE,
	accessLevel: defineSendField({
		label: "The permission level",
		fix: "Pick a permission level again, then send.",
	}),
	draftKey: DRAFT,
	draftScope: DRAFT,
	draftRev: DRAFT,
} satisfies Record<string, SendField>;

interface Issue {
	message?: string;
	code?: string;
	path?: readonly (PropertyKey | { key: PropertyKey })[];
}

const keyOf = (p: PropertyKey | { key: PropertyKey }) =>
	String(typeof p === "object" ? p.key : p);

/** A validation refusal as one sentence with its fix, or null when there are no issues. */
export function sendProblem(issues: readonly Issue[]): string | null {
	const issue = issues[0];
	if (!issue) return null;
	const path = (issue.path ?? []).map(keyOf);
	const field = SEND_FIELDS[path[0] as keyof typeof SEND_FIELDS] as
		| SendField
		| undefined;
	if (!field) {
		const where = path.filter((p) => !/^\d+$/.test(p)).join(" ");
		return `${where ? `${where}: ` : ""}${issue.message ?? "not accepted"}. Change it, then try again.`;
	}
	const cause =
		(issue.code === "too_big" && field.tooBig) ||
		(issue.code === "too_small" && field.tooSmall) ||
		(issue.message && issue.message === field.tooSmall && field.tooSmall) ||
		`${field.label} was not accepted.`;
	return cause === EMPTY_MESSAGE ? cause : `${cause} ${field.fix}`;
}

/** The text a send would carry, refused here before it travels (#1101 category 7). */
export function textProblem(text: string): string | null {
	return text.length > MESSAGE_TEXT_MAX
		? sendProblem([{ code: "too_big", path: ["text"] }])
		: null;
}

/** An upload's refusal, naming the file and what to do (#1101 category 7). */
export function uploadProblem(name: string, status: number, said?: string) {
	if (status === 413)
		return `${name} is over ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB. Remove its chip, or attach a smaller copy.`;
	if (status === 0 || status >= 500)
		return `${name} did not upload: PrismaLens did not answer. Check that it is running, then send again.`;
	return `${name} was refused${said ? `: ${said.replace(/\.$/, "")}` : ""}. Remove its chip, or attach it again.`;
}
