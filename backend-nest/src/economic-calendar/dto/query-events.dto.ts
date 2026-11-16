import { IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { EconomicEventCategory, EconomicEventImpact, EconomicEventStatus } from '../entities/economic-event.entity';

export class QueryEventsDto {
    @IsOptional()
    @IsString()
    from?: string; // YYYY-MM-DD or ISO

    @IsOptional()
    @IsString()
    to?: string; // YYYY-MM-DD or ISO

    @IsOptional()
    @IsString()
    @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
    currency?: string;

    @IsOptional()
    @IsString()
    country?: string;

    @IsOptional()
    @IsEnum(EconomicEventImpact)
    impact?: EconomicEventImpact;

    @IsOptional()
    @IsEnum(EconomicEventCategory)
    category?: EconomicEventCategory;

    @IsOptional()
    @IsEnum(EconomicEventStatus)
    status?: EconomicEventStatus;

    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(500)
    limit?: number = 200;

    @IsOptional()
    @IsString()
    accountId?: string;
}
