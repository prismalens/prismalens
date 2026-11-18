// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TurnInputPart } from "@prismalens/contracts/schemas";
import type { PromptPart } from "../runner/acp-client.js";
import { scrub } from "./redact.js";

/** What one prompt sent the agent, as stored (#1166): every string scrubbed, images by size only. */
export interface TurnInputBody {
	parts: TurnInputPart[];
	/** Characters of text the parts hold. */
	chars: number;
}

function base64Bytes(data: string): number {
	const pad = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((data.length * 3) / 4) - pad);
}

export function turnInputOf(
	sent: readonly PromptPart[],
	system: string | null,
	hidden: readonly string[],
): TurnInputBody {
	const parts: TurnInputPart[] = [
		...(system
			? [{ type: "system" as const, text: scrub(system, hidden) }]
			: []),
		...sent.map((p): TurnInputPart => {
			if (p.type === "text")
				return { type: "text", text: scrub(p.text, hidden) };
			if (p.type === "image")
				return {
					type: "image",
					mimeType: p.mimeType,
					bytes: base64Bytes(p.data),
				};
			return {
				type: "link",
				name: scrub(p.name, hidden),
				uri: scrub(p.uri, hidden),
			};
		}),
	];
	const chars = parts.reduce(
		(n, p) =>
			n + (p.type === "text" || p.type === "system" ? p.text.length : 0),
		0,
	);
	return { parts, chars };
}
