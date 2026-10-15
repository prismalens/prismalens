// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { BlockedReason, CaptureIdentity } from "@prismalens/contracts";
import { NoKubectlError, runCommand } from "./run-command.js";

const IDENTITY_TIMEOUT_MS = 5_000;
const IDENTITY_BYTE_CAP = 1024 * 1024;

export type FailureReason = Exclude<BlockedReason, "identity-mismatch">;

export interface BindingTarget {
	kubeContext: string;
	cluster: string;
}

/** Identity could not be read; the capture is blocked and no command runs after it. */
export class IdentityError extends Error {
	constructor(
		readonly reason: FailureReason,
		detail: string,
	) {
		super(detail);
		this.name = "IdentityError";
	}
}

/** Maps a kubectl failure to a blocked reason; null when nothing matches. */
export function classifyFailure(
	stderr: string,
	error?: unknown,
): FailureReason | null {
	if (
		error instanceof NoKubectlError ||
		(error instanceof Error &&
			(error as NodeJS.ErrnoException).code === "ENOENT")
	) {
		return "no-kubectl";
	}
	if (/forbidden|unauthorized/i.test(stderr)) return "unauthorised";
	if (/context .*(does not exist|not found)/i.test(stderr)) {
		return "context-missing";
	}
	if (
		/unable to connect|i\/o timeout|no such host|connection refused|deadline exceeded/i.test(
			stderr,
		)
	) {
		return "unreachable";
	}
	return null;
}

export function matchesBinding(
	identity: Pick<CaptureIdentity, "kubeContext" | "cluster">,
	binding: BindingTarget,
): boolean {
	return (
		identity.kubeContext === binding.kubeContext &&
		identity.cluster === binding.cluster
	);
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function first(value: unknown): Record<string, unknown> {
	return Array.isArray(value) ? record(value[0]) : {};
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function parseJson(buf: Buffer): unknown {
	try {
		return JSON.parse(buf.toString("utf8"));
	} catch {
		return null;
	}
}

function parseWhoami(buf: Buffer): CaptureIdentity["whoami"] {
	const info = record(record(record(parseJson(buf)).status).userInfo);
	const username = text(info.username);
	if (username === null) return null;
	const groups = Array.isArray(info.groups)
		? info.groups.filter((g): g is string => typeof g === "string")
		: undefined;
	const uid = text(info.uid) ?? undefined;
	return { username, ...(uid ? { uid } : {}), ...(groups ? { groups } : {}) };
}

export interface KubeContextView {
	kubeContext: string;
	/** The kubeconfig cluster entry's name, not its server. */
	clusterName: string | null;
	server: string;
	kubeUser: string | null;
	namespace: string | null;
}

/**
 * Reads one context from this machine's kubeconfig. The `config view` output holds
 * kubeconfig material: only names and the server URL leave this function, and the
 * output is never stored (s05).
 */
export async function viewContext(
	bin: string,
	kubeContext: string,
	signal?: AbortSignal,
): Promise<KubeContextView> {
	let view: Awaited<ReturnType<typeof runCommand>>;
	try {
		view = await runCommand({
			bin,
			timeoutMs: IDENTITY_TIMEOUT_MS,
			byteCap: IDENTITY_BYTE_CAP,
			signal,
			argv: [
				"config",
				"view",
				"--minify",
				"--context",
				kubeContext,
				"-o",
				"json",
			],
		});
	} catch (err) {
		throw new IdentityError(
			classifyFailure("", err) ?? "context-missing",
			err instanceof Error ? err.message : String(err),
		);
	}
	if (view.retrieval !== "complete") {
		// A kubeconfig that cannot be read for this context is, to the capture, a missing context.
		throw new IdentityError(
			classifyFailure(view.stderrTail) ?? "context-missing",
			view.stderrTail || `config view: ${view.retrievalReason}`,
		);
	}
	const config = record(parseJson(view.stdout));
	const context = first(config.contexts);
	const server = text(record(first(config.clusters).cluster).server);
	if (text(context.name) !== kubeContext || server === null) {
		throw new IdentityError(
			"context-missing",
			`context ${kubeContext} not found in kubeconfig`,
		);
	}
	const entry = record(context.context);
	return {
		kubeContext,
		clusterName: text(entry.cluster),
		server,
		kubeUser: text(entry.user),
		namespace: text(entry.namespace),
	};
}

/** Who `kubeContext` resolves to on this machine; throws IdentityError when it cannot be read. */
export async function resolveIdentity(
	bin: string,
	kubeContext: string,
	options: { binding?: BindingTarget; signal?: AbortSignal } = {},
): Promise<CaptureIdentity> {
	const view = await viewContext(bin, kubeContext, options.signal);
	let whoami: CaptureIdentity["whoami"] = null;
	try {
		const who = await runCommand({
			bin,
			timeoutMs: IDENTITY_TIMEOUT_MS,
			byteCap: IDENTITY_BYTE_CAP,
			signal: options.signal,
			argv: [
				"auth",
				"whoami",
				"--context",
				kubeContext,
				"-o",
				"json",
				"--request-timeout=5s",
			],
		});
		// Needs client and server >= 1.28; an older pair leaves whoami null, which does not make the capture partial.
		if (who.retrieval === "complete") whoami = parseWhoami(who.stdout);
	} catch {
		whoami = null;
	}

	const identity = {
		kubeContext,
		cluster: view.server,
		kubeUser: view.kubeUser,
		whoami,
	};
	return {
		...identity,
		matchesBinding: options.binding
			? matchesBinding(identity, options.binding)
			: false,
	};
}
