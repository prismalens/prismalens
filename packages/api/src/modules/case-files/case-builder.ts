// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import type {
	Alert,
	Capture,
	CaptureArtifact,
	Prisma,
} from "@prismalens/database";

export interface CaseBuildInput {
	incidentId: string;
	capture: Capture;
	artifacts: CaptureArtifact[];
	alerts: Alert[];
}

/** Placeholder until WU4b lands the real claim projection. */
@Injectable()
export class CaseBuilder {
	async build(
		_tx: Prisma.TransactionClient,
		_input: CaseBuildInput,
	): Promise<void> {}
}
