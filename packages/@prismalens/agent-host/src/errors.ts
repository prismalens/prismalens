// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export const AGENT_HOST_ERROR_CODES = [
	"unsafe-gateway-url",
	"user-setup-unsupported",
	"workspace-exists",
	"git-failed",
	"unsafe-copy-path",
] as const;
export type AgentHostErrorCode = (typeof AGENT_HOST_ERROR_CODES)[number];

/** A refusal with a stable code; each product picks its own words for it. */
export class AgentHostError extends Error {
	constructor(
		readonly code: AgentHostErrorCode,
		message: string,
	) {
		super(message);
		this.name = "AgentHostError";
	}
}
