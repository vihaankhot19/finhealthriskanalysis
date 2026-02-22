/**
 * charts.js — Chart.js Wrappers for all visualizations
 *
 * Renders:
 *   1. Histogram of ending net-worth distribution
 *   2. Confidence-band time series (p5 / p50 / p95)
 *   3. Scenario comparison bar chart
 *   4. Correlation heatmap (custom canvas)
 *   5. VaR / CVaR visualization
 */

"use strict";

// Track chart instances so we can destroy before re-render
const _chartInstances = {};

function destroyChart(id) {
    if (_chartInstances[id]) {
        _chartInstances[id].destroy();
        delete _chartInstances[id];
    }
}

// ─── Color Palette ────────────────────────────────────────────────────────────
const COLORS = {
    violet: 'hsl(260, 80%, 65%)',
    violetA: 'hsla(260, 80%, 65%, 0.25)',
    cyan: 'hsl(185, 85%, 55%)',
    cyanA: 'hsla(185, 85%, 55%, 0.25)',
    emerald: 'hsl(155, 65%, 50%)',
    emeraldA: 'hsla(155, 65%, 50%, 0.20)',
    rose: 'hsl(350, 80%, 60%)',
    roseA: 'hsla(350, 80%, 60%, 0.20)',
    amber: 'hsl(38, 90%, 58%)',
    amberA: 'hsla(38, 90%, 58%, 0.20)',
    grid: 'rgba(255,255,255,0.06)',
    text: 'rgba(255,255,255,0.55)',
};

const SCENARIO_COLORS = {
    minimum: { border: COLORS.rose, bg: COLORS.roseA },
    aggressive: { border: COLORS.emerald, bg: COLORS.emeraldA },
    investing: { border: COLORS.violet, bg: COLORS.violetA },
};

const SCENARIO_LABELS = {
    minimum: 'Minimum Payment',
    aggressive: 'Aggressive Payoff',
    investing: 'Invest Surplus',
};

// ─── Shared Chart Defaults ────────────────────────────────────────────────────
const BASE_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600, easing: 'easeOutQuart' },
    plugins: {
        legend: {
            labels: { color: COLORS.text, font: { family: 'Inter', size: 12 }, padding: 16 },
        },
        tooltip: {
            backgroundColor: 'rgba(13,15,22,0.92)',
            titleColor: '#fff',
            bodyColor: COLORS.text,
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
        },
    },
    scales: {
        x: {
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.text, font: { family: 'Inter', size: 11 } },
        },
        y: {
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.text, font: { family: 'Inter', size: 11 } },
        },
    },
};

function deepMerge(target, source) {
    const out = Object.assign({}, target);
    for (const k of Object.keys(source)) {
        if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
            out[k] = deepMerge(target[k] || {}, source[k]);
        } else {
            out[k] = source[k];
        }
    }
    return out;
}

function fmtMoney(n) {
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
}

// ─── 1. Histogram ─────────────────────────────────────────────────────────────
function renderHistogram(canvasId, endingNetWorths, title = 'Ending Net Worth Distribution') {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx || !endingNetWorths.length) return;

    const sorted = [...endingNetWorths].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const bins = 35;
    const step = (max - min) / bins || 1;

    const labels = [];
    const counts = new Array(bins).fill(0);
    const bColors = [];

    for (let i = 0; i < bins; i++) {
        const lo = min + i * step;
        const hi = lo + step;
        labels.push(fmtMoney((lo + hi) / 2));
        bColors.push(lo + step / 2 >= 0 ? COLORS.emerald : COLORS.rose);
    }

    for (const v of sorted) {
        const bi = Math.min(bins - 1, Math.floor((v - min) / step));
        counts[bi]++;
    }

    const opts = deepMerge(BASE_OPTIONS, {
        plugins: {
            legend: { display: false },
            title: {
                display: !!title, text: title,
                color: '#fff', font: { family: 'Inter', size: 14, weight: '600' }, padding: { bottom: 16 },
            },
            tooltip: {
                callbacks: {
                    label: ctx => `Count: ${ctx.raw}  (${((ctx.raw / sorted.length) * 100).toFixed(1)}%)`,
                    title: ctx => `~${ctx[0].label}`,
                },
            },
        },
        scales: {
            x: { ...BASE_OPTIONS.scales.x, title: { display: true, text: 'Net Worth', color: COLORS.text } },
            y: { ...BASE_OPTIONS.scales.y, title: { display: true, text: 'Frequency', color: COLORS.text } },
        },
    });

    _chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: counts,
                backgroundColor: bColors,
                borderColor: bColors.map(c => c.replace('hsl', 'hsla').replace(')', ', 0.9)')),
                borderWidth: 1,
                borderRadius: 3,
            }],
        },
        options: opts,
    });
}

// ─── 2. Confidence Band Time Series ──────────────────────────────────────────
function renderConfidenceBand(canvasId, bands, horizonYears, scenario) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    const { p5, p50, p95 } = bands;
    const months = p50.length;
    const labels = Array.from({ length: months }, (_, i) => {
        const yr = i / 12;
        return i % 12 === 0 ? `Yr ${Math.round(yr)}` : '';
    });

    const sc = SCENARIO_COLORS[scenario] || SCENARIO_COLORS.minimum;

    const opts = deepMerge(BASE_OPTIONS, {
        plugins: {
            legend: { display: true },
            title: {
                display: true, text: `Net Worth Projection — ${SCENARIO_LABELS[scenario]}`,
                color: '#fff', font: { family: 'Inter', size: 14, weight: '600' }, padding: { bottom: 16 },
            },
            tooltip: {
                callbacks: {
                    label: item => `${item.dataset.label}: ${fmtMoney(item.raw)}`,
                },
            },
        },
        scales: {
            x: { ...BASE_OPTIONS.scales.x, title: { display: true, text: 'Time', color: COLORS.text } },
            y: {
                ...BASE_OPTIONS.scales.y, title: { display: true, text: 'Net Worth ($)', color: COLORS.text },
                ticks: { ...BASE_OPTIONS.scales.y.ticks, callback: v => fmtMoney(v) }
            },
        },
    });

    _chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '95th Percentile',
                    data: p95,
                    borderColor: sc.border,
                    backgroundColor: sc.bg,
                    borderWidth: 1.5,
                    borderDash: [4, 3],
                    pointRadius: 0,
                    fill: '+1',
                    tension: 0.3,
                },
                {
                    label: 'Median (50th)',
                    data: p50,
                    borderColor: sc.border,
                    backgroundColor: 'transparent',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.3,
                },
                {
                    label: '5th Percentile',
                    data: p5,
                    borderColor: sc.border,
                    backgroundColor: sc.bg,
                    borderWidth: 1.5,
                    borderDash: [4, 3],
                    pointRadius: 0,
                    fill: '-1',
                    tension: 0.3,
                },
            ],
        },
        options: opts,
    });
}

// ─── 3. Scenario Comparison Bar ───────────────────────────────────────────────
function renderScenarioBar(canvasId, scenarioResults) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    const scenarios = Object.keys(scenarioResults);
    const medianNW = scenarios.map(s => {
        const arr = scenarioResults[s].endingNetWorths;
        return arr[Math.floor(arr.length / 2)] || 0;
    });
    const ruinProb = scenarios.map(s => (scenarioResults[s].ruinProbability * 100).toFixed(1));
    const goalProb = scenarios.map(s => (scenarioResults[s].goalProbability * 100).toFixed(1));

    const opts = deepMerge(BASE_OPTIONS, {
        plugins: {
            legend: { display: true },
            title: {
                display: true, text: 'Scenario Comparison',
                color: '#fff', font: { family: 'Inter', size: 14, weight: '600' }, padding: { bottom: 16 },
            },
        },
        scales: {
            x: { ...BASE_OPTIONS.scales.x },
            y: {
                ...BASE_OPTIONS.scales.y,
                title: { display: true, text: 'Median Net Worth ($)', color: COLORS.text },
                ticks: { ...BASE_OPTIONS.scales.y.ticks, callback: v => fmtMoney(v) },
            },
        },
    });

    // Grouped bar — median NW per scenario
    _chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: scenarios.map(s => SCENARIO_LABELS[s]),
            datasets: [
                {
                    label: 'Median Net Worth',
                    data: medianNW,
                    backgroundColor: scenarios.map(s => SCENARIO_COLORS[s].bg),
                    borderColor: scenarios.map(s => SCENARIO_COLORS[s].border),
                    borderWidth: 2,
                    borderRadius: 6,
                },
            ],
        },
        options: opts,
    });

    // Store probability data for the stats panel
    return { medianNW, ruinProb, goalProb, scenarios };
}

// ─── 4. VaR / Distribution Chart ─────────────────────────────────────────────
function renderVaRChart(canvasId, endingNetWorths, var95, var99) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx || !endingNetWorths.length) return;

    const sorted = [...endingNetWorths].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const bins = 30;
    const step = (max - min) / bins || 1;
    const labels = [];
    const counts = new Array(bins).fill(0);
    const bColors = [];

    for (let i = 0; i < bins; i++) {
        const lo = min + i * step;
        const hi = lo + step;
        const mid = (lo + hi) / 2;
        labels.push(fmtMoney(mid));
        // color: dark red (CVaR tail) → red (VaR99) → amber (VaR95) → teal (normal)
        if (mid <= -var99) bColors.push('hsl(350, 90%, 40%)');
        else if (mid <= -var95) bColors.push(COLORS.rose);
        else if (mid < 0) bColors.push(COLORS.amber);
        else bColors.push(COLORS.cyan);
    }

    for (const v of sorted) {
        const bi = Math.min(bins - 1, Math.floor((v - min) / step));
        counts[bi]++;
    }

    _chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Frequency',
                data: counts,
                backgroundColor: bColors,
                borderColor: bColors,
                borderWidth: 1,
                borderRadius: 3,
            }],
        },
        options: deepMerge(BASE_OPTIONS, {
            plugins: {
                legend: { display: false },
                title: {
                    display: true, text: 'Ending Balance Distribution with VaR Cutoffs',
                    color: '#fff', font: { family: 'Inter', size: 14, weight: '600' }, padding: { bottom: 16 },
                },
                annotation: {},
            },
            scales: {
                x: { ...BASE_OPTIONS.scales.x, title: { display: true, text: 'Ending Net Worth', color: COLORS.text } },
                y: { ...BASE_OPTIONS.scales.y, title: { display: true, text: 'Count', color: COLORS.text } },
            },
        }),
    });
}

// ─── 5. Correlation Heatmap (custom canvas) ───────────────────────────────────
function renderCorrelationHeatmap(canvasId, matrix, labels) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const n = labels.length;
    const dpr = window.devicePixelRatio || 1;

    const pad = 80;
    const cellW = (canvas.offsetWidth - pad) / n;
    const cellH = cellW;
    canvas.width = (canvas.offsetWidth) * dpr;
    canvas.height = (pad + n * cellH) * dpr;
    canvas.style.height = `${pad + n * cellH}px`;
    ctx.scale(dpr, dpr);

    const w = canvas.offsetWidth;

    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            const val = matrix[r][c];
            const x = pad + c * cellW;
            const y = pad / 2 + r * cellH;

            // color: positive → violet, negative → rose
            const intensity = Math.abs(val);
            const h = val >= 0 ? 260 : 350;
            const s = 70;
            const l = 80 - intensity * 40;
            ctx.fillStyle = `hsl(${h},${s}%,${l}%)`;
            ctx.fillRect(x, y, cellW - 2, cellH - 2);
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.strokeRect(x, y, cellW - 2, cellH - 2);

            ctx.fillStyle = intensity > 0.3 ? '#fff' : 'rgba(255,255,255,0.5)';
            ctx.font = `bold ${Math.max(10, cellW * 0.28)}px Inter`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(val.toFixed(2), x + cellW / 2 - 1, y + cellH / 2);
        }

        // Row labels
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = `12px Inter`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(labels[r], pad - 8, pad / 2 + r * cellH + cellH / 2);
    }

    // Column labels
    for (let c = 0; c < n; c++) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '12px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(labels[c], pad + c * cellW + cellW / 2 - 1, pad / 2 - 6);
    }
}

// ─── 6. Destroy all charts (cleanup) ─────────────────────────────────────────
function destroyAllCharts() {
    for (const id of Object.keys(_chartInstances)) {
        destroyChart(id);
    }
}
