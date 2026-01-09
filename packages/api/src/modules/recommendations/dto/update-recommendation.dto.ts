import { IsEnum, IsOptional, IsString } from "class-validator";
import {
	RecommendationPriority,
	RecommendationStatus,
} from "../../../shared/enums/index.js";

/**
 * DTO for updating a recommendation
 */
export class UpdateRecommendationDto {
	@IsOptional()
	@IsEnum(RecommendationStatus)
	status?: RecommendationStatus;

	@IsOptional()
	@IsEnum(RecommendationPriority)
	priority?: RecommendationPriority;

	@IsOptional()
	@IsString()
	notes?: string;
}
