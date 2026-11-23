
/* =========================================
   WHALE RADAR
   Main Application Controller
========================================= */


/* =========================================
   1. APPLICATION STATE
========================================= */

const WhaleRadar = {

    selectedPeriod: "4h",

    tools: {},

    registerTool(name, callback) {
        this.tools[name] = callback;
    },

    getSettings() {

        const symbolInput = document.getElementById("symbol");

        const symbol = symbolInput.value
            .trim()
            .toUpperCase()
            .replace(/USDT$/, "");

        if (!symbol) {
            showMessage("يرجى كتابة رمز العملة");
            return null;
        }

        const settings = {
            symbol: symbol + "USDT",
            period: this.selectedPeriod
        };

        if (this.selectedPeriod === "custom") {

            const startValue =
                document.getElementById("start-date").value;

            const endValue =
                document.getElementById("end-date").value;

            if (!startValue || !endValue) {
                showMessage("يرجى تحديد تاريخ البداية والنهاية");
                return null;
            }

            const startTime = new Date(startValue).getTime();
            const endTime = new Date(endValue).getTime();

            if (
                !Number.isFinite(startTime) ||
                !Number.isFinite(endTime) ||
                startTime >= endTime
            ) {
                showMessage("الفترة الزمنية غير صحيحة");
                return null;
            }

            if (endTime > Date.now()) {
                showMessage("تاريخ النهاية لا يمكن أن يكون في المستقبل");
                return null;
            }

            settings.startTime = startTime;
            settings.endTime = endTime;
        }

        return settings;
    },

    openTool(name) {

        const tool = this.tools[name];

        if (typeof tool !== "function") {
            showMessage("هذه الأداة لم تتم برمجتها بعد");
            return;
        }

        const settings = this.getSettings();

        if (!settings) return;

        tool(settings);
    }

};


/* =========================================
   2. TIME PERIOD SELECTION
========================================= */

const timeButtons = document.querySelectorAll(".time-btn");

const customPeriod = document.getElementById("custom-period");

timeButtons.forEach(button => {

    button.addEventListener("click", () => {

        timeButtons.forEach(item => {
            item.classList.remove("active");
        });

        button.classList.add("active");

        WhaleRadar.selectedPeriod = button.dataset.period;

        if (WhaleRadar.selectedPeriod === "custom") {
            customPeriod.classList.remove("hidden");
        } else {
            customPeriod.classList.add("hidden");
        }

    });

});


/* =========================================
   3. SCAN BUTTON
========================================= */

document.getElementById("scan-btn")
    .addEventListener("click", () => {

        const settings = WhaleRadar.getSettings();

        if (!settings) return;

        console.log("WHALE RADAR SETTINGS:", settings);

        showMessage("تم تجهيز إعدادات الفحص");

    });


/* =========================================
   4. RADAR TOOLS
========================================= */

const radarButtons = document.querySelectorAll(".radar-button");

radarButtons.forEach(button => {

    button.addEventListener("click", () => {

        const toolName = button.dataset.tool;

        WhaleRadar.openTool(toolName);

    });

});


/* =========================================
   5. MESSAGE SYSTEM
========================================= */

function showMessage(message) {
    alert(message);
}


/* =========================================
   6. TELEGRAM MINI APP
========================================= */

if (window.Telegram && window.Telegram.WebApp) {

    const tg = window.Telegram.WebApp;

    tg.ready();
    tg.expand();

}


/* =========================================
   GLOBAL ACCESS
========================================= */

window.WHALE_RADAR = WhaleRadar;
