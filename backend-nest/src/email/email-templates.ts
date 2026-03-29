/**
 * Professional Email Templates for Torex Journal
 */

export interface EmailTemplateData {
    title: string;
    subtitle?: string;
    message: string;
    buttonLabel?: string;
    buttonUrl?: string;
    userName?: string;
    footerText?: string;
}

const logoUrl = 'https://res.cloudinary.com/dndlqdylc/image/upload/v1773270778/Touro_design_1_1_udrkwi.jpg';

const BASE_LAYOUT = (content: string, footerExtra: string = '') => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 0; background-color: #f8fafc; }
        .wrapper { width: 100%; padding: 40px 0; background-color: #f8fafc; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
        .header { background-color: #0f172a; padding: 40px 30px; text-align: center; background-image: linear-gradient(to bottom right, #0f172a, #1e293b); }
        .header img { max-width: 180px; height: auto; display: block; margin: 0 auto; }
        .content { padding: 45px 40px; }
        .subtitle { color: #10b981; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; font-size: 12px; margin-bottom: 12px; display: block; }
        h1 { margin-top: 0; color: #0f172a; font-size: 26px; font-weight: 800; line-height: 1.2; }
        .divider { height: 1px; background-color: #f1f5f9; margin: 30px 0; }
        p { margin-bottom: 20px; color: #475569; font-size: 16px; }
        .cta-container { text-align: center; margin: 40px 0 20px; }
        .button { display: inline-block; padding: 16px 36px; background-color: #10b981; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 16px; transition: all 0.2s; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2); }
        .footer { background-color: #f8fafc; padding: 35px; text-align: center; font-size: 13px; color: #64748b; border-top: 1px solid #f1f5f9; }
        .footer b { color: #334155; font-size: 14px; }
        .social-links { margin-bottom: 20px; }
        .social-links a { color: #94a3b8; text-decoration: none; margin: 0 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="container">
            <div class="header">
                <img src="${logoUrl}" alt="Torex Journal">
            </div>
            <div class="content">
                ${content}
            </div>
            <div class="footer">
                <div class="social-links">
                    <a href="#">Dashboard</a>
                    <a href="#">Suporte</a>
                    <a href="#">Comunidade</a>
                </div>
                <b>Torex Journal Service</b><br>
                Elevando o seu trading através de dados e disciplina.<br>
                ${footerExtra ? `<div style="margin-top: 10px;">${footerExtra}</div>` : ''}
                <p style="margin-top: 25px; font-size: 11px;">&copy; ${new Date().getFullYear()} Torex Journal. Todos os direitos reservados.</p>
            </div>
        </div>
    </div>
</body>
</html>
`;

export const Templates = {
    GENERAL_NOTIFICATION: (data: EmailTemplateData) => {
        const content = `
            <span class="subtitle">${data.subtitle || 'NOTIFICAÇÃO DO SISTEMA'}</span>
            <h1>${data.title}</h1>
            <div class="divider"></div>
            <p>Olá${data.userName ? ` <b>${data.userName}</b>` : ''},</p>
            ${data.message.split('\n').map(p => p ? `<p>${p}</p>` : '').join('')}
            ${data.buttonUrl ? `
                <div class="cta-container">
                    <a href="${data.buttonUrl}" class="button">${data.buttonLabel || 'Aceder ao Painel'}</a>
                </div>
            ` : ''}
        `;
        return BASE_LAYOUT(content, data.footerText);
    },

    PAYMENT_INITIATED: (data: { userName?: string; amount: string; method: string; reference: string }) => {
        const content = `
            <span class="subtitle">PAGAMENTO EM PROCESSAMENTO</span>
            <h1>Confirmação de Pagamento</h1>
            <div class="divider"></div>
            <p>Olá<b>${data.userName || ''}</b>,</p>
            <p>Recebemos o pedido de pagamento para a sua assinatura no Torex Journal.</p>
            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 5px 0;"><b>Valor:</b> ${data.amount} MT</p>
                <p style="margin: 5px 0;"><b>Método:</b> ${data.method.toUpperCase()}</p>
                <p style="margin: 5px 0;"><b>Referência:</b> <code style="background: #eee; padding: 2px 5px;">${data.reference}</code></p>
            </div>
            <p>Por favor, confirme a transação no seu telemóvel para activar a sua conta imediatamente.</p>
        `;
        return BASE_LAYOUT(content);
    },

    PAYMENT_SUCCESS: (data: { userName?: string; plan: string; expiryDate: string }) => {
        const content = `
            <span class="subtitle">ASSINATURA ACTIVADA</span>
            <h1>Parabéns! Sua conta está activa.</h1>
            <div class="divider"></div>
            <p>Olá<b>${data.userName || ''}</b>,</p>
            <p>O seu pagamento foi confirmado com sucesso. A sua subscrição <b>${data.plan}</b> já está disponível.</p>
            <div style="background-color: #e6f9f1; border-left: 4px solid #10b981; padding: 20px; border-radius: 0 5px 5px 0; margin: 20px 0;">
                <p style="margin: 5px 0; color: #065f46;"><b>Plano:</b> ${data.plan}</p>
                <p style="margin: 5px 0; color: #065f46;"><b>Válido até:</b> ${data.expiryDate}</p>
            </div>
            <p>Agora você tem acesso total às ferramentas avançadas do Torex Journal para elevar seu trading.</p>
            <div class="cta-container">
                <a href="${process.env.BASE_URL || '#'}" class="button">Começar agora</a>
            </div>
        `;
        return BASE_LAYOUT(content);
    },

    PAYMENT_FAILED: (data: { userName?: string; reference: string; reason?: string }) => {
        const content = `
            <span class="subtitle">PROBLEMA NO PAGAMENTO</span>
            <h1>Ocorreu um erro ao processar seu pagamento</h1>
            <div class="divider"></div>
            <p>Olá<b>${data.userName || ''}</b>,</p>
            <p>Infelizmente não conseguimos confirmar o pagamento para a sua referência <code>${data.reference}</code>.</p>
            ${data.reason ? `<p><b>Motivo:</b> ${data.reason}</p>` : ''}
            <p>Você pode tentar novamente ou utilizar outro método de pagamento.</p>
            <div class="cta-container">
                <a href="${process.env.BASE_URL || '#'}/subscription" class="button">Tear novamente</a>
            </div>
        `;
        return BASE_LAYOUT(content);
    },

    LOGIN_ALERT: (data: { userName?: string; ip: string; device: string; time: string }) => {
        const content = `
            <span class="subtitle">ALERTA DE SEGURANÇA</span>
            <h1>Novo Login Detectado</h1>
            <div class="divider"></div>
            <p>Olá <b>${data.userName || 'Usuário'}</b>,</p>
            <p>Detectamos um novo login em sua conta Torex Journal.</p>
            <div style="background-color: #fff4f4; border-left: 4px solid #dc3545; padding: 20px; border-radius: 0 5px 5px 0; margin: 20px 0;">
                <p style="margin: 5px 0;"><b>Data:</b> ${data.time}</p>
                <p style="margin: 5px 0;"><b>IP:</b> ${data.ip}</p>
                <p style="margin: 5px 0;"><b>Dispositivo:</b> ${data.device}</p>
            </div>
            <p>Se não foi você, recomendamos alterar sua senha imediatamente para proteger sua conta.</p>
            <div class="cta-container">
                <a href="${process.env.BASE_URL || '#'}/settings" class="button" style="background-color: #dc3545;">Proteger Conta</a>
            </div>
        `;
        return BASE_LAYOUT(content);
    },

    OTP_CODE: (data: { otp: string }) => {
        const content = `
            <span class="subtitle">VERIFICAÇÃO DE CONTA</span>
            <h1>Seu Código de Acesso</h1>
            <div class="divider"></div>
            <p>Use o código de verificação abaixo para completar sua acção no Torex Journal:</p>
            <div style="text-align: center; margin: 30px 0; background-color: #f8f9fa; padding: 30px; border-radius: 10px; border: 2px dashed #10b981;">
                <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #10b981;">${data.otp}</span>
            </div>
            <p>Este código é válido por <b>10 minutos</b>. Não partilhe este código com ninguém.</p>
        `;
        return BASE_LAYOUT(content);
    },

    WELCOME_EMAIL: (data: { userName: string }) => {
        const content = `
            <span class="subtitle">BEM-VINDO AO TOREX JOURNAL</span>
            <h1>Olá, ${data.userName}!</h1>
            <div class="divider"></div>
            <p>Estamos muito felizes em ter você conosco na nossa comunidade de traders profissionais.</p>
            <p>O Torex Journal foi desenhado para ajudar você a manter a disciplina, analisar seus erros e maximizar seus lucros através de dados reais.</p>
            <p>Comece conectando sua conta MT5 para sincronizar seus trades automaticamente.</p>
            <div class="cta-container">
                <a href="${process.env.BASE_URL || '#'}/dashboard" class="button">Explorar Painel</a>
            </div>
        `;
        return BASE_LAYOUT(content);
    },

    MT5_STATUS: (data: { userName?: string; mt5Id: string; status: 'CONNECTED' | 'DISCONNECTED' }) => {
        const isConnected = data.status === 'CONNECTED';
        const color = isConnected ? '#10b981' : '#ef4444';
        const content = `
            <span class="subtitle">ESTADO DO TERMINAL MT5</span>
            <h1>MT5 ${isConnected ? 'Conectado' : 'Desconectado'}</h1>
            <div class="divider"></div>
            <p>Olá <b>${data.userName || 'Trader'}</b>,</p>
            <p>O estado de conexão da sua conta MT5 (ID: <b>${data.mt5Id}</b>) foi alterado.</p>
            <div style="background-color: ${isConnected ? '#e6f9f1' : '#fef2f2'}; border-left: 4px solid ${color}; padding: 20px; border-radius: 0 5px 5px 0; margin: 20px 0;">
                <p style="margin: 0; color: ${color}; font-weight: bold; font-size: 18px;">
                    STATUS: ${isConnected ? 'ONLINE 🟢' : 'OFFLINE 🔴'}
                </p>
            </div>
            ${isConnected ? 
                '<p>Seus dados estão sendo sincronizados em tempo real.</p>' : 
                '<p>Verifique se o seu terminal MT5 está aberto e com o EA Torex Journal carregado para retomar a sincronização.</p>'
            }
        `;
        return BASE_LAYOUT(content);
    },

    TRADE_IMPORTED: (data: { userName?: string; count: number; method: string; profit?: number; wins?: number; losses?: number }) => {
        const now = new Date();
        const hasStats = data.profit !== undefined;
        const profitColor = (data.profit || 0) >= 0 ? '#10b981' : '#ef4444';
        
        const content = `
            <span class="subtitle">SINCRONIZAÇÃO CONCLUÍDA</span>
            <h1>Resumo da Importação de Trades</h1>
            <div class="divider"></div>
            <p>Olá <b>${data.userName || 'Trader'}</b>,</p>
            <p>A sincronização com o seu terminal foi concluída com sucesso. Aqui estão os detalhes da importação:</p>
            
            <div style="background-color: #f0f7ff; padding: 25px; border-radius: 12px; margin: 25px 0; border: 1px solid #dbeafe;">
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="padding-bottom: 10px; color: #64748b; font-size: 13px; font-weight: bold; text-transform: uppercase;">Total Importado</td>
                        <td style="padding-bottom: 10px; text-align: right; color: #0f172a; font-weight: bold;">${data.count} Trades</td>
                    </tr>
                    <tr>
                        <td style="padding-bottom: 10px; color: #64748b; font-size: 13px; font-weight: bold; text-transform: uppercase;">Método</td>
                        <td style="padding-bottom: 10px; text-align: right; color: #0f172a;">${data.method}</td>
                    </tr>
                    ${hasStats ? `
                    <tr>
                        <td style="padding-top: 10px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 13px; font-weight: bold; text-transform: uppercase;">Resultado Estimado</td>
                        <td style="padding-top: 10px; border-top: 1px solid #e2e8f0; text-align: right; color: ${profitColor}; font-weight: bold;">${data.profit?.toFixed(2)} MT</td>
                    </tr>
                    ` : ''}
                </table>
            </div>

            <p style="text-align: center; color: #64748b; font-size: 14px;">Data do Processamento: ${now.toLocaleDateString()} às ${now.toLocaleTimeString()}</p>
            
            <div class="cta-container">
                <a href="${process.env.BASE_URL || '#'}/dashboard" class="button">Analisar no Dashboard</a>
            </div>
        `;
        return BASE_LAYOUT(content);
    },

    SYSTEM_ALERT: (data: { title: string; message: string; type: string; userName?: string }) => {
        let titleColor = '#1a1a1a';
        let bgColor = '#f8f9fa';
        let accentColor = '#64748b';
        let subtitle = 'NOTIFICAÇÃO DO SISTEMA';

        if (data.type.includes('risk')) {
            titleColor = '#991b1b';
            bgColor = '#fef2f2';
            accentColor = '#ef4444';
            subtitle = 'ALERTA DE RISCO ⚠️';
        } else if (data.type.includes('success')) {
            titleColor = '#065f46';
            bgColor = '#ecfdf5';
            accentColor = '#10b981';
            subtitle = 'PARABÉNS! 🏆';
        } else if (data.type.includes('insight') || data.type.includes('mental') || data.type.includes('psychology')) {
            titleColor = '#1e3a8a';
            bgColor = '#eff6ff';
            accentColor = '#3b82f6';
            subtitle = 'INSIGHT PSICOLÓGICO 🧠';
        } else if (data.type.includes('discipline') || data.type.includes('rule')) {
            titleColor = '#854d0e';
            bgColor = '#fefce8';
            accentColor = '#eab308';
            subtitle = 'ESTADO DE DISCIPLINA ⚖️';
        } else if (data.type.includes('coaching') || data.type.includes('performance')) {
            titleColor = '#581c87';
            bgColor = '#faf5ff';
            accentColor = '#a855f7';
            subtitle = 'FEEDBACK DE PERFORMANCE 📈';
        }

        const content = `
            <div style="background-color: ${bgColor}; border-left: 4px solid ${accentColor}; padding: 30px; border-radius: 0 12px 12px 0; margin-bottom: 25px;">
                <span style="color: ${accentColor}; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px; font-size: 12px; display: block; margin-bottom: 10px;">${subtitle}</span>
                <h1 style="color: ${titleColor}; font-size: 22px; margin: 0 0 15px 0;">${data.title}</h1>
                <p style="color: #475569; font-size: 16px; margin: 0; line-height: 1.6;">${data.message}</p>
            </div>
            
            <p>Olá${data.userName ? ` <b>${data.userName}</b>` : ''},</p>
            <p>Esta é uma atualização importante baseada no seu desempenho recente e nas configurações da sua conta.</p>
            
            <div class="cta-container">
                <a href="${process.env.BASE_URL || '#'}/dashboard" class="button" style="background-color: ${accentColor};">Ver Detalhes</a>
            </div>
        `;
        return BASE_LAYOUT(content);
    },

    WEEKLY_SUMMARY: (data: { userName: string; totalPnL: number; winRate: number; totalTrades: number; topLessons: any[]; period: { start: string; end: string } }) => {
        const profitColor = data.totalPnL >= 0 ? '#10b981' : '#ef4444';
        const content = `
            <span class="subtitle">RELATÓRIO SEMANAL DE PERFORMANCE</span>
            <h1>Resumo da Semana</h1>
            <div class="divider"></div>
            <p>Olá <b>${data.userName}</b>,</p>
            <p>Aqui está o resumo do seu desempenho de <b>${new Date(data.period.start).toLocaleDateString()}</b> a <b>${new Date(data.period.end).toLocaleDateString()}</b>.</p>
            
            <div style="background-color: #f8fafc; border-radius: 12px; padding: 25px; border: 1px solid #e2e8f0; margin: 25px 0;">
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="padding-bottom: 12px; color: #64748b; font-size: 13px; font-weight: bold; text-transform: uppercase;">Resultado Total</td>
                        <td style="padding-bottom: 12px; text-align: right; color: ${profitColor}; font-weight: 900; font-size: 20px;">${data.totalPnL >= 0 ? '+' : ''}${data.totalPnL.toFixed(2)} MT</td>
                    </tr>
                    <tr>
                        <td style="padding: 12px 0; border-top: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: bold; text-transform: uppercase;">Win Rate</td>
                        <td style="padding: 12px 0; border-top: 1px solid #f1f5f9; text-align: right; color: #0f172a; font-weight: bold;">${data.winRate.toFixed(1)}%</td>
                    </tr>
                    <tr>
                        <td style="padding: 12px 0; border-top: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: bold; text-transform: uppercase;">Total de Trades</td>
                        <td style="padding: 12px 0; border-top: 1px solid #f1f5f9; text-align: right; color: #0f172a; font-weight: bold;">${data.totalTrades}</td>
                    </tr>
                </table>
            </div>

            ${data.topLessons.length > 0 ? `
                <h3 style="color: #0f172a; font-size: 18px; margin-bottom: 15px;">🔍 Principais Lições Aprendidas</h3>
                <ul style="padding-left: 20px; color: #475569;">
                    ${data.topLessons.map(l => `
                        <li style="margin-bottom: 10px;"><b>${l.count}x:</b> ${l.lesson}</li>
                    `).join('')}
                </ul>
            ` : ''}

            <p style="margin-top: 30px;">Continue refinando sua estratégia e mantendo a disciplina. O sucesso no trading é uma maratona, não um sprint.</p>
            
            <div class="cta-container">
                <a href="${process.env.BASE_URL || '#'}/journal" class="button">Ver Diário Completo</a>
            </div>
        `;
        return BASE_LAYOUT(content);
    }
};
