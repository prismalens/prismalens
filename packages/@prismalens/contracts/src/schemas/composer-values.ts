// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).

export const UUID =
	"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** A message's event key, `<branch>:<seq>`; plain so it can name the message in a prompt's trusted line. */
export const MESSAGE_KEY = /^[\w.-]{1,120}:\d{1,9}$/;

/** A `message` reference's id: its thread and its event key (#1195). */
export const messageRefId = (threadId: string, key: string) =>
	`${threadId}/${key}`;

export function parseMessageRefId(
	id: string,
): { threadId: string; key: string } | null {
	const m = new RegExp(`^(${UUID})/(.+)$`).exec(id);
	return m?.[1] && m[2] && MESSAGE_KEY.test(m[2])
		? { threadId: m[1], key: m[2] }
		: null;
}
