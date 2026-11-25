import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsNumber,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

export class PrefetchCandleItemDto {
    @IsString()
    @MaxLength(48)
    symbol: string;

    @IsOptional()
    @IsString()
    @MaxLength(16)
    timeframe?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    toTs?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    fromTs?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(10)
    @Max(2500)
    chunkSize?: number;
}

export class PrefetchCandlesDto {
    @IsArray()
    @ArrayMaxSize(8)
    @ValidateNested({ each: true })
    @Type(() => PrefetchCandleItemDto)
    items: PrefetchCandleItemDto[];
}
