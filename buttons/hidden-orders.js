
/**
 * WHALE RADAR
 * HIDDEN ORDERS DETECTOR
 * Central Data Engine Edition
 */

import { fetchMarketData } from "../core/market-data.js";

export async function run(settings) {

    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>🕵️ رادار الأوامر المخفية</h3>
            <p>جارٍ تحليل التنفيذات وفحص دفتر الأوامر...</p>
        </div>
    `;

    try {

        const market = await fetchMarketData(settings);
        const trades = market.trades;

        if (!trades.length) {
            throw new Error("لا توجد صفقات ضمن الفترة المحددة");
        }

        // تجميع التنفيذات حسب السعر
        const priceGroups = new Map();

        for (const trade of trades) {

            const key = trade.price;

            if (!priceGroups.has(key)) {
                priceGroups.set(key, {
                    price: trade.price,
                    count: 0,
                    buyValue: 0,
                    sellValue: 0,
                    totalValue: 0,
                    quantity: 0
                });
            }

            const group = priceGroups.get(key);

            group.count++;
            group.totalValue += trade.value;
            group.quantity += trade.quantity;

            if (trade.buyerIsMaker) {
                group.sellValue += trade.value;
            } else {
                group.buyValue += trade.value;
            }

        }

        const repeatedPrices = [...priceGroups.values()]
            .filter(group => group.count >= 5)
            .sort((a, b) => b.count - a.count);

        // أعلى التنفيذات قيمة
        const sortedTrades = [...trades]
            .sort((a, b) => b.value - a.value);

        const largeTrades = sortedTrades.slice(
            0,
            Math.max(1, Math.ceil(trades.length * 0.01))
        );

        const largeValue = largeTrades.reduce(
            (sum, trade) => sum + trade.value,
            0
        );

        // فحص دفتر الأوامر الحالي
        let depthData = null;
        let depthError = null;

        try {

            const url = new URL(
                "https://data-api.binance.vision/api/v3/depth"
            );

            url.searchParams.set("symbol", market.symbol);
            url.searchParams.set("limit", "100");

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            depthData = await response.json();

        } catch (error) {
            depthError = error.message;
        }

        // تحليل جدار الأوامر
        let bidWalls = [];
        let askWalls = [];

        if (depthData) {

            bidWalls = depthData.bids.map(level => ({
                price: Number(level[0]),
                quantity: Number(level[1]),
                value: Number(level[0]) * Number(level[1])
            }));

            askWalls = depthData.asks.map(level => ({
                price: Number(level[0]),
                quantity: Number(level[1]),
                value: Number(level[0]) * Number(level[1])
            }));

            bidWalls.sort((a, b) => b.value - a.value);
            askWalls.sort((a, b) => b.value - a.value);

        }

        const formatMoney = value =>
            "$" + value.toLocaleString("en-US", {
                maximumFractionDigits: 2
            });

        const formatNumber = value =>
            value.toLocaleString("en-US", {
                maximumFractionDigits: 8
            });

        const priceRows = repeatedPrices
            .slice(0, 20)
            .map(group => `
                <div class="trade-row">

                    <div>
                        <strong>${formatNumber(group.price)}</strong>
                        <small>${group.count} تنفيذات عند السعر نفسه</small>
                    </div>

                    <div>
                        <strong>${formatMoney(group.totalValue)}</strong>
                        <small>إجمالي القيمة</small>
                    </div>

                    <div>
                        <strong class="buy">${formatMoney(group.buyValue)}</strong>
                        <small class="sell">${formatMoney(group.sellValue)}</small>
                    </div>

                </div>
            `).join("");

        const wallRows = (walls, type) =>
            walls.slice(0, 5).map(wall => `
                <div class="trade-row">

                    <div>
                        <strong>${formatNumber(wall.price)}</strong>
                    </div>

                    <div>
                        <strong>${formatMoney(wall.value)}</strong>
                        <small>${formatNumber(wall.quantity)} وحدة</small>
                    </div>

                    <div class="${type}">
                        ${type === "buy" ? "طلب شراء" : "طلب بيع"}
                    </div>

                </div>
            `).join("");

        results.innerHTML = `

            <div class="result-card">

                <h3>🕵️ تحليل أنماط الأوامر المخفية</h3>

                <div class="trade-summary">

                    <div>
                        <small>العملة</small>
                        <strong>${market.symbol}</strong>
                    </div>

                    <div>
                        <small>الصفقات المحللة</small>
                        <strong>${market.totalTrades.toLocaleString()}</strong>
                    </div>

                    <div>
                        <small>مستويات الأسعار المتكررة</small>
                        <strong>${repeatedPrices.length}</strong>
                    </div>

                    <div>
                        <small>قيمة أعلى 1%</small>
                        <strong>${formatMoney(largeValue)}</strong>
                    </div>

                </div>

                <h4>📍 تكرار التنفيذ عند مستويات سعرية</h4>

                ${
                    priceRows ||
                    "<p>لم تظهر مستويات تكرار تستوفي شروط الرصد.</p>"
                }

                <h4>📗 أكبر جدران الشراء الحالية</h4>

                ${
                    depthData
                        ? wallRows(bidWalls, "buy") ||
                          "<p>لا توجد بيانات شراء.</p>"
                        : "<p>تعذر جلب دفتر الأوامر.</p>"
                }

                <h4>📕 أكبر جدران البيع الحالية</h4>

                ${
                    depthData
                        ? wallRows(askWalls, "sell") ||
                          "<p>لا توجد بيانات بيع.</p>"
                        : "<p>تعذر جلب دفتر الأوامر.</p>"
                }

                <p class="analysis-note">
                    تم تحليل ${market.totalTrades.toLocaleString()}
                    صفقة من ${market.pages} دفعات.
                    تكرار التنفيذ عند سعر واحد قد يشير إلى نشاط تنفيذ منظم،
                    لكنه لا يثبت وجود أمر Iceberg أو هوية جهة واحدة.
                    دفتر الأوامر يعرض لقطة حالية وليس تاريخاً للأوامر.
                    ${depthError ? "تعذر فحص دفتر الأوامر: " + depthError : ""}
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
