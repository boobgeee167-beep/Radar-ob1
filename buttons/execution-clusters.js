
/**
 * WHALE RADAR
 * EXECUTION CLUSTERS
 *
 * تحليل تجمعات التنفيذ الكثيف زمنياً.
 * يجمع الدقائق النشطة المتجاورة في عناقيد.
 */

import { fetchMarketData } from "../core/market-data.js";
import { renderDashboard } from "../core/results-ui.js";

const WINDOW_MS = 60 * 1000;
const MIN_TRADES_PER_MINUTE = 5;
const MAX_CLUSTERS = 30;

const formatMoney = value =>
    "$" + Number(value).toLocaleString("en-US", {
        maximumFractionDigits: 2
    });

const formatPrice = value =>
    Number(value).toLocaleString("en-US", {
        maximumFractionDigits: 10
    });

const formatTime = timestamp =>
    new Date(timestamp).toLocaleString("ar", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });

function buildMinuteWindows(trades) {
    const windows = new Map();

    for (const trade of trades) {
        const start = Math.floor(trade.time / WINDOW_MS) * WINDOW_MS;

        if (!windows.has(start)) {
            windows.set(start, {
                start,
                trades: []
            });
        }

        windows.get(start).trades.push(trade);
    }

    return [...windows.values()]
        .sort((a, b) => a.start - b.start);
}

function analyzeWindow(window) {
    let buyValue = 0;
    let sellValue = 0;
    let totalValue = 0;
    let quantity = 0;

    let highestPrice = -Infinity;
    let lowestPrice = Infinity;

    for (const trade of window.trades) {
        totalValue += trade.value;
        quantity += trade.quantity;

        highestPrice = Math.max(highestPrice, trade.price);
        lowestPrice = Math.min(lowestPrice, trade.price);

        if (trade.buyerIsMaker) {
            sellValue += trade.value;
        } else {
            buyValue += trade.value;
        }
    }

    return {
        start: window.start,
        end: window.start + WINDOW_MS,
        count: window.trades.length,
        buyValue,
        sellValue,
        totalValue,
        quantity,
        highestPrice,
        lowestPrice
    };
}

function buildClusters(windows) {
    const activeWindows = windows
        .filter(window =>
            window.trades.length >= MIN_TRADES_PER_MINUTE
        );

    const clusters = [];
    let current = [];

    for (const window of activeWindows) {
        if (
            current.length === 0 ||
            window.start === current[current.length - 1].start + WINDOW_MS
        ) {
            current.push(window);
        } else {
            clusters.push(current);
            current = [window];
        }
    }

    if (current.length) {
        clusters.push(current);
    }

    return clusters.map(group => {
        const allTrades = group.flatMap(window => window.trades);

        const firstTime = group[0].start;
        const lastTime = group[group.length - 1].start + WINDOW_MS;

        let buyValue = 0;
        let sellValue = 0;
        let totalValue = 0;
        let highestPrice = -Infinity;
        let lowestPrice = Infinity;

        for (const trade of allTrades) {
            totalValue += trade.value;

            highestPrice = Math.max(highestPrice, trade.price);
            lowestPrice = Math.min(lowestPrice, trade.price);

            if (trade.buyerIsMaker) {
                sellValue += trade.value;
            } else {
                buyValue += trade.value;
            }
        }

        const durationMinutes =
            (lastTime - firstTime) / WINDOW_MS;

        return {
            start: firstTime,
            end: lastTime,
            durationMinutes,
            activeMinutes: group.length,
            tradeCount: allTrades.length,
            buyValue,
            sellValue,
            totalValue,
            highestPrice,
            lowestPrice,
            averageValuePerMinute:
                totalValue / Math.max(group.length, 1),
            tradesPerMinute:
                allTrades.length / Math.max(group.length, 1)
        };
    }).sort((a, b) => b.totalValue - a.totalValue);
}

export async function run(settings) {
    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>⚡ تحليل عناقيد التنفيذ</h3>
            <p>جارٍ البحث عن فترات النشاط الكثيف...</p>
        </div>
    `;

    try {
        const market = await fetchMarketData(settings);
        const trades = market.trades;

        if (!trades.length) {
            throw new Error("لا توجد تنفيذات ضمن الفترة المحددة");
        }

        const windows = buildMinuteWindows(trades);

        const analyzedWindows = windows.map(analyzeWindow);

        const clusters = buildClusters(windows);

        const totalClusterValue = clusters.reduce(
            (sum, cluster) => sum + cluster.totalValue,
            0
        );

        const totalClusterTrades = clusters.reduce(
            (sum, cluster) => sum + cluster.tradeCount,
            0
        );

        const totalBuyValue = clusters.reduce(
            (sum, cluster) => sum + cluster.buyValue,
            0
        );

        const totalSellValue = clusters.reduce(
            (sum, cluster) => sum + cluster.sellValue,
            0
        );

        const strongest = clusters[0] || null;

        const totalDirectionalValue =
            totalBuyValue + totalSellValue;

        const buyPercent = totalDirectionalValue > 0
            ? totalBuyValue / totalDirectionalValue * 100
            : 0;

        const sellPercent = totalDirectionalValue > 0
            ? totalSellValue / totalDirectionalValue * 100
            : 0;

        const clusterRows = clusters
            .slice(0, MAX_CLUSTERS)
            .map((cluster, index) => [
                `#${index + 1}`,
                formatTime(cluster.start),
                formatTime(cluster.end),
                `${cluster.durationMinutes} دقيقة`,
                cluster.tradeCount.toLocaleString(),
                formatMoney(cluster.totalValue),
                formatMoney(cluster.buyValue),
                formatMoney(cluster.sellValue),
                formatPrice(cluster.lowestPrice),
                formatPrice(cluster.highestPrice)
            ]);

        const activeWindows = analyzedWindows.filter(
            window => window.count >= MIN_TRADES_PER_MINUTE
        );

        const activityRows = [...activeWindows]
            .sort((a, b) => b.totalValue - a.totalValue)
            .slice(0, 20)
            .map((window, index) => [
                `#${index + 1}`,
                formatTime(window.start),
                window.count.toLocaleString(),
                formatMoney(window.totalValue),
                formatMoney(window.buyValue),
                formatMoney(window.sellValue),
                formatPrice(window.lowestPrice),
                formatPrice(window.highestPrice)
            ]);

        const strongestText = strongest
            ? `أقوى عنقود امتد ${strongest.durationMinutes} دقيقة، واحتوى ${strongest.tradeCount.toLocaleString()} تنفيذ بقيمة ${formatMoney(strongest.totalValue)}.`
            : "لم يتم العثور على عناقيد تستوفي شروط النشاط.";

        renderDashboard({
            title: "⚡ رادار عناقيد التنفيذ",
            symbol: market.symbol,
            subtitle: "كشف فترات تكثف نشاط التنفيذات في السوق",

            metrics: [
                {
                    label: "عناقيد النشاط",
                    value: clusters.length.toLocaleString(),
                    tone: "gold",
                    detail: "فترات نشطة متجاورة"
                },
                {
                    label: "تنفيذات العناقيد",
                    value: totalClusterTrades.toLocaleString(),
                    tone: "blue"
                },
                {
                    label: "قيمة الشراء المبادر",
                    value: formatMoney(totalBuyValue),
                    tone: "buy"
                },
                {
                    label: "قيمة البيع المبادر",
                    value: formatMoney(totalSellValue),
                    tone: "sell"
                }
            ],

            sections: [
                {
                    type: "bars",
                    title: "ميزان المبادرة داخل العناقيد",
                    description: "توزيع قيمة التنفيذات داخل فترات النشاط المكتشفة",

                    items: [
                        {
                            label: "شراء مبادر",
                            value: totalBuyValue,
                            display: `${formatMoney(totalBuyValue)} — ${buyPercent.toFixed(1)}%`,
                            tone: "buy"
                        },
                        {
                            label: "بيع مبادر",
                            value: totalSellValue,
                            display: `${formatMoney(totalSellValue)} — ${sellPercent.toFixed(1)}%`,
                            tone: "sell"
                        }
                    ]
                },

                {
                    type: "table",
                    title: "أقوى عناقيد التنفيذ",
                    description: `كل عنقود يجمع دقائق متجاورة تحتوي ${MIN_TRADES_PER_MINUTE} تنفيذات أو أكثر في الدقيقة`,

                    columns: [
                        "الترتيب",
                        "البداية",
                        "النهاية",
                        "المدة",
                        "التنفيذات",
                        "القيمة",
                        "شراء مبادر",
                        "بيع مبادر",
                        "أدنى سعر",
                        "أعلى سعر"
                    ],

                    rows: clusterRows
                },

                {
                    type: "table",
                    title: "أقوى دقائق النشاط",
                    description: "أعلى 20 دقيقة نشطة مرتبة حسب قيمة التنفيذات",

                    columns: [
                        "الترتيب",
                        "الوقت",
                        "التنفيذات",
                        "القيمة",
                        "شراء مبادر",
                        "بيع مبادر",
                        "أدنى سعر",
                        "أعلى سعر"
                    ],

                    rows: activityRows
                },

                {
                    type: "note",
                    title: "قراءة الرادار",

                    text:
                        `تم تحليل ${market.totalTrades.toLocaleString()} تنفيذ. ` +
                        `اكتُشفت ${clusters.length} عناقيد نشاط، ` +
                        `بقيمة إجمالية ${formatMoney(totalClusterValue)}. ` +
                        `${strongestText} ` +
                        `نسبة الشراء المبادر داخل العناقيد ${buyPercent.toFixed(2)}%، ` +
                        `ونسبة البيع المبادر ${sellPercent.toFixed(2)}%. ` +
                        `هذه العناقيد تكشف تكثف النشاط زمنياً، ` +
                        `لكنها لا تثبت أن التنفيذات صادرة عن جهة واحدة أو خوارزمية واحدة.`
                }
            ]
        });

    } catch (error) {
        results.innerHTML = `
            <div class="result-card">
                <h3>تعذر إكمال تحليل العناقيد</h3>
                <p>${String(error.message || error)}</p>
            </div>
        `;
    }
}
