// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { instanceContract } from "@prismalens/contracts";
import { resolveServiceVersion } from "../../shared/utils/service-version.js";
import { InstanceIdentity } from "./instance-identity.js";
import { Public } from "./public.decorator.js";

/** Public and minimal (#763): anything more belongs behind pairing. */
@Public()
@Controller()
export class InstanceController {
	constructor(private readonly instance: InstanceIdentity) {}

	@Implement(instanceContract)
	instanceRoutes() {
		return {
			get: implement(instanceContract.get).handler(() => ({
				instanceId: this.instance.instanceId,
				version: resolveServiceVersion(),
				apiVersion: 1 as const,
			})),
		};
	}
}
