import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UserEntity } from './user.entity';
import { WhatsAppLink } from './whatsapp-link.entity';
import { WhatsAppVerificationCode } from './whatsapp-verification-code.entity';

@Global()
@Module({
    imports: [
        TypeOrmModule.forFeature([
            UserEntity,
            WhatsAppLink,
            WhatsAppVerificationCode,
        ]),
    ],
    providers: [UsersService],
    exports: [UsersService, TypeOrmModule],
})
export class UsersModule { }
