-- The agent's own mode decides; its asks wait on the operator (#673 w21).
-- AlterTable
ALTER TABLE "investigations" ADD COLUMN "awaitingApprovalAt" DATETIME;

-- No run starts in a plan mode: a stored one reads as the agent's default ask mode.
UPDATE "investigations" SET "agentMode" = CASE "harness"
    WHEN 'opencode' THEN 'build'
    ELSE 'default'
END
WHERE "agentMode" = 'plan' AND "harness" IN ('opencode', 'claude-code', 'gemini');
