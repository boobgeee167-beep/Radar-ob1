
/**
 * WHALE RADAR
 * WHALE & INSTITUTIONAL INTELLIGENCE ENGINE
 *
 * الهدف:
 * رصد بصمة رأس المال الكبير حول منطقة الدخول،
 * وتحديد مدى توافقها مع اتجاه الصفقة.
 *
 * يعتمد حصراً على Binance Spot aggTrades التاريخية.
 * لا يجمع بيانات جديدة ولا يستخدم السعر اللحظي.
 *
 * لا يدّعي معرفة هوية الحيتان أو الصناديق.
 */

import { fetchMarketData } from "./market-data.js";

const CONFIG = {
    MIN_ZONE_TRADES: 10,
    MIN_LARGE_TRADES: 3,
    MIN_CAPITAL_TRADES: 3,
    MIN_CLUSTER_TRADES: 5,
    MIN_CLUSTER_WINDOWS: 2,

    LARGE_TRADE_PERCENTILE: 95,
    CAPITAL_PERCENTILE: 90,

    CLUSTER_WINDOW_MS: 60 * 1000,
    ACTIVITY_WINDOW_MS: 60 * 1000,

    DIRECTIONAL_THRESHOLD: 0.15,
    STRONG_DIRECTION_THRESHOLD: 0.35,
    FLAT_RETURN_PCT: 0.03,

    PRICE_BUCKETS: 12
};

/* =====================================================
   أدوات حسابية
===================================================== */

const sum = values =>
    values.reduce((total, value) => total + (Number(value) || 0), 0);

const average = values =>
    values.length ? sum(values) / values.length : 0;

const percentile = (values, percent) => {
    if (!values.length) return 0;

    const sorted = [...values].sort((a, b) => a - b);

    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(percent / 100 * sorted.length) - 1)
    );

    return sorted[index];
};

const safeRatio = (a, b) => b > 0 ? a / b : 0;

const round = (value, digits = 2) => {
    if (!Number.isFinite(Number(value))) return 0;

    const factor = 10 ** digits;
    return Math.round(Number(value) * factor) / factor;
};

const formatNumber = (value, digits = 2) =>
    Number(value || 0).toLocaleString("en-US", {
        maximumFractionDigits: digits
    });

const formatMoney = value =>
    "$" + formatNumber(value, 2);

const formatPercent = value =>
    (value > 0 ? "+" : "") + formatNumber(value, 2) + "%";

const getSide = trade =>
    trade.buyerIsMaker ? "sell" : "buy";

/*
 * buyerIsMaker = true:
 * البائع هو الطرف المبادر.
 *
 * buyerIsMaker = false:
 * المشتري هو الطرف المبادر.
 */

function getFlow(trades) {
    let buyValue = 0;
    let sellValue = 0;
    let buyCount = 0;
    let sellCount = 0;

    for (const trade of trades) {
        if (getSide(trade) === "buy") {
            buyValue += trade.value;
            buyCount++;
        } else {
            sellValue += trade.value;
            sellCount++;
        }
    }

    const totalValue = buyValue + sellValue;

    return {
        buyValue,
        sellValue,
        buyCount,
        sellCount,
        totalCount: buyCount + sellCount,
        totalValue,
        buyRatio: safeRatio(buyValue, totalValue),
        sellRatio: safeRatio(sellValue, totalValue),
        imbalance: safeRatio(
            buyValue - sellValue,
            totalValue
        )
    };
}

/* =====================================================
   تجهيز البيانات
===================================================== */

function validateTrades(rawTrades) {
    if (!Array.isArray(rawTrades)) return [];

    return rawTrades
        .map(trade => {
            const price = Number(trade.price);
            const quantity = Number(trade.quantity);
            const value = Number(trade.value || price * quantity);

            return {
                ...trade,
                price,
                quantity,
                value,
                time: Number(trade.time)
            };
        })
        .filter(trade =>
            Number.isFinite(trade.price) &&
            trade.price > 0 &&
            Number.isFinite(trade.quantity) &&
            trade.quantity > 0 &&
            Number.isFinite(trade.value) &&
            trade.value > 0 &&
            Number.isFinite(trade.time)
        )
        .sort((a, b) => a.time - b.time);
}

function getReferencePrice(trades) {
    return trades.length ? trades[trades.length - 1].price : 0;
}

function getPriceChange(first, last) {
    if (!first || !last) return 0;
    return (last - first) / first * 100;
}

function getTradeRange(trades) {
    if (!trades.length) {
        return {
            count: 0,
            firstPrice: 0,
            lastPrice: 0,
            high: 0,
            low: 0,
            changePct: 0,
            firstTime: null,
            lastTime: null
        };
    }

    const first = trades[0];
    const last = trades[trades.length - 1];
    const prices = trades.map(item => item.price);

    return {
        count: trades.length,
        firstPrice: first.price,
        lastPrice: last.price,
        high: Math.max(...prices),
        low: Math.min(...prices),
        changePct: getPriceChange(first.price, last.price),
        firstTime: first.time,
        lastTime: last.time
    };
}

/* =====================================================
   منطقة الدخول وموقع السعر
===================================================== */

function analyzeZonePosition(referencePrice, upper, lower) {
    if (!referencePrice || !upper || !lower) {
        return {
            position: "unknown",
            inside: false,
            distancePct: 0,
            description: "تعذر تحديد موقع السعر"
        };
    }

    if (referencePrice > upper) {
        const distancePct = (referencePrice - upper) / upper * 100;

        return {
            position: "above",
            inside: false,
            distancePct,
            description: `السعر أعلى المنطقة بنسبة ${formatNumber(distancePct, 3)}%`
        };
    }

    if (referencePrice < lower) {
        const distancePct = (lower - referencePrice) / lower * 100;

        return {
            position: "below",
            inside: false,
            distancePct,
            description: `السعر أسفل المنطقة بنسبة ${formatNumber(distancePct, 3)}%`
        };
    }

    return {
        position: "inside",
        inside: true,
        distancePct: 0,
        description: "السعر المرجعي داخل منطقة الدخول"
    };
}

function insideZone(trade, upper, lower) {
    return trade.price >= lower && trade.price <= upper;
}

function getApproachTrades(trades, referencePrice, upper, lower) {
    if (!trades.length || !referencePrice) return [];

    if (referencePrice > upper) {
        return trades.filter(trade =>
            trade.price > upper &&
            trade.price <= referencePrice
        );
    }

    if (referencePrice < lower) {
        return trades.filter(trade =>
            trade.price >= referencePrice &&
            trade.price < lower
        );
    }

    return trades.filter(trade =>
        insideZone(trade, upper, lower)
    );
}

/* =====================================================
   النوافذ الزمنية
===================================================== */

function buildTimeWindows(trades, windowMs = CONFIG.ACTIVITY_WINDOW_MS) {
    const buckets = new Map();

    for (const trade of trades) {
        const start = Math.floor(trade.time / windowMs) * windowMs;

        if (!buckets.has(start)) {
            buckets.set(start, {
                startTime: start,
                endTime: start + windowMs,
                trades: [],
                buyValue: 0,
                sellValue: 0,
                buyCount: 0,
                sellCount: 0,
                firstPrice: trade.price,
                lastPrice: trade.price,
                high: trade.price,
                low: trade.price
            });
        }

        const bucket = buckets.get(start);

        bucket.trades.push(trade);
        bucket.lastPrice = trade.price;
        bucket.high = Math.max(bucket.high, trade.price);
        bucket.low = Math.min(bucket.low, trade.price);

        if (getSide(trade) === "buy") {
            bucket.buyValue += trade.value;
            bucket.buyCount++;
        } else {
            bucket.sellValue += trade.value;
            bucket.sellCount++;
        }
    }

    return [...buckets.values()]
        .sort((a, b) => a.startTime - b.startTime)
        .map(bucket => {
            const totalValue = bucket.buyValue + bucket.sellValue;

            return {
                ...bucket,
                totalValue,
                totalCount: bucket.buyCount + bucket.sellCount,
                imbalance: safeRatio(
                    bucket.buyValue - bucket.sellValue,
                    totalValue
                ),
                priceChangePct: getPriceChange(
                    bucket.firstPrice,
                    bucket.lastPrice
                )
            };
        });
}

/* =====================================================
   استجابة السعر
===================================================== */

function analyzePriceResponse(trades) {
    const windows = buildTimeWindows(trades);

    const analyzed = windows.map(window => {
        const buyDominant =
            window.imbalance >= CONFIG.DIRECTIONAL_THRESHOLD;

        const sellDominant =
            window.imbalance <= -CONFIG.DIRECTIONAL_THRESHOLD;

        const priceUp =
            window.priceChangePct > CONFIG.FLAT_RETURN_PCT;

        const priceDown =
            window.priceChangePct < -CONFIG.FLAT_RETURN_PCT;

        let behavior = "balanced";

        if (buyDominant && priceUp) {
            behavior = "effective_buy_pressure";
        } else if (sellDominant && priceDown) {
            behavior = "effective_sell_pressure";
        } else if (buyDominant && !priceUp) {
            behavior = "possible_supply_response";
        } else if (sellDominant && !priceDown) {
            behavior = "possible_demand_response";
        }

        return {
            ...window,
            behavior
        };
    });

    const behaviorCounts = {
        effectiveBuy: analyzed.filter(
            item => item.behavior === "effective_buy_pressure"
        ).length,

        effectiveSell: analyzed.filter(
            item => item.behavior === "effective_sell_pressure"
        ).length,

        possibleSupply: analyzed.filter(
            item => item.behavior === "possible_supply_response"
        ).length,

        possibleDemand: analyzed.filter(
            item => item.behavior === "possible_demand_response"
        ).length,

        balanced: analyzed.filter(
            item => item.behavior === "balanced"
        ).length
    };

    return {
        windows: analyzed,
        totalWindows: analyzed.length,
        meaningfulWindows: analyzed.filter(
            item => item.behavior !== "balanced"
        ).length,
        behaviorCounts,
        recent: analyzed.slice(-10),
        summary: buildResponseSummary(behaviorCounts)
    };
}

function buildResponseSummary(counts) {
    if (
        !counts.effectiveBuy &&
        !counts.effectiveSell &&
        !counts.possibleDemand &&
        !counts.possibleSupply
    ) {
        return "لا توجد استجابة سعرية حاسمة في النوافذ المرصودة.";
    }

    if (
        counts.possibleDemand >= 2 &&
        counts.possibleDemand > counts.effectiveSell
    ) {
        return "تكرر البيع المبادر دون هبوط متناسب؛ قرينة محتملة على وجود طلب مقابل.";
    }

    if (
        counts.possibleSupply >= 2 &&
        counts.possibleSupply > counts.effectiveBuy
    ) {
        return "تكرر الشراء المبادر دون صعود متناسب؛ قرينة محتملة على وجود عرض مقابل.";
    }

    if (counts.effectiveBuy > counts.effectiveSell) {
        return "الأثر السعري للشراء المبادر كان أوضح.";
    }

    if (counts.effectiveSell > counts.effectiveBuy) {
        return "الأثر السعري للبيع المبادر كان أوضح.";
    }

    return "استجابة السعر مختلطة وغير حاسمة.";
}

/* =====================================================
   الصفقات الكبيرة
===================================================== */

function getLargeTradeThreshold(trades) {
    return percentile(
        trades.map(trade => trade.value),
        CONFIG.LARGE_TRADE_PERCENTILE
    );
}

function analyzeLargeTrades(trades, threshold) {
    const selected = trades.filter(
        trade => threshold > 0 && trade.value >= threshold
    );

    const flow = getFlow(selected);

    return {
        threshold,
        count: selected.length,
        totalValue: flow.totalValue,
        averageValue: average(selected.map(item => item.value)),
        largestTrade: selected.length
            ? Math.max(...selected.map(item => item.value))
            : 0,
        buyCount: flow.buyCount,
        sellCount: flow.sellCount,
        buyValue: flow.buyValue,
        sellValue: flow.sellValue,
        buyRatio: flow.buyRatio,
        sellRatio: flow.sellRatio,
        imbalance: flow.imbalance,
        trades: selected.slice(-20),
        status: selected.length >= CONFIG.MIN_LARGE_TRADES
            ? "sufficient"
            : "limited"
    };
}

/* =====================================================
   عناقيد التنفيذ
===================================================== */

function analyzeClusters(trades) {
    const windows = buildTimeWindows(
        trades,
        CONFIG.CLUSTER_WINDOW_MS
    );

    const clusters = windows.filter(
        window => window.totalCount >= CONFIG.MIN_CLUSTER_TRADES
    );

    const buyClusters = clusters.filter(
        item => item.imbalance >= CONFIG.DIRECTIONAL_THRESHOLD
    );

    const sellClusters = clusters.filter(
        item => item.imbalance <= -CONFIG.DIRECTIONAL_THRESHOLD
    );

    const buyValue = sum(clusters.map(item => item.buyValue));
    const sellValue = sum(clusters.map(item => item.sellValue));

    return {
        count: clusters.length,
        activeWindows: windows.length,
        buyCount: buyClusters.length,
        sellCount: sellClusters.length,
        buyValue,
        sellValue,
        totalValue: buyValue + sellValue,
        imbalance: safeRatio(
            buyValue - sellValue,
            buyValue + sellValue
        ),
        largestClusterValue: clusters.length
            ? Math.max(...clusters.map(item => item.totalValue))
            : 0,
        clusters: clusters.slice(-20),
        status: clusters.length >= CONFIG.MIN_CLUSTER_WINDOWS
            ? "sufficient"
            : "limited"
    };
}

/* =====================================================
   بصمة رأس المال
===================================================== */

function getCapitalThreshold(trades) {
    return percentile(
        trades.map(trade => trade.value),
        CONFIG.CAPITAL_PERCENTILE
    );
}

function analyzeCapital(trades, threshold) {
    const selected = trades.filter(
        trade => threshold > 0 && trade.value >= threshold
    );

    const flow = getFlow(selected);
    const prices = selected.map(item => item.price);

    let concentration = [];

    if (prices.length) {
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const spread = maxPrice - minPrice;
        const bucketSize = spread > 0
            ? spread / CONFIG.PRICE_BUCKETS
            : 1;

        const buckets = new Map();

        for (const trade of selected) {
            const index = spread > 0
                ? Math.min(
                    CONFIG.PRICE_BUCKETS - 1,
                    Math.floor((trade.price - minPrice) / bucketSize)
                )
                : 0;

            if (!buckets.has(index)) {
                buckets.set(index, {
                    index,
                    low: minPrice + index * bucketSize,
                    high: minPrice + (index + 1) * bucketSize,
                    buyValue: 0,
                    sellValue: 0,
                    count: 0
                });
            }

            const bucket = buckets.get(index);

            if (getSide(trade) === "buy") {
                bucket.buyValue += trade.value;
            } else {
                bucket.sellValue += trade.value;
            }

            bucket.count++;
        }

        concentration = [...buckets.values()]
            .map(bucket => ({
                ...bucket,
                totalValue: bucket.buyValue + bucket.sellValue,
                imbalance: safeRatio(
                    bucket.buyValue - bucket.sellValue,
                    bucket.buyValue + bucket.sellValue
                )
            }))
            .sort((a, b) => b.totalValue - a.totalValue);
    }

    return {
        threshold,
        count: selected.length,
        totalValue: flow.totalValue,
        buyCount: flow.buyCount,
        sellCount: flow.sellCount,
        buyValue: flow.buyValue,
        sellValue: flow.sellValue,
        buyRatio: flow.buyRatio,
        sellRatio: flow.sellRatio,
        imbalance: flow.imbalance,
        averageValue: average(selected.map(item => item.value)),
        largestTrade: selected.length
            ? Math.max(...selected.map(item => item.value))
            : 0,
        concentration: concentration.slice(0, 10),
        status: selected.length >= CONFIG.MIN_CAPITAL_TRADES
            ? "sufficient"
            : "limited"
    };
}

/* =====================================================
   نشاط الشراء والبيع
===================================================== */

function analyzeActivity(trades) {
    const flow = getFlow(trades);

    const windows = buildTimeWindows(
        trades,
        CONFIG.ACTIVITY_WINDOW_MS
    );

    const buyDominantWindows = windows.filter(
        item => item.imbalance >= CONFIG.DIRECTIONAL_THRESHOLD
    );

    const sellDominantWindows = windows.filter(
        item => item.imbalance <= -CONFIG.DIRECTIONAL_THRESHOLD
    );

    return {
        ...flow,
        activeWindows: windows.length,
        buyDominantWindows: buyDominantWindows.length,
        sellDominantWindows: sellDominantWindows.length,
        windows: windows.slice(-20),
        status: windows.length >= CONFIG.MIN_ACTIVITY_WINDOWS
            ? "sufficient"
            : "limited"
    };
}

/* =====================================================
   تحليل طبقة
===================================================== */

function analyzeLayer(trades, thresholds) {
    return {
        range: getTradeRange(trades),
        flow: getFlow(trades),
        largeTrades: analyzeLargeTrades(
            trades,
            thresholds.large
        ),
        clusters: analyzeClusters(trades),
        capital: analyzeCapital(
            trades,
            thresholds.capital
        ),
        activity: analyzeActivity(trades),
        priceResponse: analyzePriceResponse(trades)
    };
}

/* =====================================================
   اتجاه البصمة المؤسسية
===================================================== */

function getAlignedImbalance(imbalance, direction) {
    return direction === "long" ? imbalance : -imbalance;
}

function analyzeInstitutionalFootprint(layer, direction) {
    const large = layer.largeTrades;
    const capital = layer.capital;
    const clusters = layer.clusters;

    const largeAligned = getAlignedImbalance(
        large.imbalance,
        direction
    );

    const capitalAligned = getAlignedImbalance(
        capital.imbalance,
        direction
    );

    const clustersAligned = getAlignedImbalance(
        clusters.imbalance,
        direction
    );

    const largeAvailable =
        large.count >= CONFIG.MIN_LARGE_TRADES;

    const capitalAvailable =
        capital.count >= CONFIG.MIN_CAPITAL_TRADES;

    const clustersAvailable =
        clusters.count >= CONFIG.MIN_CLUSTER_WINDOWS;

    const largeSupport =
        largeAvailable &&
        largeAligned >= CONFIG.DIRECTIONAL_THRESHOLD;

    const capitalSupport =
        capitalAvailable &&
        capitalAligned >= CONFIG.DIRECTIONAL_THRESHOLD;

    const clustersSupport =
        clustersAvailable &&
        clustersAligned >= CONFIG.DIRECTIONAL_THRESHOLD;

    const largeOppose =
        largeAvailable &&
        largeAligned <= -CONFIG.DIRECTIONAL_THRESHOLD;

    const capitalOppose =
        capitalAvailable &&
        capitalAligned <= -CONFIG.DIRECTIONAL_THRESHOLD;

    const clustersOppose =
        clustersAvailable &&
        clustersAligned <= -CONFIG.DIRECTIONAL_THRESHOLD;

    const response = layer.priceResponse.behaviorCounts;

    const responseSupport = direction === "long"
        ? response.effectiveBuy > response.effectiveSell ||
          response.possibleDemand >= 2
        : response.effectiveSell > response.effectiveBuy ||
          response.possibleSupply >= 2;

    const responseOppose = direction === "long"
        ? response.effectiveSell >= 2
        : response.effectiveBuy >= 2;

    const supportCount = [
        largeSupport,
        capitalSupport,
        clustersSupport
    ].filter(Boolean).length;

    const opposeCount = [
        largeOppose,
        capitalOppose,
        clustersOppose
    ].filter(Boolean).length;

    const evidenceAvailable = [
        largeAvailable,
        capitalAvailable,
        clustersAvailable
    ].filter(Boolean).length;

    let status = "unclear";
    let title = "بصمة رأس المال غير محسومة";
    let tone = "neutral";

    /*
     * لا نعتبر المقاييس الثلاثة مصادر مستقلة.
     * نطلب توافقاً في أكثر من نوع من خصائص التنفيذ.
     */

    if (
        supportCount >= 2 &&
        supportCount > opposeCount
    ) {
        status = "aligned";
        title = "بصمة كبيرة متوافقة مع الصفقة";
        tone = "positive";
    } else if (
        opposeCount >= 2 &&
        opposeCount > supportCount
    ) {
        status = "opposed";
        title = "بصمة كبيرة في الاتجاه المعاكس";
        tone = "negative";
    } else if (
        supportCount &&
        opposeCount
    ) {
        status = "mixed";
        title = "بصمة رأس المال مختلطة";
        tone = "warning";
    } else if (!evidenceAvailable) {
        status = "insufficient";
        title = "لا توجد بصمة كبيرة كافية";
        tone = "neutral";
    } else if (supportCount === 1) {
        status = "possible";
        title = "ظهرت إشارة كبيرة مؤيدة";
        tone = "warning";
    } else if (opposeCount === 1) {
        status = "possible_opposition";
        title = "ظهرت إشارة كبيرة معاكسة";
        tone = "warning";
    }

    let strength = "ضعيفة";

    if (supportCount >= 2 && largeAvailable && capitalAvailable) {
        strength = "قوية نسبياً";
    } else if (supportCount >= 2 || evidenceAvailable >= 2) {
        strength = "متوسطة";
    }

    const details = [];

    if (largeAvailable) {
        details.push(
            `التنفيذات الكبيرة: ${large.count}، وقيمتها ${formatMoney(large.totalValue)}، وميلها ${largeAligned > 0 ? "مؤيد" : largeAligned < 0 ? "معاكس" : "متوازن"}.`
        );
    } else {
        details.push("عينة الصفقات الكبيرة غير كافية.");
    }

    if (capitalAvailable) {
        details.push(
            `شريحة رأس المال الأعلى: ${capital.count} تنفيذات، وميلها ${capitalAligned > 0 ? "مؤيد" : capitalAligned < 0 ? "معاكس" : "متوازن"}.`
        );
    } else {
        details.push("عينة رأس المال الكبير غير كافية.");
    }

    if (clustersAvailable) {
        details.push(
            `عناقيد التنفيذ: ${clusters.count}، منها ${clusters.buyCount} مائلة للشراء و${clusters.sellCount} مائلة للبيع.`
        );
    } else {
        details.push("لم تتشكل عناقيد متكررة كافية.");
    }

    return {
        status,
        title,
        tone,
        strength,
        supportCount,
        opposeCount,
        evidenceAvailable,
        largeSupport,
        capitalSupport,
        clustersSupport,
        largeOppose,
        capitalOppose,
        clustersOppose,
        responseSupport,
        responseOppose,
        details,
        summary: buildFootprintSummary(
            status,
            direction,
            strength,
            details
        )
    };
}

function buildFootprintSummary(status, direction, strength, details) {
    const directionLabel = direction === "long" ? "LONG" : "SHORT";

    switch (status) {
        case "aligned":
            return `توجد بصمة تنفيذات كبيرة تتوافق مع اتجاه ${directionLabel}، وقوتها ${strength}. ${details.join(" ")}`;

        case "opposed":
            return `البصمة الكبيرة تميل إلى الاتجاه المعاكس لصفقة ${directionLabel}. ${details.join(" ")}`;

        case "mixed":
            return `توجد بصمات كبيرة متعارضة، ولا يمكن اعتبارها تأييداً واضحاً لصفقة ${directionLabel}. ${details.join(" ")}`;

        case "possible":
            return `ظهرت قرينة واحدة مؤيدة لاتجاه ${directionLabel}، لكنها لا تكفي لإثبات نشاط مؤسسي متوافق. ${details.join(" ")}`;

        case "possible_opposition":
            return `ظهرت قرينة واحدة معاكسة لاتجاه ${directionLabel}، لكنها لا تكفي للحكم بوجود ضغط مؤسسي معاكس. ${details.join(" ")}`;

        default:
            return `لا تتوفر أدلة كافية لتحديد بصمة رأس المال حول سيناريو ${directionLabel}. ${details.join(" ")}`;
    }
}

/* =====================================================
   مسار الوصول
===================================================== */

function analyzeScenarioPath(direction, position, approach, zone) {
    const isLong = direction === "long";

    const expectedApproach =
        (isLong && position.position === "above") ||
        (!isLong && position.position === "below");

    let pathDescription;
    let pathStatus = "neutral";

    if (position.inside) {
        pathDescription =
            "السعر المرجعي داخل منطقة الدخول.";
    } else if (expectedApproach) {
        pathDescription = isLong
            ? "هبوط السعر من الأعلى نحو منطقة LONG هو مسار الوصول المتوقع، وليس تعارضاً."
            : "صعود السعر من الأسفل نحو منطقة SHORT هو مسار الوصول المتوقع، وليس تعارضاً.";

        pathStatus = "expected";
    } else {
        pathDescription = isLong
            ? "السعر أسفل منطقة LONG حالياً؛ تجاوز الحدود سعرياً، لكن ذلك وحده لا يثبت تسلسل الاختراق."
            : "السعر أعلى منطقة SHORT حالياً؛ تجاوز الحدود سعرياً، لكن ذلك وحده لا يثبت تسلسل الاختراق.";

        pathStatus = "beyond";
    }

    let approachInterpretation =
        "لا توجد عينة كافية لوصف حركة السعر في ممر الوصول.";

    if (approach.range.count >= 2) {
        const change = approach.range.changePct;

        if (expectedApproach) {
            const towardZone =
                (isLong && change < 0) ||
                (!isLong && change > 0);

            approachInterpretation = towardZone
                ? "تغير الأسعار في عينة الممر يتوافق إجمالاً مع الاقتراب من المنطقة."
                : "لم يظهر تغير صافٍ واضح باتجاه المنطقة في عينة الممر.";
        } else {
            approachInterpretation =
                "السعر ليس في جهة الاقتراب المعتادة لهذا السيناريو.";
        }
    }

    return {
        expectedApproach,
        pathStatus,
        pathDescription,
        approachInterpretation,
        approachPriceChangePct: approach.range.changePct,
        approachTradeCount: approach.range.count,
        zoneTradeCount: zone.range.count,
        zonePriceChangePct: zone.range.changePct
    };
}

/* =====================================================
   تقييم المنطقة
===================================================== */

function evaluateZoneEvidence(direction, zone) {
    const flow = zone.flow;
    const response = zone.priceResponse.behaviorCounts;

    const result = {
        status: "limited",
        supportive: [],
        caution: [],
        neutral: [],
        explanation: ""
    };

    if (flow.totalCount < CONFIG.MIN_ZONE_TRADES) {
        result.status = "not_tested";
        result.neutral.push(
            `عدد التداولات داخل المنطقة ${flow.totalCount} فقط؛ لا تكفي العينة لتقييم رد الفعل.`
        );

        result.explanation =
            "المنطقة لم تُختبر بعينة تداول كافية. هذا نقص في البيانات وليس دليلاً ضد الصفقة.";

        return result;
    }

    result.status = "observed";

    const alignedFlow = getAlignedImbalance(
        flow.imbalance,
        direction
    );

    if (alignedFlow >= CONFIG.DIRECTIONAL_THRESHOLD) {
        result.supportive.push(
            "المبادرة داخل المنطقة تميل إلى اتجاه الصفقة."
        );
    } else if (alignedFlow <= -CONFIG.DIRECTIONAL_THRESHOLD) {
        result.caution.push(
            "المبادرة داخل المنطقة تميل إلى الاتجاه المعاكس."
        );
    } else {
        result.neutral.push(
            "المبادرة داخل المنطقة متوازنة نسبياً."
        );
    }

    if (direction === "long") {
        if (response.possibleDemand >= 2) {
            result.supportive.push(
                "تكرر البيع المبادر دون هبوط متناسب؛ قرينة محتملة على طلب مقابل."
            );
        }

        if (response.effectiveSell >= 2) {
            result.caution.push(
                "تكرر البيع المبادر المصحوب بهبوط سعري."
            );
        }
    } else {
        if (response.possibleSupply >= 2) {
            result.supportive.push(
                "تكرر الشراء المبادر دون صعود متناسب؛ قرينة محتملة على عرض مقابل."
            );
        }

        if (response.effectiveBuy >= 2) {
            result.caution.push(
                "تكرر الشراء المبادر المصحوب بصعود سعري."
            );
        }
    }

    result.explanation =
        result.supportive.length || result.caution.length
            ? "توجد قرائن على سلوك السوق داخل المنطقة، ويجب قراءتها مع بصمة التنفيذات الكبيرة."
            : "لم يظهر سلوك اتجاهي حاسم داخل المنطقة.";

    return result;
}

/* =====================================================
   القرار النهائي: يركز على بصمة رأس المال
===================================================== */

function evaluateStrategy(
    direction,
    position,
    scenario,
    globalLayer,
    approachLayer,
    zoneLayer,
    zoneEvaluation,
    footprint
) {
    const supportive = [];
    const caution = [];
    const neutral = [];
    const reasons = [];

    const directionLabel = direction === "long" ? "LONG" : "SHORT";

    const zoneWasTested =
        zoneEvaluation.status === "observed";

    const referenceLayer =
        zoneWasTested
            ? zoneLayer
            : approachLayer.range.count >= CONFIG.MIN_ZONE_TRADES
                ? approachLayer
                : globalLayer;

    const referenceLayerName =
        zoneWasTested
            ? "داخل منطقة الدخول"
            : referenceLayer === approachLayer
                ? "ممر الوصول"
                : "الفترة العامة";

    if (footprint.status === "aligned") {
        supportive.push(
            `بصمة التنفيذات الكبيرة تميل إلى اتجاه ${directionLabel}.`
        );
    } else if (
        footprint.status === "opposed" ||
        footprint.status === "possible_opposition"
    ) {
        caution.push(
            "ظهرت بصمة تنفيذات كبيرة تميل إلى الاتجاه المعاكس."
        );
    } else if (
        footprint.status === "mixed"
    ) {
        neutral.push(
            "بصمة رأس المال متضاربة بين الشراء والبيع."
        );
    } else {
        neutral.push(
            "لا توجد بصمة كبيرة كافية لتأكيد اتجاه رأس المال."
        );
    }

    if (zoneWasTested) {
        supportive.push(...zoneEvaluation.supportive);
        caution.push(...zoneEvaluation.caution);
        neutral.push(...zoneEvaluation.neutral);
    } else {
        neutral.push(
            "منطقة الدخول لم توفر عينة كافية لاختبار سلوك رأس المال داخلها."
        );
    }

    const response = referenceLayer.priceResponse.behaviorCounts;

    if (direction === "long") {
        if (response.possibleDemand >= 2) {
            supportive.push(
                "تكرر البيع المبادر دون هبوط متناسب؛ وهذا يتوافق مع احتمال وجود طلب مقابل."
            );
        }

        if (response.effectiveSell >= 3) {
            caution.push(
                "تكرر ضغط بيع مبادر أحدث هبوطاً سعرياً فعلياً."
            );
        }
    } else {
        if (response.possibleSupply >= 2) {
            supportive.push(
                "تكرر الشراء المبادر دون صعود متناسب؛ وهذا يتوافق مع احتمال وجود عرض مقابل."
            );
        }

        if (response.effectiveBuy >= 3) {
            caution.push(
                "تكرر ضغط شراء مبادر أحدث صعوداً سعرياً فعلياً."
            );
        }
    }

    if (scenario.expectedApproach) {
        neutral.push(
            "حركة السعر نحو منطقة الدخول متوافقة مع سيناريو الوصول، ولا تُحسب ضد الصفقة."
        );
    }

    reasons.push({
        name: "بصمة رأس المال",
        status: footprint.status,
        text: footprint.summary
    });

    reasons.push({
        name: "منطقة الدخول",
        status: zoneWasTested ? "observed" : "pending",
        text: zoneEvaluation.explanation
    });

    reasons.push({
        name: "استجابة السعر",
        status: "observed",
        text: referenceLayer.priceResponse.summary
    });

    reasons.push({
        name: "مسار الوصول",
        status: scenario.pathStatus,
        text: scenario.pathDescription + " " + scenario.approachInterpretation
    });

    let verdict = "insufficient";
    let title = "لا توجد بصمة كافية";
    let tone = "neutral";
    let explanation = "";

    if (footprint.status === "aligned") {
        verdict = "support";
        title = "بصمة رأس مال كبيرة مؤيدة";
        tone = "positive";

        explanation =
            `رُصدت بصمة تنفيذات كبيرة تتوافق مع اتجاه ${directionLabel}. ` +
            (zoneWasTested
                ? "كما ظهرت تداولات كافية داخل منطقة الدخول لاختبار سلوكها."
                : "لكن منطقة الدخول لم تُختبر بعد بعينة كافية؛ البصمة المؤيدة لا تثبت أن هذه الجهات ستدخل عند المنطقة.");
    } else if (footprint.status === "opposed") {
        verdict = "oppose";
        title = "بصمة رأس مال كبيرة معاكسة";
        tone = "negative";

        explanation =
            `البصمة المرصودة تميل إلى الاتجاه المعاكس لصفقة ${directionLabel}. ` +
            "هذا تحذير مهم يستحق الانتباه، لكنه لا يمنعك من تنفيذ استراتيجيتك.";
    } else if (
        footprint.status === "mixed" ||
        supportive.length && caution.length
    ) {
        verdict = "mixed";
        title = "بصمة رأس المال مختلطة";
        tone = "warning";

        explanation =
            "هناك نشاط كبير، لكن اتجاهه غير متجانس أو أن الأدلة المؤيدة والمعاكسة متداخلة. لا توجد أفضلية مؤسسية واضحة.";
    } else if (footprint.status === "possible") {
        verdict = "context";
        title = "إشارة كبيرة مؤيدة — تحتاج دليلاً";
        tone = "warning";

        explanation =
            "ظهرت قرينة على نشاط كبير في اتجاه الصفقة، لكنها غير كافية لتأكيد وجود بصمة مؤسسية متماسكة.";
    } else if (footprint.status === "possible_opposition") {
        verdict = "context";
        title = "إشارة كبيرة معاكسة — تحتاج متابعة";
        tone = "warning";

        explanation =
            "ظهرت قرينة على نشاط كبير معاكس، لكنها لا تكفي وحدها لإثبات سيطرة رأس مال معاكس.";
    } else {
        verdict = "insufficient";
        title = "لا توجد بصمة كبيرة واضحة";
        tone = "neutral";

        explanation =
            "لم تظهر أدلة كافية على نشاط رأس مال كبير متماسك حول منطقة الدخول. هذا لا يعني أن الصفقة فاشلة؛ يعني أن الرادار لا يملك دليلاً مؤسسياً واضحاً.";
    }

    if (!zoneWasTested) {
        explanation +=
            " المنطقة لم تُختبر بعد بعينة كافية، ولذلك لا يمكن الجزم بسلوك الأموال الكبيرة عند وصول السعر إليها.";
    }

    return {
        verdict,
        title,
        tone,
        direction: directionLabel,
        explanation,
        supportive,
        caution,
        neutral,
        reasons,
        counts: {
            supportive: supportive.length,
            caution: caution.length,
            neutral: neutral.length
        },
        zoneTested: zoneWasTested,
        advisoryOnly: true,
        footprint,
        referenceLayer: referenceLayerName
    };
}

/* =====================================================
   بناء الأدلة
===================================================== */

function interpretFootprint(layer, label) {
    const large = layer.largeTrades;
    const capital = layer.capital;
    const clusters = layer.clusters;

    return [
        {
            name: `${label}: الصفقات الكبيرة`,
            status: large.status,
            text:
                `عدد التنفيذات الكبيرة ${large.count}، ` +
                `بقيمة ${formatMoney(large.totalValue)}. ` +
                `قيمة الشراء ${formatMoney(large.buyValue)}، ` +
                `وقيمة البيع ${formatMoney(large.sellValue)}.`
        },
        {
            name: `${label}: بصمة رأس المال`,
            status: capital.status,
            text:
                `عدد تنفيذات الشريحة العليا ${capital.count}، ` +
                `بقيمة ${formatMoney(capital.totalValue)}.`
        },
        {
            name: `${label}: عناقيد التنفيذ`,
            status: clusters.status,
            text:
                `عدد العناقيد ${clusters.count}، ` +
                `${clusters.buyCount} مائلة للشراء و${clusters.sellCount} مائلة للبيع.`
        },
        {
            name: `${label}: استجابة السعر`,
            status: layer.priceResponse.meaningfulWindows
                ? "observed"
                : "unclear",
            text: layer.priceResponse.summary
        }
    ];
}

function buildEvidence(
    globalLayer,
    approachLayer,
    zoneLayer,
    footprint
) {
    return {
        global: globalLayer,
        approach: approachLayer,
        zone: zoneLayer,

        largeTrades: globalLayer.largeTrades,
        clusters: globalLayer.clusters,
        capital: globalLayer.capital,
        activity: globalLayer.activity,

        institutionalFootprint: footprint,

        historicalInteraction: {
            global: globalLayer.priceResponse,
            approach: approachLayer.priceResponse,
            zone: zoneLayer.priceResponse
        },

        findings: [
            ...interpretFootprint(globalLayer, "الفترة كاملة"),
            ...interpretFootprint(approachLayer, "ممر الوصول"),
            ...interpretFootprint(zoneLayer, "داخل المنطقة"),
            {
                name: "القراءة المؤسسية",
                status: footprint.status,
                text: footprint.summary
            }
        ]
    };
}

/* =====================================================
   المحلل الرئيسي
===================================================== */

export async function analyzeStrategy(settings) {
    if (!settings?.strategy) {
        throw new Error("إعدادات منطقة الدخول غير موجودة");
    }

    const upper = Number(settings.strategy.upper);
    const lower = Number(settings.strategy.lower);

    const direction = String(
        settings.strategy.direction || "long"
    ).toLowerCase();

    if (
        !Number.isFinite(upper) ||
        !Number.isFinite(lower) ||
        upper <= 0 ||
        lower <= 0 ||
        upper < lower
    ) {
        throw new Error("حدود منطقة الدخول غير صحيحة");
    }

    if (!["long", "short"].includes(direction)) {
        throw new Error("اتجاه الصفقة يجب أن يكون LONG أو SHORT");
    }

    const market = await fetchMarketData(settings);
    const trades = validateTrades(market?.trades || []);

    if (!trades.length) {
        throw new Error("لم يتم العثور على تداولات صالحة في الفترة المحددة");
    }

    const referencePrice = getReferencePrice(trades);

    /*
     * العتبات تحسب من كامل الفترة،
     * ثم تطبق على الطبقات الثلاث.
     */

    const thresholds = {
        large: getLargeTradeThreshold(trades),
        capital: getCapitalThreshold(trades)
    };

    const position = analyzeZonePosition(
        referencePrice,
        upper,
        lower
    );

    const approachTrades = getApproachTrades(
        trades,
        referencePrice,
        upper,
        lower
    );

    const zoneTrades = trades.filter(trade =>
        insideZone(trade, upper, lower)
    );

    const globalLayer = analyzeLayer(trades, thresholds);
    const approachLayer = analyzeLayer(approachTrades, thresholds);
    const zoneLayer = analyzeLayer(zoneTrades, thresholds);

    const scenario = analyzeScenarioPath(
        direction,
        position,
        approachLayer,
        zoneLayer
    );

    const zoneEvaluation = evaluateZoneEvidence(
        direction,
        zoneLayer
    );

    /*
     * الأولوية للبصمة داخل المنطقة،
     * ثم ممر الوصول، ثم الفترة العامة.
     */

    const footprintLayer =
        zoneLayer.range.count >= CONFIG.MIN_ZONE_TRADES
            ? zoneLayer
            : approachLayer.range.count >= CONFIG.MIN_ZONE_TRADES
                ? approachLayer
                : globalLayer;

    const footprint = analyzeInstitutionalFootprint(
        footprintLayer,
        direction
    );

    const evaluation = evaluateStrategy(
        direction,
        position,
        scenario,
        globalLayer,
        approachLayer,
        zoneLayer,
        zoneEvaluation,
        footprint
    );

    const evidence = buildEvidence(
        globalLayer,
        approachLayer,
        zoneLayer,
        footprint
    );

    const limitations = [
        "بيانات Binance العامة لا تكشف هوية المتداول أو تثبت أن التنفيذات تعود إلى صندوق أو حوت بعينه.",
        "البصمة الكبيرة تعني نشاط تنفيذات مرتفعة القيمة، ولا تثبت نية الدخول مستقبلاً.",
        "لا يمكن إثبات أن عدة تنفيذات تعود إلى حساب واحد من بيانات aggTrades.",
        "عناقيد التنفيذ تقيس كثافة التنفيذات زمنياً، ولا تثبت وحدها وجود خوارزمية مؤسسية.",
        "تباين المبادرة مع استجابة السعر قرينة محتملة على وجود طرف مقابل، وليس إثباتاً قاطعاً للامتصاص.",
        "الصفقات الكبيرة وبصمة رأس المال والعناقيد مشتقة من مجموعة التداولات نفسها، وليست مصادر مستقلة إحصائياً.",
        "النوافذ الزمنية الفارغة لا تعامل كنوافذ متجاورة.",
        "السعر المرجعي هو آخر تنفيذ تاريخي مسترجع، وليس سعراً لحظياً مستقلاً.",
        "اكتمال جلب الصفحات لا يثبت توفر كل التاريخ الممكن للفترة."
    ];

    const dataQuality = {
        tradeCount: trades.length,
        globalWindowCount: globalLayer.priceResponse.totalWindows,
        approachTradeCount: approachTrades.length,
        zoneTradeCount: zoneTrades.length,
        referencePrice,
        firstTradeTime: trades[0].time,
        lastTradeTime: trades[trades.length - 1].time,
        fetchComplete: market?.complete === true,
        fetchPages: market?.pages ?? null,
        fetchTotalTrades: market?.totalTrades ?? trades.length
    };

    return {
        market,

        strategy: {
            upper,
            lower,
            direction,
            symbol: market.symbol || settings.symbol
        },

        referencePrice,
        position,
        scenario,

        evaluation,
        evidence,
        dataQuality,
        limitations,

        summary: {
            verdict: evaluation.verdict,
            title: evaluation.title,
            explanation: evaluation.explanation,
            institutionalStatus: footprint.status,
            institutionalTitle: footprint.title,
            institutionalSummary: footprint.summary
        }
    };
}

