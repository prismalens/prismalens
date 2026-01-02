import { IsString, IsOptional, IsEnum } from 'class-validator';
import {
  RecommendationStatus,
  RecommendationPriority,
} from '../../../shared/enums/index.js';

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
