
/**
 * WHALE RADAR
 * BUY / SELL ACTIVITY
 *
 * تحليل ضغط المبادرة الشرائية والبيعية زمنياً.
 */

import { fetchMarketData } from "../core/market-data.js";
import { renderDashboard } from "../core/results-ui.js";

const WINDOW_MS = 60 * 1000;
const MAX_ROWS = 30;
const MAX_TRANSITIONS = 10;

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
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });

function buildActivity(trades) {
    const windows = new Map();

    for (const trade of trades) {
        const start = Math.floor(trade.time / WINDOW_MS) * WINDOW_MS;

        if (!windows.has(start)) {
            windows.set(start, {
                start,
                buyValue: 0,
                sellValue: 0,
                totalValue: 0,
                buyCount: 0,
                sellCount: 0,
                tradeCount: 0
            });
        }

        const window = windows.get(start);

        window.totalValue += trade.value;
        window.tradeCount++;

        if (trade.buyerIsMaker) {
            window.sellValue += trade.value;
            window.sellCount++;
        } else {
            window.buyValue += trade.value;
            window.buyCount++;
        }
    }

    return [...windows.values()]
        .sort((a, b) => a.start - b.start);
}

function detectPressure(window) {
    if (window.buyValue > window.sellValue) {
        return "شراء";
    }

    if (window.sellValue > window.buyValue) {
        return "بيع";
    }

    return "متوازن";
}

function analyzeActivity(trades, windows) {
    let totalBuy = 0;
    let totalSell = 0;
    let buyCount = 0;
    let sellCount = 0;

    for (const trade of trades) {
        if (trade.buyerIsMaker) {
            totalSell += trade.value;
            sellCount++;
        } else {
            totalBuy += trade.value;
            buyCount++;
        }
    }

    const strongestBuy = [...windows]
        .sort((a, b) => b.buyValue - a.buyValue)[0] || null;

    const strongestSell = [...windows]
        .sort((a, b) => b.sellValue - a.sellValue)[0] || null;

    const strongestActivity = [...windows]
        .sort((a, b) => b.totalValue - a.totalValue)[0] || null;

    const transitions = [];

    for (let i = 1; i < windows.length; i++) {
        const previous = windows[i - 1];
        const current = windows[i];

        const previousPressure = detectPressure(previous);
        const currentPressure = detectPressure(current);

        if (
            previousPressure !== currentPressure &&
            previousPressure !== "متوازن" &&
            currentPressure !== "متوازن"
        ) {
            transitions.push({
                time: current.start,
                from: previousPressure,
                to: currentPressure,
                buyValue: current.buyValue,
                sellValue: current.sellValue,
                totalValue: current.totalValue
            });
        }
    }

    const lastWindowTime = windows.length
        ? windows[windows.length - 1].start
        : 0;

    const last30Start = lastWindowTime - 29 * WINDOW_MS;

    const last30 = windows.filter(
        window => window.start >= last30Start
    );

    const last30Buy = last30.reduce(
        (sum, window) => sum + window.buyValue, 0
    );

    const last30Sell = last30.reduce(
        (sum, window) => sum + window.sellValue, 0
    );

    const last30Value = last30Buy + last30Sell;

    return {
        totalBuy,
        totalSell,
        buyCount,
        sellCount,
        strongestBuy,
        strongestSell,
        strongestActivity,
        transitions,
        last30Buy,
        last30Sell,
        last30Value,
        last30Minutes: last30.length
    };
}

export async function run(settings) {
    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>📊 تحليل نشاط الشراء والبيع</h3>
            <p>جارٍ تحليل ضغط المبادرة والتحولات الزمنية...</p>
        </div>
    `;

    try {
        const market = await fetchMarketData(settings);
        const trades = market.trades;

        if (!trades.length) {
            throw new Error("لا توجد تنفيذات ضمن الفترة المحددة");
        }

        const windows = buildActivity(trades);

        const analysis = analyzeActivity(trades, windows);

        const totalValue =
            analysis.totalBuy + analysis.totalSell;

        const buyPercent = totalValue > 0
            ? analysis.totalBuy / totalValue * 100
            : 0;

        const sellPercent = totalValue > 0
            ? analysis.totalSell / totalValue * 100
            : 0;

        const dominantPressure =
            analysis.totalBuy > analysis.totalSell
                ? "شراء مبادر"
                : analysis.totalSell > analysis.totalBuy
                    ? "بيع مبادر"
                    : "متوازن";

        const last30BuyPercent = analysis.last30Value > 0
            ? analysis.last30Buy / analysis.last30Value * 100
            : 0;

        const last30SellPercent = analysis.last30Value > 0
            ? analysis.last30Sell / analysis.last30Value * 100
            : 0;

        const strongestBuyText = analysis.strongestBuy
            ? `${formatTime(analysis.strongestBuy.start)} — ${formatMoney(analysis.strongestBuy.buyValue)}`
            : "لا يوجد";

        const strongestSellText = analysis.strongestSell
            ? `${formatTime(analysis.strongestSell.start)} — ${formatMoney(analysis.strongestSell.sellValue)}`
            : "لا يوجد";

        const activityRows = [...windows]
            .sort((a, b) => b.totalValue - a.totalValue)
            .slice(0, MAX_ROWS)
            .map((window, index) => [
                `#${index + 1}`,
                formatTime(window.start),
                window.tradeCount.toLocaleString(),
                formatMoney(window.totalValue),
                formatMoney(window.buyValue),
                formatMoney(window.sellValue),
                detectPressure(window)
            ]);

        const transitionRows = analysis.transitions
            .slice(-MAX_TRANSITIONS)
            .reverse()
            .map((transition, index) => [
                `#${index + 1}`,
                formatTime(transition.time),
                transition.from,
                transition.to,
                formatMoney(transition.totalValue),
                formatMoney(transition.buyValue),
                formatMoney(transition.sellValue)
            ]);

        const timelineItems = windows
            .slice(-30)
            .map(window => ({
                label: formatTime(window.start),
                value: window.totalValue,
                display:
                    `${formatMoney(window.totalValue)} | ` +
                    `شراء ${formatMoney(window.buyValue)} | ` +
                    `بيع ${formatMoney(window.sellValue)}`,
                tone: window.buyValue >= window.sellValue
                    ? "buy"
                    : "sell"
            }));

        renderDashboard({
            title: "📊 رادار نشاط الشراء والبيع",
            symbol: market.symbol,
            subtitle: "تحليل ضغط المبادرة والتحولات الزمنية",

            metrics: [
                {
                    label: "قيمة الشراء المبادر",
                    value: formatMoney(analysis.totalBuy),
                    tone: "buy",
                    detail: `${buyPercent.toFixed(1)}% من القيمة`
                },
                {
                    label: "قيمة البيع المبادر",
                    value: formatMoney(analysis.totalSell),
                    tone: "sell",
                    detail: `${sellPercent.toFixed(1)}% من القيمة`
                },
                {
                    label: "الدقائق المحللة",
                    value: windows.length.toLocaleString(),
                    tone: "blue"
                },
                {
                    label: "تحولات الضغط",
                    value: analysis.transitions.length.toLocaleString(),
                    tone: "gold"
                }
            ],

            sections: [
                {
                    type: "bars",
                    title: "ميزان المبادرة العام",
                    description: `الاتجاه الغالب: ${dominantPressure}`,

                    items: [
                        {
                            label: "شراء مبادر",
                            value: analysis.totalBuy,
                            display: `${formatMoney(analysis.totalBuy)} — ${buyPercent.toFixed(1)}%`,
                            tone: "buy"
                        },
                        {
                            label: "بيع مبادر",
                            value: analysis.totalSell,
                            display: `${formatMoney(analysis.totalSell)} — ${sellPercent.toFixed(1)}%`,
                            tone: "sell"
                        }
                    ]
                },

                {
                    type: "bars",
                    title: "نشاط آخر 30 دقيقة من البيانات",
                    description: `الدقائق المتاحة: ${analysis.last30Minutes}`,

                    items: [
                        {
                            label: "شراء مبادر",
                            value: analysis.last30Buy,
                            display: `${formatMoney(analysis.last30Buy)} — ${last30BuyPercent.toFixed(1)}%`,
                            tone: "buy"
                        },
                        {
                            label: "بيع مبادر",
                            value: analysis.last30Sell,
                            display: `${formatMoney(analysis.last30Sell)} — ${last30SellPercent.toFixed(1)}%`,
                            tone: "sell"
                        }
                    ]
                },

                {
                    type: "bars",
                    title: "الموجات الزمنية الأخيرة",
                    description: "قيمة التنفيذات في آخر 30 دقيقة متاحة",

                    items: timelineItems
                },

                {
                    type: "table",
                    title: "أقوى دقائق النشاط",
                    description: "أعلى 30 دقيقة حسب القيمة الإجمالية للتنفيذات",

                    columns: [
                        "الترتيب",
                        "الوقت",
                        "التنفيذات",
                        "القيمة",
                        "شراء مبادر",
                        "بيع مبادر",
                        "الضغط"
                    ],

                    rows: activityRows
                },

                {
                    type: "table",
                    title: "تحولات ضغط المبادرة",
                    description: "انتقال الضغط من الشراء إلى البيع أو العكس بين الدقائق المتجاورة",

                    columns: [
                        "الترتيب",
                        "الوقت",
                        "من",
                        "إلى",
                        "القيمة",
                        "شراء مبادر",
                        "بيع مبادر"
                    ],

                    rows: transitionRows
                },

                {
                    type: "note",
                    title: "أقوى موجات النشاط",

                    text:
                        `أقوى دقيقة شراء: ${strongestBuyText}. ` +
                        `أقوى دقيقة بيع: ${strongestSellText}.`
                },

                {
                    type: "note",
                    title: "قراءة الرادار",

                    text:
                        `تم تحليل ${market.totalTrades.toLocaleString()} تنفيذ عبر ${windows.length} دقيقة نشطة. ` +
                        `بلغت قيمة الشراء المبادر ${formatMoney(analysis.totalBuy)}، ` +
                        `وقيمة البيع المبادر ${formatMoney(analysis.totalSell)}. ` +
                        `الاتجاه الغالب في كامل العينة هو ${dominantPressure}. ` +
                        `تم رصد ${analysis.transitions.length} تحولاً في ضغط المبادرة. ` +
                        `ضغط المبادرة يصف الطرف الذي بدأ التنفيذ، ولا يعني بالضرورة أن هذا الطرف يسيطر على السوق أو أن السعر سيتحرك في اتجاهه.`
                }
            ]
        });

    } catch (error) {
        results.innerHTML = `
            <div class="result-card">
                <h3>تعذر إكمال تحليل النشاط</h3>
                <p>${String(error.message || error)}</p>
            </div>
        `;
    }
}
