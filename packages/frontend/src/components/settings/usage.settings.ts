// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const usageUsage = define.setting({
	id: "usage.usage",
	page: "usage",
	label: "Usage",
	sentence: "Tokens, cost and each agent's limits.",
	also: "cost tokens limits quota spend",
});

export const usagePrices = define.setting({
	id: "usage.prices",
	page: "usage",
	anchor: "usage-prices",
	label: "Prices",
	sentence: "API prices for models whose agent reports no cost.",
	also: "price estimate api per million unpriced",
});
