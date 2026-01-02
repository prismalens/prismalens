import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsEnum,
  IsObject,
  ValidateNested,
  IsArray,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CorrelationAction } from '../../../shared/enums/index.js';

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
 * DTO for creating a correlation rule
 */
export class CreateCorrelationRuleDto {
  /** Unique rule name */
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** Rule description */
  @IsOptional()
  @IsString()
  description?: string;

  /** Whether the rule is enabled */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Priority (lower = higher priority) */
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  /**
   * Match criteria (JSON)
   * Example:
   * {
   *   "match": {
   *     "tags": ["database"],
   *     "severity": ["critical", "high"],
   *     "service": "user-service",
   *     "source": "prometheus"
   *   }
   * }
   */
  @IsObject()
  @ValidateNested()
  @Type(() => MatchCriteriaDto)
  matchCriteria!: MatchCriteriaDto;

  /** Time window in minutes to group alerts */
  @IsOptional()
  @IsInt()
  @Min(1)
  timeWindowMinutes?: number;

  /** Action: correlate, suppress, create_incident */
  @IsOptional()
  @IsEnum(CorrelationAction)
  action?: CorrelationAction;
}
