import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import {
  RecommendationPriority,
  RecommendationCategory,
  Urgency,
  EffortEstimate,
} from '../../../shared/enums/index.js';

/**
 * DTO for recommendation data from worker
 */
export class RecommendationDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(RecommendationPriority)
  priority?: RecommendationPriority;

  @IsOptional()
  @IsEnum(RecommendationCategory)
  category?: RecommendationCategory;

  @IsOptional()
  @IsEnum(Urgency)
  urgency?: Urgency;

  @IsOptional()
  @IsBoolean()
  actionable?: boolean;

  @IsOptional()
  @IsEnum(EffortEstimate)
  estimatedEffort?: EffortEstimate;
}
