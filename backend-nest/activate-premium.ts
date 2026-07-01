import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { DataSource } from 'typeorm';
import { UserEntity } from './src/users/user.entity';
import { SubscriptionPlanConfig } from './src/payment/subscription-plan.entity';
import { Subscription, SubscriptionStatus, SubscriptionCycle } from './src/payment/subscription.entity';

async function bootstrap() {
    console.log('Bootstrapping application context to activate Premium plan...');
    const app = await NestFactory.createApplicationContext(AppModule);
    const dataSource = app.get(DataSource);

    const userRepo = dataSource.getRepository(UserEntity);
    const planRepo = dataSource.getRepository(SubscriptionPlanConfig);
    const subRepo = dataSource.getRepository(Subscription);

    const email = 'derciomatsope9@gmail.com';
    const user = await userRepo.findOne({ where: { email } });

    if (!user) {
        console.error(`User with email ${email} not found!`);
        await app.close();
        return;
    }

    // Find or create Premium plan config
    let premiumPlan = await planRepo.findOne({ where: { tier: 'PREMIUM', isActive: true } });
    if (!premiumPlan) {
        premiumPlan = planRepo.create({
            tier: 'PREMIUM',
            description: 'Premium subscription plan',
            monthlyPrice: 20.00,
            features: ['all_features'],
            isActive: true
        });
        await planRepo.save(premiumPlan);
        console.log('Created new PREMIUM plan configuration.');
    }

    // Deactivate any existing active subscriptions for this user
    await subRepo.update({ userId: user.id }, { status: SubscriptionStatus.CANCELLED });

    // Create active subscription
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    const sub = subRepo.create({
        userId: user.id,
        planConfigId: premiumPlan.id,
        status: SubscriptionStatus.ACTIVE,
        cycle: SubscriptionCycle.YEARLY,
        currentPeriodEnd: oneYearFromNow,
        paymentReference: 'ADMIN_ACTIVATION_PREMIUM',
        paymentMethod: 'ADMIN'
    });

    await subRepo.save(sub);
    console.log(`Successfully activated PREMIUM plan for ${email} until ${oneYearFromNow.toISOString()}!`);

    await app.close();
}

bootstrap().catch(console.error);
