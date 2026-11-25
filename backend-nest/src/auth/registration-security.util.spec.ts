import { BadRequestException } from '@nestjs/common';
import {
    assertAllowedRegistrationEmail,
    assertStrongPassword,
    isDisposableEmailDomain,
    validateRegistrationEmail,
    validateStrongPassword,
} from './registration-security.util';

describe('registration-security.util', () => {
    describe('Disposable / temporary email blocking', () => {
        it.each([
            'teste@mailinator.com',
            'user@sub.mailinator.com',
            'abc@yopmail.com',
            'foo@10minutemail.com',
            'bar@guerrillamail.com',
            'tmp@sharklasers.com',
            'x@temp-mail.org',
            'y@tempmail.plus',
            'z@maildrop.cc',
            'q@getnada.com',
            'w@mohmal.com',
            'e@1secmail.com',
            'r@trashmail.com',
            't@throwawaymail.com',
            'u@emailtemporario.com.br',
            'clone@my-super-tempmail-zone.xyz',
            'bot@fakeinbox-new.net',
        ])('rejects disposable email: %s', async (email) => {
            const res = await validateRegistrationEmail(email, { checkDnsMx: false });
            expect(res.valid).toBe(false);
            expect(res.reasonCode).toBe('DISPOSABLE_DOMAIN');
            await expect(
                assertAllowedRegistrationEmail(email, { checkDnsMx: false }),
            ).rejects.toThrow(BadRequestException);
        });

        it.each([
            'dercio@gmail.com',
            'trader@outlook.com',
            'contato@torexjournal.com',
            'ana.silva@icloud.com',
            'investidor@proton.me',
            'maria@sapo.pt',
            'empresa@minhaempresa.co.mz',
            'joao@yahoo.com',
        ])('allows legitimate email: %s', async (email) => {
            expect(isDisposableEmailDomain(email.split('@')[1])).toBe(false);
            const res = await validateRegistrationEmail(email, { checkDnsMx: false });
            expect(res.valid).toBe(true);
        });

        it('rejects reserved local/test TLDs and IP literals', async () => {
            expect(
                (await validateRegistrationEmail('user@localhost', { checkDnsMx: false })).valid,
            ).toBe(false);
            expect(
                (await validateRegistrationEmail('user@domain.local', { checkDnsMx: false })).valid,
            ).toBe(false);
            expect(
                (await validateRegistrationEmail('user@127.0.0.1', { checkDnsMx: false })).valid,
            ).toBe(false);
        });
    });

    describe('Strong password policy & anti-predictable patterns', () => {
        const ctx = {
            name: 'Dércio Matsope',
            email: 'dercio.trader@gmail.com',
            contact: '+258843357697',
        };

        it('requires minimum 8 chars, uppercase, lowercase, number, and special char', () => {
            expect(validateStrongPassword('Kz#9mQ!', ctx).failedRule).toBe('minLength');
            expect(validateStrongPassword('kzm9q!x7w', ctx).failedRule).toBe('hasUppercase');
            expect(validateStrongPassword('KZM9Q!X7W', ctx).failedRule).toBe('hasLowercase');
            expect(validateStrongPassword('KzMq!XwLp', ctx).failedRule).toBe('hasNumber');
            expect(validateStrongPassword('KzMq9XwLp', ctx).failedRule).toBe('hasSpecial');
        });

        it('blocks sequential numbers (ascending, descending, and 890/098)', () => {
            expect(validateStrongPassword('Kzv!123Xm', ctx).failedRule).toBe('noSequentialNumbers');
            expect(validateStrongPassword('Kzv!456Xm', ctx).failedRule).toBe('noSequentialNumbers');
            expect(validateStrongPassword('Kzv!987Xm', ctx).failedRule).toBe('noSequentialNumbers');
            expect(validateStrongPassword('Kzv!890Xm', ctx).failedRule).toBe('noSequentialNumbers');
            expect(validateStrongPassword('Kzv!321Xm', ctx).failedRule).toBe('noSequentialNumbers');
        });

        it('blocks sequential letters and keyboard walks', () => {
            expect(validateStrongPassword('Abcd#92Kp', ctx).failedRule).toBe(
                'noSequentialLettersOrKeyboard',
            );
            expect(validateStrongPassword('Qwerty#92', ctx).failedRule).toBe(
                'noSequentialLettersOrKeyboard',
            );
            expect(validateStrongPassword('Asdf!84Kp', ctx).failedRule).toBe(
                'noSequentialLettersOrKeyboard',
            );
        });

        it('blocks repeated characters (3+ identical in a row)', () => {
            expect(validateStrongPassword('Kaaa#92Xp', ctx).failedRule).toBe('noRepeatedChars');
            expect(validateStrongPassword('Kz#111Xp', ctx).failedRule).toBe('noRepeatedChars');
        });

        it('blocks parts of user name (including accents & leet), email, and phone digits', () => {
            expect(validateStrongPassword('Dercio#94!', ctx).failedRule).toBe('noPersonalInfo');
            expect(validateStrongPassword('D3rc10#94!', ctx).failedRule).toBe('noPersonalInfo');
            expect(validateStrongPassword('Matsope@82!', ctx).failedRule).toBe('noPersonalInfo');
            expect(validateStrongPassword('Trader@82!', ctx).failedRule).toBe('noPersonalInfo');
            expect(validateStrongPassword('KzMq!7697', ctx).failedRule).toBe('noPersonalInfo');
            expect(validateStrongPassword('KzMq!84335', ctx).failedRule).toBe('noPersonalInfo');
        });

        it('blocks common weak passwords and brand words (even with leet)', () => {
            expect(validateStrongPassword('P@ssw0rd!94', ctx).failedRule).toBe(
                'noCommonWeakPassword',
            );
            expect(validateStrongPassword('S3nha#84!', ctx).failedRule).toBe(
                'noCommonWeakPassword',
            );
            expect(validateStrongPassword('Torex#94!', ctx).failedRule).toBe(
                'noCommonWeakPassword',
            );
            expect(validateStrongPassword('Admin@2026!', ctx).failedRule).toBe(
                'noCommonWeakPassword',
            );
        });

        it('accepts strong non-predictable passwords cleanly', () => {
            const strong1 = validateStrongPassword('Vortex#94Km!', ctx);
            expect(strong1.valid).toBe(true);
            expect(strong1.score).toBe(4);

            const strong2 = validateStrongPassword('Lp7$Qv29', ctx);
            expect(strong2.valid).toBe(true);
            expect(strong2.score).toBe(3);

            expect(() => assertStrongPassword('Norte@48Cais#', ctx, 'pt')).not.toThrow();
        });
    });
});
