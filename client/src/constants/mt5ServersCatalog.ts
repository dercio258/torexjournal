export interface Mt5ServerOption {
    name: string;
    env: 'DEMO' | 'REAL';
    description?: string;
}

export interface Mt5BrokerGroup {
    id: string;
    broker: string;
    category: 'Deriv' | 'Forex / ECN' | 'Prop Firm' | 'MetaQuotes';
    countryOrRegion?: string;
    popular?: boolean;
    servers: Mt5ServerOption[];
}

export const MT5_BROKERS_CATALOG: Mt5BrokerGroup[] = [
    {
        id: 'deriv',
        broker: 'Deriv',
        category: 'Deriv',
        popular: true,
        servers: [
            { name: 'Deriv-Demo', env: 'DEMO', description: 'Servidor Demo Global Deriv (Sintéticos & Forex)' },
            { name: 'Deriv-Server', env: 'REAL', description: 'Servidor Real Principal Deriv (Cluster 01)' },
            { name: 'Deriv-Server-02', env: 'REAL', description: 'Servidor Real Deriv (Cluster 02)' },
            { name: 'Deriv-Server-03', env: 'REAL', description: 'Servidor Real Deriv (Cluster 03)' },
            { name: 'DerivSVG-Demo', env: 'DEMO', description: 'Deriv (SVG) LLC - Conta Demo' },
            { name: 'DerivSVG-Server', env: 'REAL', description: 'Deriv (SVG) LLC - Servidor Real 01' },
            { name: 'DerivSVG-Server-02', env: 'REAL', description: 'Deriv (SVG) LLC - Servidor Real 02' },
            { name: 'DerivSVG-Server-03', env: 'REAL', description: 'Deriv (SVG) LLC - Servidor Real 03' },
            { name: 'DerivBVI-Demo', env: 'DEMO', description: 'Deriv (BVI) Ltd - Conta Demo' },
            { name: 'DerivBVI-Server', env: 'REAL', description: 'Deriv (BVI) Ltd - Servidor Real' },
            { name: 'DerivBVI-Server-02', env: 'REAL', description: 'Deriv (BVI) Ltd - Servidor Real 02' },
            { name: 'DerivVU-Demo', env: 'DEMO', description: 'Deriv (V) Ltd (Vanuatu) - Conta Demo' },
            { name: 'DerivVU-Server', env: 'REAL', description: 'Deriv (V) Ltd (Vanuatu) - Servidor Real' },
            { name: 'DerivFX-Demo', env: 'DEMO', description: 'Deriv (FX) Ltd (Labuan) - Conta Demo' },
            { name: 'DerivFX-Server', env: 'REAL', description: 'Deriv (FX) Ltd (Labuan) - Servidor Real' },
            { name: 'DerivMauritius-Demo', env: 'DEMO', description: 'Deriv (Mauritius) Ltd - Conta Demo' },
            { name: 'DerivMauritius-Server', env: 'REAL', description: 'Deriv (Mauritius) Ltd - Servidor Real' },
        ],
    },
    {
        id: 'exness',
        broker: 'Exness',
        category: 'Forex / ECN',
        popular: true,
        servers: [
            { name: 'Exness-MT5Trial', env: 'DEMO', description: 'Exness Trial / Demo 1' },
            { name: 'Exness-MT5Trial2', env: 'DEMO', description: 'Exness Trial / Demo 2' },
            { name: 'Exness-MT5Trial3', env: 'DEMO', description: 'Exness Trial / Demo 3' },
            { name: 'Exness-MT5Trial4', env: 'DEMO', description: 'Exness Trial / Demo 4' },
            { name: 'Exness-MT5Trial5', env: 'DEMO', description: 'Exness Trial / Demo 5' },
            { name: 'Exness-MT5Trial6', env: 'DEMO', description: 'Exness Trial / Demo 6' },
            { name: 'Exness-MT5Trial7', env: 'DEMO', description: 'Exness Trial / Demo 7' },
            { name: 'Exness-MT5Trial8', env: 'DEMO', description: 'Exness Trial / Demo 8' },
            { name: 'Exness-MT5Trial9', env: 'DEMO', description: 'Exness Trial / Demo 9' },
            { name: 'Exness-MT5Trial10', env: 'DEMO', description: 'Exness Trial / Demo 10' },
            { name: 'Exness-MT5Real', env: 'REAL', description: 'Exness Real 1' },
            { name: 'Exness-MT5Real2', env: 'REAL', description: 'Exness Real 2' },
            { name: 'Exness-MT5Real3', env: 'REAL', description: 'Exness Real 3' },
            { name: 'Exness-MT5Real4', env: 'REAL', description: 'Exness Real 4' },
            { name: 'Exness-MT5Real5', env: 'REAL', description: 'Exness Real 5' },
            { name: 'Exness-MT5Real6', env: 'REAL', description: 'Exness Real 6' },
            { name: 'Exness-MT5Real7', env: 'REAL', description: 'Exness Real 7' },
            { name: 'Exness-MT5Real8', env: 'REAL', description: 'Exness Real 8' },
            { name: 'Exness-MT5Real9', env: 'REAL', description: 'Exness Real 9' },
            { name: 'Exness-MT5Real10', env: 'REAL', description: 'Exness Real 10' },
            { name: 'Exness-MT5Real11', env: 'REAL', description: 'Exness Real 11' },
            { name: 'Exness-MT5Real12', env: 'REAL', description: 'Exness Real 12' },
            { name: 'Exness-MT5Real14', env: 'REAL', description: 'Exness Real 14' },
            { name: 'Exness-MT5Real15', env: 'REAL', description: 'Exness Real 15' },
            { name: 'Exness-MT5Real20', env: 'REAL', description: 'Exness Real 20' },
        ],
    },
    {
        id: 'xm',
        broker: 'XM Global',
        category: 'Forex / ECN',
        popular: true,
        servers: [
            { name: 'XMGlobal-MT5', env: 'REAL', description: 'XM Global MT5 Real 1 / Demo' },
            { name: 'XMGlobal-MT5 2', env: 'REAL', description: 'XM Global MT5 Real 2' },
            { name: 'XMGlobal-MT5 3', env: 'REAL', description: 'XM Global MT5 Real 3' },
            { name: 'XMGlobal-MT5 4', env: 'REAL', description: 'XM Global MT5 Real 4' },
            { name: 'XMGlobal-MT5 5', env: 'REAL', description: 'XM Global MT5 Real 5' },
            { name: 'XMGlobal-MT5 6', env: 'REAL', description: 'XM Global MT5 Real 6' },
            { name: 'XMGlobal-MT5 7', env: 'REAL', description: 'XM Global MT5 Real 7' },
        ],
    },
    {
        id: 'icmarkets',
        broker: 'IC Markets',
        category: 'Forex / ECN',
        popular: true,
        servers: [
            { name: 'ICMarketsSC-Demo', env: 'DEMO', description: 'IC Markets Global (SC) Demo' },
            { name: 'ICMarketsSC-MT5', env: 'REAL', description: 'IC Markets Global (SC) Real 1' },
            { name: 'ICMarketsSC-MT5-2', env: 'REAL', description: 'IC Markets Global (SC) Real 2' },
            { name: 'ICMarketsSC-MT5-4', env: 'REAL', description: 'IC Markets Global (SC) Real 4' },
            { name: 'ICMarketsEU-Demo', env: 'DEMO', description: 'IC Markets EU Demo' },
            { name: 'ICMarketsEU-MT5', env: 'REAL', description: 'IC Markets EU Real' },
            { name: 'ICMarketsAU-Demo', env: 'DEMO', description: 'IC Markets Australia Demo' },
            { name: 'ICMarketsAU-MT5', env: 'REAL', description: 'IC Markets Australia Real' },
        ],
    },
    {
        id: 'ftmo',
        broker: 'FTMO',
        category: 'Prop Firm',
        popular: true,
        servers: [
            { name: 'FTMO-Demo', env: 'DEMO', description: 'FTMO Challenge / Verification / Free Trial 1' },
            { name: 'FTMO-Demo2', env: 'DEMO', description: 'FTMO Challenge / Verification 2' },
            { name: 'FTMO-Server', env: 'REAL', description: 'FTMO Funded Account Server 1' },
            { name: 'FTMO-Server2', env: 'REAL', description: 'FTMO Funded Account Server 2' },
            { name: 'FTMO-Server3', env: 'REAL', description: 'FTMO Funded Account Server 3' },
            { name: 'FTMO-Server4', env: 'REAL', description: 'FTMO Funded Account Server 4' },
        ],
    },
    {
        id: 'fundednext',
        broker: 'FundedNext',
        category: 'Prop Firm',
        popular: true,
        servers: [
            { name: 'FundedNext-Trial', env: 'DEMO', description: 'FundedNext Challenge / Evaluation' },
            { name: 'FundedNext-Server', env: 'REAL', description: 'FundedNext Funded / Live Server' },
            { name: 'GrowthNext-Demo', env: 'DEMO', description: 'GrowthNext / FundedNext Demo' },
            { name: 'GrowthNext-Server', env: 'REAL', description: 'GrowthNext / FundedNext Server' },
        ],
    },
    {
        id: 'the5ers',
        broker: 'The5%ers (Five Percent Online)',
        category: 'Prop Firm',
        popular: true,
        servers: [
            { name: 'FivePercentOnline-Real', env: 'REAL', description: 'The5ers Official MT5 Server (Evaluation & Funded)' },
            { name: 'FivePercentOnline-Demo', env: 'DEMO', description: 'The5ers Demo Server' },
        ],
    },
    {
        id: 'pepperstone',
        broker: 'Pepperstone',
        category: 'Forex / ECN',
        popular: true,
        servers: [
            { name: 'Pepperstone-Demo', env: 'DEMO', description: 'Pepperstone Global Demo' },
            { name: 'Pepperstone-MT5-Live01', env: 'REAL', description: 'Pepperstone Global Live 01' },
            { name: 'PepperstoneUK-Demo', env: 'DEMO', description: 'Pepperstone UK Demo' },
            { name: 'PepperstoneUK-Live', env: 'REAL', description: 'Pepperstone UK Live' },
        ],
    },
    {
        id: 'vantage',
        broker: 'Vantage Markets',
        category: 'Forex / ECN',
        popular: true,
        servers: [
            { name: 'VantageInternational-Demo', env: 'DEMO', description: 'Vantage International Demo' },
            { name: 'VantageInternational-Live', env: 'REAL', description: 'Vantage International Live 1' },
            { name: 'VantageInternational-Live 2', env: 'REAL', description: 'Vantage International Live 2' },
            { name: 'VantageInternational-Live 3', env: 'REAL', description: 'Vantage International Live 3' },
        ],
    },
    {
        id: 'hfm',
        broker: 'HFM (HF Markets / HotForex)',
        category: 'Forex / ECN',
        popular: true,
        servers: [
            { name: 'HFMarketsSV-Demo', env: 'DEMO', description: 'HFM Global (SV) Demo' },
            { name: 'HFMarketsSV-Live', env: 'REAL', description: 'HFM Global (SV) Live 1' },
            { name: 'HFMarketsSV-Live2', env: 'REAL', description: 'HFM Global (SV) Live 2' },
            { name: 'HFMarketsSA-Demo', env: 'DEMO', description: 'HFM South Africa Demo' },
            { name: 'HFMarketsSA-Live', env: 'REAL', description: 'HFM South Africa Live' },
        ],
    },
    {
        id: 'fbs',
        broker: 'FBS',
        category: 'Forex / ECN',
        servers: [
            { name: 'FBS-Demo', env: 'DEMO', description: 'FBS MT5 Demo' },
            { name: 'FBS-Real', env: 'REAL', description: 'FBS MT5 Real' },
        ],
    },
    {
        id: 'justmarkets',
        broker: 'JustMarkets',
        category: 'Forex / ECN',
        servers: [
            { name: 'JustMarkets-Demo', env: 'DEMO', description: 'JustMarkets Demo 1' },
            { name: 'JustMarkets-Demo2', env: 'DEMO', description: 'JustMarkets Demo 2' },
            { name: 'JustMarkets-Live', env: 'REAL', description: 'JustMarkets Live 1' },
            { name: 'JustMarkets-Live2', env: 'REAL', description: 'JustMarkets Live 2' },
        ],
    },
    {
        id: 'octafx',
        broker: 'Octa (OctaFX)',
        category: 'Forex / ECN',
        servers: [
            { name: 'OctaFX-Demo', env: 'DEMO', description: 'OctaFX MT5 Demo' },
            { name: 'OctaFX-Real', env: 'REAL', description: 'OctaFX MT5 Real 1' },
            { name: 'OctaFX-Real2', env: 'REAL', description: 'OctaFX MT5 Real 2' },
        ],
    },
    {
        id: 'tickmill',
        broker: 'Tickmill',
        category: 'Forex / ECN',
        servers: [
            { name: 'Tickmill-Demo', env: 'DEMO', description: 'Tickmill Global Demo' },
            { name: 'Tickmill-Live', env: 'REAL', description: 'Tickmill Global Live' },
            { name: 'TickmillUK-Demo', env: 'DEMO', description: 'Tickmill UK Demo' },
            { name: 'TickmillUK-Live', env: 'REAL', description: 'Tickmill UK Live' },
        ],
    },
    {
        id: 'roboforex',
        broker: 'RoboForex',
        category: 'Forex / ECN',
        servers: [
            { name: 'RoboForex-ECN', env: 'REAL', description: 'RoboForex ECN / Demo' },
            { name: 'RoboForex-Pro', env: 'REAL', description: 'RoboForex Pro / Standard' },
        ],
    },
    {
        id: 'eightcap',
        broker: 'Eightcap',
        category: 'Forex / ECN',
        servers: [
            { name: 'Eightcap-Demo', env: 'DEMO', description: 'Eightcap Global Demo' },
            { name: 'Eightcap-Real', env: 'REAL', description: 'Eightcap Global Real' },
        ],
    },
    {
        id: 'fxpro',
        broker: 'FxPro',
        category: 'Forex / ECN',
        servers: [
            { name: 'FxPro-MT5 Demo', env: 'DEMO', description: 'FxPro MT5 Demo' },
            { name: 'FxPro-MT5', env: 'REAL', description: 'FxPro MT5 Live' },
        ],
    },
    {
        id: 'avatrade',
        broker: 'AvaTrade',
        category: 'Forex / ECN',
        servers: [
            { name: 'AvaTrade-Demo', env: 'DEMO', description: 'AvaTrade MT5 Demo' },
            { name: 'AvaTrade-Real', env: 'REAL', description: 'AvaTrade MT5 Real' },
        ],
    },
    {
        id: 'oanda',
        broker: 'OANDA',
        category: 'Forex / ECN',
        servers: [
            { name: 'OANDA-Demo-1', env: 'DEMO', description: 'OANDA MT5 Demo' },
            { name: 'OANDA-Live-1', env: 'REAL', description: 'OANDA MT5 Live' },
        ],
    },
    {
        id: 'fpmarkets',
        broker: 'FP Markets',
        category: 'Forex / ECN',
        servers: [
            { name: 'FPMarketsLLC-Demo', env: 'DEMO', description: 'FP Markets Demo' },
            { name: 'FPMarketsLLC-Live', env: 'REAL', description: 'FP Markets Live' },
        ],
    },
    {
        id: 'puprime',
        broker: 'PU Prime',
        category: 'Forex / ECN',
        servers: [
            { name: 'PUPrime-Demo', env: 'DEMO', description: 'PU Prime Demo' },
            { name: 'PUPrime-Live', env: 'REAL', description: 'PU Prime Live' },
        ],
    },
    {
        id: 'weltrade',
        broker: 'Weltrade',
        category: 'Forex / ECN',
        servers: [
            { name: 'Weltrade-Demo', env: 'DEMO', description: 'Weltrade MT5 Demo (SyntX & Forex)' },
            { name: 'Weltrade-Real', env: 'REAL', description: 'Weltrade MT5 Real' },
        ],
    },
    {
        id: 'metaquotes',
        broker: 'MetaQuotes (Oficial MT5)',
        category: 'MetaQuotes',
        popular: true,
        servers: [
            { name: 'MetaQuotes-Demo', env: 'DEMO', description: 'Servidor Demo Nativo MetaQuotes Software Corp.' },
        ],
    },
];

export const QUICK_POPULAR_SERVERS: Array<{ name: string; broker: string; env: 'DEMO' | 'REAL' }> = [
    { name: 'Deriv-Demo', broker: 'Deriv', env: 'DEMO' },
    { name: 'Deriv-Server', broker: 'Deriv', env: 'REAL' },
    { name: 'Deriv-Server-02', broker: 'Deriv', env: 'REAL' },
    { name: 'DerivSVG-Demo', broker: 'Deriv', env: 'DEMO' },
    { name: 'DerivSVG-Server', broker: 'Deriv', env: 'REAL' },
    { name: 'Exness-MT5Trial', broker: 'Exness', env: 'DEMO' },
    { name: 'Exness-MT5Real', broker: 'Exness', env: 'REAL' },
    { name: 'XMGlobal-MT5', broker: 'XM', env: 'REAL' },
    { name: 'ICMarketsSC-Demo', broker: 'IC Markets', env: 'DEMO' },
    { name: 'ICMarketsSC-MT5', broker: 'IC Markets', env: 'REAL' },
    { name: 'FTMO-Demo', broker: 'FTMO', env: 'DEMO' },
    { name: 'FTMO-Server', broker: 'FTMO', env: 'REAL' },
    { name: 'MetaQuotes-Demo', broker: 'MetaQuotes', env: 'DEMO' },
];
