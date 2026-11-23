
/**
 * WHALE RADAR
 * STRATEGY INTELLIGENCE ENGINE
 *
 * محرك تحليل الأدلة الاستراتيجية.
 * يربط نشاط السوق بمنطقة Order Block.
 */

import { fetchMarketData } from "./market-data.js";

/* =====================================
   إعدادات المحرك
===================================== */

const CONFIG = {
    LARGE_TRADE_MIN_COUNT: 20,
    CLUSTER_WINDOW_MS: 60 * 1000,
    ACTIVITY_WINDOW_MS: 60 * 1000,
    CAPITAL_PERCENTILE: 0.90,
    PRICE_BUCKETS: 20
};


/* =====================================
   أدوات مساعدة
===================================== */

function sum(values) {
    return values.reduce((total, value) => total + value, 0);
}

function average(values) {
    return values.length
        ? sum(values) / values.length
        : 0;
}

function median(values) {
    if (!values.length) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, ratio) {
    if (!values.length) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(
        sorted.length - 1,
        Math.floor(sorted.length * ratio)
    );

    return sorted[index];
}

function getSide(trade) {
    return trade.buyerIsMaker ? "sell" : "buy";
}

function insideZone(price, zone) {
    return price >= zone.lower && price <= zone.upper;
}

function nearZone(price, zone, tolerance) {
    return (
        price >= zone.lower - tolerance &&
        price <= zone.upper + tolerance
    );
}


/* =====================================
   تحليل البيانات الخام
===================================== */

function validateTrades(trades) {

    if (!Array.isArray(trades)) {
        throw new Error("بيانات التنفيذات غير صالحة");
    }

    return trades.filter(trade =>
        Number.isFinite(trade.price) &&
        Number.isFinite(trade.quantity) &&
        Number.isFinite(trade.value) &&
        Number.isFinite(trade.time) &&
        trade.price > 0 &&
        trade.quantity > 0 &&
        trade.value > 0
    );
}


/* =====================================
   تحليل التنفيذات الكبيرة
===================================== */

function analyzeLargeTrades(trades) {

    if (!trades.length) {
        return {
            threshold: 0,
            count: 0,
            buyValue: 0,
            sellValue: 0,
            trades: []
        };
    }

    const values = trades.map(trade => trade.value);

    const threshold = Math.max(
        percentile(values, 0.95),
        average(values) * 5
    );

    const large = trades.filter(
        trade => trade.value >= threshold
    );

    return {
        threshold,
        count: large.length,
        buyValue: sum(
            large.filter(t => getSide(t) === "buy")
                .map(t => t.value)
        ),
        sellValue: sum(
            large.filter(t => getSide(t) === "sell")
                .map(t => t.value)
        ),
        trades: large
    };
}


/* =====================================
   تحليل عناقيد التنفيذ
===================================== */

function analyzeClusters(trades) {

    const windows = new Map();

    for (const trade of trades) {

        const start = Math.floor(
            trade.time / CONFIG.CLUSTER_WINDOW_MS
        ) * CONFIG.CLUSTER_WINDOW_MS;

        if (!windows.has(start)) {
            windows.set(start, {
                start,
                count: 0,
                buyValue: 0,
                sellValue: 0,
                totalValue: 0
            });
        }

        const window = windows.get(start);

        window.count++;
        window.totalValue += trade.value;

        if (getSide(trade) === "buy") {
            window.buyValue += trade.value;
        } else {
            window.sellValue += trade.value;
        }
    }

    const active = [...windows.values()]
        .sort((a, b) => a.start - b.start)
        .filter(window => window.count >= 5);

    return {
        activeWindows: active.length,
        totalWindows: windows.size,
        clusters: active
    };
}


/* =====================================
   تحليل بصمة رأس المال
===================================== */

function analyzeCapital(trades) {

    if (!trades.length) {
        return {
            threshold: 0,
            count: 0,
            buyValue: 0,
            sellValue: 0,
            levels: []
        };
    }

    const threshold = percentile(
        trades.map(trade => trade.value),
        CONFIG.CAPITAL_PERCENTILE
    );

    const large = trades.filter(
        trade => trade.value >= threshold
    );

    const minPrice = Math.min(...large.map(t => t.price));
    const maxPrice = Math.max(...large.map(t => t.price));

    const range = maxPrice - minPrice;
    const buckets = new Map();

    for (const trade of large) {

        const index = range === 0
            ? 0
            : Math.min(
                CONFIG.PRICE_BUCKETS - 1,
                Math.floor(
                    (trade.price - minPrice) /
                    range * CONFIG.PRICE_BUCKETS
                )
            );

        if (!buckets.has(index)) {
            buckets.set(index, {
                index,
                buyValue: 0,
                sellValue: 0,
                totalValue: 0,
                count: 0
            });
        }

        const bucket = buckets.get(index);

        bucket.count++;
        bucket.totalValue += trade.value;

        if (getSide(trade) === "buy") {
            bucket.buyValue += trade.value;
        } else {
            bucket.sellValue += trade.value;
        }
    }

    return {
        threshold,
        count: large.length,
        buyValue: sum(large
            .filter(t => getSide(t) === "buy")
            .map(t => t.value)),
        sellValue: sum(large
            .filter(t => getSide(t) === "sell")
            .map(t => t.value)),
        levels: [...buckets.values()]
    };
}


/* =====================================
   تحليل ضغط الشراء والبيع
===================================== */

function analyzeActivity(trades) {

    const windows = new Map();

    for (const trade of trades) {

        const start = Math.floor(
            trade.time / CONFIG.ACTIVITY_WINDOW_MS
        ) * CONFIG.ACTIVITY_WINDOW_MS;

        if (!windows.has(start)) {
            windows.set(start, {
                start,
                buyValue: 0,
                sellValue: 0,
                totalValue: 0,
                count: 0
            });
        }

        const window = windows.get(start);

        window.totalValue += trade.value;
        window.count++;

        if (getSide(trade) === "buy") {
            window.buyValue += trade.value;
        } else {
            window.sellValue += trade.value;
        }
    }

    const timeline = [...windows.values()]
        .sort((a, b) => a.start - b.start);

    let transitions = 0;
    let previousSide = null;

    for (const window of timeline) {

        const currentSide =
            window.buyValue > window.sellValue
                ? "buy"
                : window.sellValue > window.buyValue
                    ? "sell"
                    : null;

        if (
            currentSide &&
            previousSide &&
            currentSide !== previousSide &&
            window.start - timeline[
                timeline.indexOf(window) - 1
            ].start === CONFIG.ACTIVITY_WINDOW_MS
        ) {
            transitions++;
        }

        if (currentSide) {
            previousSide = currentSide;
        } else {
            previousSide = null;
        }
    }

    const latest = timeline.length
        ? timeline[timeline.length - 1].start
        : 0;

    const recent = timeline.filter(window =>
        window.start >= latest - 29 * CONFIG.ACTIVITY_WINDOW_MS
    );

    return {
        buyValue: sum(timeline.map(w => w.buyValue)),
        sellValue: sum(timeline.map(w => w.sellValue)),
        buyCount: sum(trades
            .filter(t => getSide(t) === "buy")
            .map(() => 1)),
        sellCount: sum(trades
            .filter(t => getSide(t) === "sell")
            .map(() => 1)),
        transitions,
        recentBuyValue: sum(recent.map(w => w.buyValue)),
        recentSellValue: sum(recent.map(w => w.sellValue)),
        activeMinutes: timeline.length,
        timeline
    };
}


/* =====================================
   ربط الأدلة بمنطقة Order Block
===================================== */

function analyzeZone(trades, zone) {

    const zoneTrades = trades.filter(
        trade => insideZone(trade.price, zone)
    );

    const width = zone.upper - zone.lower;

    const tolerance = width * 0.25;

    const nearbyTrades = trades.filter(
        trade => nearZone(trade.price, zone, tolerance)
    );

    const buyValue = sum(
        zoneTrades
            .filter(t => getSide(t) === "buy")
            .map(t => t.value)
    );

    const sellValue = sum(
        zoneTrades
            .filter(t => getSide(t) === "sell")
            .map(t => t.value)
    );

    return {
        zone,
        width,
        tolerance,
        executionCount: zoneTrades.length,
        nearbyExecutionCount: nearbyTrades.length,
        totalValue: sum(zoneTrades.map(t => t.value)),
        buyValue,
        sellValue,
        buyCount: zoneTrades.filter(
            t => getSide(t) === "buy"
        ).length,
        sellCount: zoneTrades.filter(
            t => getSide(t) === "sell"
        ).length,
        medianTradeValue: median(
            zoneTrades.map(t => t.value)
        ),
        trades: zoneTrades
    };
}


/* =====================================
   المحرك الرئيسي
===================================== */

export async function analyzeStrategy(settings) {

    if (!settings?.strategy) {
        throw new Error("إعدادات الاستراتيجية غير موجودة");
    }

    const { upper, lower, direction } = settings.strategy;

    if (
        !Number.isFinite(upper) ||
        !Number.isFinite(lower) ||
        upper < lower ||
        lower <= 0 ||
        !["long", "short"].includes(direction)
    ) {
        throw new Error("حدود المنطقة أو اتجاه الصفقة غير صالح");
    }

    const market = await fetchMarketData(settings);

    const trades = validateTrades(market.trades);

    if (!trades.length) {
        throw new Error("لا توجد بيانات تنفيذات صالحة للتحليل");
    }

    const zone = {
        upper,
        lower,
        direction
    };

    return {
        market: {
            symbol: market.symbol,
            startTime: market.startTime,
            endTime: market.endTime,
            totalTrades: trades.length,
            pages: market.pages
        },

        evidence: {
            largeTrades: analyzeLargeTrades(trades),
            clusters: analyzeClusters(trades),
            capital: analyzeCapital(trades),
            activity: analyzeActivity(trades),
            zone: analyzeZone(trades, zone)
        },

        limitations: [
            "التنفيذات المجمعة لا تكشف هوية الحسابات.",
            "ضغط المبادرة لا يثبت السيطرة على السعر.",
            "دفتر الأوامر اللحظي ليس سجلاً تاريخياً.",
            "لا يمكن تأكيد أوامر Iceberg من هذه البيانات وحدها."
        ]
    };
}
  
