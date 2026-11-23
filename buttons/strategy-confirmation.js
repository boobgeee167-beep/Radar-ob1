
/**
 * WHALE RADAR
 * STRATEGY CONFIRMATION
 *
 * محلل الأدلة الاستراتيجية.
 * يربط نشاط السوق بمنطقة Order Block.
 *
 * يعتمد على أربعة مصادر تاريخية:
 * 1. الصفقات الضخمة
 * 2. عناقيد التنفيذ
 * 3. بصمة رأس المال
 * 4. نشاط الشراء والبيع
 *
 * لا يستخدم دفتر الأوامر اللحظي.
 */

import { analyzeStrategy } from "../core/strategy-engine.js";
import { renderDashboard } from "../core/results-ui.js";


/* =====================================
   التنسيق
===================================== */

const formatMoney = value =>
    "$" + Number(value || 0).toLocaleString("en-US", {
        maximumFractionDigits: 2
    });

const formatPrice = value =>
    Number(value || 0).toLocaleString("en-US", {
        maximumFractionDigits: 10
    });

const formatNumber = value =>
    Number(value || 0).toLocaleString("en-US");

const formatPercent = value =>
    Number(value || 0).toFixed(1) + "%";

const formatTime = timestamp =>
    new Date(timestamp).toLocaleString("ar", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });

const directionName = direction =>
    direction === "long" ? "شراء LONG" : "بيع SHORT";

const escapeHTML = value =>
    String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);


/* =====================================
   قراءة المبادرة داخل المنطقة
===================================== */

function analyzeDirectionalFlow(zone) {

    const total = zone.buyValue + zone.sellValue;

    if (!total || zone.executionCount < 10) {
        return {
            status: "بيانات غير كافية",
            tone: "gold",
            share: 0,
            explanation:
                "عدد التنفيذات أو قيمتها داخل المنطقة غير كافٍ لتكوين قراءة موثوقة لضغط المبادرة."
        };
    }

    const buyShare = zone.buyValue / total * 100;
    const sellShare = zone.sellValue / total * 100;

    const supportingShare =
        zone.direction === "long"
            ? buyShare
            : sellShare;

    const opposingShare =
        zone.direction === "long"
            ? sellShare
            : buyShare;

    if (supportingShare >= 60) {
        return {
            status: "ميل مبادرة مؤيد",
            tone: "buy",
            share: supportingShare,
            explanation:
                `بلغت حصة المبادرة في اتجاه الصفقة ${formatPercent(supportingShare)} داخل المنطقة. هذا يعني أن التنفيذات المبادرِة في اتجاه الصفقة كانت أكبر من الطرف المقابل، لكنه لا يثبت أن السعر استجاب لها أو أن الصفقة ستنجح.`
        };
    }

    if (opposingShare >= 60) {
        return {
            status: "ميل مبادرة معاكس",
            tone: "sell",
            share: opposingShare,
            explanation:
                `بلغت حصة المبادرة المعاكسة لاتجاه الصفقة ${formatPercent(opposingShare)} داخل المنطقة. هذه إشارة تستحق الانتباه، لكنها لا تثبت وحدها فشل المنطقة أو إلغاء فرصة الدخول.`
        };
    }

    return {
        status: "مبادرة متقاربة",
        tone: "gold",
        share: supportingShare,
        explanation:
            "توزيع المبادرة بين الطرفين متقارب نسبياً داخل المنطقة، ولا يظهر تفوق واضح لأحدهما."
    };
}


/* =====================================
   استخراج الصفقات الضخمة داخل المنطقة
===================================== */

function analyzeZoneLargeTrades(largeTrades, zone) {

    const trades = largeTrades.trades.filter(trade =>
        trade.price >= zone.lower &&
        trade.price <= zone.upper
    );

    const buy = trades.filter(
        trade => !trade.buyerIsMaker
    );

    const sell = trades.filter(
        trade => trade.buyerIsMaker
    );

    return {
        count: trades.length,
        buyCount: buy.length,
        sellCount: sell.length,
        buyValue: buy.reduce(
            (total, trade) => total + trade.value, 0
        ),
        sellValue: sell.reduce(
            (total, trade) => total + trade.value, 0
        )
    };
}


/* =====================================
   بناء التفسير الاستراتيجي
===================================== */

function buildInterpretation(data) {

    const { evidence, market } = data;

    const zone = evidence.zone;
    const flow = analyzeDirectionalFlow(zone);

    const large = analyzeZoneLargeTrades(
        evidence.largeTrades,
        zone
    );

    const activity = evidence.activity;
    const capital = evidence.capital;
    const clusters = evidence.clusters;

    const direction = zone.zone.direction;

    const supportingSide =
        direction === "long" ? "الشراء" : "البيع";

    const opposingSide =
        direction === "long" ? "البيع" : "الشراء";

    const largeSupporting =
        direction === "long"
            ? large.buyValue
            : large.sellValue;

    const largeOpposing =
        direction === "long"
            ? large.sellValue
            : large.buyValue;

    const globalSupporting =
        direction === "long"
            ? activity.buyValue
            : activity.sellValue;

    const globalOpposing =
        direction === "long"
            ? activity.sellValue
            : activity.buyValue;

    const recentSupporting =
        direction === "long"
            ? activity.recentBuyValue
            : activity.recentSellValue;

    const recentOpposing =
        direction === "long"
            ? activity.recentSellValue
            : activity.recentBuyValue;

    const findings = [];

    findings.push({
        title: "تدفق المبادرة داخل المنطقة",
        text: flow.explanation
    });

    if (large.count > 0) {

        findings.push({
            title: "التنفيذات الضخمة داخل المنطقة",
            text:
                `رُصد ${large.count} تنفيذات ضمن عتبة الصفقات الضخمة في المنطقة. ` +
                `بلغت قيمة ${supportingSide} المبادر ${formatMoney(largeSupporting)}، ` +
                `مقابل ${formatMoney(largeOpposing)} لـ ${opposingSide} المبادر.`
        });

    } else {

        findings.push({
            title: "التنفيذات الضخمة داخل المنطقة",
            text:
                "لم تُرصد تنفيذات تجاوزت عتبة الصفقات الضخمة داخل حدود المنطقة. هذا غياب لدليل من هذا النوع، وليس دليلاً على وجود ضغط معاكس."
        });

    }

    findings.push({
        title: "عناقيد التنفيذ",
        text:
            `رُصد ${clusters.activeWindows} نافذة نشطة من أصل ${clusters.totalWindows} دقيقة ذات بيانات. ` +
            "هذه النتيجة تصف كثافة التنفيذ زمنياً على مستوى العينة كلها، ولا تثبت أن العناقيد حدثت داخل منطقة Order Block."
    });

    findings.push({
        title: "بصمة رأس المال",
        text:
            `حلل المحرك ${capital.count} من أكبر التنفيذات وفق عتبة القيمة المحددة. ` +
            `بلغت قيمة الشراء ضمنها ${formatMoney(capital.buyValue)}، ` +
            `وقيمة البيع ${formatMoney(capital.sellValue)}. ` +
            "هذا توزيع عام للتنفيذات الكبيرة، وليس دليلاً على تمركز حساب واحد أو على وجود رأس مال بعينه داخل المنطقة."
    });

    findings.push({
        title: "السياق العام للمبادرة",
        text:
            `في كامل العينة بلغت المبادرة في اتجاه الصفقة ${formatMoney(globalSupporting)}، ` +
            `مقابل ${formatMoney(globalOpposing)} للطرف المعاكس. ` +
            `وفي آخر النوافذ الزمنية المتاحة بلغت ${formatMoney(recentSupporting)} ` +
            `مقابل ${formatMoney(recentOpposing)}. ` +
            "هذه قراءة عامة للسوق وليست دليلاً محصوراً في منطقة الدخول."
    });

    const warnings = [
        "لا تتوفر في هذا التحليل لقطات تاريخية لدفتر الأوامر.",
        "لا يمكن إثبات هوية منفذي الصفقات أو أنهم جهة واحدة.",
        "ضغط المبادرة لا يكشف وحده هل تم امتصاص التنفيذات أم لا.",
        "لم يُقَس بعد رد فعل السعر بعد موجات المبادرة.",
        "العناقيد وبصمة رأس المال محسوبان على كامل العينة، وليس داخل منطقة الدخول تحديداً."
    ];

    return {
        flow,
        large,
        findings,
        warnings
    };
}


/* =====================================
   تشغيل المحلل
===================================== */

export async function run(settings) {

    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>🧠 المحلل الاستراتيجي</h3>
            <p>جارٍ فحص الأدلة وربطها بمنطقة Order Block...</p>
            <p>يرجى الانتظار حتى اكتمال التحليل.</p>
        </div>
    `;

    try {

        const data = await analyzeStrategy(settings);

        const report = buildInterpretation(data);

        const { market, evidence } = data;

        const zone = evidence.zone;
        const flow = report.flow;
        const large = report.large;

        const totalZoneValue =
            zone.buyValue + zone.sellValue;

        const buyPercent = totalZoneValue
            ? zone.buyValue / totalZoneValue * 100
            : 0;

        const sellPercent = totalZoneValue
            ? zone.sellValue / totalZoneValue * 100
            : 0;

        const direction = zone.zone.direction;

        const largeRows = [
            [
                "شراء مبادر",
                formatNumber(large.buyCount),
                formatMoney(large.buyValue)
            ],
            [
                "بيع مبادر",
                formatNumber(large.sellCount),
                formatMoney(large.sellValue)
            ]
        ];

        const timelineRows = evidence.activity.timeline
            .slice(-15)
            .reverse()
            .map((window, index) => [
                `#${index + 1}`,
                formatTime(window.start),
                formatMoney(window.buyValue),
                formatMoney(window.sellValue),
                window.buyValue > window.sellValue
                    ? "شراء"
                    : window.sellValue > window.buyValue
                        ? "بيع"
                        : "متوازن"
            ]);

        const findingSections = report.findings.map(
            finding => ({
                type: "note",
                title: finding.title,
                text: finding.text
            })
        );

        const warningText = report.warnings
            .map((warning, index) =>
                `${index + 1}. ${warning}`
            )
            .join("\n");

        renderDashboard({

            title: "🧠 المحلل الاستراتيجي",
            symbol: market.symbol,

            subtitle:
                `تحليل ${directionName(direction)} — ` +
                "تقييم الأدلة حول منطقة Order Block",

            metrics: [

                {
                    label: "اتجاه الصفقة",
                    value: directionName(direction),
                    tone: direction === "long" ? "buy" : "sell"
                },

                {
                    label: "تنفيذات داخل المنطقة",
                    value: formatNumber(zone.executionCount),
                    tone: "blue"
                },

                {
                    label: "قيمة التنفيذات داخل المنطقة",
                    value: formatMoney(zone.totalValue),
                    tone: "gold"
                },

                {
                    label: "قراءة المبادرة",
                    value: flow.status,
                    tone: flow.tone,
                    detail: `حصة المبادرة المؤيدة: ${formatPercent(flow.share)}`
                }

            ],

            sections: [

                {
                    type: "note",
                    title: "منطقة الاستراتيجية",

                    text:
                        `الحد الأعلى: ${formatPrice(zone.zone.upper)}. ` +
                        `الحد الأدنى: ${formatPrice(zone.zone.lower)}. ` +
                        `الاتجاه: ${directionName(direction)}. ` +
                        `عدد التنفيذات داخل المنطقة: ${formatNumber(zone.executionCount)}. ` +
                        `القيمة الإجمالية: ${formatMoney(zone.totalValue)}.`
                },

                {
                    type: "bars",
                    title: "ميزان المبادرة داخل منطقة الدخول",

                    description:
                        "هذا هو المصدر المباشر الذي يربط تدفق التنفيذات بمنطقة Order Block.",

                    items: [

                        {
                            label: "شراء مبادر",
                            value: zone.buyValue,
                            display:
                                `${formatMoney(zone.buyValue)} — ${formatPercent(buyPercent)}`,
                            tone: "buy"
                        },

                        {
                            label: "بيع مبادر",
                            value: zone.sellValue,
                            display:
                                `${formatMoney(zone.sellValue)} — ${formatPercent(sellPercent)}`,
                            tone: "sell"
                        }

                    ]
                },

                {
                    type: "note",
                    title: "قراءة المبادرة",

                    text:
                        `${flow.status}. ${flow.explanation}`
                },

                {
                    type: "table",
                    title: "الصفقات الضخمة داخل المنطقة",

                    description:
                        "التنفيذات التي تجاوزت العتبة الإحصائية للصفقات الضخمة.",

                    columns: [
                        "نوع المبادرة",
                        "عدد التنفيذات",
                        "القيمة"
                    ],

                    rows: largeRows
                },

                ...findingSections,

                {
                    type: "table",
                    title: "التسلسل الزمني للمبادرة",

                    description:
                        "آخر 15 دقيقة نشطة متاحة في العينة، وقد تفصل بينها دقائق بلا تنفيذات.",

                    columns: [
                        "الترتيب",
                        "الوقت",
                        "شراء مبادر",
                        "بيع مبادر",
                        "الغلبة"
                    ],

                    rows: timelineRows
                },

                {
                    type: "note",
                    title: "حدود التحليل وما لا يمكن إثباته",

                    text: warningText
                },

                {
                    type: "note",
                    title: "الخلاصة الاستراتيجية",

                    text:
                        `المحلل رصد ${formatNumber(market.totalTrades)} تنفيذ صالح خلال الفترة المحددة. ` +
                        `داخل منطقة الدخول، كانت قراءة المبادرة: ${flow.status}. ` +
                        `هذه النتيجة تصف تدفق التنفيذات ولا تمثل حكماً نهائياً على صلاحية الصفقة. ` +
                        "لا يمنع هذا التقرير الدخول ولا يلغي استراتيجية المستخدم. القرار النهائي يبقى للمتداول."
                }

            ]

        });

    } catch (error) {

        results.innerHTML = `
            <div class="result-card">
                <h3>تعذر إكمال التحليل الاستراتيجي</h3>
                <p>${escapeHTML(error.message || error)}</p>
            </div>
        `;

    }

                                               }
