import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';
import {
    init,
    dispose,
    CandleType,
    LineType,
    TooltipShowRule,
    type Chart,
    type KLineData,
} from 'klinecharts';

export interface EarthHorizonBackgroundProps {
    className?: string;
}

interface LoadedEarthTextures {
    day: THREE.Texture;
    night: THREE.Texture;
    clouds: THREE.Texture;
    specular: THREE.Texture;
    normal: THREE.Texture;
}

const TEXTURE_PATHS = {
    day: '/textures/earth/earth_atmos_2048.jpg',
    night: '/textures/earth/earth_lights_2048.png',
    clouds: '/textures/earth/earth_clouds_1024.png',
    specular: '/textures/earth/earth_specular_2048.jpg',
    normal: '/textures/earth/earth_normal_2048.jpg',
} as const;

const EARTH_RADIUS = 9.2;
const ATMOSPHERE_SCALE = 1.036;
const SUN_DIRECTION = new THREE.Vector3(0.10, 0.28, -0.95).normalize();

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
        if (!gl) return false;

        const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugExt) {
            const rendererInfo = String(gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) || '');
            if (/SwiftShader|llvmpipe|Software|Microsoft Basic Render/i.test(rendererInfo)) {
                return false;
            }
        }
        return true;
    } catch {
        return false;
    }
}

/* ============================================================================
   AUTHENTIC BACKTESTING REPLAY CANDLESTICK LAYER (`klinecharts`)
   Uses the exact KLineCharts engine & theme tokens (`--ds-data-pos` / `--ds-data-neg`)
   from `KLineChartProTerminal.tsx` to render genuine OHLC replay candlesticks
   rising in realistic market structure and oscillating tick-by-tick in real time.
   ============================================================================ */

const STEP_MS = 15 * 60 * 1000; // M15 Replay timeframe (same default as Backtesting Replay)
const BAR_DURATION_SEC = 2.5;   // Smooth 2.5s live tick-by-tick formation per Replay candle

function seededNoise(step: number, salt: number): number {
    const x = Math.sin(step * 127.1 + salt * 311.7) * 43758.5453123;
    return x - Math.floor(x);
}

/**
 * Generates realistic institutional XAUUSD M15 OHLC bars with strict `open === prevClose`
 * continuity and natural bullish market structure (impulse legs, 2-3 bar pullbacks,
 * liquidity sweep wicks, and higher-high breakouts).
 */
function buildTargetReplayBar(prevClose: number, stepIndex: number, timestamp: number): KLineData {
    const wavePos = ((stepIndex % 14) + 14) % 14;
    const r1 = seededNoise(stepIndex, 1);
    const r2 = seededNoise(stepIndex, 2);
    const r3 = seededNoise(stepIndex, 3);

    // Structured wave bias: impulse up (0..4), healthy pullback (5..8), breakout continuation (9..13)
    let structuralBias = 0.55;
    if (wavePos <= 4) {
        structuralBias = wavePos === 2 ? -0.35 : 1.05;
    } else if (wavePos <= 8) {
        structuralBias = wavePos === 8 ? 0.45 : -0.92;
    } else {
        structuralBias = wavePos === 11 ? -0.42 : 1.18;
    }

    const volatility = 2.35;
    const rawDelta = structuralBias * 1.35 + (r1 - 0.48) * volatility * 1.45;
    // Ensure bodies have crisp, readable proportions (occasional doji, mostly clear bodies)
    const bodyDelta =
        Math.abs(rawDelta) < 0.28
            ? (rawDelta >= 0 ? 0.34 : -0.34)
            : rawDelta;

    const open = Number(prevClose.toFixed(2));
    const close = Number(Math.max(1800, open + bodyDelta).toFixed(2));
    const isBull = close >= open;

    // Authentic liquidity-sweep & rejection wicks
    const upperWickMul = wavePos === 4 || wavePos === 13 ? 1.25 : 0.68;
    const lowerWickMul = wavePos === 8 || wavePos === 0 ? 1.35 : 0.72;

    const upperWick = (0.28 + r2 * 1.55) * upperWickMul * (isBull ? 0.85 : 1.05);
    const lowerWick = (0.28 + r3 * 1.55) * lowerWickMul * (isBull ? 1.10 : 0.85);

    const high = Number((Math.max(open, close) + upperWick).toFixed(2));
    const low = Number((Math.min(open, close) - lowerWick).toFixed(2));
    const volume = Math.round(240 + (Math.abs(bodyDelta) + upperWick + lowerWick) * 190);

    return {
        timestamp,
        open,
        high,
        low,
        close,
        volume,
    };
}

function generateInitialReplayHistory(count: number): {
    history: KLineData[];
    nextStepIndex: number;
} {
    const nowAligned = Math.floor(Date.now() / STEP_MS) * STEP_MS;
    const startTs = nowAligned - count * STEP_MS;
    const history: KLineData[] = [];
    let price = 2652.40; // Exact XAUUSD anchor from `klineDatafeed.ts`

    for (let i = 0; i < count; i++) {
        const ts = startTs + i * STEP_MS;
        const bar = buildTargetReplayBar(price, i, ts);
        history.push(bar);
        price = bar.close;
    }

    return { history, nextStepIndex: count };
}

/**
 * Computes realistic intra-bar price action at normalized progress `p` in [0, 1],
 * sweeping the opening wick first, driving toward the opposite extreme, and settling
 * into `target.close` while oscillating smoothly with live market micro-ticks.
 */
function sampleIntraBarTickPrice(target: KLineData, p: number, elapsedSec: number): number {
    const isBull = target.close >= target.open;
    const firstExtreme = isBull ? target.low : target.high;
    const secondExtreme = isBull ? target.high : target.low;

    const smooth = (t: number) => {
        const c = Math.max(0, Math.min(1, t));
        return c * c * (3 - 2 * c);
    };

    let basePrice: number;
    if (p < 0.26) {
        const u = smooth(p / 0.26);
        basePrice = target.open + (firstExtreme - target.open) * u;
    } else if (p < 0.76) {
        const u = smooth((p - 0.26) / 0.50);
        basePrice = firstExtreme + (secondExtreme - firstExtreme) * u;
    } else {
        const u = smooth((p - 0.76) / 0.24);
        basePrice = secondExtreme + (target.close - secondExtreme) * u;
    }

    // Live harmonic tick oscillation (tapers at open/close endpoints to preserve exact continuity)
    const range = Math.max(0.6, target.high - target.low);
    const envelope = Math.sin(Math.PI * Math.max(0, Math.min(1, p)));
    const microTick =
        (Math.sin(elapsedSec * 6.4) * 0.13 + Math.cos(elapsedSec * 11.2) * 0.06) *
        range *
        envelope;

    const clamped = Math.max(target.low, Math.min(target.high, basePrice + microTick));
    return Number(clamped.toFixed(2));
}

const BacktestReplayCandleLayer: React.FC<{
    reducedMotion: boolean;
    inView: boolean;
}> = ({ reducedMotion, inView }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<Chart | null>(null);
    const replayStateRef = useRef<{
        history: KLineData[];
        stepIndex: number;
        activeTarget: KLineData;
        liveBar: KLineData;
        barElapsed: number;
    } | null>(null);

    // 1. Mount & configure genuine `klinecharts` instance with Torex Backtesting Replay theme
    useEffect(() => {
        const el = chartContainerRef.current;
        if (!el) return;

        const chart = init(el);
        if (!chart) return;
        chartRef.current = chart;

        chart.setZoomEnabled(false);
        chart.setScrollEnabled(false);
        chart.setPriceVolumePrecision(2, 0);

        // Exact `--ds-data-pos` (14 165 160) & `--ds-data-neg` (220 38 38) from `useChartTheme.ts`
        const upBody = 'rgba(14, 165, 160, 0.82)';
        const upBorder = 'rgba(20, 184, 166, 0.98)';
        const downBody = 'rgba(220, 38, 38, 0.78)';
        const downBorder = 'rgba(239, 68, 68, 0.95)';
        const neutralTick = 'rgba(148, 163, 184, 0.75)';

        chart.setStyles({
            grid: {
                show: true,
                horizontal: {
                    show: true,
                    size: 1,
                    color: 'rgba(255, 255, 255, 0.045)',
                    style: LineType.Dashed,
                    dashedValue: [4, 6],
                },
                vertical: {
                    show: false,
                    size: 1,
                    color: 'rgba(0, 0, 0, 0)',
                    style: LineType.Solid,
                    dashedValue: [2, 2],
                },
            },
            candle: {
                type: CandleType.CandleSolid,
                bar: {
                    upColor: upBody,
                    downColor: downBody,
                    noChangeColor: neutralTick,
                    upBorderColor: upBorder,
                    downBorderColor: downBorder,
                    noChangeBorderColor: neutralTick,
                    upWickColor: upBorder,
                    downWickColor: downBorder,
                    noChangeWickColor: neutralTick,
                },
                priceMark: {
                    show: true,
                    high: { show: false },
                    low: { show: false },
                    last: {
                        show: true,
                        upColor: upBorder,
                        downColor: downBorder,
                        noChangeColor: neutralTick,
                        line: {
                            show: true,
                            style: LineType.Dashed,
                            dashedValue: [4, 4],
                            size: 1,
                        },
                        text: {
                            show: false,
                        },
                    },
                },
                tooltip: {
                    showRule: TooltipShowRule.None,
                },
            },
            xAxis: {
                show: false,
                size: 0,
                axisLine: { show: false },
                tickLine: { show: false },
                tickText: { show: false },
            },
            yAxis: {
                show: false,
                size: 0,
                inside: true,
                axisLine: { show: false },
                tickLine: { show: false },
                tickText: { show: false },
            },
            separator: {
                size: 0,
                color: 'rgba(0, 0, 0, 0)',
            },
            crosshair: {
                show: false,
            },
        });

        chart.setPaneOptions({
            id: 'candle_pane',
            gap: { top: 0.20, bottom: 0.18 },
        });

        const applyResponsiveSpacing = () => {
            const w = el.clientWidth || window.innerWidth;
            const compact = w < 768;
            chart.setBarSpace(compact ? 13 : 19);
            chart.setOffsetRightDistance(compact ? 48 : Math.round(w * 0.14));
            chart.resize();
        };

        applyResponsiveSpacing();

        const { history, nextStepIndex } = generateInitialReplayHistory(96);
        const lastCompleted = history[history.length - 1];
        const firstActiveTarget = buildTargetReplayBar(
            lastCompleted.close,
            nextStepIndex,
            lastCompleted.timestamp + STEP_MS
        );
        const initialLiveBar: KLineData = {
            timestamp: firstActiveTarget.timestamp,
            open: firstActiveTarget.open,
            high: firstActiveTarget.open,
            low: firstActiveTarget.open,
            close: firstActiveTarget.open,
            volume: 60,
        };

        replayStateRef.current = {
            history,
            stepIndex: nextStepIndex,
            activeTarget: firstActiveTarget,
            liveBar: initialLiveBar,
            barElapsed: 0.85,
        };

        chart.applyNewData([...history, initialLiveBar], false);
        chart.scrollToRealTime(0);

        const ro = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                applyResponsiveSpacing();
                chart.scrollToRealTime(0);
            });
        });
        ro.observe(el);

        return () => {
            ro.disconnect();
            dispose(el);
            chartRef.current = null;
            replayStateRef.current = null;
        };
    }, []);

    // 2. Live Replay Playback Loop (60fps intra-bar tick oscillation + step-by-step candle creation)
    useEffect(() => {
        const chart = chartRef.current;
        const st = replayStateRef.current;
        if (!chart || !st || reducedMotion || !inView) return;

        let rafId = 0;
        let prevNow = performance.now();
        let totalElapsed = 12.0;

        const tick = (now: number) => {
            const dt = Math.min(0.05, Math.max(0, (now - prevNow) / 1000));
            prevNow = now;
            totalElapsed += dt;

            const state = replayStateRef.current;
            const activeChart = chartRef.current;
            if (!state || !activeChart) return;

            state.barElapsed += dt;

            if (state.barElapsed >= BAR_DURATION_SEC) {
                // 1) Finalize completed Replay candle with exact target OHLC
                const completed: KLineData = { ...state.activeTarget };
                activeChart.updateData(completed);
                state.history.push(completed);

                // Keep memory bounded smoothly over long sessions
                const needsTrim = state.history.length > 220;
                if (needsTrim) {
                    state.history = state.history.slice(state.history.length - 140);
                }

                // 2) Advance to next Replay candle (`open === completed.close`)
                state.stepIndex += 1;
                const nextTs = completed.timestamp + STEP_MS;
                const nextTarget = buildTargetReplayBar(completed.close, state.stepIndex, nextTs);
                const nextLive: KLineData = {
                    timestamp: nextTs,
                    open: completed.close,
                    high: completed.close,
                    low: completed.close,
                    close: completed.close,
                    volume: 45,
                };

                state.activeTarget = nextTarget;
                state.liveBar = nextLive;
                state.barElapsed = state.barElapsed % BAR_DURATION_SEC;

                if (needsTrim) {
                    activeChart.applyNewData([...state.history, nextLive], false);
                    activeChart.scrollToRealTime(0);
                } else {
                    activeChart.updateData(nextLive);
                }
            } else {
                // Intra-bar live tick oscillation on the forming Replay candle
                const progress = state.barElapsed / BAR_DURATION_SEC;
                const livePrice = sampleIntraBarTickPrice(state.activeTarget, progress, totalElapsed);

                state.liveBar = {
                    timestamp: state.activeTarget.timestamp,
                    open: state.activeTarget.open,
                    high: Math.max(state.liveBar.high, livePrice),
                    low: Math.min(state.liveBar.low, livePrice),
                    close: livePrice,
                    volume: Math.round(45 + (state.activeTarget.volume ?? 0) * progress),
                };

                activeChart.updateData(state.liveBar);
            }

            rafId = window.requestAnimationFrame(tick);
        };

        rafId = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(rafId);
    }, [reducedMotion, inView]);

    const edgeMask =
        'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.85) 9%, #000 18%, #000 88%, transparent 100%)';

    return (
        <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-[10%] top-[14%] z-[7] opacity-[0.28] sm:opacity-[0.32]"
            style={{
                maskImage: edgeMask,
                WebkitMaskImage: edgeMask,
            }}
        >
            <div ref={chartContainerRef} className="pointer-events-none h-full w-full" />
        </div>
    );
};

/* ============================================================================
   GLSL SHADERS — Ultra-Discreet Dark Obsidian Globe & Subtle Sapphire Rim
   ============================================================================ */

const earthSurfaceVertexShader = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;

    void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

const earthSurfaceFragmentShader = /* glsl */ `
    uniform sampler2D uDayMap;
    uniform sampler2D uNightMap;
    uniform sampler2D uCloudsMap;
    uniform sampler2D uSpecularMap;
    uniform sampler2D uNormalMap;
    uniform vec3 uSunDirection;
    uniform float uCloudUvShift;

    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;

    void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        vec3 baseNormal = normalize(vWorldNormal);

        vec3 normalTex = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
        vec3 perturbedNormal = normalize(baseNormal + normalTex * 0.04);

        float sunOrientation = dot(perturbedNormal, uSunDirection);
        float polarMask = smoothstep(0.76, 0.92, vUv.y) + (1.0 - smoothstep(0.08, 0.24, vUv.y));

        vec3 rawDay = texture2D(uDayMap, vUv).rgb;
        float specularMask = texture2D(uSpecularMap, vUv).r;

        vec2 cloudUv = vec2(fract(vUv.x + uCloudUvShift), vUv.y);
        float cloudCover = texture2D(uCloudsMap, cloudUv).r * (1.0 - polarMask * 0.80);

        vec3 oceanShadow = vec3(0.004, 0.009, 0.022);
        vec3 landShadow = rawDay * vec3(0.014, 0.024, 0.048) + vec3(0.005, 0.011, 0.026);
        vec3 baseDark = mix(landShadow, oceanShadow, specularMask * 0.88);

        float rimDayFactor = smoothstep(0.12, 0.55, sunOrientation);
        vec3 subtleRimDay = mix(landShadow, vec3(0.02, 0.07, 0.18), 0.65) * (1.0 + rimDayFactor);

        vec3 nightTex = texture2D(uNightMap, vUv).rgb;
        float nightLum = dot(nightTex, vec3(0.299, 0.587, 0.114));
        float cityClusters = smoothstep(0.30, 0.88, nightLum) * (1.0 - polarMask);
        float nightSideMask = 1.0 - smoothstep(-0.08, 0.16, sunOrientation);
        vec3 cityColor = vec3(0.95, 0.76, 0.44) * cityClusters * 0.28 * nightSideMask * (1.0 - cloudCover * 0.65);

        vec3 color = mix(baseDark, subtleRimDay, rimDayFactor * 0.55) + cityColor;

        float viewCos = clamp(dot(viewDir, baseNormal), 0.0, 1.0);
        float thinRim = pow(1.0 - viewCos, 10.5);
        float rimSun = smoothstep(-0.45, 0.55, dot(baseNormal, uSunDirection));
        vec3 rimTint = mix(vec3(0.04, 0.16, 0.48), vec3(0.18, 0.48, 0.95), rimSun);
        color += rimTint * thinRim * 0.52;

        float verticalFade = smoothstep(-2.45, -1.55, vWorldPosition.y);
        color *= mix(0.25, 1.0, verticalFade);

        gl_FragColor = vec4(color, 1.0);
    }
`;

const earthCloudsVertexShader = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;

    void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

const earthCloudsFragmentShader = /* glsl */ `
    uniform sampler2D uCloudsMap;
    uniform vec3 uSunDirection;

    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;

    void main() {
        vec3 normal = normalize(vWorldNormal);
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);

        float polarMask = smoothstep(0.76, 0.92, vUv.y) + (1.0 - smoothstep(0.08, 0.24, vUv.y));
        float rawCloud = texture2D(uCloudsMap, vUv).r * (1.0 - polarMask * 0.85);
        float cloudShape = smoothstep(0.22, 0.85, rawCloud);

        float viewCos = clamp(dot(viewDir, normal), 0.0, 1.0);
        float horizonProximity = pow(1.0 - viewCos, 5.0);
        float sunOrientation = smoothstep(-0.15, 0.45, dot(normal, uSunDirection));

        vec3 cloudColor = mix(vec3(0.03, 0.09, 0.22), vec3(0.22, 0.50, 0.92), horizonProximity * sunOrientation);
        float alpha = cloudShape * (0.025 + 0.13 * horizonProximity);

        gl_FragColor = vec4(cloudColor, alpha);
    }
`;

const atmosphereVertexShader = /* glsl */ `
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;

    void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

const atmosphereFragmentShader = /* glsl */ `
    uniform vec3 uSunDirection;

    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;

    void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        vec3 normal = normalize(vWorldNormal);

        float viewDot = clamp(dot(viewDir, -normal), 0.0, 1.0);
        float limbProgress = clamp(viewDot / 0.265, 0.0, 1.0);
        float intensity = pow(limbProgress, 3.2);

        float sunAmount = smoothstep(-0.45, 0.55, dot(normal, uSunDirection));

        vec3 midnightBlue = vec3(0.03, 0.12, 0.42);
        vec3 horizonSapphire = vec3(0.14, 0.40, 0.88);
        vec3 glowColor = mix(midnightBlue, horizonSapphire, sunAmount);

        vec3 finalGlow = glowColor * intensity * (0.28 + 0.34 * sunAmount);
        gl_FragColor = vec4(finalGlow, 1.0);
    }
`;

const solarCoronaVertexShader = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const solarCoronaFragmentShader = /* glsl */ `
    varying vec2 vUv;

    void main() {
        vec2 centered = (vUv - vec2(0.5, 0.5)) * vec2(1.0, 2.8);
        float dist = length(centered);

        float bloom = exp(-dist * dist * 5.2);
        float edgeMask = smoothstep(0.5, 0.16, length(vUv - vec2(0.5)));

        vec3 finalRgb = vec3(0.05, 0.18, 0.52) * (bloom * 0.22) * edgeMask;
        gl_FragColor = vec4(finalRgb, 1.0);
    }
`;

/* ============================================================================
   3D ORBITAL SCENE (React Three Fiber)
   ============================================================================ */

const OrbitalEarthScene: React.FC<{
    textures: LoadedEarthTextures;
    reducedMotion: boolean;
    isMobile: boolean;
}> = ({ textures, reducedMotion, isMobile }) => {
    const { camera, size } = useThree();
    const earthMeshRef = useRef<THREE.Mesh>(null);
    const cloudsMeshRef = useRef<THREE.Mesh>(null);
    const starsGroupRef = useRef<THREE.Group>(null);

    const segments = isMobile ? 64 : 112;
    const aspect = size.width / Math.max(size.height, 1);

    const planetScale = aspect < 1 ? Math.max(0.72, aspect * 0.90) : 1;
    const planetY = aspect < 1 ? -10.75 * planetScale - 0.35 : -10.92;

    useEffect(() => {
        camera.position.set(0, 0.35, 5.6);
        camera.lookAt(0, -0.55, 0);
        camera.updateProjectionMatrix();
    }, [camera, size.width, size.height]);

    const surfaceUniforms = useMemo(
        () => ({
            uDayMap: { value: textures.day },
            uNightMap: { value: textures.night },
            uCloudsMap: { value: textures.clouds },
            uSpecularMap: { value: textures.specular },
            uNormalMap: { value: textures.normal },
            uSunDirection: { value: SUN_DIRECTION },
            uCloudUvShift: { value: 0 },
        }),
        [textures]
    );

    const cloudUniforms = useMemo(
        () => ({
            uCloudsMap: { value: textures.clouds },
            uSunDirection: { value: SUN_DIRECTION },
        }),
        [textures]
    );

    const atmosphereUniforms = useMemo(
        () => ({
            uSunDirection: { value: SUN_DIRECTION },
        }),
        []
    );

    useFrame((_, delta) => {
        if (reducedMotion) return;
        const clampedDelta = Math.min(delta, 0.05);

        const earthSpeed = 0.0065;
        const cloudSpeed = 0.0105;

        if (earthMeshRef.current) {
            earthMeshRef.current.rotation.y += clampedDelta * earthSpeed;
        }
        if (cloudsMeshRef.current) {
            cloudsMeshRef.current.rotation.y += clampedDelta * cloudSpeed;
        }
        if (earthMeshRef.current && cloudsMeshRef.current) {
            const deltaAngle = cloudsMeshRef.current.rotation.y - earthMeshRef.current.rotation.y;
            surfaceUniforms.uCloudUvShift.value = -deltaAngle / (Math.PI * 2);
        }
        if (starsGroupRef.current) {
            starsGroupRef.current.rotation.y += clampedDelta * 0.0012;
        }
    });

    return (
        <>
            <group ref={starsGroupRef}>
                <Stars
                    radius={105}
                    depth={50}
                    count={isMobile ? 420 : 850}
                    factor={1.65}
                    saturation={0.08}
                    fade
                    speed={reducedMotion ? 0 : 0.16}
                />
            </group>

            <mesh position={[0, -1.72, -1.6]} renderOrder={0}>
                <planeGeometry args={[14.0 * planetScale, 4.2 * planetScale]} />
                <shaderMaterial
                    vertexShader={solarCoronaVertexShader}
                    fragmentShader={solarCoronaFragmentShader}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </mesh>

            <group
                position={[0, planetY, 0]}
                scale={planetScale}
                rotation={[1.12, 0, -0.05]}
            >
                <mesh ref={earthMeshRef} rotation={[0, -1.68, 0]} renderOrder={1}>
                    <sphereGeometry args={[EARTH_RADIUS, segments, segments]} />
                    <shaderMaterial
                        vertexShader={earthSurfaceVertexShader}
                        fragmentShader={earthSurfaceFragmentShader}
                        uniforms={surfaceUniforms}
                    />
                </mesh>

                <mesh ref={cloudsMeshRef} rotation={[0, -1.68, 0]} renderOrder={2}>
                    <sphereGeometry args={[EARTH_RADIUS * 1.0035, segments, segments]} />
                    <shaderMaterial
                        vertexShader={earthCloudsVertexShader}
                        fragmentShader={earthCloudsFragmentShader}
                        uniforms={cloudUniforms}
                        transparent
                        depthWrite={false}
                    />
                </mesh>

                <mesh renderOrder={3}>
                    <sphereGeometry args={[EARTH_RADIUS * ATMOSPHERE_SCALE, segments, segments]} />
                    <shaderMaterial
                        vertexShader={atmosphereVertexShader}
                        fragmentShader={atmosphereFragmentShader}
                        uniforms={atmosphereUniforms}
                        side={THREE.BackSide}
                        transparent
                        depthTest
                        depthWrite={false}
                        blending={THREE.AdditiveBlending}
                    />
                </mesh>
            </group>
        </>
    );
};

/* ============================================================================
   STATIC FALLBACK
   ============================================================================ */

const StaticEarthHorizonFallback: React.FC<{ hidden?: boolean }> = ({ hidden = false }) => (
    <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 overflow-hidden bg-[#02040A] transition-opacity duration-700 ${
            hidden ? 'opacity-0' : 'opacity-100'
        }`}
    >
        <div
            className="absolute inset-0"
            style={{
                background:
                    'radial-gradient(ellipse 85% 42% at 50% 90%, rgba(29, 78, 216, 0.16) 0%, rgba(5, 12, 28, 0.38) 48%, #02040A 78%)',
            }}
        />
        <div
            className="absolute left-1/2 top-[76%] h-[130vw] w-[180vw] -translate-x-1/2 rounded-[50%]"
            style={{
                background: 'radial-gradient(circle at 50% 12%, #050E21 0%, #02050E 42%, #010206 76%)',
                boxShadow:
                    '0 -1px 12px rgba(96, 165, 250, 0.36), 0 -10px 48px rgba(37, 99, 235, 0.26), inset 0 3px 16px rgba(59, 130, 246, 0.20)',
            }}
        />
    </div>
);

/* ============================================================================
   PUBLIC REUSABLE COMPONENT — EarthHorizonBackground
   ============================================================================ */

export const EarthHorizonBackground: React.FC<EarthHorizonBackgroundProps> = ({ className = '' }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [webglSupported, setWebglSupported] = useState<boolean>(true);
    const [reducedMotion, setReducedMotion] = useState<boolean>(false);
    const [isMobile, setIsMobile] = useState<boolean>(false);
    const [inView, setInView] = useState<boolean>(true);
    const [textures, setTextures] = useState<LoadedEarthTextures | null>(null);

    useEffect(() => {
        setWebglSupported(canRunHardwareWebGL());

        const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const mqMobile = window.matchMedia('(max-width: 767px)');
        setReducedMotion(mqMotion.matches);
        setIsMobile(mqMobile.matches);

        const onMotionChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
        const onMobileChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        mqMotion.addEventListener('change', onMotionChange);
        mqMobile.addEventListener('change', onMobileChange);

        return () => {
            mqMotion.removeEventListener('change', onMotionChange);
            mqMobile.removeEventListener('change', onMobileChange);
        };
    }, []);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || typeof IntersectionObserver === 'undefined') return;

        const observer = new IntersectionObserver(
            ([entry]) => setInView(entry.isIntersecting),
            { threshold: 0.01 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!webglSupported) return;
        let cancelled = false;
        const loader = new THREE.TextureLoader();

        const loadTex = (url: string) =>
            new Promise<THREE.Texture>((resolve, reject) => {
                loader.load(url, resolve, undefined, reject);
            });

        let loadedList: THREE.Texture[] = [];

        Promise.all([
            loadTex(TEXTURE_PATHS.day),
            loadTex(TEXTURE_PATHS.night),
            loadTex(TEXTURE_PATHS.clouds),
            loadTex(TEXTURE_PATHS.specular),
            loadTex(TEXTURE_PATHS.normal),
        ])
            .then(([day, night, clouds, specular, normal]) => {
                if (cancelled) {
                    [day, night, clouds, specular, normal].forEach((t) => t.dispose());
                    return;
                }
                loadedList = [day, night, clouds, specular, normal];
                loadedList.forEach((tex) => {
                    tex.wrapS = THREE.RepeatWrapping;
                    tex.wrapT = THREE.ClampToEdgeWrapping;
                    tex.minFilter = THREE.LinearMipmapLinearFilter;
                    tex.magFilter = THREE.LinearFilter;
                    tex.anisotropy = 4;
                    tex.needsUpdate = true;
                });

                setTextures({ day, night, clouds, specular, normal });
            })
            .catch(() => {
                if (!cancelled) {
                    setWebglSupported(false);
                }
            });

        return () => {
            cancelled = true;
            loadedList.forEach((t) => t.dispose());
        };
    }, [webglSupported]);

    const ready = webglSupported && textures !== null;

    return (
        <div
            ref={containerRef}
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 z-0 select-none overflow-hidden bg-[#02040A] ${className}`}
        >
            <StaticEarthHorizonFallback hidden={ready} />

            {ready && textures && (
                <div className="pointer-events-none absolute inset-0 z-[5]">
                    <Canvas
                        dpr={isMobile ? [1, 1.35] : [1, 1.85]}
                        frameloop={inView && !reducedMotion ? 'always' : 'demand'}
                        camera={{ fov: 36, near: 0.1, far: 260, position: [0, 0.35, 5.6] }}
                        gl={{
                            antialias: true,
                            alpha: true,
                            powerPreference: 'high-performance',
                            stencil: false,
                            toneMapping: THREE.NoToneMapping,
                        }}
                        style={{ pointerEvents: 'none' }}
                    >
                        <OrbitalEarthScene
                            textures={textures}
                            reducedMotion={reducedMotion}
                            isMobile={isMobile}
                        />
                    </Canvas>
                </div>
            )}

            {/* Authentic Backtesting Replay Candlesticks (`klinecharts` engine) */}
            <BacktestReplayCandleLayer reducedMotion={reducedMotion} inView={inView} />

            {/* Soft central readability halo behind headline & subheadline */}
            <div
                className="pointer-events-none absolute inset-0 z-[8]"
                style={{
                    background:
                        'radial-gradient(ellipse 50% 36% at 50% 42%, rgba(2, 4, 10, 0.52) 0%, rgba(2, 4, 10, 0.16) 65%, rgba(2, 4, 10, 0) 100%)',
                }}
            />

            {/* Top navbar readability gradient */}
            <div
                className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32"
                style={{
                    background: 'linear-gradient(180deg, rgba(2, 4, 10, 0.90) 0%, rgba(2, 4, 10, 0) 100%)',
                }}
            />

            {/* Bottom obsidian blend */}
            <div
                className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-28"
                style={{
                    background: 'linear-gradient(0deg, #02040A 0%, rgba(2, 4, 10, 0.55) 45%, rgba(2, 4, 10, 0) 100%)',
                }}
            />
        </div>
    );
};

export default EarthHorizonBackground;
