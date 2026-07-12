// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export async function parseStdin(): Promise<
	Record<string, unknown> | undefined
> {
	if (process.stdin.isTTY) return undefined;

	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk as Buffer);
	}

	const raw = Buffer.concat(chunks).toString("utf-8").trim();
	if (!raw) return undefined;

	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`invalid FiringAlert JSON on stdin: ${msg}`);
	}
}
