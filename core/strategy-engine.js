
/**
 * WHALE RADAR
 * STRATEGY INTELLIGENCE ENGINE
 *
 * المحلل الاستراتيجي لمنطقة Order Block.
 *
 * السعر المرجعي = آخر تنفيذ في الفترة المختارة.
 * لا يستخدم السعر اللحظي من Binance.
 *
 * مصادر الأدلة:
 * 1. Large Trades
 * 2. Execution Clusters
 * 3. Capital Footprint
 * 4. Buy / Sell Activity
 */

import { fetchMarketData } from "./market-data.js";


/* =====================================
   CONFIGURATION
===================================== */

const CONFIG = {
    LARGE_TRADE_MIN_COUNT: 20,
    CLUSTER_WINDOW_MS: 60 * 1000,
    ACTIVITY_WINDOW_MS: 60 * 1000,
    CAPITAL_PERCENTILE: 0.90,
    PRICE_BUCKETS: 20,

    // مسافة الاقتراب بوحدات عرض المنطقة
    APPROACH_DISTANCE: 1,

    // هامش اعتبار السعر ملامساً للحد
    BOUNDARY_TOLERANCE: 0.02
};


/* =====================================
   HELPERS
===================================== */

function sum(values) {
    return values.reduce((total, value) => total + value, 0);
}

function average(values) {
    return values.length ? sum(values) / values.length : 0;
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
    // buyerIsMaker = true يعني أن البائع هو المبادر
    return trade.buyerIsMaker ? "sell" : "buy";
}

function insideZone(price, zone) {
    return price >= zone.lower && price <= zone.upper;
}

function getValue(trade) {
    return Number.isFinite(trade.value)
        ? trade.value
        : trade.price * trade.quantity;
}

function getSettingsValue(settings, names) {
    for (const name of names) {
        if (settings[name] !== undefined && settings[name] !== null) {
            return settings[name];
        }
    }

    return undefined;
}


/* =====================================
   VALIDATE TRADES
===================================== */

function validateTrades(trades) {

    if (!Array.isArray(trades)) {
        throw new Error("بيانات التنفيذات غير صالحة");
    }

    return trades
        .filter(trade =>
            Number.isFinite(Number(trade.price)) &&
            Number.isFinite(Number(trade.quantity)) &&
            Number.isFinite(Number(trade.time)) &&
            Number(trade.price) > 0 &&
            Number(trade.quantity) > 0
        )
        .map(trade => ({
            ...trade,
            price: Number(trade.price),
            quantity: Number(trade.quantity),
            value: getValue(trade),
            time: Number(trade.time)
        }))
        .filter(trade =>
            Number.isFinite(trade.value) &&
            trade.value > 0
        )
        .sort((a, b) => a.time - b.time);
}


/* =====================================
   REFERENCE PRICE
===================================== */

function analyzeReferencePrice(trades) {

    if (!trades.length) {
        return {
            price: null,
            timestamp: null,
            firstPrice: null,
            firstTimestamp: null,
            source: "historical-last-trade"
        };
    }

    const first = trades[0];
    const last = trades[trades.length - 1];

    return {
        price: last.price,
        timestamp: last.time,

        firstPrice: first.price,
        firstTimestamp: first.time,

        source: "historical-last-trade"
    };
}


/* =====================================
   ZONE POSITION
===================================== */

function analyzeZonePosition(reference, zone) {

    const price = reference.price;
    const width = zone.upper - zone.lower;

    if (!Number.isFinite(price) || width <= 0) {
        return {
            status: "غير متاح",
            description: "لا تتوفر بيانات كافية لتحديد موقع السعر",
            distance: null,
            distanceInZoneWidths: null,
            location: "unknown",
            crossed: false
        };
    }

    const tolerance = width * CONFIG.BOUNDARY_TOLERANCE;

    const firstPrice = reference.firstPrice;

    // هل انتقل السعر تاريخياً من جانب إلى الجانب المقابل؟
    const crossed =
        (firstPrice > zone.upper && price < zone.lower) ||
        (firstPrice < zone.lower && price > zone.upper);

    if (insideZone(price, zone)) {

        return {
            status: "داخل المنطقة",
            description: "آخر سعر في البيانات يقع داخل منطقة الدخول",
            distance: 0,
            distanceInZoneWidths: 0,
            location: "inside",
            crossed: false
        };
    }

    if (crossed) {

        return {
            status: "تجاوز المنطقة",
            description: "السعر انتقل خلال الفترة المختارة من أحد جانبي المنطقة إلى الجانب الآخر",
            distance: Math.min(
                Math.abs(price - zone.upper),
                Math.abs(price - zone.lower)
            ),
            distanceInZoneWidths:
                Math.min(
                    Math.abs(price - zone.upper),
                    Math.abs(price - zone.lower)
                ) / width,
            location: price > zone.upper ? "above" : "below",
            crossed: true
        };
    }

    if (price > zone.upper) {

        const distance = price - zone.upper;

        if (distance <= tolerance) {
            return {
                status: "لامس الحد العلوي",
                description: "آخر سعر قريب جداً من الحد العلوي للمنطقة",
                distance,
                distanceInZoneWidths: distance / width,
                location: "above",
                crossed: false
            };
        }

        if (distance <= width * CONFIG.APPROACH_DISTANCE) {
            return {
                status: "يقترب من المنطقة",
                description: "السعر فوق المنطقة وعلى مسافة لا تتجاوز عرضها",
                distance,
                distanceInZoneWidths: distance / width,
                location: "above",
                crossed: false
            };
        }

        return {
            status: "لم يصل إلى المنطقة",
            description: "السعر ما زال فوق المنطقة وبعيداً عنها نسبياً",
            distance,
            distanceInZoneWidths: distance / width,
            location: "above",
            crossed: false
        };
    }

    const distance = zone.lower - price;

    if (distance <= tolerance) {
        return {
            status: "لامس الحد السفلي",
            description: "آخر سعر قريب جداً من الحد السفلي للمنطقة",
            distance,
            distanceInZoneWidths: distance / width,
            location: "below",
            crossed: false
        };
    }

    if (distance <= width * CONFIG.APPROACH_DISTANCE) {
        return {
            status: "يقترب من المنطقة",
            description: "السعر تحت المنطقة وعلى مسافة لا تتجاوز عرضها",
            distance,
            distanceInZoneWidths: distance / width,
            location: "below",
            crossed: false
        };
    }

    return {
        status: "لم يصل إلى المنطقة",
        description: "السعر ما زال تحت المنطقة وبعيداً عنها نسبياً",
        distance,
        distanceInZoneWidths: distance / width,
        location: "below",
        crossed: false
    };
}


/* =====================================
   APPROACH CORRIDOR
===================================== */

function getApproachTrades(trades, reference, zone, position) {

    if (!reference.price) return [];

    const price = reference.price;

    // إذا كان السعر داخل المنطقة، فالممر هو المنطقة نفسها
    if (position.location === "inside") {
        return trades.filter(trade =>
            insideZone(trade.price, zone)
        );
    }

    // إذا تجاوز المنطقة، لا ننشئ ممر اقتراب مضللاً
    if (position.crossed) {
        return [];
    }

    // السعر أعلى المنطقة: الممر بين الحد العلوي والسعر
    if (price > zone.upper) {
        return trades.filter(trade =>
            trade.price >= zone.upper &&
            trade.price <= price
        );
    }

    // السعر أسفل المنطقة: الممر بين السعر والحد السفلي
    return trades.filter(trade =>
        trade.price >= price &&
        trade.price <= zone.lower
    );
}


/* =====================================
   LARGE TRADES
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
   EXECUTION CLUSTERS
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
   CAPITAL FOOTPRINT
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

        buyValue: sum(
            large.filter(t => getSide(t) === "buy")
                .map(t => t.value)
        ),

        sellValue: sum(
            large.filter(t => getSide(t) === "sell")
                .map(t => t.value)
        ),

        levels: [...buckets.values()]
    };
}


/* =====================================
   BUY / SELL ACTIVITY
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
    let previousTime = null;

    for (const window of timeline) {

        const currentSide =
            window.buyValue > window.sellValue
                ? "buy"
                : window.sellValue > window.buyValue
                    ? "sell"
                    : null;

        const adjacent =
            previousTime !== null &&
            window.start - previousTime ===
                CONFIG.ACTIVITY_WINDOW_MS;

        if (!adjacent) {
            previousSide = null;
        }

        if (
            currentSide &&
            previousSide &&
            currentSide !== previousSide
        ) {
            transitions++;
        }

        previousSide = currentSide;
        previousTime = window.start;
    }

    const latest = timeline.length
        ? timeline[timeline.length - 1].start
        : 0;

    const recent = timeline.filter(window =>
        window.start >=
        latest - 29 * CONFIG.ACTIVITY_WINDOW_MS
    );

    return {
        buyValue: sum(timeline.map(w => w.buyValue)),
        sellValue: sum(timeline.map(w => w.sellValue)),

        buyCount: trades.filter(
            t => getSide(t) === "buy"
        ).length,

        sellCount: trades.filter(
            t => getSide(t) === "sell"
        ).length,

        transitions,

        recentBuyValue: sum(
            recent.map(w => w.buyValue)
        ),

        recentSellValue: sum(
            recent.map(w => w.sellValue)
        ),

        activeMinutes: timeline.length,
        timeline
    };
}


/* =====================================
   ZONE ANALYSIS
===================================== */

function analyzeZone(trades, zone) {

    const zoneTrades = trades.filter(
        trade => insideZone(trade.price, zone)
    );

    const width = zone.upper - zone.lower;
    const tolerance = width * 0.25;

    const nearbyTrades = trades.filter(
        trade =>
            trade.price >= zone.lower - tolerance &&
            trade.price <= zone.upper + tolerance
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
        count: zoneTrades.length,
        buyValue,
        sellValue,

        totalValue: buyValue + sellValue,

        buyCount: zoneTrades.filter(
            t => getSide(t) === "buy"
        ).length,

        sellCount: zoneTrades.filter(
            t => getSide(t) === "sell"
        ).length,

        medianPrice: median(
            zoneTrades.map(t => t.price)
        ),

        nearbyCount: nearbyTrades.length,
        nearbyValue: sum(
            nearbyTrades.map(t => t.value)
        ),

        trades: zoneTrades
    };
}


/* =====================================
   APPROACH ANALYSIS
===================================== */

function analyzeApproach(trades, zone, position) {

    const reference = trades.length
        ? trades[trades.length - 1].price
        : null;

    if (reference === null) {
        return {
            count: 0,
            buyValue: 0,
            sellValue: 0,
            totalValue: 0,
            largeTrades: null,
            clusters: null,
            capital: null,
            activity: null
        };
    }

    const corridorTrades = getApproachTrades(
        trades,
        { price: reference },
        zone,
        position
    );

    const buyValue = sum(
        corridorTrades
            .filter(t => getSide(t) === "buy")
            .map(t => t.value)
    );

    const sellValue = sum(
        corridorTrades
            .filter(t => getSide(t) === "sell")
            .map(t => t.value)
    );

    return {
        count: corridorTrades.length,
        buyValue,
        sellValue,
        totalValue: buyValue + sellValue,

        largeTrades: analyzeLargeTrades(corridorTrades),
        clusters: analyzeClusters(corridorTrades),
        capital: analyzeCapital(corridorTrades),
        activity: analyzeActivity(corridorTrades),

        trades: corridorTrades
    };
}


/* =====================================
   HISTORICAL ZONE INTERACTION
===================================== */

function analyzeHistoricalInteraction(trades, zone) {

    const inside = trades.filter(
        trade => insideZone(trade.price, zone)
    );

    const first = trades[0] || null;
    const last = trades[trades.length - 1] || null;

    const upperExecutions = trades.filter(
        trade => Math.abs(trade.price - zone.upper) <=
            (zone.upper - zone.lower) * 0.02
    );

    const lowerExecutions = trades.filter(
        trade => Math.abs(trade.price - zone.lower) <=
            (zone.upper - zone.lower) * 0.02
    );

    return {
        tradedInside: inside.length > 0,
        insideCount: inside.length,

        upperBoundaryExecutions: upperExecutions.length,
        lowerBoundaryExecutions: lowerExecutions.length,

        firstPrice: first?.price ?? null,
        lastPrice: last?.price ?? null,

        firstTimestamp: first?.time ?? null,
        lastTimestamp: last?.time ?? null,

        note: "يعتمد هذا التحليل على أسعار التنفيذات، ولا يثبت أن ذيل شمعة لمس الحد بين تنفيذين"
    };
}


/* =====================================
   MAIN STRATEGY ANALYSIS
===================================== */


export async function analyzeStrategy(settings) {

    const strategySettings = settings.strategy || {};

    const symbol = String(
        settings.symbol || ""
    ).trim().toUpperCase();

    const upper = Number(strategySettings.upper);
    const lower = Number(strategySettings.lower);

    const direction = String(
        strategySettings.direction || "long"
    ).toLowerCase();

    if (!symbol) {
        throw new Error("رمز العملة غير محدد");
    }

    if (
        !Number.isFinite(upper) ||
        !Number.isFinite(lower) ||
        upper <= lower ||
        lower <= 0
    ) {
        throw new Error("حدود منطقة الدخول غير صحيحة");
    }

    if (!["long", "short"].includes(direction)) {
        throw new Error("اتجاه الصفقة غير صحيح");
    }

    const zone = {
        upper,
        lower,
        direction
    };

    const market = await fetchMarketData(settings);

    const trades = validateTrades(market.trades);

    if (!trades.length) {
        throw new Error("لا توجد تنفيذات صالحة في الفترة المحددة");
    }

    const referencePrice = analyzeReferencePrice(trades);

    const position = analyzeZonePosition(
        referencePrice,
        zone
    );

    const largeTrades = analyzeLargeTrades(trades);
    const clusters = analyzeClusters(trades);
    const capital = analyzeCapital(trades);
    const activity = analyzeActivity(trades);

    const zoneEvidence = analyzeZone(trades, zone);

    const approach = analyzeApproach(
        trades,
        zone,
        position
    );

    const historicalInteraction =
        analyzeHistoricalInteraction(trades, zone);

    return {
        market,

        strategy: {
            symbol,
            direction,
            zone
        },

        referencePrice,

        position,

        evidence: {
            largeTrades,
            clusters,
            capital,
            activity,

            zone: {
                zone,
                ...zoneEvidence
            },

            approach,

            historicalInteraction
        },

        limitations: [
            "السعر المرجعي هو آخر تنفيذ في الفترة المختارة وليس السعر اللحظي.",
            "غياب التنفيذات داخل المنطقة لا يعني وجود ضغط معاكس.",
            "التنفيذات العامة لا تثبت أنها تعود إلى حساب واحد.",
            "الصفقات الكبيرة لا تثبت وحدها وجود حوت واحد.",
            "التنفيذات لا تكشف الأوامر المخفية أو هوية أصحابها.",
            "تحليل الاقتراب يقيس التنفيذات في الممر السعري ولا يثبت اتجاه الحركة بين التنفيذات.",
            "ملامسة الحد عبر أسعار التنفيذ لا تثبت أن ذيل شمعة لمسه."
        ]
    };
}
