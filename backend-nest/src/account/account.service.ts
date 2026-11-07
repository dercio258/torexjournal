import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';
import { AccountEntity, AccountType } from './account.entity';
import { AccountTransactionEntity, TransactionType } from './account-transaction.entity';
import { TradeEntity } from '../mt5/trade.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import * as crypto from 'crypto';
import { ClickHouseService } from '../clickhouse/clickhouse.service';

export interface AccountWithStats extends AccountEntity {
    tradesCount: number;
    netPnl: number;
    winRate: number;
}

@Injectable()
export class AccountService {
    private readonly logger = new Logger(AccountService.name);

    constructor(
        @InjectRepository(AccountEntity)
        private accountRepo: Repository<AccountEntity>,
        @InjectRepository(AccountTransactionEntity)
        private transactionRepo: Repository<AccountTransactionEntity>,
        @InjectRepository(TradeEntity)
        private tradeRepo: Repository<TradeEntity>,
        private dataSource: DataSource,
        private clickHouseService: ClickHouseService
    ) { }

    private generateToken(): string {
        return crypto.randomUUID().replace(/-/g, '').toUpperCase();
    }

    /**
     * Validação Estrita de Segurança (Camada 2):
     * Verifica categoricamente se a conta pertence ao usuário autenticado.
     */
    async validateAccountOwnership(accountId: string, userId: string): Promise<AccountEntity> {
        if (!accountId || !userId) {
            throw new ForbiddenException('Identificador de usuário ou conta inválido');
        }

        const account = await this.accountRepo.findOne({ where: { id: accountId } });
        if (!account) {
            throw new NotFoundException(`Conta não encontrada: ${accountId}`);
        }

        if (account.userId !== userId) {
            this.logger.warn(`Tentativa de acesso não autorizado! Usuário ${userId} tentou acessar a conta ${accountId} pertencente a ${account.userId}`);
            throw new ForbiddenException('Acesso negado: esta conta de trading não pertence ao usuário autenticado');
        }

        return account;
    }

    /**
     * Busca a conta principal ou padrão do usuário (fallback retrocompatível)
     */
    async findOneByUserId(userId: string): Promise<AccountEntity> {
        let account = await this.accountRepo.findOne({
            where: { userId, isArchived: false, isPrimary: true }
        });

        if (!account) {
            account = await this.accountRepo.findOne({
                where: { userId, isArchived: false },
                order: { createdAt: 'ASC' }
            });
        }

        if (!account) {
            // Cria uma conta padrão inicial se o usuário ainda não possuir nenhuma conta ativa
            account = this.accountRepo.create({
                userId,
                name: 'Conta Principal',
                broker: 'MetaTrader 5',
                type: AccountType.LIVE,
                currency: 'USD',
                initialBalance: 0,
                balance: 0,
                equity: 0,
                isPrimary: true,
                isArchived: false,
                appToken: this.generateToken()
            });
            await this.accountRepo.save(account);
        }

        return account;
    }

    /**
     * Reconcilia e desagrupa automaticamente contas MT5 que tenham sido sobrescritas ou juntadas,
     * garantindo que:
     * 1. A "Conta Principal" manual exista separada das contas MT5;
     * 2. Cada login MT5 válido (ex: 408953138, 202658742) tenha sua própria Conta de Trading exclusiva;
     * 3. Logs de importação de logins distintos não fiquem misturados na mesma conta;
     * 4. Contas vazias geradas por erro de digitação (>10 dígitos sem trades e desconectadas) sejam limpas.
     */
    private async reconcileUserMt5Accounts(userId: string): Promise<void> {
        try {
            let userAllAccounts = await this.accountRepo.find({ where: { userId } });

            // 1. Remove contas vazias geradas por erro de digitação de login (>10 dígitos, desconectada, saldo 0, 0 trades)
            for (const acc of [...userAllAccounts]) {
                const cleanMt5 = (acc.mt5Id || '').trim();
                if (cleanMt5.length >= 11 && !acc.isConnected && Number(acc.balance || 0) === 0) {
                    const cnt = await this.tradeRepo.count({ where: { accountId: acc.id } });
                    if (cnt === 0) {
                        await this.accountRepo.delete({ id: acc.id });
                        userAllAccounts = userAllAccounts.filter(a => a.id !== acc.id);
                    }
                }
            }

            const existingByMt5 = new Map<string, AccountEntity>();
            for (const acc of userAllAccounts) {
                if (acc.mt5Id && acc.mt5Id.trim()) {
                    const cleanMt5 = acc.mt5Id.trim();
                    existingByMt5.set(cleanMt5, acc);
                    if (!acc.name || acc.name === 'Conta Principal') {
                        acc.name = `MT5 ${cleanMt5}`;
                        await this.accountRepo.save(acc);
                    }
                }
            }

            // 2. Descobre logins MT5 válidos (5 a 10 dígitos) nos logs de importação e instâncias cloud deste usuário
            const discoveredLogins = new Map<string, string>(); // login -> server

            try {
                const cloudRows = await this.dataSource.query(
                    `SELECT "mt5Id" FROM cloud_instances WHERE "userId" = $1 AND "mt5Id" IS NOT NULL`,
                    [userId]
                );
                for (const r of cloudRows || []) {
                    const loginStr = String(r.mt5Id || '').trim();
                    if (/^\d{5,10}$/.test(loginStr)) {
                        discoveredLogins.set(loginStr, 'MetaTrader 5');
                    }
                }
            } catch { }

            try {
                const logRows = await this.dataSource.query(
                    `SELECT id, details, account_id, status FROM import_logs WHERE "userId" = $1 ORDER BY "createdAt" ASC LIMIT 100`,
                    [userId]
                );
                for (const row of logRows || []) {
                    const detailsStr = String(row.details || '');
                    const match = detailsStr.match(/\b(\d{5,10})@([A-Za-z0-9._-]+)/);
                    if (match) {
                        discoveredLogins.set(match[1], match[2]);
                    }
                }
            } catch { }

            // 3. Garante que cada login MT5 descoberto tenha sua própria Conta de Trading separada e corrige o broker se foi sobrescrito
            for (const [mt5Login, serverName] of discoveredLogins.entries()) {
                const existingAcc = existingByMt5.get(mt5Login);
                if (existingAcc) {
                    let changed = false;
                    if (serverName && serverName !== 'MetaTrader 5' && existingAcc.broker !== serverName) {
                        existingAcc.broker = serverName;
                        changed = true;
                    }
                    if (!existingAcc.name || existingAcc.name === 'Conta Principal') {
                        existingAcc.name = `MT5 ${mt5Login}`;
                        changed = true;
                    }
                    if (changed) {
                        await this.accountRepo.save(existingAcc);
                    }
                    continue;
                }

                const orphanAcc = await this.accountRepo.findOne({ where: { mt5Id: mt5Login } });
                if (orphanAcc && (!orphanAcc.userId || orphanAcc.userId === userId)) {
                    orphanAcc.userId = userId;
                    orphanAcc.isArchived = false;
                    orphanAcc.archivedAt = null;
                    orphanAcc.name = `MT5 ${mt5Login}`;
                    if (serverName && serverName !== 'MetaTrader 5') {
                        orphanAcc.broker = serverName;
                    }
                    const saved = await this.accountRepo.save(orphanAcc);
                    existingByMt5.set(mt5Login, saved);
                } else if (!orphanAcc) {
                    const lowerSrv = (serverName || '').toLowerCase();
                    const isDemo = lowerSrv.includes('demo') || lowerSrv.includes('trial');
                    const isProp =
                        lowerSrv.includes('ftmo') ||
                        lowerSrv.includes('goatfunded') ||
                        lowerSrv.includes('fundingpips') ||
                        lowerSrv.includes('fundednext') ||
                        lowerSrv.includes('fivepercent') ||
                        lowerSrv.includes('alphacapital') ||
                        lowerSrv.includes('maven') ||
                        lowerSrv.includes('e8markets') ||
                        lowerSrv.includes('blueguardian') ||
                        lowerSrv.includes('fxify') ||
                        lowerSrv.includes('thefundedtrader') ||
                        lowerSrv.includes('topstep');
                    const newAcc = this.accountRepo.create({
                        userId,
                        mt5Id: mt5Login,
                        name: `MT5 ${mt5Login}`,
                        broker: serverName || 'MetaTrader 5',
                        type: isProp ? AccountType.PROP_FIRM : (isDemo ? AccountType.DEMO : AccountType.LIVE),
                        currency: 'USD',
                        initialBalance: 0,
                        balance: 0,
                        equity: 0,
                        isPrimary: false,
                        isArchived: false,
                        appToken: this.generateToken()
                    });
                    const saved = await this.accountRepo.save(newAcc);
                    existingByMt5.set(mt5Login, saved);
                    this.logger.log(`Conta de Trading desagrupada/criada automaticamente para MT5 ${mt5Login} (Usuário: ${userId})`);
                }
            }

            // 4. Desagrupa import_logs que ficaram misturados em outra conta quando houve sobrescrição antiga
            for (const [mt5Login, targetAcc] of existingByMt5.entries()) {
                try {
                    await this.dataSource.query(
                        `UPDATE import_logs SET account_id = $1 WHERE "userId" = $2 AND details LIKE $3 AND (account_id IS NULL OR account_id != $1)`,
                        [targetAcc.id, userId, `%${mt5Login}@%`]
                    );
                } catch { }
            }

            // 5. Se a "Conta Principal" original do usuário foi transformada em conta MT5 no passado,
            // recria uma "Conta Principal" limpa (sem mt5Id) para manter a conta manual separada das contas MT5
            const hasCleanManualAccount = userAllAccounts.some(a => !a.mt5Id && !a.isArchived);
            if (!hasCleanManualAccount && existingByMt5.size > 0) {
                const manualAcc = this.accountRepo.create({
                    userId,
                    name: 'Conta Principal',
                    broker: 'MetaTrader 5',
                    type: AccountType.LIVE,
                    currency: 'USD',
                    initialBalance: 0,
                    balance: 0,
                    equity: 0,
                    isPrimary: false,
                    isArchived: false,
                    appToken: this.generateToken()
                });
                await this.accountRepo.save(manualAcc);
            }
        } catch (err: any) {
            this.logger.warn(`Aviso ao reconciliar contas MT5 do usuário ${userId}: ${err.message}`);
        }
    }

    /**
     * Lista todas as contas de trading pertencentes ao usuário com estatísticas básicas
     */
    async findAllByUser(userId: string, includeArchived = false): Promise<AccountWithStats[]> {
        await this.reconcileUserMt5Accounts(userId);

        const query: any = { userId };
        if (!includeArchived) {
            query.isArchived = false;
        }

        const accounts = await this.accountRepo.find({
            where: query,
            order: { isPrimary: 'DESC', createdAt: 'ASC' }
        });

        if (accounts.length === 0) {
            const defaultAcc = await this.findOneByUserId(userId);
            return [{
                ...defaultAcc,
                tradesCount: 0,
                netPnl: 0,
                winRate: 0
            }];
        }

        const accountIds = accounts.map(a => a.id);

        // Agrega estatísticas de trades por conta
        const tradesStats = await this.tradeRepo
            .createQueryBuilder('trade')
            .select('trade.accountId', 'accountId')
            .addSelect('COUNT(*)', 'tradesCount')
            .addSelect('COALESCE(SUM(trade.profit + trade.commission + trade.swap), 0)', 'netPnl')
            .addSelect('COUNT(CASE WHEN (trade.profit + trade.commission + trade.swap) > 0 THEN 1 END)', 'winCount')
            .where('trade.accountId IN (:...accountIds)', { accountIds })
            .andWhere("trade.status = 'CLOSED'")
            .groupBy('trade.accountId')
            .getRawMany();

        const statsMap = new Map<string, { tradesCount: number; netPnl: number; winCount: number }>();
        for (const stat of tradesStats) {
            statsMap.set(stat.accountId, {
                tradesCount: parseInt(stat.tradesCount, 10) || 0,
                netPnl: parseFloat(stat.netPnl) || 0,
                winCount: parseInt(stat.winCount, 10) || 0
            });
        }

        return accounts.map(acc => {
            const stat = statsMap.get(acc.id) || { tradesCount: 0, netPnl: 0, winCount: 0 };
            const winRate = stat.tradesCount > 0 ? (stat.winCount / stat.tradesCount) * 100 : 0;
            return {
                ...acc,
                tradesCount: stat.tradesCount,
                netPnl: Number(stat.netPnl.toFixed(2)),
                winRate: Number(winRate.toFixed(1))
            };
        });
    }

    /**
     * Retorna detalhes de uma conta específica
     */
    async findOneByIdAndUser(id: string, userId: string) {
        return this.validateAccountOwnership(id, userId);
    }

    /**
     * Cria uma nova conta de trading independente (sem limite restritivo de 3 contas)
     */
    async createAccount(userId: string, dto: CreateAccountDto) {
        const activeCount = await this.accountRepo.count({ where: { userId, isArchived: false } });
        const isFirstAccount = activeCount === 0;
        const initialBalance = dto.initialBalance ? Number(dto.initialBalance) : 0;

        const account = this.accountRepo.create({
            userId,
            name: dto.name.trim(),
            broker: dto.broker.trim(),
            type: dto.type || AccountType.LIVE,
            currency: (dto.currency || 'USD').toUpperCase(),
            initialBalance,
            balance: initialBalance,
            equity: initialBalance,
            isPrimary: isFirstAccount,
            isArchived: false,
            propFirmRules: dto.propFirmRules || null,
            appToken: this.generateToken()
        });

        const savedAccount = await this.accountRepo.save(account);

        if (initialBalance > 0) {
            const initialTx = this.transactionRepo.create({
                accountId: savedAccount.id,
                type: TransactionType.DEPOSIT,
                amount: initialBalance,
                description: 'Saldo inicial da conta',
                balanceAfter: initialBalance,
                date: new Date()
            });
            await this.transactionRepo.save(initialTx);
        }

        this.logger.log(`Nova conta de trading criada: "${savedAccount.name}" (ID: ${savedAccount.id}, Usuário: ${userId})`);
        return savedAccount;
    }

    /**
     * Atualiza os dados de uma conta de trading
     */
    async updateAccount(id: string, userId: string, dto: UpdateAccountDto) {
        const account = await this.validateAccountOwnership(id, userId);

        if (dto.name !== undefined) account.name = dto.name.trim();
        if (dto.broker !== undefined) account.broker = dto.broker.trim();
        if (dto.type !== undefined) account.type = dto.type;
        if (dto.currency !== undefined) account.currency = dto.currency.toUpperCase();
        if (dto.propFirmRules !== undefined) account.propFirmRules = dto.propFirmRules;
        if (dto.initialBalance !== undefined) {
            account.initialBalance = Number(dto.initialBalance);
        }

        return this.accountRepo.save(account);
    }

    /**
     * Define uma conta como principal (desmarca todas as outras do usuário)
     */
    async setPrimary(id: string, userId: string) {
        await this.validateAccountOwnership(id, userId);

        await this.dataSource.transaction(async (manager) => {
            await manager.update(AccountEntity, { userId }, { isPrimary: false });
            await manager.update(AccountEntity, { id }, { isPrimary: true });
        });

        return { success: true, message: 'Conta definida como principal' };
    }

    /**
     * Arquiva uma conta de trading
     */
    async archiveAccount(id: string, userId: string) {
        const account = await this.validateAccountOwnership(id, userId);

        if (account.isPrimary) {
            // Se for a conta principal, procura outra conta ativa para ser a nova principal
            const nextPrimary = await this.accountRepo.findOne({
                where: { userId, isArchived: false },
                order: { createdAt: 'ASC' }
            });
            if (nextPrimary && nextPrimary.id !== id) {
                nextPrimary.isPrimary = true;
                await this.accountRepo.save(nextPrimary);
            }
        }

        account.isArchived = true;
        account.archivedAt = new Date();
        account.isPrimary = false;
        await this.accountRepo.save(account);

        return { success: true, message: 'Conta arquivada com sucesso' };
    }

    /**
     * Restaura uma conta arquivada
     */
    async restoreAccount(id: string, userId: string) {
        const account = await this.validateAccountOwnership(id, userId);
        account.isArchived = false;
        account.archivedAt = null;
        await this.accountRepo.save(account);

        return { success: true, message: 'Conta restaurada com sucesso' };
    }

    /**
     * Exclui uma conta de trading (com proteção contra exclusão acidental se houver histórico)
     */
    async deleteAccount(id: string, userId: string, force = false) {
        const account = await this.validateAccountOwnership(id, userId);

        const tradesCount = await this.tradeRepo.count({ where: { accountId: id } });
        if (tradesCount > 0 && !force) {
            throw new BadRequestException(
                `Esta conta possui ${tradesCount} operações registradas. Arquive a conta ou passe force=true para confirmar a exclusão de todo o histórico.`
            );
        }

        // Se era a conta principal, define outra como principal
        if (account.isPrimary) {
            const nextAccount = await this.accountRepo.findOne({
                where: { userId, isArchived: false },
                order: { createdAt: 'ASC' }
            });
            if (nextAccount && nextAccount.id !== id) {
                nextAccount.isPrimary = true;
                await this.accountRepo.save(nextAccount);
            }
        }

        await this.dataSource.transaction(async (manager) => {
            if (tradesCount > 0) {
                await manager.delete(TradeEntity, { accountId: id });
            }
            await manager.delete(AccountTransactionEntity, { accountId: id });
            await manager.delete(AccountEntity, { id });
        });

        // Delete all trades for this account from ClickHouse as well
        await this.clickHouseService.deleteTradesByAccountId(id);

        this.logger.log(`Conta de trading excluída: ${id} (Usuário: ${userId})`);
        return { success: true, message: 'Conta excluída com sucesso' };
    }

    /**
     * Regenera o token de conexão do MT5 EA para esta conta
     */
    async regenerateAppToken(id: string, userId: string) {
        const account = await this.validateAccountOwnership(id, userId);
        account.appToken = this.generateToken();
        await this.accountRepo.save(account);
        return { token: account.appToken };
    }

    /**
     * Histórico de transações de saldo da conta
     */
    async getTransactions(accountId: string, userId: string) {
        await this.validateAccountOwnership(accountId, userId);
        return this.transactionRepo.find({
            where: { accountId },
            order: { date: 'DESC', createdAt: 'DESC' }
        });
    }

    /**
     * Registra uma movimentação de saldo (Depósito, Retirada, Ajuste, Bônus, Taxa)
     */
    async createTransaction(accountId: string, userId: string, dto: CreateTransactionDto) {
        const account = await this.validateAccountOwnership(accountId, userId);
        const amount = Number(dto.amount);
        let newBalance = Number(account.balance);

        switch (dto.type) {
            case TransactionType.DEPOSIT:
            case TransactionType.BONUS:
                newBalance += amount;
                break;
            case TransactionType.WITHDRAWAL:
            case TransactionType.FEE:
                newBalance -= amount;
                break;
            case TransactionType.ADJUSTMENT:
                newBalance += amount; // Pode ser positivo ou negativo
                break;
        }

        const tx = this.transactionRepo.create({
            accountId,
            type: dto.type,
            amount,
            date: dto.date ? new Date(dto.date) : new Date(),
            description: dto.description || null,
            balanceAfter: Number(newBalance.toFixed(2))
        });

        await this.dataSource.transaction(async (manager) => {
            await manager.save(AccountTransactionEntity, tx);
            account.balance = Number(newBalance.toFixed(2));
            account.equity = Number(newBalance.toFixed(2));
            await manager.save(AccountEntity, account);
        });

        return tx;
    }

    /**
     * Visão Consolidada de todas as contas ativas do usuário
     */
    async getConsolidatedSummary(userId: string) {
        const accounts = await this.findAllByUser(userId, false);

        if (accounts.length === 0) {
            return {
                totalInitialBalance: 0,
                totalCurrentBalance: 0,
                totalNetPnl: 0,
                totalTrades: 0,
                totalWins: 0,
                winRate: 0,
                currencies: ['USD'],
                hasMultipleCurrencies: false,
                accounts: []
            };
        }

        const currencies = [...new Set(accounts.map(a => a.currency || 'USD'))];
        const hasMultipleCurrencies = currencies.length > 1;

        let totalInitialBalance = 0;
        let totalCurrentBalance = 0;
        let totalNetPnl = 0;
        let totalTrades = 0;
        let totalWins = 0;

        for (const acc of accounts) {
            totalInitialBalance += Number(acc.initialBalance || 0);
            totalCurrentBalance += Number(acc.balance || 0);
            totalNetPnl += Number(acc.netPnl || 0);
            totalTrades += Number(acc.tradesCount || 0);
            totalWins += Math.round((Number(acc.winRate || 0) / 100) * Number(acc.tradesCount || 0));
        }

        const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

        return {
            totalInitialBalance: Number(totalInitialBalance.toFixed(2)),
            totalCurrentBalance: Number(totalCurrentBalance.toFixed(2)),
            totalNetPnl: Number(totalNetPnl.toFixed(2)),
            totalTrades,
            totalWins,
            winRate: Number(winRate.toFixed(1)),
            currencies,
            hasMultipleCurrencies,
            accounts
        };
    }

    /**
     * Reset de conexão EA para a conta
     */
    async resetConnection(userId: string, accountId?: string) {
        let account: AccountEntity;
        const isUuid = !!accountId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId.trim());
        if (isUuid) {
            account = await this.validateAccountOwnership(accountId.trim(), userId);
        } else {
            account = await this.findOneByUserId(userId);
        }

        account.mt5Id = null;
        account.isConnected = false;

        await this.accountRepo.save(account);
        return { success: true, message: 'Conexão resetada com sucesso' };
    }
}
