-- DropForeignKey
ALTER TABLE "agent_executions" DROP CONSTRAINT "agent_executions_investigationId_fkey";

-- DropForeignKey
ALTER TABLE "tool_executions" DROP CONSTRAINT "tool_executions_agentExecutionId_fkey";

-- DropTable
DROP TABLE "agent_executions";

-- DropTable
DROP TABLE "tool_executions";

-- DropEnum
DROP TYPE "AgentType";

-- DropEnum
DROP TYPE "ExecutionStatus";

-- DropEnum
DROP TYPE "ToolExecutionStatus";

-- DropEnum
DROP TYPE "ToolCategory";
