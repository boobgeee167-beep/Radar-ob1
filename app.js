
/* =========================================
   WHALE RADAR
   Main Application Controller
========================================= */

// تشغيل Telegram Mini App
if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;

    tg.ready();
    tg.expand();
}


// =========================================
// اختيار الفترة الزمنية
// =========================================

const timeButtons = document.querySelectorAll(".time-btn");

const customPeriod = document.getElementById("custom-period");

let selectedPeriod = "4h";

timeButtons.forEach(button => {

    button.addEventListener("click", () => {

        // إزالة التحديد السابق
        timeButtons.forEach(btn => {
            btn.classList.remove("active");
        });

        // تحديد الزر الحالي
        button.classList.add("active");

        selectedPeriod = button.dataset.period;

        // إظهار أو إخفاء الفترة المخصصة
        if (selectedPeriod === "custom") {
            customPeriod.classList.remove("hidden");
        } else {
            customPeriod.classList.add("hidden");
        }

    });

});


// =========================================
// قراءة إعدادات الفحص
// =========================================

function getScanSettings() {

    const symbol = document
        .getElementById("symbol")
        .value
        .trim()
        .toUpperCase()
        .replace(/USDT$/, "");

    const startDate = document.getElementById("start-date").value;
    const endDate = document.getElementById("end-date").value;

    if (!symbol) {
        showMessage("يرجى كتابة رمز العملة أولاً");
        return null;
    }

    if (selectedPeriod === "custom") {

        if (!startDate || !endDate) {
            showMessage("يرجى تحديد تاريخ البداية والنهاية");
            return null;
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        if (Number.isNaN(start.getTime()) ||
            Number.isNaN(end.getTime()) ||
            start >= end) {
            showMessage("الفترة الزمنية غير صحيحة");
            return null;
        }

        return {
            symbol: symbol + "USDT",
            period: "custom",
            startTime: start.getTime(),
            endTime: end.getTime()
        };

    }

    return {
        symbol: symbol + "USDT",
        period: selectedPeriod
    };

}


// =========================================
// زر بدء الفحص
// =========================================

const scanButton = document.getElementById("scan-btn");

scanButton.addEventListener("click", () => {

    const settings = getScanSettings();

    if (!settings) return;

    console.log("Scan Settings:", settings);

    showMessage("تم تجهيز إعدادات الفحص بنجاح");

});


// =========================================
// أزرار أدوات الرادار
// =========================================

const radarButtons = document.querySelectorAll(".radar-button");

radarButtons.forEach(button => {

    button.addEventListener("click", () => {

        const tool = button.dataset.tool;

        handleRadarTool(tool);

    });

});


// =========================================
// توجيه أزرار الأدوات
// =========================================

function handleRadarTool(tool) {

    const settings = getScanSettings();

    if (!settings) return;

    switch (tool) {

        case "chart":
            openTradingView(settings.symbol);
            break;

        case "large-trades":
            showMessage("الصفقات الضخمة: سيتم تحديد وظيفتها لاحقاً");
            break;

        case "hidden-orders":
            showMessage("أنماط الأوامر المخفية: سيتم تحديد وظيفتها لاحقاً");
            break;

        case "execution-clusters":
            showMessage("تجمعات التنفيذ: سيتم تحديد وظيفتها لاحقاً");
            break;

        case "capital-footprint":
            showMessage("بصمة نشاط رأس المال الكبير: سيتم تحديد وظيفتها لاحقاً");
            break;

        case "buy-sell-activity":
            showMessage("نشاط الشراء والبيع: سيتم تحديد وظيفته لاحقاً");
            break;

        default:
            showMessage("الأداة غير معروفة");

    }

}


// =========================================
// فتح شارت TradingView
// =========================================

function openTradingView(symbol) {

    const url = "https://www.tradingview.com/chart/?symbol=BINANCE:" +
        encodeURIComponent(symbol);

    window.open(url, "_blank");

}


// =========================================
// رسائل التنبيه
// =========================================

function showMessage(message) {

    alert(message);

}
