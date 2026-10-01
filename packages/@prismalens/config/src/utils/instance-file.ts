// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `<workspace>/instance.json`: who this workspace is and which port it serves on (#763).
 */

import { randomUUID } from "node:crypto";
import {
	linkSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const INSTANCE_FILE = "instance.json";
export const DEFAULT_PORT = 6473;

export interface InstanceFile {
	instanceId: string;
	port: number;
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPort(value: unknown): value is number {
	return (
		Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535
	);
}

/** The instance file, or null when the workspace has none. Throws when it exists but is unreadable or invalid. */
export function readInstanceFile(workspaceDir: string): InstanceFile | null {
	const path = join(workspaceDir, INSTANCE_FILE);
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw new Error(
			`Cannot read ${path}: ${(e as Error).message}. Fix or remove it.`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`${path} is not valid JSON. Fix or remove it.`);
	}
	const record = parsed as Partial<InstanceFile> | null;
	if (
		!record ||
		typeof record.instanceId !== "string" ||
		!UUID_RE.test(record.instanceId) ||
		!isPort(record.port)
	) {
		throw new Error(
			`${path} must hold {"instanceId": "<uuid>", "port": <1-65535>}. Fix or remove it.`,
		);
	}
	return { instanceId: record.instanceId, port: record.port };
}

/** Read the instance file, creating it on first use. */
export function ensureInstanceFile(workspaceDir: string): InstanceFile {
	const existing = readInstanceFile(workspaceDir);
	if (existing) return existing;
	mkdirSync(workspaceDir, { recursive: true });
	const created: InstanceFile = {
		instanceId: randomUUID(),
		port: DEFAULT_PORT,
	};
	const path = join(workspaceDir, INSTANCE_FILE);
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(created, null, "\t")}\n`, {
		mode: 0o600,
	});
	// link() never replaces: a process that loses the creation race adopts the winner's id.
	try {
		linkSync(temp, path);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
		const winner = readInstanceFile(workspaceDir);
		if (winner) return winner;
		throw e;
	} finally {
		unlinkSync(temp);
	}
	return created;
}

/**
 * The port to serve on: an explicit `PRISMALENS_PORT` (set by `--port` too)
 * wins for this run without being saved; otherwise the workspace's own port.
 */
export function resolvePort(
	env: NodeJS.ProcessEnv,
	workspaceDir: string,
): number {
	const explicit = Number(env.PRISMALENS_PORT);
	if (env.PRISMALENS_PORT && isPort(explicit)) return explicit;
	return ensureInstanceFile(workspaceDir).port;
}
