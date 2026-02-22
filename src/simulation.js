/**
 * simulation.js — Monte Carlo Simulation Engine
 *
 * Methodology:
 *  - Each simulation run models monthly household cash flows over a chosen horizon.
 *  - Income is sampled from N(µ_income, σ_income) each month (Box-Muller transform).
 *  - Variable expenses are sampled from N(µ_var, σ_var) with a floor of 0.
 *  - Fixed expenses are deterministic per month.
 *  - Debt accrues interest monthly (APR / 12) and is reduced by the payment amount.
 *  - Savings grow at the specified annual return rate with a small random shock.
 *  - Cash balance = prior cash + net income - net expenses - debt payments.
 *  - If cash goes negative the shortfall is drawn from savings before declaring ruin.
 *
 * Assumptions:
 *  - Income shocks are i.i.d. each month (no autocorrelation).
 *  - Stock/savings returns are log-normally distributed (approximated as normal for small σ).
 *  - Tax effects are not explicitly modelled — inputs are treated as after-tax.
 *  - Inflation is not modelled by default (can be added via the inflationRate param).
 *  - Debt minimum payments are user-defined; aggressive payoff sends all surplus to debt.
 *
 * Limitations:
 *  - Does not model life events (job loss, medical costs) beyond the income σ.
 *  - Returns on savings are time-invariant (no market regime changes).
 *  - Correlations between income shocks and expense shocks are not modelled.
 */

"use strict";

// ─── Box-Muller Normal Sampler ────────────────────────────────────────────────
function randNormal(mean = 0, std = 1) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const n = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + std * n;
}

// ─── Clamp helper ─────────────────────────────────────────────────────────────
function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

/**
 * simulateOnce — run a single trajectory.
 * @param {Object} p  - parameter object (see runMonteCarlo)
 * @param {string} scenario - 'minimum' | 'aggressive' | 'investing'
 * @returns {Object} { months: Array<{cash,savings,debt,netWorth}>, ruined, goalHit, debtFreePeriod }
 */
function simulateOnce(p, scenario) {
    const months = p.horizonYears * 12;
    const monthlyReturn = (p.savingsReturnRate / 100) / 12;
    const monthlyInflation = (p.inflationRate / 100) / 12;

    let cash = p.initialSavings;
    let savings = p.initialInvestments;
    let debt = p.totalDebt;
    let ruined = false;
    let goalHit = false;
    let debtFreePeriod = null;

    const trajectory = [];

    for (let m = 0; m < months; m++) {
        // — income shock —
        const income = Math.max(0, randNormal(p.monthlyIncome, p.incomeStd));

        // — variable expense shock — (floor at 20% of mean)
        const varExp = Math.max(
            p.monthlyVariableExpenses * 0.2,
            randNormal(p.monthlyVariableExpenses, p.expenseStd)
        );

        // — inflation scaling (compounds) —
        const inflScale = Math.pow(1 + monthlyInflation, m);
        const fixedExp = p.monthlyFixedExpenses * inflScale;

        // — debt interest —
        let debtPayment = 0;
        if (debt > 0) {
            const interest = debt * (p.debtAPR / 100 / 12);
            debt += interest;

            if (scenario === 'minimum') {
                debtPayment = Math.min(p.minimumDebtPayment, debt);
            } else if (scenario === 'aggressive') {
                // pay min + 50% of monthly surplus toward debt
                debtPayment = Math.min(debt, p.minimumDebtPayment * 2.5);
            } else {
                // 'investing' — only minimum payments, rest goes to investments
                debtPayment = Math.min(p.minimumDebtPayment, debt);
            }
            debt = Math.max(0, debt - debtPayment);
            if (debt === 0 && debtFreePeriod === null) debtFreePeriod = m;
        }

        // — savings growth —
        const savingsReturn = randNormal(monthlyReturn, Math.abs(monthlyReturn) * 0.4 + 0.005);
        savings = Math.max(0, savings * (1 + savingsReturn));

        // — investing extra in 'investing' scenario —
        let extraInvest = 0;
        if (scenario === 'investing' && debt === 0) {
            extraInvest = income * 0.10; // invest 10% extra
        }

        // — net cash flow —
        const netFlow = income - fixedExp - varExp * inflScale - debtPayment - extraInvest;
        cash += netFlow;

        // — handle negative cash: draw from savings —
        if (cash < 0 && savings > 0) {
            const draw = Math.min(-cash, savings);
            savings -= draw;
            cash += draw;
        }

        // — add extra investing to savings pool —
        savings += extraInvest;

        // — ruin check —
        if (cash < 0 && !ruined) {
            ruined = true;
        }

        // — savings goal check —
        const netWorth = cash + savings - debt;
        if (!goalHit && netWorth >= p.savingsGoal) goalHit = true;

        trajectory.push({
            cash: +cash.toFixed(2),
            savings: +savings.toFixed(2),
            debt: +debt.toFixed(2),
            netWorth: +netWorth.toFixed(2),
        });
    }

    return { trajectory, ruined, goalHit, debtFreePeriod };
}

/**
 * runMonteCarlo — run N simulations and aggregate results.
 *
 * @param {Object} params
 *   - monthlyIncome          {number}  after-tax monthly income
 *   - incomeStd              {number}  monthly income std dev (volatility)
 *   - monthlyFixedExpenses   {number}  deterministic monthly fixed costs
 *   - monthlyVariableExpenses{number}  mean monthly variable spending
 *   - expenseStd             {number}  std dev of variable expenses
 *   - initialSavings         {number}  liquid cash on hand
 *   - initialInvestments     {number}  existing investment/savings balance
 *   - totalDebt              {number}  total outstanding debt
 *   - debtAPR                {number}  weighted average APR (%)
 *   - minimumDebtPayment     {number}  monthly min payment
 *   - savingsReturnRate      {number}  annual investment return rate (%)
 *   - inflationRate          {number}  annual inflation rate (%)
 *   - horizonYears           {number}  simulation horizon in years
 *   - savingsGoal            {number}  net-worth target
 * @param {number} runs  number of Monte Carlo runs (default 5000)
 * @returns {Object}  aggregated results for all three scenarios
 */
function runMonteCarlo(params, runs = 5000) {
    const scenarios = ['minimum', 'aggressive', 'investing'];
    const results = {};

    for (const scenario of scenarios) {
        const endingNetWorths = [];
        const ruinCount = { count: 0 };
        const goalCount = { count: 0 };
        const debtFreeTimes = [];

        // Store sampled trajectories for percentile bands (store 200 for perf)
        const sampledTraj = [];
        const trajSampleRate = Math.max(1, Math.floor(runs / 200));

        for (let i = 0; i < runs; i++) {
            const { trajectory, ruined, goalHit, debtFreePeriod } = simulateOnce(params, scenario);

            const finalNW = trajectory[trajectory.length - 1].netWorth;
            endingNetWorths.push(finalNW);

            if (ruined) ruinCount.count++;
            if (goalHit) goalCount.count++;
            if (debtFreePeriod !== null) debtFreeTimes.push(debtFreePeriod);

            if (i % trajSampleRate === 0) sampledTraj.push(trajectory);
        }

        // Sort for percentiles
        endingNetWorths.sort((a, b) => a - b);

        results[scenario] = {
            endingNetWorths,
            sampledTrajectories: sampledTraj,
            ruinProbability: ruinCount.count / runs,
            goalProbability: goalCount.count / runs,
            medianDebtFreeMonth: debtFreeTimes.length
                ? debtFreeTimes.sort((a, b) => a - b)[Math.floor(debtFreeTimes.length / 2)]
                : null,
            debtFreeProbability: debtFreeTimes.length / runs,
        };
    }

    return results;
}

/**
 * buildConfidenceBands — derive p5, p50, p95 net-worth time series from sampled trajectories.
 * @param {Array} sampledTrajectories  array of trajectory arrays
 * @returns {Object} { p5, p50, p95 } — each is array of monthly values
 */
function buildConfidenceBands(sampledTrajectories) {
    if (!sampledTrajectories || sampledTrajectories.length === 0) {
        return { p5: [], p50: [], p95: [] };
    }
    const months = sampledTrajectories[0].length;
    const p5 = [], p50 = [], p95 = [];

    for (let m = 0; m < months; m++) {
        const vals = sampledTrajectories
            .map(t => t[m]?.netWorth ?? 0)
            .sort((a, b) => a - b);
        const n = vals.length;
        p5.push(vals[Math.floor(0.05 * n)] ?? 0);
        p50.push(vals[Math.floor(0.50 * n)] ?? 0);
        p95.push(vals[Math.floor(0.95 * n)] ?? 0);
    }

    return { p5, p50, p95 };
}
