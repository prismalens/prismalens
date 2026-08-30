// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { type Contract, contract } from "@prismalens/contracts";
import { config } from "./config.js";

// Must speak OpenAPI REST routes matching the Nest API's @Implement routes,
// not oRPC's default RPC procedure paths (#511).
const link = new OpenAPILink(contract, {
	url: config.PRISMALENS_WORKER_API_URL,
	headers: () => ({
		"Content-Type": "application/json",
		"User-Agent": "prismalens-worker/0.1.0",
		// Authenticate to internal API endpoints
		...(process.env.PRISMALENS_INTERNAL_SECRET && {
			"X-Internal-Secret": process.env.PRISMALENS_INTERNAL_SECRET,
		}),
	}),
});

export const api: ContractRouterClient<Contract> = createORPCClient(link);
