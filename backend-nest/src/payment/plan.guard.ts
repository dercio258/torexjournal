import { CanActivate, ExecutionContext, Injectable, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanPermissionService, PlanTier } from './plan-permission.service';

export const REQUIRE_PLAN_KEY = 'requiredPlanTier';
export const RequirePlan = (tier: PlanTier) => SetMetadata(REQUIRE_PLAN_KEY, tier);

@Injectable()
export class PlanGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private planPermissionService: PlanPermissionService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requiredTier = this.reflector.get<PlanTier>(REQUIRE_PLAN_KEY, context.getHandler()) || 
                             this.reflector.get<PlanTier>(REQUIRE_PLAN_KEY, context.getClass());

        if (!requiredTier) {
            // If no plan tier is explicitly required, allow access
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (!user) {
            return false;
        }

        const userId = user.id || user.userId;
        const hasPermission = await this.planPermissionService.checkPermission(userId, requiredTier);

        if (!hasPermission) {
            throw new ForbiddenException(`Acesso negado: esta funcionalidade requer o plano ${requiredTier}`);
        }

        return true;
    }
}
