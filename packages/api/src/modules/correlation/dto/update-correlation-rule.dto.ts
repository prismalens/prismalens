import { Type } from "class-transformer";
import {
	IsArray,
	IsBoolean,
	IsEnum,
	IsInt,
	IsObject,
	IsOptional,
	IsString,
	Min,
	ValidateNested,
} from "class-validator";
import { CorrelationAction } from "../../../shared/enums/index.js";

/**
 * Match criteria for correlation rules
 */
class MatchConditions {
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	tags?: string[];

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	severity?: string[];

	@IsOptional()
	@IsString()
	service?: string;

	@IsOptional()
	@IsString()
	source?: string;
}

class MatchCriteriaDto {
	@IsOptional()
	@ValidateNested()
	@Type(() => MatchConditions)
	match?: MatchConditions;
}

/**
 * DTO for updating a correlation rule
 */
export class UpdateCorrelationRuleDto {
	@IsOptional()
	@IsString()
	name?: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;

	@IsOptional()
	@IsInt()
	@Min(0)
	priority?: number;

	@IsOptional()
	@IsObject()
	@ValidateNested()
	@Type(() => MatchCriteriaDto)
	matchCriteria?: MatchCriteriaDto;

	@IsOptional()
	@IsInt()
	@Min(1)
	timeWindowMinutes?: number;

	@IsOptional()
	@IsEnum(CorrelationAction)
	action?: CorrelationAction;
}
