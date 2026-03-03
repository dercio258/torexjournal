import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmailProcessor } from './email.processor';
import * as path from 'path';

@Module({
    imports: [
        BullModule.registerQueue({
            name: 'email-queue',
        }),
        MailerModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (config: ConfigService) => ({
                transport: {
                    host: config.get('EMAIL_HOST'),
                    port: config.get('EMAIL_PORT'),
                    secure: config.get('EMAIL_SECURE') === 'true',
                    auth: {
                        user: config.get('EMAIL_SYSTEM_USER'),
                        pass: config.get('EMAIL_SYSTEM_PASS'),
                    },
                },
                defaults: {
                    from: config.get('EMAIL_FROM_DEFAULT') || '"No Reply" <noreply@example.com>',
                },
                template: {
                    dir: path.join(process.cwd(), 'src/email/templates'), // Use absolute cwd path for safety
                    adapter: new HandlebarsAdapter(),
                    options: {
                        strict: true,
                    },
                },
                options: {
                    partials: {
                        dir: path.join(process.cwd(), 'src/email/templates/partials'),
                        options: {
                            strict: true,
                        },
                    },
                }
            }),
            inject: [ConfigService],
        }),
    ],
    providers: [EmailProcessor],
    exports: [BullModule], // Export BullModule so other modules can inject the queue
})
export class EmailModule { }
