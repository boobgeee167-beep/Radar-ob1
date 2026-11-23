
/**
 * WHALE RADAR
 * LARGE TRADES VISUAL DASHBOARD
 */

import { fetchMarketData } from "../core/market-data.js";
import { renderDashboard } from "../core/results-ui.js";

export async function run(settings) {

    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>🐋 تحليل الصفقات الضخمة</h3>
            <p>جارٍ تحليل بيانات السوق...</p>
        </div>
    `;

    try {

        const market = await fetchMarketData(settings);
        const trades = market.trades;

        if (!trades.length) {
            throw new Error("لا توجد صفقات ضمن الفترة المحددة");
        }

        const values = trades.map(t => t.value);
        const sortedValues = [...values].sort((a, b) => a - b);

        const percentile = p =>
            sortedValues[
                Math.floor((sortedValues.length - 1) * p)
            ];

        const average =
            values.reduce((sum, value) => sum + value, 0)
            / values.length;

        const threshold = Math.max(
            percentile(0.95),
            average * 5
        );

        const largeTrades = trades
            .filter(t => t.value >= threshold)
            .sort((a, b) => b.value - a.value);

        const buyTrades = largeTrades.filter(
            t => !t.buyerIsMaker
        );

        const sellTrades = largeTrades.filter(
            t => t.buyerIsMaker
        );

        const buyValue = buyTrades.reduce(
            (sum, t) => sum + t.value, 0
        );

        const sellValue = sellTrades.reduce(
            (sum, t) => sum + t.value, 0
        );

        const totalValue = buyValue + sellValue;

        const formatMoney = value =>
            "$" + value.toLocaleString("en-US", {
                maximumFractionDigits: 2
            });

        const formatNumber = value =>
            value.toLocaleString("en-US", {
                maximumFractionDigits: 8
            });

        const formatTime = timestamp =>
            new Date(timestamp).toLocaleString("ar");

        const rows = largeTrades.slice(0, 50).map(
            (trade, index) => [

                `#${index + 1}`,

                formatMoney(trade.value),

                formatNumber(trade.price),

                formatNumber(trade.quantity),

                trade.buyerIsMaker
                    ? "بيع مبادر"
                    : "شراء مبادر",

                formatTime(trade.time)

            ]
        );

        const buyPercent = totalValue > 0
            ? buyValue / totalValue * 100
            : 0;

        const sellPercent = totalValue > 0
            ? sellValue / totalValue * 100
            : 0;

        renderDashboard({

            title: "🐋 رادار الصفقات الضخمة",

            symbol: market.symbol,

            subtitle: "تحليل التنفيذات الكبيرة",

            metrics: [

                {
                    label: "إجمالي الصفقات المحللة",
                    value: market.totalTrades.toLocaleString(),
                    tone: "blue",
                    detail: `${market.pages} دفعات بيانات`
                },

                {
                    label: "الصفقات الضخمة",
                    value: largeTrades.length.toLocaleString(),
                    tone: "gold"
                },

                {
                    label: "قيمة الشراء المبادر",
                    value: formatMoney(buyValue),
                    tone: "buy"
                },

                {
                    label: "قيمة البيع المبادر",
                    value: formatMoney(sellValue),
                    tone: "sell"
                }

            ],

            sections: [

                {
                    type: "bars",
                    title: "ميزان رأس المال الكبير",
                    description: "توزيع قيمة الصفقات التي تجاوزت حد الرصد",

                    items: [

                        {
                            label: "الشراء المبادر",
                            value: buyValue,
                            display: `${formatMoney(buyValue)} — ${buyPercent.toFixed(1)}%`,
                            tone: "buy"
                        },

                        {
                            label: "البيع المبادر",
                            value: sellValue,
                            display: `${formatMoney(sellValue)} — ${sellPercent.toFixed(1)}%`,
                            tone: "sell"
                        }

                    ]
                },

                {
                    type: "table",
                    title: "أكبر 50 صفقة منفذة",
                    description: `حد رصد الصفقة: ${formatMoney(threshold)}`,

                    columns: [
                        "الترتيب",
                        "القيمة",
                        "السعر",
                        "الكمية",
                        "المبادرة",
                        "الوقت"
                    ],

                    rows
                },

                {
                    type: "note",
                    title: "قراءة الرادار",

                    text:
                        `تم تحليل ${market.totalTrades.toLocaleString()} صفقة. ` +
                        `تم رصد ${largeTrades.length} صفقة تجاوزت الحد التكيفي. ` +
                        `نسبة الشراء المبادر ${buyPercent.toFixed(2)}% ` +
                        `ونسبة البيع المبادر ${sellPercent.toFixed(2)}%. ` +
                        `اتجاه المبادرة لا يكشف هوية صاحب التنفيذ أو حسابه.`
                }

            ]

        });

    } catch (error) {

        results.innerHTML = `
            <div class="result-card">
                <h3>تعذر إكمال التحليل</h3>
                <p>${error.message}</p>
            </div>
        `;

    }

}
