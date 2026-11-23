
/* =====================================
   WHALE RADAR - MAIN CONTROLLER
===================================== */

const WhaleRadar = {

    selectedPeriod: "4h",

    tools: {},

    registerTool(name, callback) {
        this.tools[name] = callback;
    },

    getSettings(requireStrategy = false) {

        const symbolInput = document.getElementById("symbol");

        const symbol = symbolInput.value
            .trim()
            .toUpperCase()
            .replace(/USDT$/, "");

        if (!symbol) {
            alert("يرجى كتابة رمز العملة");
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
                alert("يرجى تحديد التاريخ والوقت");
                return null;
            }

            const startTime = new Date(startValue).getTime();
            const endTime = new Date(endValue).getTime();

            if (
                !Number.isFinite(startTime) ||
                !Number.isFinite(endTime) ||
                startTime >= endTime ||
                endTime > Date.now()
            ) {
                alert("الفترة الزمنية غير صحيحة");
                return null;
            }

            settings.startTime = startTime;
            settings.endTime = endTime;
        }

        /* إعدادات الاستراتيجية */

        if (requireStrategy) {

            const upperInput =
                document.getElementById("ob-upper");

            const lowerInput =
                document.getElementById("ob-lower");

            const upper = Number(upperInput?.value);
            const lower = Number(lowerInput?.value);

            if (
                !upperInput?.value ||
                !lowerInput?.value ||
                !Number.isFinite(upper) ||
                !Number.isFinite(lower) ||
                upper <= 0 ||
                lower <= 0 ||
                upper < lower
            ) {
                alert("يرجى إدخال حدود منطقة Order Block بشكل صحيح");
                return null;
            }

            const activeDirection =
                document.querySelector(".direction-btn.active");

            if (!activeDirection) {
                alert("يرجى تحديد اتجاه الصفقة");
                return null;
            }

            settings.strategy = {
                upper: upper,
                lower: lower,
                direction: activeDirection.dataset.direction
            };
        }

        return settings;
    },

    async loadTools() {

        const modules = [
            ["chart", "./buttons/chart.js"],
            ["large-trades", "./buttons/large-trades.js"],
            ["hidden-orders", "./buttons/hidden-orders.js"],
            ["execution-clusters", "./buttons/execution-clusters.js"],
            ["capital-footprint", "./buttons/capital-footprint.js"],
            ["buy-sell-activity", "./buttons/buy-sell-activity.js"],

            ["strategy-confirmation", "./buttons/strategy-confirmation.js"]
        ];

        for (const [name, path] of modules) {

            try {
                const module = await import(path);

                if (typeof module.run === "function") {
                    this.registerTool(name, module.run);
                }

            } catch (error) {
                console.warn("Tool not loaded:", name, error);
            }
        }

    },

    async openTool(name) {

        const tool = this.tools[name];

        if (!tool) {
            alert("هذه الأداة لم تتم إضافتها بعد");
            return;
        }

        const settings = this.getSettings(
            name === "strategy-confirmation"
        );

        if (!settings) return;

        await tool(settings);

    }

};


/* اختيار الفترة الزمنية */

document.querySelectorAll(".time-btn").forEach(button => {

    button.addEventListener("click", () => {

        document.querySelectorAll(".time-btn").forEach(item => {
            item.classList.remove("active");
        });

        button.classList.add("active");

        WhaleRadar.selectedPeriod = button.dataset.period;

        document.getElementById("custom-period")
            .classList.toggle(
                "hidden",
                WhaleRadar.selectedPeriod !== "custom"
            );

    });

});


/* اختيار اتجاه الصفقة */

document.querySelectorAll(".direction-btn").forEach(button => {

    button.addEventListener("click", () => {

        document.querySelectorAll(".direction-btn").forEach(item => {
            item.classList.remove("active");
        });

        button.classList.add("active");

    });

});


/* زر الفحص */

document.getElementById("scan-btn")
    .addEventListener("click", () => {

        const settings = WhaleRadar.getSettings();

        if (settings) {
            console.log("Scan settings:", settings);
            alert("تم تجهيز إعدادات الفحص");
        }

    });


/* ربط أزرار الأدوات */

document.querySelectorAll(".radar-button").forEach(button => {

    button.addEventListener("click", () => {
        WhaleRadar.openTool(button.dataset.tool);
    });

});


/* Telegram Mini App */

if (window.Telegram?.WebApp) {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
}


/* تحميل ملفات الأدوات */

WhaleRadar.loadTools();


/* إتاحة المشغّل */

window.WHALE_RADAR = WhaleRadar;
