import "dotenv/config";
import { defineConfig } from "prisma/config";
import { getConfig } from "@prismalens/config";

const dbType = getConfig().PRISMALENS_DB_TYPE;

export default defineConfig({
  schema: dbType === "postgresql"
    ? "prisma/pg.schema.prisma"
    : "prisma/sqlite.schema.prisma",
  migrations: {
    path: dbType === "postgresql"
      ? "prisma/migrations-pg"
      : "prisma/migrations-sqlite",
  },
  datasource: {
    url: getConfig().PRISMALENS_DB_URL,
  },
});
