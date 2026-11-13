#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Huge-output conditions (#1101): huge.log, huge.paste and huge.binary, one thread each,
// shaped as the app stores them: tool output already cut to its 4,000-character preview,
// so the size rides on an agent's reply, a folded paste and an attached file.
//   PRISMALENS_WORKSPACE_DIR=<dir> pnpm --filter @prismalens/api seed:huge-output [log|paste|binary|all]
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CanonicalEvent } from "@prismalens/contracts";
import { runMigrations } from "@prismalens/database/migrator";
import { writeStamp } from "../../../scripts/fakes/conditions/stamp.mjs";
import { clearSeed, seedId } from "./seed-ids.js";

const SEED = "huge-output";
const PREVIEW = 4000;

export const HUGE = {
	log: { replyLines: 50_000, toolResults: 200, previewChars: PREVIEW },
	paste: { messageChars: 4000, pasteBytes: 3 * 1024 * 1024 },
	binary: { previewChars: PREVIEW, fileBytes: 20 * 1024 * 1024 },
} as const;
type Kind = keyof typeof HUGE;

function logLines(n: number): string {
	const out: string[] = [];
	for (let i = 0; i < n; i++)
		out.push(
			`2026-11-13T08:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z level=${i % 13 === 0 ? "error" : "info"} svc=checkout req=${i} msg="pool ${i % 50}/50 in use, wait ${i % 900} ms"`,
		);
	return out.join("\n");
}

/** Deterministic bytes that are not text: NULs, control bytes and invalid UTF-8. */
function binaryBytes(n: number): Buffer {
	const b = Buffer.alloc(n);
	let x = 2463534242;
	for (let i = 0; i < n; i++) {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		b[i] = x & 0xff;
	}
	b.write("\x7fELF", 0, "latin1");
	return b;
}

interface Built {
	title: string;
	events: CanonicalEvent[];
	files: { id: string; name: string; mimeType: string; bytes: Buffer }[];
}

function build(kind: Kind, start: number): Built {
	const runId = seedId(SEED, `${kind}:run`);
	const base = { runId, branchId: "main", path: [] as string[] };
	let seq = 0;
	let t = start;
	const ts = () => {
		t += 1000;
		return new Date(t).toISOString();
	};
	const events: CanonicalEvent[] = [];
	const files: Built["files"] = [];
	if (kind === "log") {
		events.push({
			kind: "operator_message",
			...base,
			seq: seq++,
			ts: ts(),
			text: "Show me the whole checkout log from the incident window.",
			mode: "queue",
			delivered: true,
		});
		for (let c = 0; c < HUGE.log.toolResults; c++) {
			const callId = `huge-log-${c}`;
			events.push({
				kind: "agent_step",
				...base,
				seq: seq++,
				ts: ts(),
				text: "",
				toolCalls: [
					{
						toolCallId: callId,
						name: "Bash",
						args: { command: `kubectl logs checkout-${c} --tail=100000` },
					},
				],
			});
			events.push({
				kind: "tool_result",
				...base,
				seq: seq++,
				ts: ts(),
				result: {
					name: "Bash",
					toolCallId: callId,
					source: `kubectl logs checkout-${c} --tail=100000`,
					ok: true,
					error: null,
					preview: logLines(60).slice(0, PREVIEW),
				},
			});
		}
		events.push({
			kind: "agent_step",
			...base,
			seq: seq++,
			ts: ts(),
			text: `Here is the full window:\n\n\`\`\`\n${logLines(HUGE.log.replyLines)}\n\`\`\`\n`,
			toolCalls: [],
		});
		return { title: "Huge log in a reply", events, files };
	}
	if (kind === "paste") {
		const id = seedId(SEED, "paste:file");
		const bytes = Buffer.from(
			logLines(40_000).slice(0, HUGE.paste.pasteBytes),
			"utf8",
		);
		files.push({ id, name: "Pasted text.txt", mimeType: "text/plain", bytes });
		const text = `Here is what I see:\n${logLines(60)}`.slice(
			0,
			HUGE.paste.messageChars,
		);
		events.push({
			kind: "operator_message",
			...base,
			seq: seq++,
			ts: ts(),
			text,
			mode: "queue",
			delivered: true,
			attachments: [
				{
					id,
					name: "Pasted text.txt",
					mimeType: "text/plain",
					size: bytes.length,
					at: text.length,
				},
			],
		});
		events.push({
			kind: "agent_step",
			...base,
			seq: seq++,
			ts: ts(),
			text: "Read the paste: the pool saturates at 08:14.",
			toolCalls: [],
		});
		return { title: "Huge paste", events, files };
	}
	const id = seedId(SEED, "binary:file");
	const bytes = binaryBytes(HUGE.binary.fileBytes);
	files.push({
		id,
		name: "core.checkout.dump",
		mimeType: "application/octet-stream",
		bytes,
	});
	events.push({
		kind: "operator_message",
		...base,
		seq: seq++,
		ts: ts(),
		text: "The checkout pod crashed; here is its core dump.",
		mode: "queue",
		delivered: true,
		attachments: [
			{
				id,
				name: "core.checkout.dump",
				mimeType: "application/octet-stream",
				size: bytes.length,
			},
		],
	});
	events.push({
		kind: "agent_step",
		...base,
		seq: seq++,
		ts: ts(),
		text: "",
		toolCalls: [
			{
				toolCallId: "huge-binary",
				name: "Bash",
				args: { command: "cat core.checkout.dump" },
			},
		],
	});
	events.push({
		kind: "tool_result",
		...base,
		seq: seq++,
		ts: ts(),
		result: {
			name: "Bash",
			toolCallId: "huge-binary",
			source: "cat core.checkout.dump",
			ok: true,
			error: null,
			preview: bytes.subarray(0, HUGE.binary.previewChars).toString("utf8"),
		},
	});
	events.push({
		kind: "agent_step",
		...base,
		seq: seq++,
		ts: ts(),
		text: "That is a binary core file; reading it as text shows nothing useful.",
		toolCalls: [],
	});
	return { title: "Huge binary output", events, files };
}

async function main(): Promise<void> {
	const dir = process.env.PRISMALENS_WORKSPACE_DIR;
	if (!dir)
		throw new Error(
			"Set PRISMALENS_WORKSPACE_DIR to the dev workspace to seed.",
		);
	const pick = process.argv[2] ?? "all";
	const kinds: Kind[] =
		pick === "all" ? ["log", "paste", "binary"] : [pick as Kind];
	if (!kinds.every((k) => k in HUGE))
		throw new Error("Usage: seed-huge-output.ts [log|paste|binary|all]");
	await runMigrations({ databaseFile: join(dir, "prismalens.db") });
	const { prisma } = await import("@prismalens/database");
	const now = Date.now();
	for (const kind of kinds) {
		const id = seedId(SEED, kind);
		await clearSeed(prisma, [id]);
		const built = build(kind, now - 3600_000);
		await prisma.investigation.create({
			data: {
				id,
				kind: "chat",
				status: "completed",
				lastTurnOutcome: "answered",
				title: built.title,
				createdAt: new Date(now - 3600_000),
				startedAt: new Date(now - 3600_000),
				completedAt: new Date(now - 60_000),
				lastActivityAt: new Date(now - 60_000),
			},
		});
		for (const e of built.events)
			await prisma.investigationEvent.create({
				data: {
					investigationId: id,
					seq: e.seq,
					branchId: "main",
					event: JSON.stringify(e),
				},
			});
		const artifacts: string[] = [];
		mkdirSync(join(dir, "attachments"), { recursive: true });
		for (const f of built.files) {
			const path = join(dir, "attachments", f.id);
			writeFileSync(path, f.bytes);
			artifacts.push(path);
			await prisma.attachment.deleteMany({ where: { id: f.id } });
			await prisma.attachment.create({
				data: {
					id: f.id,
					investigationId: id,
					name: f.name,
					mimeType: f.mimeType,
					size: f.bytes.length,
					sha256: createHash("sha256").update(f.bytes).digest("hex"),
				},
			});
		}
		const stored = built.events.reduce(
			(n, e) => n + Buffer.byteLength(JSON.stringify(e)),
			0,
		);
		console.log(
			`seed:huge-output ${kind}: thread ${id}, ${stored} event bytes`,
		);
		writeStamp({
			condition: `huge.${kind}`,
			simulator: "seed.huge-output",
			profile: { ...HUGE[kind] },
			observed: {
				threadId: id,
				events: built.events.length,
				eventBytes: stored,
				fileBytes: built.files.reduce((n, f) => n + f.bytes.length, 0),
				seedRun: randomUUID(),
			},
			artifacts,
		});
	}
	await prisma.$disconnect();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
	main().catch((err) => {
		console.error("seed:huge-output failed:", err);
		process.exit(1);
	});
