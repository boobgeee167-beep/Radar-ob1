
/**
 * WHALE RADAR
 * LARGE TRADES DETECTOR
 * رصد الصفقات الضخمة على Binance Spot
 */

export async function run(settings) {

    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>🐋 رادار الصفقات الضخمة</h3>
            <p>جارٍ تحليل الصفقات المنفذة...</p>
        </div>
    `;

    try {

        const symbol = settings.symbol;

        const url =
            `https://data-api.binance.vision/api/v3/aggTrades?symbol=${symbol}&limit=1000`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("تعذر الاتصال ببيانات Binance");
        }

        const trades = await response.json();

        if (!Array.isArray(trades) || trades.length === 0) {
            throw new Error("لا توجد صفقات متاحة");
        }

        // حساب قيمة كل صفقة مجمعة
        const analyzed = trades.map(trade => {

            const price = Number(trade.p);
            const quantity = Number(trade.q);
            const value = price * quantity;

            return {
                price,
                quantity,
                value,
                time: Number(trade.T),
                buyerIsMaker: trade.m
            };

        });

        // حساب متوسط قيمة الصفقات
        const values = analyzed.map(t => t.value);

        const average =
            values.reduce((sum, value) => sum + value, 0)
            / values.length;

        const deviations = values.map(value =>
            Math.abs(value - average)
        );

        const mad =
            deviations.reduce((sum, value) => sum + value, 0)
            / deviations.length;

        // تحديد الصفقات الاستثنائية مقارنة بنشاط العملة
        const threshold = Math.max(
            average * 5,
            average + mad * 5
        );

        const largeTrades = analyzed
            .filter(trade => trade.value >= threshold)
            .sort((a, b) => b.value - a.value)
            .slice(0, 50);

        const formatMoney = value =>
            "$" + value.toLocaleString("en-US", {
                maximumFractionDigits: 2
            });

        const formatTime = timestamp =>
            new Date(timestamp).toLocaleString("ar");

        const tradeRows = largeTrades.map(trade => {

            const buyerInitiated = !trade.buyerIsMaker;

            return `
                <div class="trade-row">
                    <div>
                        <strong>${formatMoney(trade.value)}</strong>
                        <small>${formatTime(trade.time)}</small>
                    </div>

                    <div>
                        <strong>${trade.price}</strong>
                        <small>${trade.quantity} ${symbol.replace("USDT", "")}</small>
                    </div>

                    <div class="${buyerInitiated ? "buy" : "sell"}">
                        ${buyerInitiated ? "شراء مبادر" : "بيع مبادر"}
                    </div>
                </div>
            `;

        }).join("");

        results.innerHTML = `

            <div class="result-card">

                <h3>🐋 نتائج الصفقات الضخمة</h3>

                <div class="trade-summary">
                    <div>
                        <small>العملة</small>
                        <strong>${symbol}</strong>
                    </div>

                    <div>
                        <small>الصفقات المفحوصة</small>
                        <strong>${analyzed.length}</strong>
                    </div>

                    <div>
                        <small>الصفقات الاستثنائية</small>
                        <strong>${largeTrades.length}</strong>
                    </div>

                    <div>
                        <small>حد الرصد التقديري</small>
                        <strong>${formatMoney(threshold)}</strong>
                    </div>
                </div>

                <h4>أكبر الصفقات المنفذة</h4>

                ${
                    tradeRows ||
                    "<p>لم يتم العثور على صفقات تتجاوز حد الرصد.</p>"
                }

                <p class="analysis-note">
                    الرصد مبني على بيانات الصفقات المجمعة العامة.
                    اتجاه المبادرة يوضح الطرف الذي بدأ التنفيذ،
                    وليس هوية صاحب الصفقة.
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
