// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import "dotenv/config";
import { getConfig } from "@prismalens/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
	schema: "prisma/sqlite/schema",
	migrations: {
		path: "prisma/sqlite/schema",
		seed: "tsx ../../api/scripts/seed.ts",
	},
	datasource: {
		url: getConfig().PRISMALENS_DB_URL,
	},
});
