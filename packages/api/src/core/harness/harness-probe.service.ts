// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The ACP handshake `pl doctor` runs (#630, Unit D on #337): behind the
 * Settings Check button, once per installed agent at boot, and before a run
 * when no recent "ready" is remembered (#673 w9). Never on a Settings visit:
 * `getStatus` (PATH presence only) runs there.
 */
import { Injectable } from "@nestjs/common";
import type { HarnessId } from "@prismalens/config/harness";
import type { HarnessProbeResult } from "@prismalens/contracts/schemas";
import { probeHarness } from "@prismalens/engine";
import { HarnessModelsService } from "./harness-models.service.js";

@Injectable()
export class HarnessProbeService {
	constructor(private readonly models: HarnessModelsService) {}

	async check(id: HarnessId): Promise<HarnessProbeResult> {
		const probed = await probeHarness(id);
		if (probed.outcome === "answers-acp")
			this.models.remember(id, probed.models);
		// The handshake passes signed out; the agent's own push says so (w8-9).
		const result: typeof probed =
			probed.outcome === "answers-acp" && probed.signedOut === true
				? { ...probed, outcome: "sign-in-needed", detail: "sign in needed" }
				: probed;
		const effort = result.effort
			? {
					id: result.effort.id,
					values: result.effort.values,
					default: result.effort.default,
				}
			: null;
		// Every outcome, so a run can be refused before it starts (#673 w9).
		this.models.rememberCheck(id, {
			outcome: result.outcome,
			detail: result.detail,
			version: result.version ?? null,
			companionVersion: result.companionVersion ?? null,
			servedModel: result.servedModel ?? null,
			effort,
			modes: result.modes ?? null,
			efforts: result.efforts ?? null,
			images: result.images === true,
			sandbox: result.sandbox ?? null,
		});
		return {
			id: result.id,
			outcome: result.outcome,
			detail: result.detail,
			hard: result.hard,
			version: result.version ?? null,
			companionVersion: result.companionVersion ?? null,
			...(result.models?.length ? { models: result.models } : {}),
			...(result.outcome === "answers-acp"
				? {
						servedModel: result.servedModel ?? null,
						effort,
						modes: result.modes ?? null,
						efforts: result.efforts ?? null,
						images: result.images === true,
						sandbox: result.sandbox ?? null,
					}
				: {}),
		};
	}
}
