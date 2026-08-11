/*
  Warnings:

  - You are about to drop the `agent_executions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tool_executions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "agent_executions";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "tool_executions";
PRAGMA foreign_keys=on;
