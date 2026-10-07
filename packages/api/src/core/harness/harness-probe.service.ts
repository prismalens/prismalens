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
		const result = await probeHarness(id);
		if (result.outcome === "answers-acp")
			this.models.remember(id, result.models);
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
			servedModel: result.servedModel ?? null,
			effort,
			modes: result.modes ?? null,
			efforts: result.efforts ?? null,
			images: result.images === true,
		});
		return {
			id: result.id,
			outcome: result.outcome,
			detail: result.detail,
			hard: result.hard,
			...(result.models?.length ? { models: result.models } : {}),
			...(result.outcome === "answers-acp"
				? {
						servedModel: result.servedModel ?? null,
						effort,
						modes: result.modes ?? null,
						efforts: result.efforts ?? null,
						images: result.images === true,
					}
				: {}),
		};
	}
}
