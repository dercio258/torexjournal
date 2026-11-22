import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AccountService } from './account.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard, RequirePlan } from '../payment/plan.guard';
import { PlanTier } from '../payment/plan-permission.service';
import { maskSecretToken } from '../common/security/payload-envelope.util';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Controller(['account', 'accounts'])
@UseGuards(JwtAuthGuard, PlanGuard)
@RequirePlan(PlanTier.BASIC)
export class AccountController {
    constructor(private readonly accountService: AccountService) { }

    private sanitizeAccount<T extends Record<string, any>>(acc: T): T & { appTokenMasked: string } {
        if (!acc) return acc as any;
        return {
            ...acc,
            appTokenMasked: maskSecretToken(acc.appToken),
            appToken: '',
        };
    }

    /**
     * Retorna todas as contas ativas do usuário (com token EA mascarado)
     */
    @Get()
    async getAccounts(
        @Request() req,
        @Query('includeArchived') includeArchived?: string
    ) {
        const accounts = await this.accountService.findAllByUser(req.user.id, includeArchived === 'true');
        return accounts.map((acc) => this.sanitizeAccount(acc));
    }

    /**
     * Visão Consolidada de todas as contas
     */
    @Get('summary/consolidated')
    async getConsolidatedSummary(@Request() req) {
        const summary = await this.accountService.getConsolidatedSummary(req.user.id);
        if (summary && Array.isArray(summary.accounts)) {
            return {
                ...summary,
                accounts: summary.accounts.map((acc) => this.sanitizeAccount(acc)),
            };
        }
        return summary;
    }

    /**
     * Retorna a conta principal do usuário (retrocompatibilidade)
     */
    @Get('primary')
    async getPrimaryAccount(@Request() req) {
        const account = await this.accountService.findOneByUserId(req.user.id);
        return this.sanitizeAccount(account);
    }

    /**
     * Retorna detalhes de uma conta específica
     */
    @Get(':id')
    async getAccount(@Request() req, @Param('id') id: string) {
        const account = await this.accountService.findOneByIdAndUser(id, req.user.id);
        return this.sanitizeAccount(account);
    }

    /**
     * Cria uma nova conta de trading (limites validados por plano no backend)
     */
    @Post()
    @UseGuards(PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async createAccount(@Request() req, @Body() dto: CreateAccountDto) {
        const account = await this.accountService.createAccount(req.user.id, dto);
        return this.sanitizeAccount(account);
    }

    /**
     * Atualiza dados de uma conta de trading
     */
    @Put(':id')
    @UseGuards(PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async updateAccount(
        @Request() req,
        @Param('id') id: string,
        @Body() dto: UpdateAccountDto
    ) {
        const account = await this.accountService.updateAccount(id, req.user.id, dto);
        return this.sanitizeAccount(account);
    }

    /**
     * Define uma conta como principal
     */
    @Post(':id/primary')
    @UseGuards(PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async setPrimary(@Request() req, @Param('id') id: string) {
        return this.accountService.setPrimary(id, req.user.id);
    }

    /**
     * Arquiva uma conta
     */
    @Post(':id/archive')
    @UseGuards(PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async archiveAccount(@Request() req, @Param('id') id: string) {
        return this.accountService.archiveAccount(id, req.user.id);
    }

    /**
     * Restaura uma conta arquivada
     */
    @Post(':id/restore')
    @UseGuards(PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async restoreAccount(@Request() req, @Param('id') id: string) {
        return this.accountService.restoreAccount(id, req.user.id);
    }

    /**
     * Exclui uma conta de trading
     */
    @Delete(':id')
    @UseGuards(PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async deleteAccount(
        @Request() req,
        @Param('id') id: string,
        @Query('force') force?: string
    ) {
        return this.accountService.deleteAccount(id, req.user.id, force === 'true');
    }

    /**
     * Regenera o token de conexão EA para a conta
     */
    @Post(':id/token/regenerate')
    @UseGuards(PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async regenerateToken(@Request() req, @Param('id') id: string) {
        return this.accountService.regenerateAppToken(id, req.user.id);
    }

    /**
     * Revela sob demanda o token de conexão EA desta conta
     */
    @Post(':id/token/reveal')
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    @UseGuards(PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async revealToken(@Request() req, @Param('id') id: string) {
        return this.accountService.revealAppToken(id, req.user.id);
    }

    /**
     * Histórico de transações de saldo
     */
    @Get(':id/transactions')
    async getTransactions(@Request() req, @Param('id') id: string) {
        return this.accountService.getTransactions(id, req.user.id);
    }

    /**
     * Registra nova transação de saldo (depósito, retirada, etc.)
     */
    @Post(':id/transactions')
    @UseGuards(PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async createTransaction(
        @Request() req,
        @Param('id') id: string,
        @Body() dto: CreateTransactionDto
    ) {
        return this.accountService.createTransaction(id, req.user.id, dto);
    }

    /**
     * Reset de conexão (retrocompatibilidade)
     */
    @Post('reset-connection')
    @UseGuards(PlanGuard)
    @RequirePlan(PlanTier.BASIC)
    async resetConnection(@Request() req, @Body('accountId') accountId?: string) {
        return this.accountService.resetConnection(req.user.id, accountId);
    }
}
