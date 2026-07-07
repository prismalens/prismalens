// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { IsUUID } from "class-validator";

export class LinkDeploymentDto {
	@IsUUID()
	serviceId!: string;
}
