// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import {
	type BindingDetection,
	BindingDetectionSchema,
	type BindingProbeState,
	BindingProbeStateSchema,
	type ServiceBinding,
} from "@prismalens/contracts";
import type { ServiceBinding as BindingRow } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	classifyFailure,
	IdentityError,
	type KubeContextView,
	resolveIdentity,
	viewContext,
} from "./capture/identity.js";
import {
	NoKubectlError,
	resolveKubectl,
	runCommand,
} from "./capture/run-command.js";
import { redactDiagnostic } from "./storage/redact.js";

const DETECT_TIMEOUT_MS = 5_000;
const DETECT_BYTE_CAP = 256 * 1024;
/** The probe only needs proof the list call was allowed; a cut list still proves it. */
const PROBE_BYTE_CAP = 64 * 1024;

export class ServiceNotFoundError extends Error {
	constructor(serviceId: string) {
		super(`Service ${serviceId} not found`);
		this.name = "ServiceNotFoundError";
	}
}

export class BindingNotFoundError extends Error {
	constructor(serviceId: string) {
		super(`Service ${serviceId} has no binding`);
		this.name = "BindingNotFoundError";
	}
}

/** The context could not be read on this machine, so there is no server to bind to. */
export class BindingRefusedError extends Error {
	constructor(
		readonly reason: BindingProbeState,
		detail: string,
	) {
		super(detail);
		this.name = "BindingRefusedError";
	}
}

async function kubectlText(
	bin: string,
	argv: string[],
): Promise<string | null> {
	try {
		const r = await runCommand({
			bin,
			argv,
			timeoutMs: DETECT_TIMEOUT_MS,
			byteCap: DETECT_BYTE_CAP,
		});
		return r.retrieval === "complete" ? r.stdout.toString("utf8") : null;
	} catch (err) {
		if (err instanceof NoKubectlError) throw err;
		return null;
	}
}

function clientVersion(json: string | null): string | null {
	if (json === null) return null;
	try {
		const parsed: unknown = JSON.parse(json);
		const version = (parsed as { clientVersion?: { gitVersion?: unknown } })
			?.clientVersion?.gitVersion;
		return typeof version === "string" ? version : null;
	} catch {
		return null;
	}
}

export function serializeBinding(row: BindingRow): ServiceBinding {
	let raw: unknown = null;
	try {
		raw = JSON.parse(row.detected);
	} catch {
		raw = null;
	}
	const detected = BindingDetectionSchema.safeParse(raw);
	const probeState = BindingProbeStateSchema.safeParse(row.probeState);
	return {
		id: row.id,
		serviceId: row.serviceId,
		kind: "kubernetes",
		kubeContext: row.kubeContext,
		cluster: row.cluster,
		namespace: row.namespace,
		kubeUser: row.kubeUser,
		detected: detected.success
			? detected.data
			: { kubectl: null, contexts: [] },
		confirmedAt: row.confirmedAt.toISOString(),
		probeState: probeState.success ? probeState.data : "unchecked",
		probeDetail: row.probeDetail,
		probedAt: row.probedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/** One service bound to one Kubernetes target, confirmed by the operator (s01). */
@Injectable()
export class BindingsService {
	constructor(private readonly prisma: PrismaService) {}

	/** What kubectl on this machine offers; never throws when kubectl is missing (e02). */
	async detect(_serviceId?: string): Promise<BindingDetection> {
		const none: BindingDetection = { kubectl: null, contexts: [] };
		const bin = resolveKubectl();
		if (bin === null) return none;
		try {
			const version = clientVersion(
				await kubectlText(bin, ["version", "--client", "-o", "json"]),
			);
			const contexts = (
				(await kubectlText(bin, ["config", "get-contexts", "-o", "name"])) ?? ""
			)
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean);
			const currentContext =
				(await kubectlText(bin, ["config", "current-context"]))?.trim() || null;
			let view: KubeContextView | null = null;
			if (currentContext !== null) {
				view = await viewContext(bin, currentContext).catch(() => null);
			}
			return {
				kubectl: { path: bin, version },
				contexts,
				currentContext,
				current: view
					? {
							cluster: view.server,
							user: view.kubeUser,
							namespace: view.namespace,
						}
					: null,
				suggested: currentContext
					? {
							kubeContext: currentContext,
							namespace: view?.namespace ?? "default",
						}
					: null,
			};
		} catch (err) {
			if (err instanceof NoKubectlError) return none;
			throw err;
		}
	}

	async get(serviceId: string): Promise<ServiceBinding | null> {
		const row = await this.prisma.serviceBinding.findUnique({
			where: { serviceId },
		});
		return row ? serializeBinding(row) : null;
	}

	/** Stores the binding whatever the probe says, then probes it once. */
	async confirm(input: {
		serviceId: string;
		kubeContext: string;
		namespace: string;
	}): Promise<ServiceBinding> {
		const service = await this.prisma.service.findUnique({
			where: { id: input.serviceId },
			select: { id: true },
		});
		if (!service) throw new ServiceNotFoundError(input.serviceId);

		const bin = resolveKubectl();
		if (bin === null) {
			throw new BindingRefusedError(
				"no-kubectl",
				"kubectl is not on PATH on this machine.",
			);
		}
		let view: KubeContextView;
		try {
			view = await viewContext(bin, input.kubeContext);
		} catch (err) {
			const reason =
				err instanceof IdentityError
					? err.reason
					: (classifyFailure("", err) ?? "context-missing");
			throw new BindingRefusedError(
				reason,
				await redactDiagnostic(
					err instanceof Error ? err.message : String(err),
				),
			);
		}
		const detected = await this.detect(input.serviceId);
		const fields = {
			kubeContext: input.kubeContext,
			cluster: view.server,
			namespace: input.namespace,
			kubeUser: view.kubeUser,
			detected: JSON.stringify(detected),
			confirmedAt: new Date(),
			probeState: "unchecked",
			probeDetail: null,
			probedAt: null,
		};
		await this.prisma.serviceBinding.upsert({
			where: { serviceId: input.serviceId },
			create: { serviceId: input.serviceId, ...fields },
			update: fields,
		});
		return this.probe(input.serviceId);
	}

	/** One real list call with the bound identity, not `auth can-i`. */
	async probe(serviceId: string): Promise<ServiceBinding> {
		const binding = await this.prisma.serviceBinding.findUnique({
			where: { serviceId },
		});
		if (!binding) throw new BindingNotFoundError(serviceId);
		const { state, detail } = await this.runProbe(binding);
		// Probe detail quotes kubectl stderr, which can carry credentials (#842).
		const probeDetail = detail === null ? null : await redactDiagnostic(detail);
		const row = await this.prisma.serviceBinding.update({
			where: { serviceId },
			data: { probeState: state, probeDetail, probedAt: new Date() },
		});
		return serializeBinding(row);
	}

	async remove(serviceId: string): Promise<boolean> {
		const { count } = await this.prisma.serviceBinding.deleteMany({
			where: { serviceId },
		});
		return count > 0;
	}

	private async runProbe(
		binding: BindingRow,
	): Promise<{ state: BindingProbeState; detail: string | null }> {
		const bin = resolveKubectl();
		if (bin === null) {
			return { state: "no-kubectl", detail: "kubectl is not on PATH" };
		}
		try {
			const identity = await resolveIdentity(bin, binding.kubeContext, {
				binding: { kubeContext: binding.kubeContext, cluster: binding.cluster },
			});
			if (!identity.matchesBinding) {
				return {
					state: "identity-mismatch",
					detail: `context ${binding.kubeContext} now points at ${identity.cluster}, not the bound ${binding.cluster}`,
				};
			}
			// kubectl get has no --limit flag; the byte cap bounds the read instead.
			const read = await runCommand({
				bin,
				timeoutMs: DETECT_TIMEOUT_MS,
				byteCap: PROBE_BYTE_CAP,
				argv: [
					"--context",
					binding.kubeContext,
					"-n",
					binding.namespace,
					"get",
					"pods",
					"-o",
					"name",
					"--request-timeout=5s",
				],
			});
			if (
				read.retrieval === "complete" ||
				read.retrievalReason === "byte-cap"
			) {
				return { state: "ok", detail: null };
			}
			return {
				state: classifyFailure(read.stderrTail) ?? "unreachable",
				detail: read.stderrTail.trim() || `get pods: ${read.retrievalReason}`,
			};
		} catch (err) {
			if (err instanceof IdentityError) {
				return { state: err.reason, detail: err.message };
			}
			const reason = classifyFailure("", err);
			if (reason) {
				return {
					state: reason,
					detail: err instanceof Error ? err.message : String(err),
				};
			}
			throw err;
		}
	}
}
