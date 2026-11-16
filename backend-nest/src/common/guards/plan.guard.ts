import { Injectable, CanActivate, ExecutionContext, SetMetadata, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanPermissionService, PlanTier } from '../../payment/plan-permission.service';

export const REQUIRED_PLAN = 'requiredPlan';
export const RequirePlan = (tier: PlanTier) => SetMetadata(REQUIRED_PLAN, tier);

@Injectable()
export class PlanGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private planPermissionService: PlanPermissionService
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requiredTier = this.reflector.getAllAndOverride<PlanTier>(REQUIRED_PLAN, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!requiredTier) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const user = request.user;
        const userId = user?.id || user?.userId;

        if (!userId) {
            return false;
        }

        const hasPermission = await this.planPermissionService.checkPermission(userId, requiredTier);
        if (!hasPermission) {
            throw new ForbiddenException(`Funcionalidade restrita ao plano ${requiredTier}`);
        }

        return true;
    }
}
