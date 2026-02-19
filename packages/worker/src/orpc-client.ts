import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { Contract } from "@prismalens/contracts";
import { config } from "./config.js";

const link = new RPCLink({
	url: config.API_URL,
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
