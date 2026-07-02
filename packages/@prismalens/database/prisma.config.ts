import "dotenv/config";
import { getConfig } from "@prismalens/config";
import { defineConfig } from "prisma/config";

const dbType = getConfig().PRISMALENS_DB_TYPE;

export default defineConfig({
	schema: dbType === "postgresql" ? "prisma/pg/schema" : "prisma/sqlite/schema",
	migrations: {
		path: dbType === "postgresql" ? "prisma/pg/schema" : "prisma/sqlite/schema",
		seed: "tsx prisma/seed.ts",
	},
	datasource: {
		url: getConfig().PRISMALENS_DB_URL,
	},
});
