// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ArtifactPurpose } from "@prismalens/contracts";
import { LOG_LIMIT_BYTES, LOG_TAIL } from "./budget.js";

/** Bump when the argv below changes: it is part of the canonical query, so captures stop sharing across versions. */
export const CHECKLIST_VERSION = 1;
export const CAPTURE_KIND = "k8s-alert-time";

/** Argv elements no checklist or logs command may carry; `config` is allowed only in identity.ts. */
export const FORBIDDEN_TOKENS = [
	"secret",
	"secrets",
	"configmap",
	"configmaps",
	"exec",
	"cp",
	"port-forward",
	"proxy",
	"describe",
	"--raw",
	"env",
	"config",
] as const;

export interface CaptureTarget {
	kubeContext: string;
	cluster: string;
	namespace: string;
}

export interface CaptureCommand {
	purpose: ArtifactPurpose;
	/** `<pod>/<container>` for logs-previous. */
	subject: string | null;
	argv: string[];
}

export interface CanonicalQuery {
	v: 1;
	kind: typeof CAPTURE_KIND;
	checklistVersion: number;
	kubeContext: string;
	cluster: string;
	namespace: string;
}

const LIST_PURPOSES = ["events", "deployments", "replicasets", "pods"] as const;

/** Kubernetes object names (DNS-1123); anything else is refused rather than passed to kubectl. */
const K8S_NAME = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

function targetFlags(target: CaptureTarget): string[] {
	return [
		"--context",
		target.kubeContext,
		"--namespace",
		target.namespace,
		"--request-timeout=15s",
	];
}

/** The four list commands, in run order. */
export function checklistArgv(target: CaptureTarget): CaptureCommand[] {
	return LIST_PURPOSES.map((purpose) => ({
		purpose,
		subject: null,
		argv: ["get", purpose, "-o", "json", ...targetFlags(target)],
	}));
}

export function logsArgv(
	target: CaptureTarget,
	pod: string,
	container: string,
): CaptureCommand {
	if (!K8S_NAME.test(pod) || !K8S_NAME.test(container)) {
		throw new Error(`not a Kubernetes name: ${pod}/${container}`);
	}
	return {
		purpose: "logs-previous",
		subject: `${pod}/${container}`,
		argv: [
			"logs",
			pod,
			"-c",
			container,
			"--previous",
			`--tail=${LOG_TAIL}`,
			`--limit-bytes=${LOG_LIMIT_BYTES}`,
			"--timestamps",
			...targetFlags(target),
		],
	};
}

/** kubectl stops at `--limit-bytes` without saying so; output of exactly that length was cut. */
export function logsCut(stdoutBytes: number): boolean {
	return stdoutBytes >= LOG_LIMIT_BYTES;
}

export function hasForbiddenToken(argv: readonly string[]): boolean {
	const forbidden: readonly string[] = FORBIDDEN_TOKENS;
	return argv.some((arg) => forbidden.includes(arg.toLowerCase()));
}

export function canonicalQuery(target: CaptureTarget): CanonicalQuery {
	return {
		v: 1,
		kind: CAPTURE_KIND,
		checklistVersion: CHECKLIST_VERSION,
		kubeContext: target.kubeContext,
		cluster: target.cluster,
		namespace: target.namespace,
	};
}
