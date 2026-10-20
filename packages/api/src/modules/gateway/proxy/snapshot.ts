// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A run's view of its vendor MCP servers (#848, 06): tools paged by hand and bounded
 * before parsing, so a huge catalogue costs at most one capped page (OBJ-019).
 */
import { allocateOfferedNames } from "@prismalens/contracts/schemas";
import type { DroppedWhy, ProxySnapshot } from "@prismalens/integrations";
import { failureReason } from "../source-tools.js";
import {
	type McpConnection,
	type Meter,
	OffTargetError,
	TooLargeError,
	type Upstream,
} from "./upstream.js";

export const LIMITS = {
	proxy: {
		toolsPerConnection: 64,
		bytesPerConnection: 128 * 1024,
		bytesPerTool: 16 * 1024,
		toolsPerRun: 192,
		bytesPerRun: 512 * 1024,
		bytesPerPage: 1024 * 1024,
		receivedPerConnection: 2 * 1024 * 1024,
	},
} as const;

export type SnapshotConnection = ProxySnapshot["connections"][number];

export const newMeter = (): Meter => ({
	active: true,
	received: 0,
	maxResponse: LIMITS.proxy.bytesPerPage,
	maxTotal: LIMITS.proxy.receivedPerConnection,
});

interface Budget {
	tools: number;
	bytes: number;
}

interface UpstreamTool {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

/** Why a connection offers nothing, in PrismaLens's own words. */
export function unreachableReason(e: unknown): string {
	if (e instanceof TooLargeError) return "tool list too large";
	if (e instanceof OffTargetError) return e.message;
	return failureReason(e);
}

/**
 * Lists one connection's tools a page at a time, stopping at the per-connection and
 * per-run bounds. `budget` is shared across connections processed in name order.
 */
export async function listBounded(
	c: McpConnection,
	up: Upstream,
	budget: Budget,
	signal?: AbortSignal,
): Promise<SnapshotConnection> {
	const P = LIMITS.proxy;
	const kept: UpstreamTool[] = [];
	const drops = new Map<DroppedWhy, number>();
	const drop = (why: DroppedWhy, n = 1) =>
		drops.set(why, (drops.get(why) ?? 0) + n);
	let keptBytes = 0;
	let cursor: string | undefined;
	let stopped: DroppedWhy | null = null;
	do {
		let page: { tools: UpstreamTool[]; nextCursor?: string };
		try {
			// One page per request: the SDK's listTools gathers every page (06).
			page = (await up.client.request(
				{ method: "tools/list", params: cursor ? { cursor } : {} },
				{ signal },
			)) as typeof page;
		} catch (e) {
			// A first page too large or unreadable: the connection offers nothing.
			if (!kept.length && !drops.size) throw e;
			drop("received-bytes");
			break;
		}
		for (const t of [...page.tools].sort((a, b) =>
			a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
		)) {
			if (stopped) {
				drop(stopped);
				continue;
			}
			const size = Buffer.byteLength(
				JSON.stringify({ d: t.description ?? "", s: t.inputSchema }),
			);
			if (size > P.bytesPerTool) {
				drop("schema-bytes");
				continue;
			}
			const why: DroppedWhy | null =
				kept.length >= P.toolsPerConnection
					? "tool-count"
					: budget.tools >= P.toolsPerRun
						? "total-tools"
						: keptBytes + size > P.bytesPerConnection
							? "schema-bytes"
							: budget.bytes + size > P.bytesPerRun
								? "total-bytes"
								: null;
			if (why) {
				stopped = why;
				drop(why);
				continue;
			}
			kept.push(t);
			keptBytes += size;
			budget.tools++;
			budget.bytes += size;
		}
		cursor = page.nextCursor;
		const atBound =
			kept.length >= P.toolsPerConnection
				? "tool-count"
				: budget.tools >= P.toolsPerRun
					? "total-tools"
					: null;
		// More pages exist past a bound: at least one tool is left out, unseen.
		if (cursor && atBound && !stopped) {
			stopped = atBound;
			drop(atBound);
		}
	} while (cursor && !stopped);
	const names = allocateOfferedNames(
		c.name,
		kept.map((t) => t.name),
		new Set(),
	);
	const dropped = [...drops]
		.filter(([, count]) => count > 0)
		.map(([why, count]) => ({ count, why }));
	return {
		id: c.id,
		name: c.name,
		description: c.description,
		status: "connected",
		...(dropped.length ? { dropped } : {}),
		tools: kept.flatMap((t) => {
			const n = names.get(t.name);
			return n
				? [
						{
							offered: n.offered,
							upstream: t.name,
							description: t.description ?? "",
							inputSchema: t.inputSchema,
						},
					]
				: [];
		}),
	};
}
