/**
 * WhatsApp Message Templates for Torex Journal
 * Breve e Objetivo
 */

export const WhatsAppTemplates = {
    PAYMENT_INITIATED: (data: { amount: string; method: string; reference: string }) => 
        `💳 *Pagamento Iniciado*\n\nValor: ${data.amount} MT\nMétodo: ${data.method.toUpperCase()}\nRef: ${data.reference}\n\nConfirme a transação no seu telemóvel para activar a conta.`,

    PAYMENT_SUCCESS: (data: { plan: string; expiryDate: string }) => 
        `✅ *Assinatura Ativa*\n\nSeu plano *${data.plan}* foi ativado!\nVálido até: ${data.expiryDate}\n\nObrigado por escolher o Torex Journal.`,

    PAYMENT_FAILED: (data: { reference: string; reason?: string }) => 
        `❌ *Pagamento Falhou*\n\nRef: ${data.reference}\n${data.reason ? `Motivo: ${data.reason}` : 'Infelizmente não conseguimos confirmar seu pagamento.'}\n\nTente novamente no painel.`,

    LOGIN_ALERT: (data: { ip: string; device: string; time: string }) => 
        `⚠️ *Alerta de Segurança*\n\nNovo login detectado:\nData: ${data.time}\nIP: ${data.ip}\nDispositivo: ${data.device}\n\nSe não foi você, recomendamos alterar sua senha.`,

    OTP_CODE: (data: { otp: string }) => 
        `🔐 *Código de Acesso*\n\nSeu código: *${data.otp}*\nValidade: 10 minutos.\nNão partilhe com ninguém.`,

    AUTH_2FA: (data: { code: string }) => 
        `🔐 *Autenticação de Dois Fatores*\n\nSeu código de acesso é: *${data.code}*\nUse este código para completar seu login no Torex Journal.`,

    WELCOME: (data: { userName: string }) => 
        `👋 *Bem-vindo(a), ${data.userName}!*\n\nSua conta no Torex Journal foi criada com sucesso.\nConecte seu MT5 para começar a sincronizar seus trades.`,

    MT5_STATUS: (data: { mt5Id: string; status: 'CONNECTED' | 'DISCONNECTED' }) => {
        const isConnected = data.status === 'CONNECTED';
        return `${isConnected ? '🟢' : '🔴'} *MT5 ${isConnected ? 'Conectado' : 'Desconectado'}*\n\nConta ID: ${data.mt5Id}\nStatus: ${isConnected ? 'ONLINE' : 'OFFLINE'}`;
    },

    TRADE_IMPORTED: (data: { count: number; profit?: number }) => {
        const hasProfit = data.profit !== undefined;
        return `📊 *Sincronização Concluída*\n\nTotal: ${data.count} trades importados.\n${hasProfit ? `Resultado: ${data.profit?.toFixed(2)} MT` : ''}\n\nAnalise os detalhes no seu dashboard.`;
    },

    SYSTEM_ALERT: (data: { title: string; message: string; type: string }) => {
        let icon = '🔔';
        if (data.type.includes('risk')) icon = '⚠️';
        else if (data.type.includes('success')) icon = '🏆';
        else if (data.type.includes('insight')) icon = '🧠';
        else if (data.type.includes('discipline')) icon = '⚖️';
        
        return `${icon} *${data.title}*\n\n${data.message}`;
    }
};
