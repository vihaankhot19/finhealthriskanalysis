/**
 * app.js — Main Entry Point
 * Wires simulation, statistics, and chart rendering together.
 */

// All functions loaded from src/ scripts below

// ─── State ────────────────────────────────────────────────────────────────────
let lastResults = null;
let activeScenario = 'minimum';
let activeTab = 'dashboard';
let isRunning = false;

// ─── DOM Helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function setText(id, val) { const el = $(id); if (el) el.textContent = val; }
function setProgress(id, pct) {
    const el = $(id);
    if (!el) return;
    el.style.setProperty('--pct', `${Math.min(100, Math.max(0, pct * 100))}%`);
    el.setAttribute('data-value', `${(pct * 100).toFixed(1)}%`);
}

function fmtMoney(n, decimals = 0) {
    if (!isFinite(n)) return '$0';
    const absN = Math.abs(n);
    if (absN >= 1e6) return `${n < 0 ? '-' : ''}$${(absN / 1e6).toFixed(2)}M`;
    if (absN >= 1e3) return `${n < 0 ? '-' : ''}$${(absN / 1e3).toFixed(1)}K`;
    return `${n < 0 ? '-' : ''}$${absN.toFixed(decimals)}`;
}

function fmtPct(p, dec = 1) { return `${(p * 100).toFixed(dec)}%`; }

function fmtMonths(m) {
    if (m === null || m === undefined) return 'N/A';
    const yr = Math.floor(m / 12);
    const mo = m % 12;
    return yr > 0 ? `${yr}y ${mo}m` : `${mo}m`;
}

// ─── Read Input Form ──────────────────────────────────────────────────────────
function readParams() {
    const v = id => parseFloat($(id)?.value) || 0;
    return {
        monthlyIncome: v('income'),
        incomeStd: v('income') * (v('incomeVolatility') / 100),
        monthlyFixedExpenses: v('fixedExpenses'),
        monthlyVariableExpenses: v('varExpenses'),
        expenseStd: v('varExpenses') * 0.25,
        initialSavings: v('initialSavings'),
        initialInvestments: v('initialInvestments'),
        totalDebt: v('totalDebt'),
        debtAPR: v('debtAPR'),
        minimumDebtPayment: v('minDebtPayment'),
        savingsReturnRate: v('returnRate'),
        inflationRate: v('inflationRate'),
        horizonYears: v('horizonYears'),
        savingsGoal: v('savingsGoal'),
    };
}

// ─── Run Analysis ─────────────────────────────────────────────────────────────
async function runAnalysis() {
    if (isRunning) return;
    isRunning = true;

    const btn = $('runBtn');
    btn.classList.add('loading');
    btn.textContent = 'Running…';

    // Yield to paint
    await new Promise(r => setTimeout(r, 30));

    try {
        const params = readParams();
        const runs = 5000;
        const results = runMonteCarlo(params, runs);
        lastResults = results;

        updateDashboard(results, params);
        updateSimulationTab(results, params);
        updateScenariosTab(results, params);
        updateAnalyticsTab(results, params);
    } catch (err) {
        console.error('Simulation error:', err);
    }

    btn.classList.remove('loading');
    btn.innerHTML = '<span class="btn-icon">▶</span> Run Analysis';
    isRunning = false;
}

// ─── Dashboard Tab ────────────────────────────────────────────────────────────
function updateDashboard(results, params) {
    const sc = results[activeScenario];
    const nw = sc.endingNetWorths;
    const sorted = [...nw].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const p95 = percentile(sorted, 95, true);
    const p5 = percentile(sorted, 5, true);

    setText('dash-median-nw', fmtMoney(med));
    setText('dash-p95-nw', fmtMoney(p95));
    setText('dash-p5-nw', fmtMoney(p5));
    setText('dash-ruin', fmtPct(sc.ruinProbability));
    setText('dash-goal', fmtPct(sc.goalProbability));
    setText('dash-debtfree', fmtMonths(sc.medianDebtFreeMonth));
    setText('dash-var95', fmtMoney(valueAtRisk(nw, 0.95)));
    setText('dash-scenario-label', activeScenario === 'minimum' ? 'Minimum Payment'
        : activeScenario === 'aggressive' ? 'Aggressive Payoff' : 'Invest Surplus');

    setProgress('ruin-bar', sc.ruinProbability);
    setProgress('goal-bar', sc.goalProbability);
    setProgress('debt-bar', sc.debtFreeProbability ?? 0);

    // Monthly cash flow derived stat
    const surplus = params.monthlyIncome
        - params.monthlyFixedExpenses
        - params.monthlyVariableExpenses
        - params.minimumDebtPayment;
    setText('dash-surplus', fmtMoney(surplus));
    const surplusEl = $('dash-surplus');
    if (surplusEl) surplusEl.className = `stat-value ${surplus < 0 ? 'negative' : 'positive'}`;

    // Debt-to-income ratio
    const dti = params.monthlyIncome > 0
        ? ((params.minimumDebtPayment / params.monthlyIncome) * 100).toFixed(1)
        : 0;
    setText('dash-dti', `${dti}%`);

    // Mini histogram on dashboard
    renderHistogram('dashHistogram', nw);

    // Quick Stats panel (unique IDs)
    setText('qs-debtfree', fmtMonths(sc.medianDebtFreeMonth));
    setText('qs-var95', fmtMoney(valueAtRisk(nw, 0.95)));
    setText('qs-surplus', fmtMoney(surplus));
    setText('qs-scenario', activeScenario === 'minimum' ? 'Minimum Payment'
        : activeScenario === 'aggressive' ? 'Aggressive Payoff' : 'Invest Surplus');
}

// ─── Simulation Tab ───────────────────────────────────────────────────────────
function updateSimulationTab(results, params) {
    const sc = results[activeScenario];
    const bands = buildConfidenceBands(sc.sampledTrajectories);
    renderConfidenceBand('confBandChart', bands, params.horizonYears, activeScenario);

    // Descriptive stats table
    const stats = descriptiveStats(sc.endingNetWorths);
    if (stats) {
        setText('sim-mean', fmtMoney(stats.mean));
        setText('sim-median', fmtMoney(stats.median));
        setText('sim-std', fmtMoney(stats.stdDev));
        setText('sim-skew', stats.skewness.toFixed(3));
        setText('sim-kurt', stats.kurtosis.toFixed(3));
        setText('sim-min', fmtMoney(stats.min));
        setText('sim-max', fmtMoney(stats.max));
        setText('sim-p5', fmtMoney(stats.p5));
        setText('sim-p95', fmtMoney(stats.p95));
        setText('sim-runs', stats.n.toLocaleString());
    }
}

// ─── Scenarios Tab ────────────────────────────────────────────────────────────
function updateScenariosTab(results, params) {
    renderScenarioBar('scenarioBarChart', results);

    const scenarios = ['minimum', 'aggressive', 'investing'];
    const labels = { minimum: 'Min Payment', aggressive: 'Aggressive', investing: 'Investing' };

    scenarios.forEach(sc => {
        const r = results[sc];
        const sorted = [...r.endingNetWorths].sort((a, b) => a - b);
        const med = sorted[Math.floor(sorted.length / 2)];
        setText(`sc-${sc}-median`, fmtMoney(med));
        setText(`sc-${sc}-ruin`, fmtPct(r.ruinProbability));
        setText(`sc-${sc}-goal`, fmtPct(r.goalProbability));
        setText(`sc-${sc}-debt`, fmtMonths(r.medianDebtFreeMonth));
    });
}

// ─── Analytics Tab ────────────────────────────────────────────────────────────
function updateAnalyticsTab(results, params) {
    const sc = results[activeScenario];
    const nw = sc.endingNetWorths;

    // VaR chart
    const var95 = valueAtRisk(nw, 0.95);
    const var99 = valueAtRisk(nw, 0.99);
    const cvar = expectedShortfall(nw, 0.95);
    renderVaRChart('varChart', nw, var95, var99);

    setText('analytics-var95', fmtMoney(var95));
    setText('analytics-var99', fmtMoney(var99));
    setText('analytics-cvar95', fmtMoney(cvar));

    // Regression: net worth vs horizon (use median trajectory)
    const traj = sc.sampledTrajectories;
    if (traj && traj.length > 0) {
        const months = traj[0].length;
        const x = Array.from({ length: months }, (_, i) => i);
        const medianNW = x.map(m => {
            const vals = traj.map(t => t[m]?.netWorth ?? 0).sort((a, b) => a - b);
            return vals[Math.floor(vals.length / 2)];
        });
        const reg = simpleLinearRegression(x, medianNW);
        setText('reg-slope', `${fmtMoney(reg.slope)}/mo`);
        setText('reg-r2', reg.rSquared.toFixed(4));
        setText('reg-intercept', fmtMoney(reg.intercept));
    }

    // Correlation matrix: income, fixedExp, varExp, debt, savings
    // Use per-run ending values across sampled trajectories
    if (traj && traj.length > 4) {
        const finalNW = traj.map(t => t[t.length - 1]?.netWorth ?? 0);
        const finalCash = traj.map(t => t[t.length - 1]?.cash ?? 0);
        const finalSav = traj.map(t => t[t.length - 1]?.savings ?? 0);
        const finalDebt = traj.map(t => t[t.length - 1]?.debt ?? 0);

        const { labels, matrix } = buildCorrelationMatrix({
            'Net Worth': finalNW,
            'Cash': finalCash,
            'Savings': finalSav,
            'Debt': finalDebt,
        });
        renderCorrelationHeatmap('correlationHeatmap', matrix, labels);
    }
}

// ─── Tab Switching ────────────────────────────────────────────────────────────
function switchTab(tab) {
    activeTab = tab;
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));

    // Re-render relevant chart when switching
    if (lastResults) {
        const p = readParams();
        if (tab === 'dashboard') updateDashboard(lastResults, p);
        if (tab === 'simulation') updateSimulationTab(lastResults, p);
        if (tab === 'scenarios') updateScenariosTab(lastResults, p);
        if (tab === 'analytics') updateAnalyticsTab(lastResults, p);
    }
}

// ─── Scenario Switcher ────────────────────────────────────────────────────────
function switchScenario(sc) {
    activeScenario = sc;
    $$('.sc-btn').forEach(b => b.classList.toggle('active', b.dataset.scenario === sc));
    if (lastResults) {
        const p = readParams();
        updateDashboard(lastResults, p);
        updateSimulationTab(lastResults, p);
        updateAnalyticsTab(lastResults, p);
    }
}

// ─── Slider Labels ────────────────────────────────────────────────────────────
function bindSlider(sliderId, labelId, fmt) {
    const slider = $(sliderId);
    const label = $(labelId);
    if (!slider || !label) return;
    const update = () => { label.textContent = fmt(parseFloat(slider.value)); };
    slider.addEventListener('input', update);
    update();
}

// ─── Sample Data Pre-fill ─────────────────────────────────────────────────────
function loadSampleData() {
    const fields = {
        income: 7500,
        incomeVolatility: 8,
        fixedExpenses: 2800,
        varExpenses: 1500,
        initialSavings: 12000,
        initialInvestments: 25000,
        totalDebt: 38000,
        debtAPR: 6.5,
        minDebtPayment: 750,
        returnRate: 7,
        inflationRate: 3,
        horizonYears: 15,
        savingsGoal: 500000,
    };
    for (const [id, val] of Object.entries(fields)) {
        const el = $(id);
        if (el) {
            el.value = val;
            el.dispatchEvent(new Event('input'));
        }
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
    // Tab buttons
    $$('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Scenario buttons
    $$('.sc-btn').forEach(btn => {
        btn.addEventListener('click', () => switchScenario(btn.dataset.scenario));
    });

    // Run button
    $('runBtn')?.addEventListener('click', runAnalysis);

    // Sample data button
    $('sampleBtn')?.addEventListener('click', () => {
        loadSampleData();
        runAnalysis();
    });

    // Slider bindings
    bindSlider('horizonYears', 'horizonLabel', v => `${v} years`);
    bindSlider('incomeVolatility', 'volLabel', v => `±${v}%`);
    bindSlider('inflationRate', 'inflationLabel', v => `${v}%`);
    bindSlider('returnRate', 'returnLabel', v => `${v}%`);

    // Auto-load sample and run on start
    loadSampleData();
    runAnalysis();
}

document.addEventListener('DOMContentLoaded', init);
