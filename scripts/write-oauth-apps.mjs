// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Writes the PrismaLens-owned OAuth app IDs from OAUTH_APP_<VENDOR>_CLIENT_ID/_CLIENT_SECRET
// before `pnpm build` (#848). Public clients; a vendor with no ID set is left out.
import { writeFileSync } from "node:fs";

const apps = {};
for (const vendor of ["github", "gitlab", "bitbucket"]) {
	const key = `OAUTH_APP_${vendor.toUpperCase()}`;
	const clientId = process.env[`${key}_CLIENT_ID`]?.trim();
	const clientSecret = process.env[`${key}_CLIENT_SECRET`]?.trim();
	if (clientId)
		apps[vendor] = { clientId, ...(clientSecret ? { clientSecret } : {}) };
}
writeFileSync(
	new URL(
		"../packages/@prismalens/contracts/src/schemas/oauth-apps.generated.json",
		import.meta.url,
	),
	`${JSON.stringify(apps, null, "\t")}\n`,
);
console.log(`OAuth apps: ${Object.keys(apps).join(", ") || "none"}`);
