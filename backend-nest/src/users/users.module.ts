import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UserEntity } from './user.entity';
import { ReferralEntity } from './referral.entity';
import { ReferralService } from './referral.service';
import { ReferralController } from './referral.controller';

@Global()
@Module({
    imports: [
        TypeOrmModule.forFeature([
            UserEntity,
            ReferralEntity,
        ]),
    ],
    controllers: [ReferralController],
    providers: [UsersService, ReferralService],
    exports: [UsersService, ReferralService, TypeOrmModule],
})
export class UsersModule { }
