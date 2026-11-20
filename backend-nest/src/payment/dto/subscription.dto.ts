import { IsBoolean, IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class SubscribeMobileDto {
    @IsString()
    @MaxLength(30)
    tier: string;

    @IsString()
    @IsIn(['MONTHLY', 'YEARLY'])
    cycle: string;

    @IsString()
    @IsIn(['mpesa', 'emola'])
    paymentMethod: 'mpesa' | 'emola';

    @IsString()
    @MaxLength(30)
    phoneNumber: string;

    @IsOptional()
    @IsBoolean()
    savePreference?: boolean;

    @IsOptional()
    @IsBoolean()
    useReferralCredits?: boolean;
}

export class SubscribeCardDto {
    @IsString()
    @MaxLength(30)
    tier: string;

    @IsString()
    @IsIn(['MONTHLY', 'YEARLY'])
    cycle: string;

    @IsOptional()
    @IsString()
    @IsUrl({ require_tld: false })
    @MaxLength(500)
    returnUrl?: string;

    @IsOptional()
    @IsString()
    @IsUrl({ require_tld: false })
    @MaxLength(500)
    cancelUrl?: string;

    @IsOptional()
    @IsString()
    @MaxLength(30)
    phoneNumber?: string;

    @IsOptional()
    @IsString()
    @IsIn(['card'])
    paymentMethod?: 'card';

    @IsOptional()
    @IsBoolean()
    useReferralCredits?: boolean;
}

export class RedeemReferralCreditsDto {
    @IsString()
    @MaxLength(30)
    tier: string;

    @IsString()
    @IsIn(['MONTHLY', 'YEARLY'])
    cycle: string;
}
