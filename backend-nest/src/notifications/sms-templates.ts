export const SmsTemplates = {
    WELCOME: (name: string) => 
        `Ola ${name}! Bem-vindo ao Torex Journal. Sua conta foi criada com sucesso. Comece a trackear seus trades agora: torexjournal.com`,
    
    PAYMENT_CONFIRMED: (name: string, plan: string) => 
        `Ola ${name}! Seu pagamento para o plano ${plan} foi confirmado. Acesso liberado! Sucesso nos trades. Equipe Torex.`,
    
    RENEWAL_SUCCESS: (name: string, plan: string, expiry: string) => 
        `Ola ${name}! Sua assinatura ${plan} foi renovada com sucesso. Valido ate ${expiry}. Obrigado por confiar na Torex Journal!`,
    
    EXPIRATION_REMINDER: (name: string, days: number) => 
        `Aviso Torex: Ola ${name}, sua assinatura expira em ${days} dias. Renovacao disponivel em torexjournal.com para evitar interrupcoes.`,
};
