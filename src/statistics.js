/**
 * statistics.js — Core Statistical Methods
 *
 * Implements:
 *   - Descriptive statistics (mean, median, std dev, skewness, kurtosis)
 *   - Percentile interpolation
 *   - Pearson correlation
 *   - Simple linear regression (OLS)
 *   - Value-at-Risk (VaR) at user-specified confidence levels
 *   - Correlation matrix builder
 *
 * All functions are pure and operate on plain arrays of numbers.
 */

"use strict";

// ─── Descriptive Stats ────────────────────────────────────────────────────────

function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function median(arr) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

function variance(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
}

function stdDev(arr) {
    return Math.sqrt(variance(arr));
}

/**
 * skewness — Fisher-Pearson standardized moment coefficient.
 * Positive = right tail, Negative = left tail.
 */
function skewness(arr) {
    if (arr.length < 3) return 0;
    const m = mean(arr);
    const s = stdDev(arr);
    if (s === 0) return 0;
    const n = arr.length;
    const g1 = arr.reduce((acc, x) => acc + ((x - m) / s) ** 3, 0) / n;
    return g1;
}

/**
 * excessKurtosis — measures tail heaviness relative to normal distribution.
 * Normal distribution has excess kurtosis = 0.
 */
function excessKurtosis(arr) {
    if (arr.length < 4) return 0;
    const m = mean(arr);
    const s = stdDev(arr);
    if (s === 0) return 0;
    const n = arr.length;
    const g2 = arr.reduce((acc, x) => acc + ((x - m) / s) ** 4, 0) / n - 3;
    return g2;
}

/**
 * descriptiveStats — full summary object for a distribution.
 */
function descriptiveStats(arr) {
    if (!arr || !arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    return {
        n: arr.length,
        mean: mean(arr),
        median: median(arr),
        stdDev: stdDev(arr),
        skewness: skewness(arr),
        kurtosis: excessKurtosis(arr),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        p5: percentile(sorted, 5, true),
        p25: percentile(sorted, 25, true),
        p75: percentile(sorted, 75, true),
        p95: percentile(sorted, 95, true),
    };
}

// ─── Percentile ───────────────────────────────────────────────────────────────

/**
 * percentile — linear interpolation.
 * @param {number[]} sortedArr  pre-sorted ascending array
 * @param {number}   p          0–100
 * @param {boolean}  preSorted  skip sort if already sorted
 */
function percentile(arr, p, preSorted = false) {
    if (!arr.length) return 0;
    const sorted = preSorted ? arr : [...arr].sort((a, b) => a - b);
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ─── Value-at-Risk ────────────────────────────────────────────────────────────

/**
 * valueAtRisk — parametric VaR for a loss distribution (negative cash flows).
 *
 * Convention: VaR is reported as a positive number representing the loss
 * not exceeded with probability α.
 *
 * Here we compute non-parametric (historical simulation) VaR from the
 * empirical ending-balance distribution.
 *
 * @param {number[]} endingBalances  array of simulated ending net worths
 * @param {number}   alpha           confidence level, e.g. 0.95 or 0.99
 * @returns {number} VaR (positive = loss)
 */
function valueAtRisk(endingBalances, alpha = 0.95) {
    const sorted = [...endingBalances].sort((a, b) => a - b);
    const cutoff = percentile(sorted, (1 - alpha) * 100, true);
    // VaR expressed as potential loss from initial investment
    return -cutoff; // if cutoff is negative, VaR is positive (loss)
}

/**
 * expectedShortfall — mean of losses beyond the VaR threshold (CVaR).
 */
function expectedShortfall(endingBalances, alpha = 0.95) {
    const sorted = [...endingBalances].sort((a, b) => a - b);
    const varCutoff = percentile(sorted, (1 - alpha) * 100, true);
    const tail = sorted.filter(x => x <= varCutoff);
    if (!tail.length) return 0;
    return -mean(tail);
}

// ─── Correlation & Regression ─────────────────────────────────────────────────

/**
 * pearsonR — Pearson correlation coefficient between two arrays.
 */
function pearsonR(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;
    const mx = mean(x), my = mean(y);
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - mx;
        const dy = y[i] - my;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
    }
    const denom = Math.sqrt(dx2 * dy2);
    return denom === 0 ? 0 : num / denom;
}

/**
 * simpleLinearRegression — OLS: y = slope * x + intercept
 * @returns {Object} { slope, intercept, rSquared }
 */
function simpleLinearRegression(x, y) {
    const n = Math.min(x.length, y.length);
    const mx = mean(x.slice(0, n));
    const my = mean(y.slice(0, n));
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) {
        sxy += (x[i] - mx) * (y[i] - my);
        sxx += (x[i] - mx) ** 2;
    }
    const slope = sxx === 0 ? 0 : sxy / sxx;
    const intercept = my - slope * mx;
    const r = pearsonR(x.slice(0, n), y.slice(0, n));
    return { slope, intercept, rSquared: r * r };
}

/**
 * buildCorrelationMatrix — n×n Pearson correlation matrix.
 * @param {Object} variables  { label: number[] }
 * @returns {Object} { labels: string[], matrix: number[][] }
 */
function buildCorrelationMatrix(variables) {
    const labels = Object.keys(variables);
    const matrix = labels.map(rowLabel =>
        labels.map(colLabel =>
            rowLabel === colLabel ? 1 : pearsonR(variables[rowLabel], variables[colLabel])
        )
    );
    return { labels, matrix };
}

// ─── Cash-Flow Risk Helpers ───────────────────────────────────────────────────

/**
 * monthlyCashFlowRisk — given projected trajectories, extract monthly net cash
 * flows and compute their VaR/CVaR for risk display.
 *
 * @param {Array<Array<Object>>} trajectories  sampledTrajectories from simulation
 * @param {string} field  'netWorth' | 'cash' | 'savings'
 * @returns {Object} stats on the distribution of final period values
 */
function distributionStats(trajectories, field = 'netWorth') {
    if (!trajectories || !trajectories.length) return null;
    const finalValues = trajectories.map(t => t[t.length - 1][field] ?? 0);
    return {
        ...descriptiveStats(finalValues),
        var95: valueAtRisk(finalValues, 0.95),
        var99: valueAtRisk(finalValues, 0.99),
        cvar95: expectedShortfall(finalValues, 0.95),
    };
}
