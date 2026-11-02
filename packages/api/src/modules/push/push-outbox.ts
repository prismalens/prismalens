// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, PushKind } from "@prismalens/contracts";

/** A notification owed; written by the caller's transaction, sent by PushService (#859). */
export interface OwedPush {
	kind: PushKind;
	investigationId: string;
	askId?: string;
}

export interface OutboxWriter {
	pushOutbox: {
		create(args: {
			data: { kind: string; investigationId: string; askId?: string };
		}): Promise<unknown>;
	};
}

export async function owePush(tx: OutboxWriter, owed: OwedPush): Promise<void> {
	await tx.pushOutbox.create({
		data: {
			kind: owed.kind,
			investigationId: owed.investigationId,
			...(owed.askId ? { askId: owed.askId } : {}),
		},
	});
}

/** The push an appended event owes: an ask now waiting, or one an alert-started run refused. */
export function pushOwedBy(
	investigationId: string,
	event: CanonicalEvent,
): OwedPush | null {
	if (event.kind === "permission_ask")
		return { kind: "ask_waiting", investigationId, askId: event.askId };
	if (event.kind === "permission_answer" && event.outcome === "unattended")
		return { kind: "ask_refused", investigationId, askId: event.askId };
	return null;
}
