import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
    ArrowRight,
    BellRing,
    BookOpenCheck,
    CheckCircle2,
    FileSpreadsheet,
    Sparkles,
    TrendingUp,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../../context/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import {
    getLocalPushStatus,
    markStandaloneWelcomeSeen,
    subscribeUserToPush,
} from '../../lib/pwaManager';

function canRunHardwareWebGL(): boolean {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    try {
        const nav = navigator as Navigator & { deviceMemory?: number };
        if (typeof nav.deviceMemory === 'number' && nav.deviceMemory < 2) {
            return false;
        }
        const canvas = document.createElement('canvas');
        const gl =
            canvas.getContext('webgl2', { powerPreference: 'high-performance' }) ||
            canvas.getContext('webgl', { powerPreference: 'high-performance' });
        return Boolean(gl);
    } catch {
        return false;
    }
}

interface CandleSpec {
    x: number;
    open: number;
    close: number;
    high: number;
    low: number;
    phase: number;
}

const OHLC_SERIES: CandleSpec[] = [
    { x: -4.8, open: -0.9, close: -0.4, high: -0.2, low: -1.25, phase: 0.1 },
    { x: -4.2, open: -0.4, close: -0.75, high: -0.25, low: -0.95, phase: 0.4 },
    { x: -3.6, open: -0.75, close: -0.1, high: 0.1, low: -0.9, phase: 0.7 },
    { x: -3.0, open: -0.1, close: 0.45, high: 0.65, low: -0.25, phase: 1.0 },
    { x: -2.4, open: 0.45, close: 0.15, high: 0.7, low: -0.05, phase: 1.3 },
    { x: -1.8, open: 0.15, close: 0.8, high: 1.05, low: 0.05, phase: 1.6 },
    { x: -1.2, open: 0.8, close: 0.5, high: 0.95, low: 0.3, phase: 1.9 },
    { x: -0.6, open: 0.5, close: 1.15, high: 1.35, low: 0.4, phase: 2.2 },
    { x: 0.0, open: 1.15, close: 0.85, high: 1.4, low: 0.65, phase: 2.5 },
    { x: 0.6, open: 0.85, close: 1.55, high: 1.75, low: 0.75, phase: 2.8 },
    { x: 1.2, open: 1.55, close: 1.9, high: 2.15, low: 1.35, phase: 3.1 },
    { x: 1.8, open: 1.9, close: 1.45, high: 2.05, low: 1.25, phase: 3.4 },
    { x: 2.4, open: 1.45, close: 2.1, high: 2.35, low: 1.35, phase: 3.7 },
    { x: 3.0, open: 2.1, close: 2.55, high: 2.75, low: 1.95, phase: 4.0 },
    { x: 3.6, open: 2.55, close: 2.25, high: 2.8, low: 2.1, phase: 4.3 },
    { x: 4.2, open: 2.25, close: 2.85, high: 3.05, low: 2.15, phase: 4.6 },
    { x: 4.8, open: 2.85, close: 3.25, high: 3.55, low: 2.7, phase: 4.9 },
];

const Candles3DGroup: React.FC<{ reducedMotion: boolean }> = ({ reducedMotion }) => {
    const groupRef = useRef<THREE.Group>(null);
    const candleRefs = useRef<(THREE.Group | null)[]>([]);

    const { bullBodyMat, bearBodyMat, wickBullMat, wickBearMat, maGeometry, maMaterial } = useMemo(() => {
        const bullBodyMat = new THREE.MeshStandardMaterial({
            color: '#10b981',
            emissive: '#059669',
            emissiveIntensity: 0.55,
            roughness: 0.25,
            metalness: 0.25,
        });
        const bearBodyMat = new THREE.MeshStandardMaterial({
            color: '#f43f5e',
            emissive: '#be123c',
            emissiveIntensity: 0.45,
            roughness: 0.3,
            metalness: 0.2,
        });
        const wickBullMat = new THREE.MeshStandardMaterial({
            color: '#6ee7b7',
            emissive: '#10b981',
            emissiveIntensity: 0.3,
        });
        const wickBearMat = new THREE.MeshStandardMaterial({
            color: '#fda4af',
            emissive: '#f43f5e',
            emissiveIntensity: 0.25,
        });

        const curvePoints = OHLC_SERIES.map(
            (c, i) => new THREE.Vector3(c.x, (c.open + c.close) * 0.5 + 0.15, Math.sin(i * 0.4) * 0.3),
        );
        const curve = new THREE.CatmullRomCurve3(curvePoints);
        const maGeometry = new THREE.TubeGeometry(curve, 80, 0.045, 10, false);
        const maMaterial = new THREE.MeshBasicMaterial({
            color: '#38bdf8',
            transparent: true,
            opacity: 0.85,
        });

        return { bullBodyMat, bearBodyMat, wickBullMat, wickBearMat, maGeometry, maMaterial };
    }, []);

    useEffect(() => {
        return () => {
            bullBodyMat.dispose();
            bearBodyMat.dispose();
            wickBullMat.dispose();
            wickBearMat.dispose();
            maGeometry.dispose();
            maMaterial.dispose();
        };
    }, [bullBodyMat, bearBodyMat, wickBullMat, wickBearMat, maGeometry, maMaterial]);

    useFrame(({ clock }) => {
        if (reducedMotion) return;
        const t = clock.getElapsedTime();
        if (groupRef.current) {
            groupRef.current.rotation.y = Math.sin(t * 0.28) * 0.22;
            groupRef.current.rotation.x = 0.08 + Math.cos(t * 0.22) * 0.04;
        }
        for (let i = 0; i < OHLC_SERIES.length; i++) {
            const g = candleRefs.current[i];
            if (g) {
                g.position.y = Math.sin(t * 1.4 + OHLC_SERIES[i].phase) * 0.08 - 0.75;
            }
        }
    });

    return (
        <group ref={groupRef} position={[0, -0.3, -1.2]}>
            {OHLC_SERIES.map((c, idx) => {
                const isBull = c.close >= c.open;
                const bodyHeight = Math.max(0.16, Math.abs(c.close - c.open));
                const bodyCenterY = (c.open + c.close) / 2;
                const wickHeight = Math.max(0.25, c.high - c.low);
                const wickCenterY = (c.high + c.low) / 2;

                return (
                    <group
                        key={c.x}
                        ref={(el) => {
                            candleRefs.current[idx] = el;
                        }}
                        position={[c.x, -0.75, Math.sin(idx * 0.4) * 0.3]}
                    >
                        <mesh
                            position={[0, bodyCenterY, 0]}
                            material={isBull ? bullBodyMat : bearBodyMat}
                        >
                            <boxGeometry args={[0.32, bodyHeight, 0.32]} />
                        </mesh>
                        <mesh
                            position={[0, wickCenterY, 0]}
                            material={isBull ? wickBullMat : wickBearMat}
                        >
                            <cylinderGeometry args={[0.03, 0.03, wickHeight, 8]} />
                        </mesh>
                    </group>
                );
            })}

            <mesh geometry={maGeometry} material={maMaterial} position={[0, -0.75, 0]} />
            <gridHelper args={[18, 18, '#1e293b', '#0f172a']} position={[0, -2.6, 0]} />
        </group>
    );
};

interface PwaStandaloneWelcomeProps {
    onContinue?: () => void;
}

export const PwaStandaloneWelcome: React.FC<PwaStandaloneWelcomeProps> = ({ onContinue }) => {
    const { locale } = useLocale();
    const { token } = useAuth();
    const navigate = useNavigate();
    const isEn = locale === 'en';

    const [webglReady] = useState(() => canRunHardwareWebGL());
    const [reducedMotion, setReducedMotion] = useState(false);
    const [pushActive, setPushActive] = useState(false);
    const [pushBusy, setPushBusy] = useState(false);
    const [pushMessage, setPushMessage] = useState<string | null>(null);

    useEffect(() => {
        if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
            setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        }
        void getLocalPushStatus().then((s) => setPushActive(s.subscribed));
    }, []);

    const handleEnablePush = async () => {
        if (!token) {
            markStandaloneWelcomeSeen();
            navigate('/login?next=/dashboard');
            return;
        }
        setPushBusy(true);
        setPushMessage(null);
        const res = await subscribeUserToPush({
            locale: isEn ? 'en' : 'pt',
            sendWelcome: true,
        });
        setPushBusy(false);
        if (res.ok) {
            setPushActive(true);
            setPushMessage(
                isEn
                    ? 'Smart notifications enabled! Check your notification tray for confirmation.'
                    : 'Notificações inteligentes ativadas com sucesso!',
            );
        } else {
            setPushMessage(
                isEn
                    ? 'Please allow browser notifications to receive trade & journal reminders.'
                    : 'Autorize as notificações no pedido do sistema para receber alertas sobre suas trades.',
            );
        }
    };

    const handleEnterApp = () => {
        markStandaloneWelcomeSeen();
        if (onContinue) {
            onContinue();
            return;
        }
        navigate(token ? '/dashboard' : '/login', { replace: true });
    };

    return (
        <div className="fixed inset-0 z-[100] flex min-h-screen flex-col justify-between overflow-y-auto bg-[#060b16] text-slate-100">
            {/* Three.js 3D Candlestick Backdrop with CSS institutional grid fallback */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div
                    className="absolute inset-0 opacity-60"
                    style={{
                        background:
                            'radial-gradient(circle at 22% 20%, rgba(16, 185, 129, 0.22), transparent 45%), radial-gradient(circle at 80% 75%, rgba(56, 189, 248, 0.16), transparent 50%), linear-gradient(180deg, #060b16 0%, #091122 100%)',
                    }}
                />
                {webglReady && (
                    <Canvas
                        dpr={[1, 1.5]}
                        frameloop={reducedMotion ? 'demand' : 'always'}
                        camera={{ position: [0, 0.8, 7.6], fov: 45 }}
                        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
                    >
                        <ambientLight intensity={0.75} />
                        <directionalLight position={[5, 8, 6]} intensity={1.3} color="#e2e8f0" />
                        <pointLight position={[-4, 2, 4]} intensity={1.8} color="#10b981" />
                        <pointLight position={[4, -1, 4]} intensity={1.4} color="#38bdf8" />
                        <Candles3DGroup reducedMotion={reducedMotion} />
                    </Canvas>
                )}
            </div>

            {/* Content Layer */}
            <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-10 sm:px-8">
                <div className="rounded-3xl border border-white/10 bg-[#0b1324]/75 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                        <Sparkles size={13} />
                        <span>{isEn ? 'Torex Journal App · Ready' : 'Torex Journal App · Terminal 3D'}</span>
                    </div>

                    <h1 className="mt-4 text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight">
                        {isEn
                            ? 'Precision journaling & live execution clarity in your pocket.'
                            : 'Seu terminal de execução, diário e edge quantitativo — agora no app.'}
                    </h1>

                    <p className="mt-2.5 text-sm leading-relaxed text-slate-300">
                        {isEn
                            ? 'Operate online or log setups completely offline. Enable smart push alerts below so Torex reminds you to reflect in 2 minutes whenever trades sync.'
                            : 'Registe o diário mesmo offline, analise operações em cache e baixe relatórios completos. Ative as notificações para receber incentivos inteligentes logo após importar novas operações.'}
                    </p>

                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                            <BookOpenCheck size={17} className="text-emerald-400" />
                            <h2 className="mt-2 text-xs font-bold text-white">
                                {isEn ? 'Offline Journal' : 'Diário Offline'}
                            </h2>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                                {isEn ? 'Log psychology & setups without Wi-Fi.' : 'Registe emoções em 2 min mesmo offline.'}
                            </p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                            <TrendingUp size={17} className="text-sky-400" />
                            <h2 className="mt-2 text-xs font-bold text-white">
                                {isEn ? '20+ Broker Sync' : '+20 Corretoras'}
                            </h2>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                                {isEn ? 'MT5, Deriv & transparent audit trail.' : 'Operações auditadas com transparência.'}
                            </p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                            <FileSpreadsheet size={17} className="text-emerald-400" />
                            <h2 className="mt-2 text-xs font-bold text-white">
                                {isEn ? 'Advanced Reports' : 'Relatórios Avançados'}
                            </h2>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                                {isEn ? 'Export PDF/CSV analytics anywhere.' : 'Exporte detalhes profundos em PDF/CSV.'}
                            </p>
                        </div>
                    </div>

                    {/* Incentivo principal de Push Notifications */}
                    <div className="mt-6 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-slate-950">
                                    {pushActive ? <CheckCircle2 size={18} /> : <BellRing size={18} />}
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-white">
                                        {pushActive
                                            ? isEn
                                                ? 'Push notifications are active!'
                                                : 'Notificações Push já estão ativas!'
                                            : isEn
                                              ? 'Activate Smart Push Alerts (Recommended)'
                                              : 'Ative as Notificações Push (Recomendado)'}
                                    </p>
                                    <p className="mt-0.5 text-[11px] text-slate-300">
                                        {isEn
                                            ? 'Zero spam: objective reminders after trade imports, edge curiosities, and community room activity.'
                                            : 'Zero excesso: apenas avisos claros pós-importação, curiosidades dos seus dados e salas da comunidade.'}
                                    </p>
                                </div>
                            </div>

                            {!pushActive && (
                                <button
                                    type="button"
                                    onClick={handleEnablePush}
                                    disabled={pushBusy}
                                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 shadow-lg transition-all hover:bg-emerald-400 active:scale-95 disabled:opacity-60 cursor-pointer"
                                >
                                    <BellRing size={14} />
                                    {pushBusy
                                        ? isEn
                                            ? 'Enabling...'
                                            : 'Ativando...'
                                        : isEn
                                          ? 'Enable Alerts'
                                          : 'Ativar Notificações'}
                                </button>
                            )}
                        </div>
                        {pushMessage && (
                            <p className="mt-2.5 text-xs font-semibold text-emerald-300">{pushMessage}</p>
                        )}
                    </div>

                    <div className="mt-6 flex items-center justify-end">
                        <button
                            type="button"
                            onClick={handleEnterApp}
                            className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 text-xs font-extrabold text-slate-950 shadow transition-all hover:bg-slate-200 active:scale-[0.98] cursor-pointer"
                        >
                            <span>{isEn ? 'Enter Torex Terminal' : 'Entrar no Torex Terminal'}</span>
                            <ArrowRight size={15} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PwaStandaloneWelcome;
