// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ComposerScope, Quote, ReferenceRef } from "@prismalens/contracts";
import type { AttachmentView } from "./investigation-events";

/** A file still on this device, or one already uploaded (a saved draft's). */
export type EnvelopeAttachment = File | AttachmentView;

/** Everything one Send carries, from the box to the send and start routes (#1024). */
export interface SendEnvelope {
	text: string;
	attachments: EnvelopeAttachment[];
	quotes: Quote[];
	references: ReferenceRef[];
	/** The saved draft this send came from; the server deletes it when `draftRev` is current. */
	draftScope?: ComposerScope;
	draftRev?: number;
	/** The cold-conversation dock's choices. */
	compact?: boolean;
	fresh?: boolean;
}

/** The box clears only on `sent`; `deferred` keeps the draft while a dock decides. */
export type SendResult = "sent" | "deferred" | "cancelled";

export interface SendReceipt {
	result: SendResult;
	/** On `deferred`: how the dock's decision ends. A later `sent` clears the box. */
	settled?: Promise<Exclude<SendResult, "deferred">>;
}

/** What actually sends: uploads and calls the route. Rejects so the box keeps the draft. */
export type SendForward = (env: SendEnvelope, now: boolean) => Promise<void>;

/**
 * A lane's hook into Send, registered in its slot file. Null lets the send through;
 * a receipt takes it over, and the interceptor calls `forward` itself once its dock decides.
 */
export type SendInterceptor = (
	env: SendEnvelope,
	now: boolean,
	forward: SendForward,
) => SendReceipt | null | Promise<SendReceipt | null>;

/** The box's own content with nothing chosen beside the text. */
export function envelopeOf(
	text: string,
	attachments: EnvelopeAttachment[] = [],
): SendEnvelope {
	return { text, attachments, quotes: [], references: [] };
}

/** Runs the interceptors in order; the first receipt wins, else the envelope is forwarded. */
export async function interceptSend(
	env: SendEnvelope,
	now: boolean,
	interceptors: readonly SendInterceptor[],
	forward: SendForward,
): Promise<SendReceipt> {
	for (const intercept of interceptors) {
		const receipt = await intercept(env, now, forward);
		if (receipt) return receipt;
	}
	await forward(env, now);
	return { result: "sent" };
}

export const isUploaded = (a: EnvelopeAttachment): a is AttachmentView =>
	!(typeof File !== "undefined" && a instanceof File);

/** Uploads each local file and keeps uploaded ones, in the box's order. */
export function uploadEach(
	attachments: readonly EnvelopeAttachment[],
	upload: (file: File) => Promise<AttachmentView>,
): Promise<AttachmentView[]> {
	return Promise.all(
		attachments.map((a) => (isUploaded(a) ? Promise.resolve(a) : upload(a))),
	);
}

/** The local files alone: a route that uploads under its own key reads these. */
export const filesOf = (env: Pick<SendEnvelope, "attachments">): File[] =>
	env.attachments.filter((a): a is File => !isUploaded(a));

/** The context fields a send or start body takes (`MessageContextShape`), set ones only. */
export function messageContext(env: SendEnvelope) {
	return {
		...(env.quotes.length ? { quotes: env.quotes } : {}),
		...(env.references.length ? { references: env.references } : {}),
		...(env.draftScope ? { draftScope: env.draftScope } : {}),
		...(env.draftRev !== undefined ? { draftRev: env.draftRev } : {}),
	};
}

/** `messageContext` plus the cold dock's choices: what `POST /investigations/{id}/messages` takes. */
export function messageFields(env: SendEnvelope) {
	return {
		...messageContext(env),
		...(env.compact ? { compact: true } : {}),
		...(env.fresh ? { fresh: true } : {}),
	};
}

export type MessageFields = ReturnType<typeof messageFields>;
