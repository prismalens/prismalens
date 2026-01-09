import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { contract } from "@prismalens/contracts";
import { config } from "./config.js";

const link = new RPCLink({
	url: config.API_URL,
	headers: () => ({
		"Content-Type": "application/json",
		"User-Agent": "prismalens-worker/0.1.0",
	}),
});

export const api = createORPCClient<any>(link);
