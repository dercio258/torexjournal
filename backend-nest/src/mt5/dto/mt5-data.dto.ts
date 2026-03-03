import { IsString, IsNumber, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PositionDto {
    @IsNumber()
    @IsNumber()
    ticket: number;

    @IsString()
    symbol: string;

    @IsString()
    type: string;

    @IsNumber()
    volume: number;

    @IsNumber()
    openPrice: number; // camelCase

    @IsNumber()
    currentPrice: number; // camelCase

    @IsNumber()
    profit: number;

    @IsOptional()
    @IsNumber()
    sl?: number;

    @IsOptional()
    @IsNumber()
    tp?: number;

    @IsNumber() // Changed to Number for Timestamp
    openTime: number; // camelCase
}

export class Mt5DataDto {
    @IsString()
    token: string;

    @IsString() // We will update EA to send as String just to be standard
    mt5_id: string;

    @IsOptional() // Make optional so omitting it doesn't crash immediateley, but we will add to EA
    @IsString()
    broker?: string;

    @IsNumber()
    balance: number;

    @IsNumber()
    equity: number;

    @IsNumber()
    margin: number;

    @IsNumber()
    margin_free: number;

    @IsNumber()
    margin_level: number;

    @IsNumber()
    leverage: number;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PositionDto)
    positions: PositionDto[];
}

export class TradeDto {
    @IsNumber()
    ticket: number;

    @IsString()
    symbol: string;

    @IsString()
    type: string;

    @IsNumber()
    volume: number;

    @IsNumber()
    open_price: number;

    @IsNumber()
    close_price: number;

    @IsNumber() // Changed to Number
    open_time: number;

    @IsNumber() // Changed to Number
    close_time: number;

    @IsNumber()
    profit: number;

    @IsNumber()
    commission: number;

    @IsNumber()
    swap: number;

    @IsNumber()
    magic: number;

    @IsString()
    comment: string;
}
