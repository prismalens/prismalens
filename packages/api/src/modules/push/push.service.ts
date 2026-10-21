// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Phone push (#859). State changes write a push_outbox row in their own
 * transaction; this sends what is owed, at boot and on a short tick, so a
 * restart between the change and the send loses nothing.
 */

import { randomUUID } from "node:crypto";
import {
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
} from "@nestjs/common";
import { getOrCreateVapidKeys } from "@prismalens/config";
import {
	LIVE_WORKFLOW_STATUSES,
	type PushHealth,
	type PushKind,
	type PushPayload,
} from "@prismalens/contracts";
import webpush from "web-push";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { askLinkState } from "./ask-state.js";

// Apple's push service refuses a VAPID subject that is not mailto: or https:.
const VAPID_SUBJECT = "https://prismalens.io";
const TICK_MS = 5_000;
const KEEP_DELIVERED_MS = 7 * 24 * 60 * 60 * 1000;
/** A row is retried when a push service answers with an error that is not an expiry: tries, each at least this old. */
const RETRY_AFTER_MS = [0, 5_000, 30_000, 120_000, 600_000];

interface Subscription {
	id: string;
	endpoint: string;
	p256dh: string;
	auth: string;
	createdAt: Date;
	lastDeliveryAt: Date | null;
	lastError: string | null;
	expiredAt: Date | null;
}

export class PushNotFoundError extends Error {}

export function pushHealth(sub: Subscription): PushHealth {
	return {
		state: sub.expiredAt ? "expired" : sub.lastError ? "failing" : "active",
		since: sub.createdAt.toISOString(),
		lastDeliveryAt: sub.lastDeliveryAt?.toISOString() ?? null,
		lastError: sub.lastError,
	};
}

@Injectable()
export class PushService
	implements OnApplicationBootstrap, OnApplicationShutdown
{
	private readonly logger = new Logger(PushService.name);
	private keys: { publicKey: string; privateKey: string } | null = null;
	private timer: NodeJS.Timeout | undefined;
	private flushing: Promise<number> | null = null;

	constructor(private readonly prisma: PrismaService) {}

	get publicKey(): string {
		return this.vapid().publicKey;
	}

	private vapid() {
		this.keys ??= getOrCreateVapidKeys(() => webpush.generateVAPIDKeys());
		return this.keys;
	}

	async onApplicationBootstrap(): Promise<void> {
		await this.flush().catch((error: unknown) =>
			this.logger.warn(`Boot push reconciliation failed: ${String(error)}`),
		);
		this.timer = setInterval(() => {
			this.flush().catch((error: unknown) =>
				this.logger.warn(`Push send failed: ${String(error)}`),
			);
		}, TICK_MS);
		this.timer.unref();
	}

	onApplicationShutdown(): void {
		clearInterval(this.timer);
	}

	/** Send every undelivered row once to every live subscription; resolves to the rows settled. */
	flush(): Promise<number> {
		this.flushing ??= this.drain().finally(() => {
			this.flushing = null;
		});
		return this.flushing;
	}

	private async drain(): Promise<number> {
		const rows = await this.prisma.pushOutbox.findMany({
			where: { deliveredAt: null },
			orderBy: { createdAt: "asc" },
			take: 100,
		});
		const age = Date.now();
		const due = rows.filter(
			(r) =>
				age - r.createdAt.getTime() >=
				(RETRY_AFTER_MS[r.attempts] ?? RETRY_AFTER_MS.length - 1),
		);
		if (due.length === 0) return 0;
		const subs = await this.prisma.pushSubscription.findMany({
			where: { expiredAt: null, device: { revokedAt: null } },
		});
		const gone = new Set<string>();
		let settled = 0;
		for (const row of due) {
			const payload: PushPayload = {
				id: row.id,
				kind: row.kind as PushKind,
				investigationId: row.investigationId,
				...(row.askId ? { askId: row.askId } : {}),
			};
			let retry = false;
			for (const sub of subs) {
				if (gone.has(sub.id)) continue;
				const after = await this.deliver(sub, payload);
				if (after.expiredAt) gone.add(sub.id);
				else if (after.lastError) retry = true;
			}
			const settle = !retry || row.attempts + 1 >= RETRY_AFTER_MS.length;
			if (settle) settled++;
			await this.prisma.pushOutbox.update({
				where: { id: row.id },
				data: {
					attempts: { increment: 1 },
					...(settle ? { deliveredAt: new Date() } : {}),
				},
			});
		}
		await this.prisma.pushOutbox.deleteMany({
			where: { deliveredAt: { lt: new Date(Date.now() - KEEP_DELIVERED_MS) } },
		});
		return settled;
	}

	private async deliver(
		sub: Subscription,
		payload: PushPayload,
	): Promise<Subscription> {
		const { publicKey, privateKey } = this.vapid();
		try {
			await webpush.sendNotification(
				{
					endpoint: sub.endpoint,
					keys: { p256dh: sub.p256dh, auth: sub.auth },
				},
				JSON.stringify(payload),
				{
					vapidDetails: { subject: VAPID_SUBJECT, publicKey, privateKey },
					TTL: 24 * 60 * 60,
					urgency: "high",
				},
			);
			return this.prisma.pushSubscription.update({
				where: { id: sub.id },
				data: { lastDeliveryAt: new Date(), lastError: null },
			});
		} catch (error) {
			const status =
				error instanceof webpush.WebPushError ? error.statusCode : null;
			const expired = status === 404 || status === 410;
			return this.prisma.pushSubscription.update({
				where: { id: sub.id },
				data: {
					lastError: status
						? `The push service answered ${status}`
						: error instanceof Error
							? error.message
							: String(error),
					...(expired ? { expiredAt: new Date() } : {}),
				},
			});
		}
	}

	async subscribe(
		deviceId: string,
		input: { endpoint: string; keys: { p256dh: string; auth: string } },
	): Promise<PushHealth> {
		const data = {
			endpoint: input.endpoint,
			p256dh: input.keys.p256dh,
			auth: input.keys.auth,
			lastError: null,
			expiredAt: null,
		};
		const sub = await this.prisma.pushSubscription.upsert({
			where: { deviceId },
			create: { deviceId, ...data },
			update: { ...data, createdAt: new Date() },
		});
		return pushHealth(sub);
	}

	async unsubscribe(deviceId: string): Promise<boolean> {
		const { count } = await this.prisma.pushSubscription.deleteMany({
			where: { deviceId },
		});
		return count > 0;
	}

	async sendTest(deviceId: string): Promise<PushHealth> {
		const sub = await this.prisma.pushSubscription.findUnique({
			where: { deviceId },
		});
		if (!sub)
			throw new PushNotFoundError("This device has not turned push on.");
		return pushHealth(
			await this.deliver(sub, { id: randomUUID(), kind: "test" }),
		);
	}

	/** The words for a push, fetched by the device so the push service never carries them. */
	async notification(
		id: string,
	): Promise<{ title: string; body: string; url: string }> {
		const row = await this.prisma.pushOutbox.findUnique({ where: { id } });
		if (!row) throw new PushNotFoundError("No such notification.");
		const run = await this.prisma.investigation.findUnique({
			where: { id: row.investigationId },
			include: { incident: { select: { number: true, title: true } } },
		});
		const where = run
			? `#${run.incident.number} ${run.title ?? run.incident.title}`
			: "A run that was deleted";
		const runUrl = `/investigations/${row.investigationId}`;
		const askUrl = row.askId
			? `${runUrl}?ask=${encodeURIComponent(row.askId)}`
			: runUrl;
		const asked =
			row.askId && run
				? (await this.askState(row.investigationId, row.askId)).title
				: null;
		switch (row.kind as PushKind) {
			case "finding_ready":
				return { title: "Finding ready", body: where, url: runUrl };
			case "run_failed": {
				// #852 adds endReason (interrupted, limited); read it when the row has it.
				const reason = run ? (run as Record<string, unknown>).endReason : null;
				return {
					title: typeof reason === "string" ? `Run ${reason}` : "Run failed",
					body: where,
					url: runUrl,
				};
			}
			case "ask_waiting":
				return {
					title: "An ask is waiting",
					body: asked ? `${asked} · ${where}` : where,
					url: askUrl,
				};
			case "ask_refused":
				return {
					title: `Needed approval for ${asked ?? "a tool call"}`,
					body: `Nobody was there to answer. Re-run with approval · ${where}`,
					url: askUrl,
				};
			default:
				return { title: "PrismaLens", body: where, url: runUrl };
		}
	}

	async askState(investigationId: string, askId: string) {
		const run = await this.prisma.investigation.findUnique({
			where: { id: investigationId },
			select: { status: true, incidentId: true },
		});
		if (!run) throw new PushNotFoundError("No such run.");
		const rows = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId,
				event: { contains: `"askId":${JSON.stringify(askId)}` },
			},
			orderBy: { seq: "asc" },
			select: { event: true },
		});
		const events = rows.flatMap((r) => {
			try {
				return [JSON.parse(r.event) as { kind: string }];
			} catch {
				return [];
			}
		});
		const live = (LIVE_WORKFLOW_STATUSES as readonly string[]).includes(
			run.status,
		);
		return { ...askLinkState(events, live), incidentId: run.incidentId };
	}
}
