// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Ending subscriptions (#1179 §5), shared by the service, a user's Stop and the settle
 * teardown. A cancel, a stop, a settle and an expiry withdraw what waits; merge, close,
 * the guard, the cap and `once` deliver it (D7). A bundled delivery left with no member is
 * cut from its wake on the next tick (D18).
 */
import { PR_SUB_END_WORDS, type PrSubEndReason } from "@prismalens/contracts";
import type { Prisma } from "@prismalens/database";
import type { PrismaService } from "../../../core/prisma/prisma.service.js";

export const LIVE_SUB_STATES = ["active", "disconnected"] as const;
/** Deliveries a withdrawal still reaches: not yet received. */
export const OPEN_DELIVERY_STATES = ["queued", "bundled", "parked"] as const;

const WITHDRAWS = new Set<PrSubEndReason>([
	"cancelled_by_user",
	"cancelled_by_agent",
	"run_stopped",
	"settled",
	"expired",
]);

export interface Ended {
	id: string;
	investigationId: string;
	withdrawn: number;
}

type Tx = Pick<
	PrismaService,
	"prSubscription" | "prDeliveryMember" | "prDelivery"
>;

/** Withdraws one subscription's waiting memberships; a queued or parked delivery left with none is discarded. */
export async function withdrawMembers(
	tx: Tx,
	subscriptionId: string,
	by: PrSubEndReason,
): Promise<number> {
	const members = await tx.prDeliveryMember.findMany({
		where: {
			subscriptionId,
			state: "member",
			delivery: { state: { in: [...OPEN_DELIVERY_STATES] } },
		},
		select: { deliveryId: true },
	});
	if (!members.length) return 0;
	const ids = members.map((m) => m.deliveryId);
	await tx.prDeliveryMember.updateMany({
		where: { subscriptionId, deliveryId: { in: ids } },
		data: { state: "withdrawn", withdrawnBy: by },
	});
	await tx.prDelivery.updateMany({
		where: {
			id: { in: ids },
			state: { in: ["queued", "parked"] },
			members: { none: { state: "member" } },
		},
		data: { state: "discarded", discardReason: "withdrawn" },
	});
	return ids.length;
}

/** Ends every live subscription `where` matches with `reason`, once each. */
export async function endSubscriptions(
	tx: Tx,
	where: Prisma.PrSubscriptionWhereInput,
	reason: PrSubEndReason,
	now: Date = new Date(),
): Promise<Ended[]> {
	const subs = await tx.prSubscription.findMany({
		where: { ...where, state: { in: [...LIVE_SUB_STATES] } },
		select: { id: true, investigationId: true },
	});
	const out: Ended[] = [];
	for (const s of subs) {
		const { count } = await tx.prSubscription.updateMany({
			where: { id: s.id, state: { in: [...LIVE_SUB_STATES] } },
			data: {
				state: "ended",
				endReason: reason,
				endNote: PR_SUB_END_WORDS[reason],
				endedAt: now,
				endAnnounced: false,
			},
		});
		if (!count) continue;
		const withdrawn = WITHDRAWS.has(reason)
			? await withdrawMembers(tx, s.id, reason)
			: 0;
		out.push({ ...s, withdrawn });
	}
	return out;
}
