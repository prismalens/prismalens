// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * PrismaLens answers every ACP permission request yes; the agent's own
 * permission mode is the only limit (#673 walk w21, operator ruling 2026-10-07).
 */

export interface PermissionOption {
	optionId: string;
	name?: string;
	/** allow_once | allow_always | reject_once | reject_always */
	kind?: string;
}

export interface PermissionRequest {
	options: PermissionOption[];
	toolCall?: {
		title?: string;
		toolCallId?: string;
		kind?: string;
		rawInput?: unknown;
		locations?: { path?: string }[];
	};
}

export type PermissionDecision =
	| { allow: true; optionId: string; warn?: string }
	| { allow: false; optionId?: string; why: string };

export type PermissionPolicy = (req: PermissionRequest) => PermissionDecision;

export const allowAllPolicy: PermissionPolicy = (req) => {
	const allow =
		req.options.find((o) => o.kind === "allow_once") ??
		req.options.find((o) => o.kind?.startsWith("allow"));
	return allow
		? { allow: true, optionId: allow.optionId }
		: { allow: false, why: "harness offered no allow option" };
};

/** Kept so callers compile until item 6 renames them; options are ignored. */
export const readOnlyPolicyFor = (_options: unknown = {}): PermissionPolicy =>
	allowAllPolicy;
export const readOnlyPolicy: PermissionPolicy = allowAllPolicy;
