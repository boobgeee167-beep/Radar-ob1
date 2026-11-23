
/**
 * WHALE RADAR
 * STRATEGY INTELLIGENCE ENGINE
 *
 * المحلل الاستراتيجي لبصمة رأس المال وسلوك التنفيذ.
 *
 * لا يجمع بيانات جديدة ولا يستخدم السعر اللحظي.
 * يعتمد حصراً على صفقات Binance Spot التاريخية التي يجلبها market-data.js.
 *
 * طبقات التحليل:
 * 1. البصمة العامة خلال الفترة.
 * 2. ممر الوصول إلى منطقة الدخول.
 * 3. التداولات داخل منطقة الدخول.
 * 4. استجابة السعر للمبادرة الشرائية والبيعية.
 *
 * تنبيه:
 * البيانات العامة لا تكشف هوية المتداول أو مالك الأوامر.
 * لذلك نصف الأنماط المرصودة ولا نجزم بأنها تعود إلى صندوق أو حوت بعينه.
 */

import { fetchMarketData } from "./market-data.js";

const CONFIG = {
    MIN_ZONE_TRADES: 10,
    MIN_LARGE_TRADES: 3,
    MIN_CLUSTER_TRADES: 5,
    MIN_ACTIVITY_WINDOWS: 2,

    LARGE_TRADE_PERCENTILE: 95,
    CAPITAL_PERCENTILE: 90,

    CLUSTER_WINDOW_MS: 60 * 1000,
    ACTIVITY_WINDOW_MS: 60 * 1000,

    DIRECTIONAL_THRESHOLD: 0.15,
    FLAT_RETURN_PCT: 0.03,

    APPROACH_DISTANCE: 0.03,
    BOUNDARY_TOLERANCE: 0.001,

    PRICE_BUCKETS: 12
};

/* =========================================================
   أدوات حسابية عامة
========================================================= */

const sum = values =>
    values.reduce((total, value) => total + (Number(value) || 0), 0);

const average = values =>
    values.length ? sum(values) / values.length : 0;

const median = values => {
    if (!values.length) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
};

const percentile = (values, percent) => {
    if (!values.length) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1)
    );

    return sorted[index];
};

const safeRatio = (a, b) =>
    b > 0 ? a / b : 0;

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
    (value > 0 ? "+" : "") + formatNumber(value, 3) + "%";

const getSide = trade =>
    trade.buyerIsMaker ? "sell" : "buy";

const getFlow = trades => {
    let buyValue = 0;
    let sellValue = 0;
    let buyCount = 0;
    let sellCount = 0;

    for (const trade of trades) {
        const side = getSide(trade);

        if (side === "buy") {
            buyValue += trade.value;
            buyCount++;
        } else {
            sellValue += trade.value;
            sellCount++;
        }
    }

    const totalValue = buyValue + sellValue;
    const totalCount = buyCount + sellCount;

    return {
        buyValue,
        sellValue,
        totalValue,
        buyCount,
        sellCount,
        totalCount,
        buyRatio: safeRatio(buyValue, totalValue),
        sellRatio: safeRatio(sellValue, totalValue),
        imbalance: safeRatio(
            buyValue - sellValue,
            totalValue
        )
    };
};

/* =========================================================
   تجهيز البيانات والتحقق منها
========================================================= */

function validateTrades(rawTrades) {
    if (!Array.isArray(rawTrades)) return [];

    return rawTrades
        .map(trade => {
            const price = Number(trade.price);
            const quantity = Number(trade.quantity);
            const value = Number(
                trade.value || price * quantity
            );

            const time = Number(trade.time);

            return {
                ...trade,
                price,
                quantity,
                value,
                time
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
    return trades.length
        ? trades[trades.length - 1].price
        : 0;
}

function getPriceChange(firstPrice, lastPrice) {
    if (!firstPrice || !lastPrice) return 0;

    return ((lastPrice - firstPrice) / firstPrice) * 100;
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

    const prices = trades.map(trade => trade.price);
    const first = trades[0];
    const last = trades[trades.length - 1];

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

/* =========================================================
   تحديد موقع السعر بالنسبة إلى منطقة الدخول
========================================================= */

function analyzeZonePosition(referencePrice, upper, lower) {
    if (!referencePrice || !upper || !lower) {
        return {
            position: "unknown",
            inside: false,
            distancePct: 0,
            description: "تعذر تحديد موقع السعر بالنسبة إلى المنطقة"
        };
    }

    if (referencePrice > upper) {
        const distancePct =
            ((referencePrice - upper) / upper) * 100;

        return {
            position: "above",
            inside: false,
            distancePct,
            description:
                `السعر المرجعي أعلى المنطقة بنسبة ${formatNumber(distancePct, 3)}%`
        };
    }

    if (referencePrice < lower) {
        const distancePct =
            ((lower - referencePrice) / lower) * 100;

        return {
            position: "below",
            inside: false,
            distancePct,
            description:
                `السعر المرجعي أسفل المنطقة بنسبة ${formatNumber(distancePct, 3)}%`
        };
    }

    return {
        position: "inside",
        inside: true,
        distancePct: 0,
        description: "السعر المرجعي داخل حدود منطقة الدخول"
    };
}

function insideZone(trade, upper, lower) {
    return trade.price >= lower && trade.price <= upper;
}

/*
 * ممر الوصول:
 * نأخذ التداولات الواقعة بين السعر المرجعي والمنطقة،
 * ولا نعامل كل حركة تاريخية في هذا النطاق كرحلة متصلة.
 */
function getApproachTrades(
    trades,
    referencePrice,
    upper,
    lower
) {
    if (!trades.length || !referencePrice) return [];

    const zoneTrades = trades.filter(trade =>
        insideZone(trade, upper, lower)
    );

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

    return zoneTrades;
}

/* =========================================================
   بناء النوافذ الزمنية واستجابة السعر
========================================================= */

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
            const totalValue =
                bucket.buyValue + bucket.sellValue;

            const totalCount =
                bucket.buyCount + bucket.sellCount;

            return {
                ...bucket,
                totalValue,
                totalCount,
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
        let interpretation =
            "لم يظهر تفوق واضح لأحد الطرفين أو استجابة سعرية حاسمة";

        if (buyDominant && priceUp) {
            behavior = "effective_buy_pressure";
            interpretation =
                "مبادرة شرائية صاحَبها ارتفاع سعري؛ الشراء كان ذا أثر سعري ظاهر";
        } else if (sellDominant && priceDown) {
            behavior = "effective_sell_pressure";
            interpretation =
                "مبادرة بيعية صاحَبها انخفاض سعري؛ البيع كان ذا أثر سعري ظاهر";
        } else if (buyDominant && !priceUp) {
            behavior = "possible_supply_response";
            interpretation =
                "مبادرة شرائية دون ارتفاع سعري متناسب؛ يتوافق ذلك مع احتمال وجود عرض مقابل أو امتصاص للشراء";
        } else if (sellDominant && !priceDown) {
            behavior = "possible_demand_response";
            interpretation =
                "مبادرة بيعية دون انخفاض سعري متناسب؛ يتوافق ذلك مع احتمال وجود طلب مقابل أو امتصاص للبيع";
        }

        return {
            ...window,
            behavior,
            interpretation
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

    const meaningful = analyzed.filter(item =>
        item.behavior !== "balanced"
    );

    return {
        windows: analyzed,
        totalWindows: analyzed.length,
        meaningfulWindows: meaningful.length,
        behaviorCounts,
        recent: analyzed.slice(-10),
        summary: buildResponseSummary(behaviorCounts)
    };
}

function buildResponseSummary(counts) {
    const buyImpact =
        counts.effectiveBuy + counts.possibleSupply;

    const sellImpact =
        counts.effectiveSell + counts.possibleDemand;

    if (!buyImpact && !sellImpact) {
        return "العلاقة بين المبادرة واتجاه السعر غير حاسمة في النوافذ المرصودة.";
    }

    if (
        counts.possibleDemand >
        counts.effectiveSell &&
        counts.possibleDemand >= 2
    ) {
        return "ظهرت عدة نوافذ شهدت مبادرة بيعية دون استجابة هبوطية متناسبة؛ هذه قرينة تتوافق مع وجود طلب مقابل، لكنها لا تثبت الامتصاص.";
    }

    if (
        counts.possibleSupply >
        counts.effectiveBuy &&
        counts.possibleSupply >= 2
    ) {
        return "ظهرت عدة نوافذ شهدت مبادرة شرائية دون استجابة صعودية متناسبة؛ هذه قرينة تتوافق مع وجود عرض مقابل، لكنها لا تثبت الامتصاص.";
    }

    if (counts.effectiveBuy > counts.effectiveSell) {
        return "الأثر السعري للمبادرة الشرائية كان أوضح من الأثر السعري للمبادرة البيعية.";
    }

    if (counts.effectiveSell > counts.effectiveBuy) {
        return "الأثر السعري للمبادرة البيعية كان أوضح من الأثر السعري للمبادرة الشرائية.";
    }

    return "توجد استجابات سعرية مختلفة، ولا يظهر نمط واحد مهيمن بوضوح.";
}

/* =========================================================
   تحليل الصفقات الكبيرة
   يستخدم عتبة واحدة محسوبة من كامل الفترة.
========================================================= */

function getLargeTradeThreshold(trades) {
    const values = trades.map(trade => trade.value);

    if (!values.length) return 0;

    return percentile(
        values,
        CONFIG.LARGE_TRADE_PERCENTILE
    );
}

function analyzeLargeTrades(trades, threshold) {
    const largeTrades = trades.filter(
        trade => trade.value >= threshold && threshold > 0
    );

    const flow = getFlow(largeTrades);
    const totalValue = sum(largeTrades.map(trade => trade.value));

    const buyLarge = largeTrades.filter(
        trade => getSide(trade) === "buy"
    );

    const sellLarge = largeTrades.filter(
        trade => getSide(trade) === "sell"
    );

    return {
        threshold,
        count: largeTrades.length,
        totalValue,
        averageValue: average(
            largeTrades.map(trade => trade.value)
        ),
        largestTrade: largeTrades.length
            ? Math.max(...largeTrades.map(trade => trade.value))
            : 0,
        buyCount: buyLarge.length,
        sellCount: sellLarge.length,
        buyValue: flow.buyValue,
        sellValue: flow.sellValue,
        buyRatio: flow.buyRatio,
        sellRatio: flow.sellRatio,
        imbalance: flow.imbalance,
        trades: largeTrades.slice(-20),
        status: largeTrades.length >= CONFIG.MIN_LARGE_TRADES
            ? "sufficient"
            : "limited"
    };
}

/* =========================================================
   تحليل عناقيد التنفيذ
========================================================= */

function analyzeClusters(trades) {
    const windows = buildTimeWindows(
        trades,
        CONFIG.CLUSTER_WINDOW_MS
    );

    const clusters = windows.filter(
        window => window.totalCount >= CONFIG.MIN_CLUSTER_TRADES
    );

    const buyClusters = clusters.filter(
        cluster => cluster.buyValue > cluster.sellValue
    );

    const sellClusters = clusters.filter(
        cluster => cluster.sellValue > cluster.buyValue
    );

    const buyValue = sum(
        clusters.map(cluster => cluster.buyValue)
    );

    const sellValue = sum(
        clusters.map(cluster => cluster.sellValue)
    );

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
        status: clusters.length >= CONFIG.MIN_ACTIVITY_WINDOWS
            ? "sufficient"
            : "limited"
    };
}

/* =========================================================
   بصمة رأس المال
   عتبة أعلى 10% تحسب من كامل الفترة ثم تطبق على كل طبقة.
========================================================= */

function getCapitalThreshold(trades) {
    return percentile(
        trades.map(trade => trade.value),
        CONFIG.CAPITAL_PERCENTILE
    );
}

function analyzeCapital(trades, threshold) {
    const capitalTrades = trades.filter(
        trade => trade.value >= threshold && threshold > 0
    );

    const flow = getFlow(capitalTrades);

    const buyTrades = capitalTrades.filter(
        trade => getSide(trade) === "buy"
    );

    const sellTrades = capitalTrades.filter(
        trade => getSide(trade) === "sell"
    );

    const prices = capitalTrades.map(
        trade => trade.price
    );

    let concentration = [];

    if (capitalTrades.length && prices.length) {
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const spread = maxPrice - minPrice;

        const bucketSize = spread > 0
            ? spread / CONFIG.PRICE_BUCKETS
            : 1;

        const buckets = new Map();

        for (const trade of capitalTrades) {
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
        count: capitalTrades.length,
        totalValue: flow.totalValue,
        buyCount: buyTrades.length,
        sellCount: sellTrades.length,
        buyValue: flow.buyValue,
        sellValue: flow.sellValue,
        buyRatio: flow.buyRatio,
        sellRatio: flow.sellRatio,
        imbalance: flow.imbalance,
        averageValue: average(
            capitalTrades.map(trade => trade.value)
        ),
        largestTrade: capitalTrades.length
            ? Math.max(...capitalTrades.map(trade => trade.value))
            : 0,
        concentration: concentration.slice(0, 10),
        status: capitalTrades.length >= CONFIG.MIN_CAPITAL_TRADES
            ? "sufficient"
            : "limited"
    };
}

/* =========================================================
   نشاط الشراء والبيع
========================================================= */

function analyzeActivity(trades) {
    const flow = getFlow(trades);
    const windows = buildTimeWindows(
        trades,
        CONFIG.ACTIVITY_WINDOW_MS
    );

    const activeWindows = windows.filter(
        window => window.totalCount > 0
    );

    const buyDominantWindows = activeWindows.filter(
        window => window.imbalance >= CONFIG.DIRECTIONAL_THRESHOLD
    );

    const sellDominantWindows = activeWindows.filter(
        window => window.imbalance <= -CONFIG.DIRECTIONAL_THRESHOLD
    );

    return {
        ...flow,
        activeWindows: activeWindows.length,
        buyDominantWindows: buyDominantWindows.length,
        sellDominantWindows: sellDominantWindows.length,
        windows: activeWindows.slice(-20),
        status: activeWindows.length >= CONFIG.MIN_ACTIVITY_WINDOWS
            ? "sufficient"
            : "limited"
    };
}

/* =========================================================
   تحليل طبقة واحدة من السوق
========================================================= */

function analyzeLayer(
    trades,
    thresholds,
    includeResponse = true
) {
    const range = getTradeRange(trades);
    const flow = getFlow(trades);

    return {
        range,
        flow,
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
        priceResponse: includeResponse
            ? analyzePriceResponse(trades)
            : null
    };
}

/* =========================================================
   تفسير البصمة المؤسسية المحتملة
========================================================= */

function interpretFootprint(layer, label) {
    const findings = [];

    const large = layer.largeTrades;
    const capital = layer.capital;
    const clusters = layer.clusters;
    const response = layer.priceResponse;

    if (large.count) {
        const side = large.imbalance > 0.15
            ? "الشراء"
            : large.imbalance < -0.15
                ? "البيع"
                : "الجانبين";

        findings.push({
            name: `${label}: الصفقات الكبيرة`,
            status: large.count >= CONFIG.MIN_LARGE_TRADES
                ? "observed"
                : "limited",
            text:
                `رُصدت ${large.count} تنفيذات ضمن شريحة الصفقات الكبيرة، ` +
                `بقيمة إجمالية ${formatMoney(large.totalValue)}. ` +
                `كان اتجاه القيمة الأكبر نحو ${side}.`
        });
    } else {
        findings.push({
            name: `${label}: الصفقات الكبيرة`,
            status: "unobserved",
            text:
                `لم تظهر في هذه الطبقة تنفيذات تتجاوز عتبة الصفقات الكبيرة المحسوبة من كامل الفترة.`
        });
    }

    if (capital.count) {
        findings.push({
            name: `${label}: بصمة رأس المال`,
            status: capital.status,
            text:
                `شريحة أعلى 10% من أحجام التنفيذ احتوت ${capital.count} تنفيذات، ` +
                `بقيمة ${formatMoney(capital.totalValue)}. ` +
                `نسبة قيمة الشراء ${formatNumber(capital.buyRatio * 100, 1)}% ` +
                `ونسبة قيمة البيع ${formatNumber(capital.sellRatio * 100, 1)}%.`
        });
    } else {
        findings.push({
            name: `${label}: بصمة رأس المال`,
            status: "unobserved",
            text:
                "لم تظهر تنفيذات ضمن شريحة رأس المال الأعلى في هذه الطبقة."
        });
    }

    if (clusters.count) {
        findings.push({
            name: `${label}: عناقيد التنفيذ`,
            status: clusters.status,
            text:
                `ظهرت ${clusters.count} نوافذ تنفيذ نشطة بكثافة، ` +
                `منها ${clusters.buyCount} نوافذ مالت قيمتها للشراء ` +
                `و${clusters.sellCount} نوافذ مالت قيمتها للبيع.`
        });
    } else {
        findings.push({
            name: `${label}: عناقيد التنفيذ`,
            status: "unobserved",
            text:
                "لم تتشكل عناقيد تستوفي حد كثافة التنفيذ المعتمد في هذه الطبقة."
        });
    }

    if (response) {
        findings.push({
            name: `${label}: استجابة السعر`,
            status: response.meaningfulWindows
                ? "observed"
                : "unclear",
            text: response.summary
        });
    }

    return findings;
}

/* =========================================================
   فهم حركة السعر بالنسبة إلى سيناريو المتداول
========================================================= */

function analyzeScenarioPath(
    direction,
    position,
    approach,
    zone
) {
    const isLong = direction === "long";

    const expectedApproach =
        (isLong && position.position === "above") ||
        (!isLong && position.position === "below");

    const approachRange = approach.range;

    let pathDescription = "";
    let pathStatus = "neutral";

    if (position.inside) {
        pathDescription =
            "السعر المرجعي موجود داخل منطقة الدخول؛ لذلك لا نتعامل معه كرحلة اقتراب من خارج المنطقة.";
    } else if (expectedApproach) {
        pathDescription = isLong
            ? "السعر أعلى منطقة LONG. هبوطه باتجاه المنطقة هو مسار الوصول المتوقع في هذا السيناريو، وليس تعارضاً تلقائياً."
            : "السعر أسفل منطقة SHORT. صعوده باتجاه المنطقة هو مسار الوصول المتوقع في هذا السيناريو، وليس تعارضاً تلقائياً.";

        pathStatus = "expected";
    } else {
        pathDescription = isLong
            ? "السعر أسفل منطقة LONG حالياً؛ أي إنه تجاوز الحد السفلي سعرياً. يلزم فحص التسلسل الزمني قبل وصف ما حدث بأنه اختراق أو عبور مؤكد."
            : "السعر أعلى منطقة SHORT حالياً؛ أي إنه تجاوز الحد العلوي سعرياً. يلزم فحص التسلسل الزمني قبل وصف ما حدث بأنه اختراق أو عبور مؤكد.";

        pathStatus = "beyond";
    }

    let approachInterpretation =
        "بيانات ممر الوصول لا تكفي لوصف مسار متصل.";

    if (approachRange.count >= 2) {
        const change = approachRange.changePct;

        if (expectedApproach) {
            const towardZone =
                (isLong && change < 0) ||
                (!isLong && change > 0);

            approachInterpretation = towardZone
                ? "اتجاه الأسعار في عينة ممر الوصول يتوافق إجمالاً مع الحركة نحو منطقة الدخول. هذا وصف للحركة داخل العينة وليس إثباتاً لمسار متصل."
                : "اتجاه الأسعار في عينة ممر الوصول لا يظهر حركة صافية واضحة نحو المنطقة، رغم أن بعض التداولات وقعت داخل الممر.";
        } else {
            approachInterpretation =
                "السعر ليس في وضع الاقتراب المتوقع من جهة السيناريو؛ ينبغي التعامل مع المنطقة بحذر دون افتراض كيفية وصول السعر إليها.";
        }
    }

    const zoneRange = zone.range;

    return {
        expectedApproach,
        pathStatus,
        pathDescription,
        approachInterpretation,
        approachPriceChangePct: approachRange.changePct,
        approachTradeCount: approachRange.count,
        zoneTradeCount: zoneRange.count,
        zonePriceChangePct: zoneRange.changePct
    };
}

/* =========================================================
   تقييم الأدلة داخل المنطقة
========================================================= */

function evaluateZoneEvidence(direction, zone) {
    const flow = zone.flow;
    const response = zone.priceResponse;
    const count = flow.totalCount;

    const result = {
        status: "limited",
        supportive: [],
        caution: [],
        neutral: [],
        explanation: ""
    };

    if (count < CONFIG.MIN_ZONE_TRADES) {
        result.status = "not_tested";
        result.neutral.push(
            `عدد التداولات داخل المنطقة ${count}، وهو أقل من الحد التحليلي ${CONFIG.MIN_ZONE_TRADES}.`
        );
        result.explanation =
            "لا توجد عينة كافية للحكم على سلوك التنفيذ داخل المنطقة. هذا لا يعني أن المنطقة فاشلة ولا يعني وجود دليل ضد الصفقة.";
        return result;
    }

    result.status = "observed";

    const directionalFlow = direction === "long"
        ? flow.imbalance
        : -flow.imbalance;

    if (directionalFlow >= CONFIG.DIRECTIONAL_THRESHOLD) {
        result.supportive.push(
            direction === "long"
                ? "قيمة المبادرة الشرائية أعلى بوضوح من المبادرة البيعية داخل المنطقة."
                : "قيمة المبادرة البيعية أعلى بوضوح من المبادرة الشرائية داخل المنطقة."
        );
    } else if (directionalFlow <= -CONFIG.DIRECTIONAL_THRESHOLD) {
        result.caution.push(
            direction === "long"
                ? "قيمة المبادرة البيعية أعلى بوضوح داخل منطقة LONG."
                : "قيمة المبادرة الشرائية أعلى بوضوح داخل منطقة SHORT."
        );
    } else {
        result.neutral.push(
            "التوازن بين قيمة الشراء والبيع داخل المنطقة لا يعطي أفضلية اتجاهية واضحة."
        );
    }

    if (response) {
        const counts = response.behaviorCounts;

        if (direction === "long") {
            if (counts.effectiveBuy > counts.effectiveSell) {
                result.supportive.push(
                    "عدد النوافذ ذات الأثر الشرائي الصاعد أكبر من نوافذ الأثر البيعي الهابط."
                );
            }

            if (counts.possibleDemand >= 2) {
                result.supportive.push(
                    "ظهرت نوافذ شهدت بيعاً مبادراً دون هبوط متناسب؛ وهي قرينة محتملة على طلب مقابل."
                );
            }

            if (counts.effectiveSell > counts.effectiveBuy) {
                result.caution.push(
                    "ظهرت نوافذ كان فيها ضغط البيع مصحوباً بهبوط سعري فعلي."
                );
            }
        } else {
            if (counts.effectiveSell > counts.effectiveBuy) {
                result.supportive.push(
                    "عدد النوافذ ذات الأثر البيعي الهابط أكبر من نوافذ الأثر الشرائي الصاعد."
                );
            }

            if (counts.possibleSupply >= 2) {
                result.supportive.push(
                    "ظهرت نوافذ شهدت شراءً مبادراً دون صعود متناسب؛ وهي قرينة محتملة على عرض مقابل."
                );
            }

            if (counts.effectiveBuy > counts.effectiveSell) {
                result.caution.push(
                    "ظهرت نوافذ كان فيها ضغط الشراء مصحوباً بصعود سعري فعلي."
                );
            }
        }
    }

    result.explanation =
        result.supportive.length || result.caution.length
            ? "توجد أدلة داخل المنطقة، لكنها تحتاج إلى قراءة مشتركة مع حجم العينة واستجابة السعر وبصمة التنفيذات الكبيرة."
            : "التداولات داخل المنطقة لم تنتج دليلاً اتجاهياً واضحاً.";

    return result;
}

/* =========================================================
   التقييم الاستراتيجي النهائي
========================================================= */

function evaluateStrategy(
    direction,
    position,
    scenario,
    globalLayer,
    approachLayer,
    zoneLayer,
    zoneEvaluation
) {
    const reasons = [];
    const supportive = [];
    const caution = [];
    const neutral = [];

    const isLong = direction === "long";

    const directionName = isLong ? "LONG" : "SHORT";

    const zoneWasTested =
        zoneEvaluation.status === "observed";

    for (const item of zoneEvaluation.supportive) {
        supportive.push(item);
    }

    for (const item of zoneEvaluation.caution) {
        caution.push(item);
    }

    for (const item of zoneEvaluation.neutral) {
        neutral.push(item);
    }

    if (scenario.expectedApproach) {
        supportive.push(
            isLong
                ? "موقع السعر أعلى منطقة LONG يجعل الهبوط نحوها مسار وصول متوقعاً، ولا يصح اعتباره إشارة سلبية بذاته."
                : "موقع السعر أسفل منطقة SHORT يجعل الصعود نحوها مسار وصول متوقعاً، ولا يصح اعتباره إشارة سلبية بذاته."
        );
    }

    if (approachLayer.range.count) {
        const approachResponse = approachLayer.priceResponse;

        if (approachResponse) {
            const counts = approachResponse.behaviorCounts;

            if (isLong && counts.possibleDemand >= 2) {
                supportive.push(
                    "في ممر الوصول ظهرت نوافذ بيع مبادر دون استجابة هبوطية متناسبة؛ قد تكون هذه قرينة على طلب مقابل أثناء الاقتراب."
                );
            }

            if (!isLong && counts.possibleSupply >= 2) {
                supportive.push(
                    "في ممر الوصول ظهرت نوافذ شراء مبادر دون استجابة صعودية متناسبة؛ قد تكون هذه قرينة على عرض مقابل أثناء الاقتراب."
                );
            }

            if (isLong && counts.effectiveSell >= 3) {
                caution.push(
                    "تكرر ضغط بيع مبادر مصحوب بهبوط سعري فعلي في ممر الوصول؛ هذه معلومة تستحق المراقبة، لكنها لا تلغي سيناريو LONG وحدها."
                );
            }

            if (!isLong && counts.effectiveBuy >= 3) {
                caution.push(
                    "تكرر ضغط شراء مبادر مصحوب بصعود سعري فعلي في ممر الوصول؛ هذه معلومة تستحق المراقبة، لكنها لا تلغي سيناريو SHORT وحدها."
                );
            }
        }
    } else {
        neutral.push(
            "لا توجد تداولات كافية في ممر الوصول لتحليل بصمة التنفيذ خلاله."
        );
    }

    const globalResponse = globalLayer.priceResponse;

    if (globalResponse) {
        const counts = globalResponse.behaviorCounts;

        if (isLong && counts.possibleDemand >= 3) {
            supportive.push(
                "على مستوى الفترة كاملة ظهرت عدة نوافذ بيع مبادر لم ينتج عنها هبوط متناسب؛ نمط يتوافق مع وجود طلب مقابل محتمل."
            );
        }

        if (!isLong && counts.possibleSupply >= 3) {
            supportive.push(
                "على مستوى الفترة كاملة ظهرت عدة نوافذ شراء مبادر لم ينتج عنها صعود متناسب؛ نمط يتوافق مع وجود عرض مقابل محتمل."
            );
        }
    }

    const large = zoneWasTested
        ? zoneLayer.largeTrades
        : approachLayer.largeTrades;

    const capital = zoneWasTested
        ? zoneLayer.capital
        : approachLayer.capital;

    if (large.count >= CONFIG.MIN_LARGE_TRADES) {
        const alignedLargeFlow = isLong
            ? large.imbalance > CONFIG.DIRECTIONAL_THRESHOLD
            : large.imbalance < -CONFIG.DIRECTIONAL_THRESHOLD;

        const opposingLargeFlow = isLong
            ? large.imbalance < -CONFIG.DIRECTIONAL_THRESHOLD
            : large.imbalance > CONFIG.DIRECTIONAL_THRESHOLD;

        if (alignedLargeFlow) {
            supportive.push(
                `اتجاه قيمة الصفقات الكبيرة في ${zoneWasTested ? "المنطقة" : "ممر الوصول"} يميل إلى اتجاه سيناريو ${directionName}.`
            );
        } else if (opposingLargeFlow) {
            neutral.push(
                `قيمة الصفقات الكبيرة في ${zoneWasTested ? "المنطقة" : "ممر الوصول"} تميل إلى الاتجاه المقابل؛ ويجب تفسير ذلك مع استجابة السعر، لا باعتباره رفضاً آلياً للصفقة.`
            );
        }
    }

    if (capital.count >= CONFIG.MIN_CAPITAL_TRADES) {
        const alignedCapital = isLong
            ? capital.imbalance > CONFIG.DIRECTIONAL_THRESHOLD
            : capital.imbalance < -CONFIG.DIRECTIONAL_THRESHOLD;

        if (alignedCapital) {
            supportive.push(
                "شريحة التنفيذات الأعلى قيمة تميل إلى اتجاه سيناريو الصفقة في هذه الطبقة."
            );
        }
    }

    if (!zoneWasTested) {
        reasons.push({
            name: "اختبار منطقة الدخول",
            status: "pending",
            text:
                "المنطقة لم توفر حتى الآن عينة تداول كافية للحكم على رد فعل السوق داخلها. هذا نقص في دليل الاختبار، وليس دليلاً ضد الصفقة."
        });
    } else {
        reasons.push({
            name: "اختبار منطقة الدخول",
            status: "observed",
            text: zoneEvaluation.explanation
        });
    }

    reasons.push({
        name: "مسار الوصول",
        status: scenario.expectedApproach ? "expected" : "context",
        text: scenario.pathDescription + " " + scenario.approachInterpretation
    });

    reasons.push({
        name: "استجابة السعر",
        status: "observed",
        text:
            "استجابة السعر للمبادرة: " +
            (zoneLayer.priceResponse?.summary || "لا توجد بيانات كافية داخل المنطقة.")
    });

    reasons.push({
        name: "البصمة الكبيرة",
        status: large.count >= CONFIG.MIN_LARGE_TRADES
            ? "observed"
            : "limited",
        text:
            `عدد التنفيذات الكبيرة في الطبقة المرجعية ${large.count}، ` +
            `وقيمتها الإجمالية ${formatMoney(large.totalValue)}.`
    });

    reasons.push({
        name: "بصمة رأس المال",
        status: capital.count >= CONFIG.MIN_CAPITAL_TRADES
            ? "observed"
            : "limited",
        text:
            `عدد تنفيذات شريحة رأس المال الأعلى ${capital.count}، ` +
            `وقيمتها الإجمالية ${formatMoney(capital.totalValue)}.`
    });

    let verdict = "insufficient";
    let title = "المعطيات لا تكفي للحكم";
    let tone = "neutral";
    let explanation = "";

    if (!zoneWasTested && (supportive.length || caution.length)) {
        verdict = "context";
        title = "بصمة مرصودة — المنطقة لم تُختبر بعد";
        tone = "warning";

        explanation =
            `رُصدت إشارات ذات معنى في بيانات السوق وممر الوصول، لكن منطقة ${directionName} لم توفر عينة تداول كافية لاختبار رد فعل السعر داخلها. ` +
            "هذا ليس رفضاً للسيناريو ولا تأكيداً نهائياً له. راقب ما سيحدث عند وصول السعر إلى المنطقة، خصوصاً العلاقة بين المبادرة الكبيرة واستجابة السعر.";
    } else if (!zoneWasTested) {
        verdict = "insufficient";
        title = "المنطقة لم تُختبر بعد";
        tone = "neutral";

        explanation =
            "لا توجد عينة كافية من التداولات داخل المنطقة، كما أن الأدلة المتاحة خارجها لا تمنح أفضلية واضحة. عدم وجود تأكيد لا يعني وجود تعارض، ولا يمنعك من تنفيذ استراتيجيتك.";
    } else if (
        supportive.length >= 2 &&
        supportive.length > caution.length
    ) {
        verdict = "support";
        title = "الأدلة تميل إلى دعم السيناريو";
        tone = "positive";

        explanation =
            `توجد عدة قرائن تتوافق مع سيناريو ${directionName}، خصوصاً في سلوك التنفيذات واستجابة السعر. ` +
            "هذا دعم احتمالي مبني على البيانات المرصودة، وليس ضماناً للارتداد أو نجاح الصفقة.";
    } else if (
        caution.length >= 2 &&
        caution.length > supportive.length
    ) {
        verdict = "oppose";
        title = "توجد أدلة تستدعي الحذر";
        tone = "negative";

        explanation =
            `بعض الأدلة داخل منطقة ${directionName} أو حولها لا تتوافق جيداً مع السيناريو، خصوصاً عندما تقترن المبادرة المقابلة بأثر سعري فعلي. ` +
            "هذه نتيجة تحذيرية وليست قرار منع؛ قد تبقى استراتيجيتك صالحة وفق شروطك الخاصة.";
    } else if (supportive.length && caution.length) {
        verdict = "mixed";
        title = "الأدلة مختلطة";
        tone = "warning";

        explanation =
            "توجد قرائن مؤيدة وأخرى تستدعي الحذر. لا يظهر تفوق واضح لطرف واحد، ولذلك الأهم هو متابعة سلوك التنفيذات الكبيرة واستجابة السعر بدلاً من اختزال الصورة في إشارة واحدة.";
    } else {
        verdict = "insufficient";
        title = "لا توجد أفضلية واضحة";
        tone = "neutral";

        explanation =
            "البيانات المتاحة لا تمنح أفضلية واضحة لسيناريو الصفقة ولا تقدم تعارضاً قوياً. هذا يعني أن الرادار لم يجد دليلاً حاسماً، وليس أن الصفقة غير صالحة.";
    }

    return {
        verdict,
        title,
        tone,
        direction: directionName,
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
        advisoryOnly: true
    };
}

/* =
