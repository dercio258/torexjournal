import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Square, Save, Download, FlaskConical, Calendar as CalendarIcon, Search } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { StrategyConfig, BacktestStats } from '../components/backtest/BacktestComponents';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { PlanModal } from '../components/dashboard/PlanModal';

export const Backtest = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const isBasic = user?.tier === 'BASIC';

    // State
    const [symbol, setSymbol] = useState('EURUSD');
    const [searchTerm, setSearchTerm] = useState('');
    const [timeframe, setTimeframe] = useState('60'); // 60 = 1H
    const [dateRange] = useState({ start: '2025-01-01', end: '2025-01-31' });
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState(0);
    const [searchResults, setSearchResults] = useState<any[]>([]);

    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

    // Mock Config
    const [config, setConfig] = useState({
        strategy: 'MACD Cross',
        initialBalance: 10000,
        riskPerTrade: 1,
        commission: 3.5,
        slippage: 5
    });

    // Initialize Chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: '#0f172a' }, // slate-900
                textColor: '#94a3b8', // slate-400
            },
            grid: {
                vertLines: { color: '#1e293b' }, // slate-800
                horzLines: { color: '#1e293b' },
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
        });

        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#10b981', // emerald-500
            downColor: '#ef4444', // red-500
            borderVisible: false,
            wickUpColor: '#10b981',
            wickDownColor: '#ef4444',
        });

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;

        // Resize handler
        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight
                });
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, []);

    // Fetch Data on Symbol/Timeframe Change
    useEffect(() => {
        const fetchData = async () => {
            if (!candleSeriesRef.current) return;

            try {
                // Determine range based on timeframe (approx)
                let range = 200;

                const response = await api.get(`/tradingview/candles`, {
                    params: { symbol, timeframe, range }
                });

                if (response.data && Array.isArray(response.data)) {
                    // Sort data by time just in case
                    const sortedData = response.data.sort((a: any, b: any) => a.time - b.time);

                    // Lightweight charts expects time in seconds
                    const formattedData = sortedData.map((d: any) => ({
                        time: d.time, // Assuming API returns unix timestamp in seconds
                        open: d.open,
                        high: d.high,
                        low: d.low,
                        close: d.close,
                    }));

                    candleSeriesRef.current.setData(formattedData);
                    chartRef.current?.timeScale().fitContent();
                }
            } catch (error) {
                console.error("Failed to fetch candle data:", error);
            }
        };

        fetchData();
    }, [symbol, timeframe]);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchTerm) return;

        // isSearching removed
        try {
            const res = await api.get(`/tradingview/search`, {
                params: { q: searchTerm, type: 'forex' } // prioritizing forex for now
            });
            setSearchResults(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            // isSearching removed
        }
    };

    const selectSymbol = (sym: string) => {
        setSymbol(sym);
        setSearchTerm('');
        setSearchResults([]);
    };

    const handleRun = () => {
        setIsRunning(true);
        setProgress(0);

        // Mock Progress
        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(interval);
                    setIsRunning(false);
                    return 100;
                }
                return prev + 5;
            });
        }, 100);
    };

    const handleStop = () => {
        setIsRunning(false);
        setProgress(0);
    };

    return (
        <div className="h-[calc(100vh-2rem)] flex flex-col space-y-4">
            {/* Header / Toolbar */}
            <Card className="p-4 flex flex-col md:flex-row gap-4 items-center justify-between shrink-0 z-20 overflow-visible">
                <div className="flex items-center gap-4 w-full md:w-auto relative">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold text-lg min-w-[140px]">
                        <FlaskConical />
                        BACKTEST
                    </div>

                    <div className="h-8 w-px bg-slate-700 mx-2 hidden md:block" />

                    <div className="relative group">
                        <form onSubmit={handleSearch} className="flex gap-2">
                            <div className="relative">
                                <input
                                    value={searchTerm || symbol}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    className="bg-slate-900 border border-slate-700 text-slate-100 px-3 py-1.5 rounded-lg text-sm w-32 font-bold uppercase focus:w-48 transition-all"
                                    placeholder="Search..."
                                />
                                {searchTerm && searchResults.length > 0 && (
                                    <div className="absolute top-full left-0 mt-1 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto z-50">
                                        {searchResults.map((res: any) => (
                                            <div
                                                key={res.symbol}
                                                onClick={() => selectSymbol(res.symbol)}
                                                className="px-4 py-2 hover:bg-slate-700 cursor-pointer flex justify-between items-center"
                                            >
                                                <span className="font-bold text-slate-200">{res.symbol}</span>
                                                <span className="text-xs text-slate-400">{res.description}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <Button type="submit" icon={<Search size={14} />} />
                        </form>
                    </div>

                    <select
                        value={timeframe}
                        onChange={e => setTimeframe(e.target.value)}
                        className="bg-slate-900 border border-slate-700 text-slate-100 px-3 py-1.5 rounded-lg text-sm font-bold"
                    >
                        <option value="1">1m</option>
                        <option value="5">5m</option>
                        <option value="15">15m</option>
                        <option value="60">1h</option>
                        <option value="240">4h</option>
                        <option value="D">1D</option>
                    </select>

                    <div className="flex items-center gap-2 bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-1.5">
                        <CalendarIcon size={14} className="text-slate-500" />
                        <span className="text-xs text-slate-300">{dateRange.start}</span>
                        <span className="text-slate-600">-</span>
                        <span className="text-xs text-slate-300">{dateRange.end}</span>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto">
                    {isRunning && (
                        <div className="flex-1 md:w-48 mr-2">
                            <div className="flex justify-between text-xs mb-1 text-slate-400">
                                <span>Running...</span>
                                <span>{progress}%</span>
                            </div>
                            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                            </div>
                        </div>
                    )}

                    {!isRunning ? (
                        <Button onClick={handleRun} icon={<Play size={16} />} className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/20">
                            Run
                        </Button>
                    ) : (
                        <Button onClick={handleStop} variant="danger" icon={<Square size={16} />}>
                            Stop
                        </Button>
                    )}

                    <div className="h-8 w-px bg-slate-700 mx-2" />

                    <Button variant="secondary" icon={<Save size={16} />} />
                    <Button variant="secondary" icon={<Download size={16} />} />
                </div>
            </Card>

            {/* Main Content - 3 Columns */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0 overflow-hidden">

                {/* Left: Configuration */}
                <div className="lg:col-span-3 overflow-y-auto pr-1">
                    <StrategyConfig
                        config={config}
                        onChange={(k, v) => setConfig(prev => ({ ...prev, [k]: v }))}
                    />
                </div>

                {/* Center: Chart */}
                <div className="lg:col-span-6 flex flex-col h-full min-h-[400px]">
                    <Card className="flex-1 bg-slate-900 relative overflow-hidden border-slate-800">
                        {/* Chart Container */}
                        <div ref={chartContainerRef} className="w-full h-full" />

                        {/* Overlay Metrics (Optional) */}
                        <div className="absolute top-4 left-4 flex gap-4 z-10 pointer-events-none">
                            <div className="px-3 py-1 bg-slate-950/80 rounded border border-slate-800 text-xs text-slate-300">
                                Equity: <span className="text-emerald-400 font-bold">$11,250.00</span>
                            </div>
                            <div className="px-3 py-1 bg-slate-950/80 rounded border border-slate-800 text-xs text-slate-300">
                                DD: <span className="text-rose-400 font-bold">-2.4%</span>
                            </div>
                        </div>
                    </Card>

                    {/* Bottom Tabs Area (Logs/Trades) */}
                    <div className="h-48 mt-4">
                        <Card className="h-full p-0 overflow-hidden flex flex-col">
                            <div className="flex border-b border-slate-800">
                                <button className="px-4 py-2 text-xs font-bold text-slate-200 border-b-2 border-emerald-500 bg-slate-800/50">Trades</button>
                                <button className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-300">Logs</button>
                            </div>
                            <div className="flex-1 overflow-auto p-0">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-slate-900/50 text-xs text-slate-500 uppercase sticky top-0">
                                        <tr>
                                            <th className="px-4 py-2 font-medium">Time</th>
                                            <th className="px-4 py-2 font-medium">Type</th>
                                            <th className="px-4 py-2 font-medium">Entry</th>
                                            <th className="px-4 py-2 font-medium">Exit</th>
                                            <th className="px-4 py-2 font-medium text-right">Profit</th>
                                        </tr>
                                    </thead>
                                    <tbody className="text-xs text-slate-300 divide-y divide-slate-800/50">
                                        {[1, 2, 3, 4, 5].map(i => (
                                            <tr key={i} className="hover:bg-slate-800/30">
                                                <td className="px-4 py-2 text-slate-500">2025-01-14 10:{i}0</td>
                                                <td className="px-4 py-2"><span className="text-emerald-400">BUY</span></td>
                                                <td className="px-4 py-2">1.08500</td>
                                                <td className="px-4 py-2">1.08650</td>
                                                <td className="px-4 py-2 text-right text-emerald-400">+$150.00</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    </div>
                </div>

                {/* Right: Results */}
                <div className="lg:col-span-3 overflow-y-auto pl-1">
                    <BacktestStats
                        results={{
                            netProfit: '1,250.00',
                            winRate: 65,
                            profitFactor: 1.8,
                            maxDrawdown: 4.5,
                            totalTrades: 42
                        }}
                    />
                </div>
            </div>
            {isBasic && (
                <PlanModal 
                    type="UPGRADE_REQUIRED" 
                    featureName="Backtest Ilimitado" 
                    onClose={() => navigate('/dashboard')} 
                />
            )}
        </div>
    );
};
