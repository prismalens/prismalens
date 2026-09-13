// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The Settings Harness verdict's on-demand ACP handshake (#630, Unit D on
 * #337): the same probe `pl doctor` runs, behind a button rather than page
 * load. A real handshake costs the harness a login check, so it never fires
 * for free on every Settings visit — `getStatus` (PATH presence only) still
 * runs there.
 */
import { Injectable } from "@nestjs/common";
import type { HarnessId } from "@prismalens/config/harness";
import type { HarnessProbeResult } from "@prismalens/contracts/schemas";
import { probeHarness } from "@prismalens/engine";

@Injectable()
export class HarnessProbeService {
	async check(id: HarnessId): Promise<HarnessProbeResult> {
		const result = await probeHarness(id);
		return {
			id: result.id,
			ready: result.ready,
			detail: result.detail,
			hard: result.hard,
		};
	}
}
