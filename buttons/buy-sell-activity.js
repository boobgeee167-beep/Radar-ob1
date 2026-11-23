
/**
 * WHALE RADAR
 * BUY / SELL ACTIVITY ANALYZER
 *
 * تحليل نشاط المشترين والبائعين المبادرين.
 * قياس ضغط التنفيذ وتغيره عبر الزمن.
 * مقارنة اتجاه المبادرة بحركة السعر.
 */

export async function run(settings) {

    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>📊 تحليل نشاط الشراء والبيع</h3>
            <p>جارٍ تحليل تدفق التداول...</p>
        </div>
    `;

    try {

        const symbol = settings.symbol;

        const url = new URL(
            "https://data-api.binance.vision/api/v3/aggTrades"
        );

        url.searchParams.set("symbol", symbol);
        url.searchParams.set("limit", "1000");

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("تعذر الاتصال ببيانات Binance");
        }

        const rawTrades = await response.json();

        if (!Array.isArray(rawTrades) || !rawTrades.length) {
            throw new Error("لا توجد بيانات تداول متاحة");
        }

        let trades = rawTrades.map(trade => ({

            price: Number(trade.p),
            quantity: Number(trade.q),
            value: Number(trade.p) * Number(trade.q),
            time: Number(trade.T),

            // m=true: البائع هو الطرف المبادر
            // m=false: المشتري هو الطرف المبادر
            buyerIsMaker: trade.m

        }));

        // تطبيق الفترة الزمنية المخصصة
        if (
            settings.period === "custom" &&
            settings.startTime &&
            settings.endTime
        ) {

            trades = trades.filter(trade =>
                trade.time >= settings.startTime &&
                trade.time <= settings.endTime
            );

        }

        if (trades.length < 5) {
            throw new Error("عدد الصفقات غير كافٍ للتحليل");
        }

        trades.sort((a, b) => a.time - b.time);

        // إجمالي نشاط الشراء والبيع
        let buyValue = 0;
        let sellValue = 0;

        let buyQuantity = 0;
        let sellQuantity = 0;

        let buyCount = 0;
        let sellCount = 0;

        for (const trade of trades) {

            if (trade.buyerIsMaker) {

                sellValue += trade.value;
                sellQuantity += trade.quantity;
                sellCount++;

            } else {

                buyValue += trade.value;
                buyQuantity += trade.quantity;
                buyCount++;

            }

        }

        const totalValue = buyValue + sellValue;

        const buyRatio = totalValue
            ? buyValue / totalValue * 100
            : 0;

        const sellRatio = totalValue
            ? sellValue / totalValue * 100
            : 0;

        // تقسيم النشاط إلى نوافذ زمنية
        const WINDOW_MS = 60 * 1000;

        const windows = new Map();

        for (const trade of trades) {

            const bucketTime =
                Math.floor(trade.time / WINDOW_MS) * WINDOW_MS;

            if (!windows.has(bucketTime)) {

                windows.set(bucketTime, {

                    time: bucketTime,

                    buyValue: 0,
                    sellValue: 0,

                    buyCount: 0,
                    sellCount: 0,

                    firstPrice: trade.price,
                    lastPrice: trade.price

                });

            }

            const bucket = windows.get(bucketTime);

            bucket.lastPrice = trade.price;

            if (trade.buyerIsMaker) {

                bucket.sellValue += trade.value;
                bucket.sellCount++;

            } else {

                bucket.buyValue += trade.value;
                bucket.buyCount++;

            }

        }

        const timeline = [...windows.values()]
            .sort((a, b) => a.time - b.time)
            .map(bucket => {

                const value =
                    bucket.buyValue + bucket.sellValue;

                const buyPercent = value
                    ? bucket.buyValue / value * 100
                    : 0;

                const sellPercent = value
                    ? bucket.sellValue / value * 100
                    : 0;

                const delta =
                    bucket.lastPrice - bucket.firstPrice;

                const priceChange = bucket.firstPrice
                    ? delta / bucket.firstPrice * 100
                    : 0;

                return {

                    ...bucket,

                    totalValue: value,

                    buyPercent,
                    sellPercent,

                    priceChange,

                    deltaValue:
                        bucket.buyValue - bucket.sellValue

                };

            });

        // اكتشاف تغيرات ضغط المبادرة
        const shifts = [];

        for (let i = 1; i < timeline.length; i++) {

            const previous = timeline[i - 1];
            const current = timeline[i];

            const previousBias =
                previous.buyPercent >= 60
                    ? "شراء"
                    : previous.sellPercent >= 60
                        ? "بيع"
                        : "متوازن";

            const currentBias =
                current.buyPercent >= 60
                    ? "شراء"
                    : current.sellPercent >= 60
                        ? "بيع"
                        : "متوازن";

            if (
                previousBias !== currentBias &&
                currentBias !== "متوازن"
            ) {

                shifts.push({

                    time: current.time,

                    previousBias,
                    currentBias,

                    buyPercent: current.buyPercent,
                    sellPercent: current.sellPercent,

                    priceChange: current.priceChange

                });

            }

        }

        // أفضل وأضعف دقائق النشاط
        const strongestBuy = [...timeline]
            .sort((a, b) => b.buyValue - a.buyValue)[0];

        const strongestSell = [...timeline]
            .sort((a, b) => b.sellValue - a.sellValue)[0];

        // القراءة العامة
        const overallBias =
            buyRatio >= 60
                ? "سيطرة الشراء المبادر"
                : sellRatio >= 60
                    ? "سيطرة البيع المبادر"
                    : "توازن نسبي بين الطرفين";

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

        // جدول النشاط الزمني
        const timelineHTML = [...timeline]
            .sort((a, b) => b.totalValue - a.totalValue)
            .slice(0, 20)
            .map(bucket => {

                const direction =
                    bucket.buyPercent >= 60
                        ? "شراء مبادر"
                        : bucket.sellPercent >= 60
                            ? "بيع مبادر"
                            : "متوازن";

                const directionClass =
                    bucket.buyPercent >= 60
                        ? "buy"
                        : bucket.sellPercent >= 60
                            ? "sell"
                            : "";

                return `

                    <div class="trade-row">

                        <div>
                            <strong>${formatMoney(bucket.totalValue)}</strong>
                            <small>${formatTime(bucket.time)}</small>
                        </div>

                        <div>
                            <strong class="${directionClass}">
                                ${direction}
                            </strong>

                            <small>
                                شراء ${bucket.buyPercent.toFixed(1)}%
                                | بيع ${bucket.sellPercent.toFixed(1)}%
                            </small>
                        </div>

                        <div>
                            <strong>
                                ${bucket.priceChange >= 0 ? "+" : ""}
                                ${bucket.priceChange.toFixed(3)}%
                            </strong>

                            <small>تغير السعر خلال الدقيقة</small>
                        </div>

                    </div>

                `;

            }).join("");

        // جدول التحولات
        const shiftsHTML = shifts
            .slice(-15)
            .reverse()
            .map(shift => `

                <div class="trade-row">

                    <div>
                        <strong>${formatTime(shift.time)}</strong>
                    </div>

                    <div>
                        <strong>${shift.previousBias} ← ${shift.currentBias}</strong>
                        <small>تحول في اتجاه المبادرة</small>
                    </div>

                    <div>
                        <strong>
                            شراء ${shift.buyPercent.toFixed(1)}%
                            | بيع ${shift.sellPercent.toFixed(1)}%
                        </strong>
                    </div>

                </div>

            `).join("");

        results.innerHTML = `

            <div class="result-card">

                <h3>📊 نتائج نشاط الشراء والبيع</h3>

                <div class="trade-summary">

                    <div>
                        <small>العملة</small>
                        <strong>${symbol}</strong>
                    </div>

                    <div>
                        <small>التنفيذات</small>
                        <strong>${trades.length}</strong>
                    </div>

                    <div>
                        <small>إجمالي القيمة</small>
                        <strong>${formatMoney(totalValue)}</strong>
                    </div>

                    <div>
                        <small>القراءة العامة</small>
                        <strong>${overallBias}</strong>
                    </div>

                </div>

                <h4>1. مقارنة الشراء والبيع</h4>

                <div class="trade-summary">

                    <div>
                        <small>قيمة الشراء المبادر</small>
                        <strong>${formatMoney(buyValue)}</strong>
                        <small>${buyRatio.toFixed(2)}%</small>
                    </div>

                    <div>
                        <small>قيمة البيع المبادر</small>
                        <strong>${formatMoney(sellValue)}</strong>
                        <small>${sellRatio.toFixed(2)}%</small>
                    </div>

                    <div>
                        <small>عدد تنفيذات الشراء</small>
                        <strong>${buyCount}</strong>
                    </div>

                    <div>
                        <small>عدد تنفيذات البيع</small>
                        <strong>${sellCount}</strong>
                    </div>

                </div>

                <h4>2. أحجام الكميات</h4>

                <div class="trade-summary">

                    <div>
                        <small>كمية الشراء المبادر</small>
                        <strong>${formatNumber(buyQuantity)}</strong>
                    </div>

                    <div>
                        <small>كمية البيع المبادر</small>
                        <strong>${formatNumber(sellQuantity)}</strong>
                    </div>

                </div>

                <h4>3. أقوى فترات النشاط</h4>

                <div class="trade-summary">

                    <div>
                        <small>أقوى دقيقة شراء</small>
                        <strong>${formatMoney(strongestBuy.buyValue)}</strong>
                        <small>${formatTime(strongestBuy.time)}</small>
                    </div>

                    <div>
                        <small>أقوى دقيقة بيع</small>
                        <strong>${formatMoney(strongestSell.sellValue)}</strong>
                        <small>${formatTime(strongestSell.time)}</small>
                    </div>

                </div>

                <h4>4. التحولات في ضغط المبادرة</h4>

                ${
                    shiftsHTML ||
                    "<p>لم يتم رصد تحولات واضحة وفق شروط التحليل.</p>"
                }

                <h4>5. النشاط عبر الزمن</h4>

                ${
                    timelineHTML ||
                    "<p>لا توجد بيانات زمنية كافية.</p>"
                }

                <p class="analysis-note">
                    الشراء المبادر يعني أن المشتري أخذ السيولة من دفتر
                    الأوامر، والبيع المبادر يعني أن البائع أخذ السيولة.
                    لا يعني ذلك صافي تدفق الأموال أو هوية المتداولين.
                    التحليل هنا مبني على عينة الصفقات المتاحة من Binance.
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
