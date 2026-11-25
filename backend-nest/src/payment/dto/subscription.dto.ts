import { IsBoolean, IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class SubscribeMobileDto {
    @IsString()
    @MaxLength(30)
    tier: string;

    @IsString()
    @IsIn(['MONTHLY', 'QUARTERLY', 'YEARLY', 'BIENNIAL'])
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
    @IsIn(['MONTHLY', 'QUARTERLY', 'YEARLY', 'BIENNIAL'])
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
    @IsIn(['MONTHLY', 'QUARTERLY', 'YEARLY', 'BIENNIAL'])
    cycle: string;
}

export class SubscribeCryptoDto {
    @IsString()
    @MaxLength(30)
    tier: string;

    @IsString()
    @IsIn(['MONTHLY', 'QUARTERLY', 'YEARLY', 'BIENNIAL'])
    cycle: string;

    @IsString()
    @MaxLength(32)
    cryptocurrency: string;

    @IsOptional()
    @IsBoolean()
    useReferralCredits?: boolean;

    @IsOptional()
    @IsBoolean()
    forceNew?: boolean;
}

export class SubscribePixDto {
    @IsString()
    @MaxLength(30)
    tier: string;

    @IsString()
    @IsIn(['MONTHLY', 'QUARTERLY', 'YEARLY', 'BIENNIAL'])
    cycle: string;

    @IsString()
    @MaxLength(32)
    payerDocument: string;

    @IsOptional()
    @IsString()
    @MaxLength(140)
    payerName?: string;

    @IsOptional()
    @IsBoolean()
    useReferralCredits?: boolean;

    @IsOptional()
    @IsBoolean()
    forceNew?: boolean;
}

export class SubscribePayFastDto {
    @IsString()
    @MaxLength(30)
    tier: string;

    @IsString()
    @IsIn(['MONTHLY', 'QUARTERLY', 'YEARLY', 'BIENNIAL'])
    cycle: string;

    @IsOptional()
    @IsString()
    @IsUrl({ require_tld: false })
    @MaxLength(500)
    returnUrl?: string;

    @IsOptional()
    @IsString()
    @MaxLength(30)
    phoneNumber?: string;

    @IsOptional()
    @IsBoolean()
    useReferralCredits?: boolean;
}

export class PayRenewalInvoiceDto {
    @IsString()
    @IsIn(['mpesa', 'emola', 'card', 'payfast', 'pix', 'crypto'])
    paymentMethod: 'mpesa' | 'emola' | 'card' | 'payfast' | 'pix' | 'crypto';

    @IsOptional()
    @IsString()
    @MaxLength(30)
    phoneNumber?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    payerDocument?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    cryptocurrency?: string;

    @IsOptional()
    @IsString()
    @IsUrl({ require_tld: false })
    @MaxLength(500)
    returnUrl?: string;
}
