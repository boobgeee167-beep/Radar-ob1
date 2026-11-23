
/**
 * WHALE RADAR
 * STRATEGY INTELLIGENCE ENGINE
 *
 * محرك تقييم توافق سلوك السوق مع سيناريو Order Block.
 *
 * السعر المرجعي = آخر تنفيذ في الفترة المختارة.
 * لا يستخدم السعر اللحظي.
 *
 * مصادر الأدلة:
 * 1. Large Trades
 * 2. Execution Clusters
 * 3. Capital Footprint
 * 4. Buy / Sell Activity
 *
 * المحلل مستشار فقط ولا يمنع الدخول.
 */

import { fetchMarketData } from "./market-data.js";


/* =====================================
   CONFIGURATION
===================================== */

const CONFIG = {
    CLUSTER_WINDOW_MS: 60 * 1000,
    ACTIVITY_WINDOW_MS: 60 * 1000,
    CAPITAL_PERCENTILE: 0.90,
    PRICE_BUCKETS: 20,

    APPROACH_DISTANCE: 1,
    BOUNDARY_TOLERANCE: 0.02,

    // الحد الأدنى لتحليل تدفق التنفيذات داخل المنطقة
    MIN_ZONE_TRADES: 10,

    // الحد الأدنى لقبول مصدر كدليل
    MIN_LARGE_TRADES: 3,
    MIN_CLUSTER_WINDOWS: 2,
    MIN_CAPITAL_TRADES: 3,
    MIN_ACTIVITY_WINDOWS: 2,

    // الحد الأدنى للفارق بين المبادرة المؤيدة والمعارضة
    DIRECTIONAL_THRESHOLD: 0.15
};


/* =====================================
   BASIC HELPERS
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

function formatDirection(direction) {
    return direction === "long" ? "الشراء LONG" : "البيع SHORT";
}

function alignedSide(direction) {
    return direction === "long" ? "buy" : "sell";
}

function opposingSide(direction) {
    return direction === "long" ? "sell" : "buy";
}

function safeRatio(numerator, denominator) {
    return denominator > 0 ? numerator / denominator : 0;
}

function getFlow(trades) {
    const buyValue = sum(
        trades.filter(t => getSide(t) === "buy").map(t => t.value)
    );

    const sellValue = sum(
        trades.filter(t => getSide(t) === "sell").map(t => t.value)
    );

    const totalValue = buyValue + sellValue;

    return {
        buyValue,
        sellValue,
        totalValue,
        buyCount: trades.filter(t => getSide(t) === "buy").length,
        sellCount: trades.filter(t => getSide(t) === "sell").length,
        buyRatio: safeRatio(buyValue, totalValue),
        sellRatio: safeRatio(sellValue, totalValue),
        imbalance: safeRatio(buyValue - sellValue, totalValue)
    };
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

    const crossed =
        (firstPrice > zone.upper && price < zone.lower) ||
        (firstPrice < zone.lower && price > zone.upper);

    if (insideZone(price, zone)) {
        return {
            status: "داخل المنطقة",
            description: "آخر تنفيذ تاريخي يقع داخل منطقة الدخول",
            distance: 0,
            distanceInZoneWidths: 0,
            location: "inside",
            crossed: false
        };
    }

    if (crossed) {
        const distance = Math.min(
            Math.abs(price - zone.upper),
            Math.abs(price - zone.lower)
        );

        return {
            status: "بدأ وانتهى على جانبي المنطقة",
            description:
                "بدأت العينة على أحد جانبي المنطقة وانتهت على الجانب الآخر. هذا لا يثبت وحده مسار العبور بين التنفيذات.",
            distance,
            distanceInZoneWidths: distance / width,
            location: price > zone.upper ? "above" : "below",
            crossed: true
        };
    }

    if (price > zone.upper) {

        const distance = price - zone.upper;

        if (distance <= tolerance) {
            return {
                status: "ملامسة الحد العلوي",
                description: "آخر تنفيذ قريب جداً من الحد العلوي",
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
            description: "السعر ما زال فوق منطقة الدخول",
            distance,
            distanceInZoneWidths: distance / width,
            location: "above",
            crossed: false
        };
    }

    const distance = zone.lower - price;

    if (distance <= tolerance) {
        return {
            status: "ملامسة الحد السفلي",
            description: "آخر تنفيذ قريب جداً من الحد السفلي",
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
        description: "السعر ما زال تحت منطقة الدخول",
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

    if (position.location === "inside") {
        return trades.filter(t => insideZone(t.price, zone));
    }

    if (position.crossed) return [];

    if (price > zone.upper) {
        return trades.filter(t =>
            t.price >= zone.upper &&
            t.price <= price
        );
    }

    return trades.filter(t =>
        t.price >= price &&
        t.price <= zone.lower
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

    const values = trades.map(t => t.value);

    const threshold = Math.max(
        percentile(values, 0.95),
        average(values) * 5
    );

    const large = trades.filter(
        t => t.value >= threshold
    );

    const flow = getFlow(large);

    return {
        threshold,
        count: large.length,
        buyValue: flow.buyValue,
        sellValue: flow.sellValue,
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
        .filter(w => w.count >= 5);

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
        trades.map(t => t.value),
        CONFIG.CAPITAL_PERCENTILE
    );

    const large = trades.filter(
        t => t.value >= threshold
    );

    if (!large.length) {
        return {
            threshold,
            count: 0,
            buyValue: 0,
            sellValue: 0,
            levels: []
        };
    }

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

    const flow = getFlow(large);

    return {
        threshold,
        count: large.length,
        buyValue: flow.buyValue,
        sellValue: flow.sellValue,
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

        if (!adjacent) previousSide = null;

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

    const recent = timeline.filter(w =>
        w.start >= latest - 29 * CONFIG.ACTIVITY_WINDOW_MS
    );

    const flow = getFlow(trades);

    return {
        buyValue: flow.buyValue,
        sellValue: flow.sellValue,
        buyCount: flow.buyCount,
        sellCount: flow.sellCount,
        transitions,
        recentBuyValue: sum(recent.map(w => w.buyValue)),
        recentSellValue: sum(recent.map(w => w.sellValue)),
        activeMinutes: timeline.length,
        timeline
    };
}


/* =====================================
   ZONE ANALYSIS
===================================== */

function analyzeZone(trades, zone) {

    const zoneTrades = trades.filter(
        t => insideZone(t.price, zone)
    );

    const width = zone.upper - zone.lower;
    const tolerance = width * 0.25;

    const nearbyTrades = trades.filter(t =>
        t.price >= zone.lower - tolerance &&
        t.price <= zone.upper + tolerance
    );

    const flow = getFlow(zoneTrades);

    return {
        count: zoneTrades.length,

        buyValue: flow.buyValue,
        sellValue: flow.sellValue,
        totalValue: flow.totalValue,

        buyCount: flow.buyCount,
        sellCount: flow.sellCount,

        medianPrice: median(zoneTrades.map(t => t.price)),

        nearbyCount: nearbyTrades.length,
        nearbyValue: sum(nearbyTrades.map(t => t.value)),

        trades: zoneTrades
    };
}


/* =====================================
   APPROACH ANALYSIS
===================================== */

function analyzeApproach(trades, referencePrice, zone, position) {

    const corridorTrades = getApproachTrades(
        trades,
        referencePrice,
        zone,
        position
    );

    const flow = getFlow(corridorTrades);

    return {
        count: corridorTrades.length,
        buyValue: flow.buyValue,
        sellValue: flow.sellValue,
        totalValue: flow.totalValue,

        largeTrades: analyzeLargeTrades(corridorTrades),
        clusters: analyzeClusters(corridorTrades),
        capital: analyzeCapital(corridorTrades),
        activity: analyzeActivity(corridorTrades),

        firstPrice: corridorTrades[0]?.price ?? null,
        lastPrice: corridorTrades[corridorTrades.length - 1]?.price ?? null,

        trades: corridorTrades
    };
}


/* =====================================
   HISTORICAL ZONE INTERACTION
===================================== */

function analyzeHistoricalInteraction(trades, zone) {

    const inside = trades.filter(
        t => insideZone(t.price, zone)
    );

    const first = trades[0] || null;
    const last = trades[trades.length - 1] || null;

    const tolerance =
        (zone.upper - zone.lower) * CONFIG.BOUNDARY_TOLERANCE;

    const upperExecutions = trades.filter(t =>
        Math.abs(t.price - zone.upper) <= tolerance
    );

    const lowerExecutions = trades.filter(t =>
        Math.abs(t.price - zone.lower) <= tolerance
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

        note:
            "يعتمد التحليل على أسعار التنفيذات، ولا يثبت أن ذيل شمعة لمس الحد بين تنفيذين."
    };
}


/* =====================================
   DIRECTIONAL EVIDENCE
===================================== */

function classifyDirectionalFlow(flow, direction, minCount = 1) {

    const totalCount = flow.buyCount + flow.sellCount;

    if (
        totalCount < minCount ||
        flow.totalValue <= 0
    ) {
        return {
            status: "insufficient",
            label: "غير كافٍ",
            alignedRatio: null,
            opposingRatio: null,
            imbalance: null
        };
    }

    const aligned = direction === "long"
        ? flow.buyValue
        : flow.sellValue;

    const opposing = direction === "long"
        ? flow.sellValue
        : flow.buyValue;

    const alignedRatio = safeRatio(aligned, flow.totalValue);
    const opposingRatio = safeRatio(opposing, flow.totalValue);

    const imbalance = alignedRatio - opposingRatio;

    let status = "neutral";
    let label = "متقارب";

    if (imbalance >= CONFIG.DIRECTIONAL_THRESHOLD) {
        status = "support";
        label = "مؤيد للسيناريو";
    } else if (imbalance <= -CONFIG.DIRECTIONAL_THRESHOLD) {
        status = "oppose";
        label = "معارض للسيناريو";
    }

    return {
        status,
        label,
        alignedValue: aligned,
        opposingValue: opposing,
        alignedRatio,
        opposingRatio,
        imbalance
    };
}


/* =====================================
   SOURCE EVALUATION
===================================== */

function evaluateZoneSources(zoneTrades, direction) {

    const large = analyzeLargeTrades(zoneTrades);
    const clusters = analyzeClusters(zoneTrades);
    const capital = analyzeCapital(zoneTrades);
    const activity = analyzeActivity(zoneTrades);

    const largeFlow = getFlow(large.trades);

    const clusterFlow = {
        buyValue: sum(clusters.clusters.map(c => c.buyValue)),
        sellValue: sum(clusters.clusters.map(c => c.sellValue)),
        totalValue: sum(clusters.clusters.map(c => c.totalValue)),
        buyCount: 0,
        sellCount: 0
    };

    const capitalFlow = {
        buyValue: capital.buyValue,
        sellValue: capital.sellValue,
        totalValue: capital.buyValue + capital.sellValue,
        buyCount: capital.count,
        sellCount: capital.count
    };

    const activityFlow = {
        buyValue: activity.buyValue,
        sellValue: activity.buyValue + activity.sellValue,
        buyCount: activity.buyCount,
        sellCount: activity.sellCount
    };

    const sources = [
        {
            id: "largeTrades",
            name: "الصفقات الكبيرة",
            description:
                "اتجاه المبادرة داخل المنطقة لدى التنفيذات الكبيرة.",
            result: classifyDirectionalFlow(
                largeFlow,
                direction,
                CONFIG.MIN_LARGE_TRADES
            )
        },
        {
            id: "clusters",
            name: "عناقيد التنفيذ",
            description:
                "اتجاه المبادرة في نوافذ النشاط المتجمعة داخل المنطقة.",
            result: clusters.activeWindows >= CONFIG.MIN_CLUSTER_WINDOWS
                ? classifyDirectionalFlow(
                    clusterFlow,
                    direction,
                    1
                )
                : {
                    status: "insufficient",
                    label: "غير كافٍ",
                    alignedRatio: null,
                    opposingRatio: null,
                    imbalance: null
                }
        },
        {
            id: "capital",
            name: "بصمة رأس المال",
            description:
                "اتجاه المبادرة في الشريحة الأعلى قيمة من التنفيذات داخل المنطقة.",
            result: classifyDirectionalFlow(
                capitalFlow,
                direction,
                CONFIG.MIN_CAPITAL_TRADES
            )
        },
        {
            id: "activity",
            name: "نشاط الشراء والبيع",
            description:
                "اتجاه المبادرة عبر التنفيذات والنوافذ الزمنية داخل المنطقة.",
            result: activity.activeMinutes >= CONFIG.MIN_ACTIVITY_WINDOWS
                ? classifyDirectionalFlow(
                    activityFlow,
                    direction,
                    1
                )
                : {
                    status: "insufficient",
                    label: "غير كافٍ",
                    alignedRatio: null,
                    opposingRatio: null,
                    imbalance: null
                }
        }
    ];

    return {
        sources,
        details: {
            largeTrades: large,
            clusters,
            capital,
            activity
        }
    };
}


/* =====================================
   APPROACH INTERPRETATION
===================================== */

function evaluateApproach(approach, position, direction) {

    if (!approach.count || !approach.totalValue) {
        return {
            status: "insufficient",
            label: "لا توجد أدلة كافية في الممر",
            explanation:
                "لا توجد تنفيذات كافية في الممر السعري بين آخر سعر تاريخي والمنطقة."
        };
    }

    const flow = getFlow(approach.trades);

    const towardZoneSide =
        position.location === "above" ? "sell" : "buy";

    const towardZoneValue =
        towardZoneSide === "sell"
            ? flow.sellValue
            : flow.buyValue;

    const awayFromZoneValue =
        towardZoneSide === "sell"
            ? flow.buyValue
            : flow.sellValue;

    const towardRatio = safeRatio(
        towardZoneValue,
        flow.totalValue
    );

    const awayRatio = safeRatio(
        awayFromZoneValue,
        flow.totalValue
    );

    let explanation;

    if (towardRatio >= 0.60) {
        explanation =
            "المبادرة الغالبة في الممر تتوافق مع حركة السعر باتجاه المنطقة. هذا يصف ضغط الوصول إليها، ولا يثبت صلاحية المنطقة أو نجاح الصفقة.";
    } else if (awayRatio >= 0.60) {
        explanation =
            "المبادرة الغالبة في الممر تتوافق مع ضغط يدفع السعر بعيداً عن المنطقة. قد يؤخر ذلك الوصول إليها، لكنه لا يثبت إلغاء السيناريو.";
    } else {
        explanation =
            "المبادرة في الممر متقاربة نسبياً، ولا يظهر اتجاه واضح يهيمن على التنفيذات.";
    }

    return {
        status: "context",
        label: "سياق الوصول إلى المنطقة",
        towardZoneSide,
        towardZoneRatio: towardRatio,
        awayFromZoneRatio: awayRatio,
        explanation
    };
}


/* =====================================
   STRATEGIC VERDICT
===================================== */

function evaluateStrategy(
    direction,
    position,
    zoneEvidence,
    sourceEvaluation,
    approachEvaluation
) {

    const zoneFlow = getFlow(zoneEvidence.trades);

    const primaryFlow = classifyDirectionalFlow(
        zoneFlow,
        direction,
        CONFIG.MIN_ZONE_TRADES
    );

    const available = sourceEvaluation.sources.filter(
        source => source.result.status !== "insufficient"
    );

    const supportCount = available.filter(
        source => source.result.status === "support"
    ).length;

    const opposeCount = available.filter(
        source => source.result.status === "oppose"
    ).length;

    const neutralCount = available.filter(
        source => source.result.status === "neutral"
    ).length;

    let verdict = "insufficient";
    let title = "الأدلة غير كافية";
    let explanation = "";
    let tone = "neutral";

    if (zoneEvidence.count < CONFIG.MIN_ZONE_TRADES) {

        verdict = "insufficient";
        title = "لا يوجد تأكيد كافٍ من داخل المنطقة";
        tone = "neutral";

        explanation =
            `رصد المحرك ${zoneEvidence.count} تنفيذاً فقط داخل منطقة الدخول. ` +
            "هذا لا يعني أن المنطقة ضعيفة أو أن السيناريو خاطئ؛ بل يعني أن العينة لا تحتوي على تفاعل كافٍ داخل المنطقة للحكم عليها. " +
            "يمكن الاستفادة من تحليل الممر المؤدي إليها لفهم ضغط الوصول، لكن لا يجوز اعتباره تأكيداً للمنطقة.";

    } else if (
        primaryFlow.status === "support" &&
        supportCount >= 2 &&
        opposeCount === 0
    ) {

        verdict = "support";
        title = "الأدلة تؤيد سيناريو الصفقة";
        tone = "positive";

        explanation =
            `المبادرة داخل المنطقة تميل إلى اتجاه ${formatDirection(direction)}، ` +
            "كما أن أكثر من مصدر تحليلي يدعم هذا الاتجاه دون ظهور مصدر متاح يعارضه بوضوح. " +
            "هذا توافق بين الأدلة المرصودة والسيناريو، وليس ضماناً للارتداد أو نجاح الصفقة.";

    } else if (
        primaryFlow.status === "oppose" &&
        opposeCount >= 2 &&
        supportCount === 0
    ) {

        verdict = "oppose";
        title = "الأدلة تعارض سيناريو الصفقة";
        tone = "negative";

        explanation =
            `المبادرة داخل المنطقة تميل عكس اتجاه ${formatDirection(direction)}، ` +
            "وتظهر هذه الإشارة في أكثر من مصدر متاح. هذه علامة تحذير تستحق الانتباه، لكنها لا تعني أن الصفقة مستحيلة أو أن المنطقة فشلت حتماً.";

    } else if (
        supportCount > 0 &&
        opposeCount > 0
    ) {

        verdict = "mixed";
        title = "الأدلة مختلطة";
        tone = "warning";

        explanation =
            "توجد مصادر تدعم سيناريو الصفقة وأخرى تعارضه. لا يصح اختزال هذا الاختلاف في تأييد أو رفض قاطع. يجب النظر إلى تفاصيل كل مصدر، وحجم التنفيذات، ومكان حدوثها داخل المنطقة.";

    } else if (
        primaryFlow.status === "neutral" ||
        neutralCount > 0
    ) {

        verdict = "mixed";
        title = "لا يوجد اتجاه حاسم";
        tone = "warning";

        explanation =
            "التنفيذات داخل المنطقة لا تظهر تفوقاً واضحاً للمبادرة المتوافقة مع السيناريو أو المعارضة له. البيانات موجودة، لكنها لا تقدم تأكيداً اتجاهياً قوياً.";

    } else {

        verdict = "insufficient";
        title = "الأدلة غير كافية";
        tone = "neutral";

        explanation =
            "توجد بعض البيانات داخل المنطقة، لكن المصادر المتاحة لا تكوّن صورة متماسكة تسمح بتأييد السيناريو أو معارضته.";
    }

    const reasons = [];

    reasons.push({
        name: "تدفق التنفيذات داخل المنطقة",
        status: primaryFlow.label,
        detail: primaryFlow.status === "insufficient"
            ? "عدد التنفيذات أقل من الحد المطلوب للتحليل."
            : `المبادرة المتوافقة مع السيناريو تمثل ${(primaryFlow.alignedRatio * 100).toFixed(1)}% من قيمة التنفيذات، مقابل ${(primaryFlow.opposingRatio * 100).toFixed(1)}% للمبادرة المعارضة.`
    });

    for (const source of sourceEvaluation.sources) {
        reasons.push({
            name: source.name,
            status: source.result.label,
            detail: source.description
        });
    }

    return {
        verdict,
        title,
        tone,
        explanation,

        direction,
        directionName: formatDirection(direction),

        zoneTradeCount: zoneEvidence.count,

        primaryFlow,
        supportCount,
        opposeCount,
        neutralCount,
        availableSources: available.length,

        reasons,

        approach: approachEvaluation,

        interpretation:
            "هذا التقييم يقيس توافق الأدلة المرصودة مع سيناريو الصفقة، ولا يمثل احتمال نجاح الصفقة أو توقعاً مضموناً لاتجاه السعر.",

        advisorOnly: true
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
        referencePrice,
        zone,
        position
    );

    const historicalInteraction =
        analyzeHistoricalInteraction(trades, zone);

    const sourceEvaluation = evaluateZoneSources(
        zoneEvidence.trades,
        direction
    );

    const approachEvaluation = evaluateApproach(
        approach,
        position,
        direction
    );

    const evaluation = evaluateStrategy(
        direction,
        position,
        zoneEvidence,
        sourceEvaluation,
        approachEvaluation
    );

    return {
        market,

        strategy: {
            symbol,
            direction,
            zone
        },

        referencePrice,

        position,

        evaluation,

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

            historicalInteraction,

            sourceEvaluation
        },

        limitations: [
            "السعر المرجعي هو آخر تنفيذ في الفترة المختارة وليس السعر اللحظي.",
            "غياب التنفيذات داخل المنطقة لا يعني وجود ضغط معاكس.",
            "التنفيذات العامة لا تثبت أنها تعود إلى حساب واحد.",
            "الصفقات الكبيرة لا تثبت وحدها وجود حوت واحد.",
            "التنفيذات لا تكشف الأوامر المخفية أو هوية أصحابها.",
            "المبادرة الشرائية أو البيعية لا تكشف وحدها الطرف السلبي الذي استقبل التنفيذ.",
            "تحليل الممر يصف ضغط التنفيذات ولا يثبت أن الحركة ستستمر حتى المنطقة.",
            "التنفيذات لا تثبت أن ذيل شمعة لمس حدود المنطقة.",
            "مصادر الأدلة الأربعة مشتقة من مجموعة التنفيذات نفسها، ولذلك لا تعد أربعة مصادر مستقلة إحصائياً.",
            "التقييم يقيس توافق الأدلة مع السيناريو ولا يحسب احتمال نجاح الصفقة."
        ]
    };
                                     }
       
