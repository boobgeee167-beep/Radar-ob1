
/**
 * WHALE RADAR
 * LARGE TRADES DETECTOR
 * الإصدار المتصل بمحرك البيانات المركزي
 */

import { fetchMarketData } from "../core/market-data.js";

export async function run(settings) {

    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>🐋 رادار الصفقات الضخمة</h3>
            <p>جارٍ جلب جميع صفقات الفترة المحددة وتحليلها...</p>
        </div>
    `;

    try {

        // جلب البيانات الكاملة من المحرك المركزي
        const market = await fetchMarketData(settings);

        const trades = market.trades;

        if (!trades.length) {
            throw new Error("لا توجد صفقات ضمن الفترة المحددة");
        }

        // حساب متوسط قيمة التنفيذ
        const values = trades.map(t => t.value);

        const sortedValues = [...values].sort((a, b) => a - b);

        const percentile = p =>
            sortedValues[
                Math.floor((sortedValues.length - 1) * p)
            ];

        const average =
            values.reduce((sum, value) => sum + value, 0)
            / values.length;

        const median = percentile(0.50);
        const p95 = percentile(0.95);

        // حد الرصد التكيفي
        const threshold = Math.max(
            p95,
            average * 5
        );

        const largeTrades = trades
            .filter(trade => trade.value >= threshold)
            .sort((a, b) => b.value - a.value);

        const totalLargeValue = largeTrades.reduce(
            (sum, trade) => sum + trade.value,
            0
        );

        const buyTrades = largeTrades.filter(
            trade => !trade.buyerIsMaker
        );

        const sellTrades = largeTrades.filter(
            trade => trade.buyerIsMaker
        );

        const buyValue = buyTrades.reduce(
            (sum, trade) => sum + trade.value, 0
        );

        const sellValue = sellTrades.reduce(
            (sum, trade) => sum + trade.value, 0
        );

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

        const rows = largeTrades.slice(0, 50).map(trade => {

            const isBuy = !trade.buyerIsMaker;

            return `
                <div class="trade-row">

                    <div>
                        <strong>${formatMoney(trade.value)}</strong>
                        <small>${formatTime(trade.time)}</small>
                    </div>

                    <div>
                        <strong>${formatNumber(trade.price)}</strong>
                        <small>${formatNumber(trade.quantity)} وحدة</small>
                    </div>

                    <div class="${isBuy ? "buy" : "sell"}">
                        ${isBuy ? "شراء مبادر" : "بيع مبادر"}
                    </div>

                </div>
            `;

        }).join("");

        results.innerHTML = `

            <div class="result-card">

                <h3>🐋 تحليل الصفقات الضخمة</h3>

                <div class="trade-summary">

                    <div>
                        <small>العملة</small>
                        <strong>${market.symbol}</strong>
                    </div>

                    <div>
                        <small>إجمالي الصفقات</small>
                        <strong>${market.totalTrades.toLocaleString()}</strong>
                    </div>

                    <div>
                        <small>دفعات البيانات</small>
                        <strong>${market.pages}</strong>
                    </div>

                    <div>
                        <small>الصفقات الضخمة</small>
                        <strong>${largeTrades.length}</strong>
                    </div>

                </div>

                <h4>ملخص رأس المال الكبير</h4>

                <div class="trade-summary">

                    <div>
                        <small>قيمة الصفقات الضخمة</small>
                        <strong>${formatMoney(totalLargeValue)}</strong>
                    </div>

                    <div>
                        <small>قيمة الشراء المبادر</small>
                        <strong class="buy">${formatMoney(buyValue)}</strong>
                    </div>

                    <div>
                        <small>قيمة البيع المبادر</small>
                        <strong class="sell">${formatMoney(sellValue)}</strong>
                    </div>

                    <div>
                        <small>حد رصد الصفقة</small>
                        <strong>${formatMoney(threshold)}</strong>
                    </div>

                </div>

                <h4>أكبر الصفقات المنفذة</h4>

                ${
                    rows ||
                    "<p>لم يتم العثور على صفقات تتجاوز حد الرصد.</p>"
                }

                <p class="analysis-note">
                    تم تحليل ${market.totalTrades.toLocaleString()}
                    صفقة ضمن الفترة المطلوبة، عبر ${market.pages} دفعة.
                    حد الرصد تكيفي ويعتمد على توزيع أحجام التنفيذ.
                    اتجاه المبادرة لا يكشف هوية صاحب الصفقة.
                </p>

            </div>

        `;

    } catch (error) {

        results.innerHTML = `
            <div class="result-card">
                <h3>تعذر إكمال التحليل</h3>
                <p>${error.message}</p>
            </div>
        `;

    }

}
