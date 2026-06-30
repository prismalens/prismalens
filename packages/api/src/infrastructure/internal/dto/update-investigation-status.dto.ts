import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from "class-validator";
import { WorkflowStatus } from "../../../shared/enums/index.js";

/**
 * DTO for updating investigation status (real-time updates from worker)
 */
export class UpdateInvestigationStatusDto {
	@IsEnum(WorkflowStatus)
	status!: WorkflowStatus;

	@IsOptional()
	@IsDateString()
	startedAt?: string;

	@IsOptional()
	@IsString()
	error?: string;

	@IsOptional()
	@IsUUID()
	harnessThreadId?: string;
}
