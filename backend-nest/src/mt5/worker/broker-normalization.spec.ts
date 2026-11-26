import { Mt5WorkerService } from './mt5-worker.service';

describe('Mt5WorkerService.normalizeBrokerServer', () => {
    const svc = Object.create(Mt5WorkerService.prototype) as Mt5WorkerService;

    it.each([
        ['exness-mt5real', 'Exness-MT5Real'],
        ['exness-mt5real1', 'Exness-MT5Real'],
        ['exness-mt5real37', 'Exness-MT5Real37'],
        ['Exness-MT5Reala30', 'Exness-MT5Real30'],
        ['Exness MT5 Real 45', 'Exness-MT5Real45'],
        ['exness-mt5-trial15', 'Exness-MT5Trial15'],
        ['exness-mt5demo12', 'Exness-MT5Trial12'],
        ['exnesske-mt5real', 'ExnessKE-MT5Real'],
        ['exnessza-mt5trial', 'ExnessZA-MT5Trial'],
        ['xmglobal-mt5 14', 'XMGlobal-MT5 14'],
        ['xmglobal-mt5', 'XMGlobal-MT5'],
        ['hfmarketsglobal-live12', 'HFMarketsGlobal-Live12'],
        ['hfmarketsglobal-demo', 'HFMarketsGlobal-Demo'],
        ['hfmarketssv-live2', 'HFMarketsSV-Live2'],
        ['icmarketssc-mt5-6', 'ICMarketsSC-MT5-6'],
        ['pepperstone-mt5-live2', 'Pepperstone-MT5-Live02'],
        ['vantageinternational-live 4', 'VantageInternational-Live 4'],
        ['dooprime-live 5', 'DooPrime-Live 5'],
        ['cptmarkets-live3', 'CPTMarkets-Live03'],
        ['swissquote-live4', 'Swissquote-Live4'],
        ['ftmo-server6', 'FTMO-Server6'],
        ['fundednext-server 5', 'FundedNext-Server 5'],
        ['fundingpips-server4', 'FundingPips-Server4'],
        ['goatfunded-server 2', 'GoatFunded-Server2'],
        ['fusionmarkets-live 2', 'FusionMarkets-Live 2'],
        ['forextimefxtm-live01', 'ForexTimeFXTM-Live01'],
        ['btgpactual-prd', 'BTGPactual-PRD'],
        ['fundedtradingplus-live', 'FundedTradingPlus-Live'],
        ['deric-demo', 'Deriv-Demo'],
    ])('normalizes "%s" -> "%s"', (input, expected) => {
        expect(svc.normalizeBrokerServer(input)).toBe(expected);
    });
});
