
/**
 * WHALE RADAR
 * STRATEGY CONFIRMATION
 *
 * المحلل الاستراتيجي لمنطقة Order Block.
 *
 * يعتمد على أربعة مصادر تاريخية:
 * 1. الصفقات الضخمة
 * 2. عناقيد التنفيذ
 * 3. بصمة رأس المال
 * 4. نشاط الشراء والبيع
 *
 * السعر المرجعي:
 * آخر تنفيذ في الفترة التاريخية المختارة.
 *
 * لا يستخدم دفتر الأوامر اللحظي.
 */

import { analyzeStrategy } from "../core/strategy-engine.js";
import { renderDashboard } from "../core/results-ui.js";


/* =====================================
   FORMATTING
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

const formatTime = timestamp => {
    if (!timestamp) return "غير متاح";

    return new Date(timestamp).toLocaleString("ar", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
};

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
   STRATEGY VERDICT
===================================== */

function getVerdictTone(evaluation) {

    if (!evaluation) return "gold";

    if (evaluation.tone) return evaluation.tone;

    switch (evaluation.verdict) {
        case "support":
            return "buy";

        case "oppose":
            return "sell";

        case "mixed":
        case "insufficient":
        default:
            return "gold";
    }
}


function getVerdictTitle(evaluation) {

    if (!evaluation) {
        return "الحكم الاستراتيجي غير متاح";
    }

    if (evaluation.title) {
        return evaluation.title;
    }

    switch (evaluation.verdict) {
        case "support":
            return "الأدلة تميل إلى تأييد السيناريو";

        case "oppose":
            return "الأدلة تميل إلى معارضة السيناريو";

        case "mixed":
            return "الأدلة مختلطة";

        case "insufficient":
            return "الأدلة غير كافية";

        default:
            return "لا يوجد حكم استراتيجي واضح";
    }
}


function normalizeReasons(evaluation) {

    if (!Array.isArray(evaluation?.reasons)) {
        return [];
    }

    return evaluation.reasons.map(reason => {

        if (typeof reason === "string") {
            return reason;
        }

        if (reason && typeof reason === "object") {
            return reason.text ||
                reason.explanation ||
                reason.title ||
                "";
        }

        return "";
    }).filter(Boolean);
}


function buildStrategyVerdictSection(evaluation) {

    if (!evaluation) {
        return {
            type: "note",
            title: "الحكم الاستراتيجي",
            text:
                "لم يُرجع محرك التحليل حكماً استراتيجياً. " +
                "المعلومات المعروضة أدناه تصف الأدلة المتاحة فقط."
        };
    }

    const reasons = normalizeReasons(evaluation);

    const explanation =
        evaluation.explanation ||
        "لم يقدم المحرك تفسيراً إضافياً للحكم.";

    const reasonText = reasons.length
        ? "\n\nالأسباب التي استند إليها الحكم:\n" +
          reasons.map((reason, index) =>
              `${index + 1}. ${reason}`
          ).join("\n")
        : "\n\nلم يقدم المحرك قائمة أسباب تفصيلية.";

    return {
        type: "note",
        title: "الحكم الاستراتيجي للمحلل",
        text:
            `${getVerdictTitle(evaluation)}\n\n` +
            `${explanation}` +
            reasonText +
            "\n\nهذا الحكم يصف مدى توافق الأدلة المرصودة مع سيناريو الصفقة، " +
            "ولا يمثل احتمالاً رقمياً للنجاح أو أمراً بالدخول أو الامتناع."
    };
}


/* =====================================
   DIRECTIONAL FLOW
===================================== */

function analyzeDirectionalFlow(data, direction) {

    const buyValue = data.buyValue || 0;
    const sellValue = data.sellValue || 0;
    const count = data.count || 0;

    const total = buyValue + sellValue;

    if (!total || count < 10) {
        return {
            status: "بيانات غير كافية",
            tone: "gold",
            share: null,
            explanation:
                "عدد التنفيذات أو قيمتها غير كافٍ لتكوين قراءة موثوقة لضغط المبادرة. لا يمكن اعتبار ذلك تأييداً أو تعارضاً."
        };
    }

    const buyShare = buyValue / total * 100;
    const sellShare = sellValue / total * 100;

    const supportingShare =
        direction === "long"
            ? buyShare
            : sellShare;

    const opposingShare =
        direction === "long"
            ? sellShare
            : buyShare;

    if (supportingShare >= 60) {
        return {
            status: "ميل مبادرة مؤيد",
            tone: "buy",
            share: supportingShare,
            explanation:
                `بلغت حصة المبادرة في اتجاه الصفقة ${formatPercent(supportingShare)}. هذا تفوق في قيمة التنفيذات المبادرِة، لكنه لا يثبت وحده استجابة السعر أو نجاح الصفقة.`
        };
    }

    if (opposingShare >= 60) {
        return {
            status: "ميل مبادرة معاكس",
            tone: "sell",
            share: opposingShare,
            explanation:
                `بلغت حصة المبادرة المعاكسة لاتجاه الصفقة ${formatPercent(opposingShare)}. هذه إشارة تستحق الفحص، لكنها لا تلغي فرصة الدخول تلقائياً.`
        };
    }

    return {
        status: "مبادرة متقاربة",
        tone: "gold",
        share: supportingShare,
        explanation:
            "توزيع المبادرة بين الطرفين متقارب نسبياً، ولا يظهر تفوق واضح لأحدهما."
    };
}


/* =====================================
   LARGE TRADES IN ZONE
===================================== */

function analyzeZoneLargeTrades(largeTrades, zone) {

    const trades = (largeTrades.trades || []).filter(trade =>
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
   FINDINGS
===================================== */

function buildInterpretation(data) {

    const { evidence, strategy, referencePrice, position } = data;

    const zone = evidence.zone;
    const direction = strategy.direction;

    const flow = analyzeDirectionalFlow(
        zone,
        direction
    );

    const approachFlow = analyzeDirectionalFlow(
        evidence.approach,
        direction
    );

    const large = analyzeZoneLargeTrades(
        evidence.largeTrades,
        zone.zone
    );

    const approachLarge = evidence.approach.largeTrades || {
        count: 0,
        buyValue: 0,
        sellValue: 0
    };

    const activity = evidence.activity;
    const capital = evidence.capital;
    const clusters = evidence.clusters;

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

    const approachSupporting =
        direction === "long"
            ? evidence.approach.buyValue
            : evidence.approach.sellValue;

    const approachOpposing =
        direction === "long"
            ? evidence.approach.sellValue
            : evidence.approach.buyValue;

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

    /* السعر المرجعي */

    findings.push({
        title: "السعر المرجعي للفترة",

        text:
            `اعتمد المحلل على آخر تنفيذ في البيانات المختارة عند سعر ${formatPrice(referencePrice.price)}. ` +
            `وقت هذا التنفيذ: ${formatTime(referencePrice.timestamp)}. ` +
            "هذا السعر يمثل نهاية العينة التاريخية، وليس السعر اللحظي الحالي."
    });

    /* حالة المنطقة */

    findings.push({
        title: "موقع السعر من منطقة الدخول",

        text:
            `${position.status}. ${position.description}. ` +
            (
                position.distance !== null
                    ? `المسافة إلى أقرب حد: ${formatPrice(position.distance)}، أي ${Number(position.distanceInZoneWidths || 0).toFixed(2)} من عرض المنطقة.`
                    : "لا يمكن حساب المسافة بسبب نقص البيانات."
            )
    });

    /* التفاعل التاريخي */

    const history = evidence.historicalInteraction;

    findings.push({
        title: "التفاعل التاريخي مع المنطقة",

        text:
            history.tradedInside
                ? `سُجل ${formatNumber(history.insideCount)} تنفيذ داخل المنطقة خلال الفترة. ` +
                  `تنفيذات قريبة من الحد العلوي: ${formatNumber(history.upperBoundaryExecutions)}، ` +
                  `وقريبة من الحد السفلي: ${formatNumber(history.lowerBoundaryExecutions)}.`
                : "لم تُسجل تنفيذات داخل حدود المنطقة في الفترة المختارة. هذا يعني عدم وجود دليل تنفيذ مباشر داخلها، وليس دليلاً على فشل المنطقة."
    });

    /* المبادرة داخل المنطقة */

    findings.push({
        title: "تدفق المبادرة داخل المنطقة",

        text:
            zone.count > 0
                ? `${flow.status}. ${flow.explanation}`
                : "لا توجد تنفيذات داخل المنطقة تسمح بقياس ضغط المبادرة المباشر. لذلك لا نصنف هذا المحور كمؤيد أو معارض."
    });

    /* الصفقات الضخمة داخل المنطقة */

    findings.push({
        title: "الصفقات الضخمة داخل المنطقة",

        text:
            large.count > 0
                ? `رُصد ${formatNumber(large.count)} تنفيذات ضخمة داخل المنطقة. ` +
                  `بلغت قيمة ${supportingSide} المبادر ${formatMoney(largeSupporting)}، ` +
                  `مقابل ${formatMoney(largeOpposing)} لـ ${opposingSide} المبادر.`
                : "لم تُرصد تنفيذات تجاوزت عتبة الصفقات الضخمة داخل المنطقة. غياب هذه التنفيذات لا يعني وجود ضغط معاكس."
    });

    /* الممر السعري */

    if (position.location === "inside") {

        findings.push({
            title: "تحليل الممر السعري",

            text:
                "السعر المرجعي داخل المنطقة بالفعل؛ لذلك يركز المحلل على التنفيذات داخل حدودها بدلاً من إنشاء ممر اقتراب خارجي."
        });

    } else if (position.crossed) {

        findings.push({
            title: "تحليل الممر السعري",

            text:
                "بدأت العينة وانتهت على جانبين مختلفين من المنطقة. هذا لا يثبت وحده المسار الذي سلكه السعر أو أنه عبر المنطقة فعلياً؛ لذلك نتعامل معه كسياق تاريخي يحتاج إلى فحص."
        });

    } else if (evidence.approach.count > 0) {

        findings.push({
            title: "نشاط التنفيذات في الممر المؤدي للمنطقة",

            text:
                `رُصد ${formatNumber(evidence.approach.count)} تنفيذ في الممر السعري بين السعر المرجعي والمنطقة. ` +
                `بلغت قيمة المبادرة في اتجاه الصفقة ${formatMoney(approachSupporting)}، ` +
                `مقابل ${formatMoney(approachOpposing)} للطرف المعاكس. ` +
                `قراءة المبادرة في الممر: ${approachFlow.status}.`
        });

    } else {

        findings.push({
            title: "نشاط التنفيذات في الممر المؤدي للمنطقة",

            text:
                "لم تتوفر تنفيذات في الممر السعري بين السعر المرجعي والمنطقة ضمن العينة. لذلك لا توجد قراءة كافية عن سلوك السوق أثناء الاقتراب."
        });

    }

    /* الصفقات الضخمة في الممر */

    if (
        !position.crossed &&
        position.location !== "inside"
    ) {

        findings.push({
            title: "الصفقات الضخمة في ممر الاقتراب",

            text:
                approachLarge.count > 0
                    ? `رُصد ${formatNumber(approachLarge.count)} تنفيذات ضخمة في الممر. ` +
                      `قيمة الشراء المبادر: ${formatMoney(approachLarge.buyValue)}، ` +
                      `وقيمة البيع المبادر: ${formatMoney(approachLarge.sellValue)}.`
                    : "لم تُرصد صفقات ضخمة في ممر الاقتراب. هذا غياب لدليل من هذا النوع، وليس تعارضاً مع الصفقة."
        });

    }

    /* العناقيد */

    findings.push({
        title: "عناقيد التنفيذ",

        text:
            `رُصد ${formatNumber(clusters.activeWindows)} نافذة نشطة من أصل ${formatNumber(clusters.totalWindows)} نافذة زمنية ذات بيانات. ` +
            "هذا يصف كثافة التنفيذ زمنياً في كامل العينة، ولا يثبت وحده وجود جهة واحدة تنفذ الأوامر."
    });

    /* بصمة رأس المال */

    findings.push({
        title: "بصمة رأس المال",

        text:
            `حلل المحرك ${formatNumber(capital.count)} من أكبر التنفيذات وفق عتبة القيمة المحددة. ` +
            `بلغت قيمة الشراء ${formatMoney(capital.buyValue)}، ` +
            `وقيمة البيع ${formatMoney(capital.sellValue)}. ` +
            "هذا توزيع عام للتنفيذات الكبيرة، وليس دليلاً على تمركز حساب واحد."
    });

    /* السياق العام */

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
        "السعر المرجعي هو آخر تنفيذ في الفترة المختارة، وليس السعر الحالي.",
        "لا توجد بيانات تاريخية لدفتر الأوامر ضمن هذا المحلل.",
        "لا يمكن إثبات هوية منفذي الصفقات أو أنهم جهة واحدة.",
        "ضغط المبادرة لا يكشف وحده هل تم امتصاص التنفيذات أم لا.",
        "التنفيذات لا تثبت وحدها أن ذيل شمعة لمس الحد.",
        "العناقيد وبصمة رأس المال محسوبان على كامل العينة.",
        "عدم وجود تنفيذات داخل المنطقة لا يعني وجود دليل معاكس."
    ];

    return {
        flow,
        approachFlow,
        large,
        findings,
        warnings
    };
}


/* =====================================
   RUN
===================================== */

export async function run(settings) {

    const results = document.getElementById("results-section");

    results.innerHTML = `
        <div class="result-card">
            <h3>🧠 المحلل الاستراتيجي</h3>
            <p>جارٍ تحليل منطقة Order Block...</p>
            <p>يتم ربط السعر المرجعي بالأدلة التاريخية.</p>
        </div>
    `;

    try {

        const data = await analyzeStrategy(settings);

        const report = buildInterpretation(data);

        const {
            market,
            evidence,
            strategy,
            evaluation
        } = data;

        const zone = evidence.zone;
        const flow = report.flow;
        const large = report.large;
        const position = data.position;

        const verdictTitle = getVerdictTitle(evaluation);
        const verdictTone = getVerdictTone(evaluation);

        const totalZoneValue =
            zone.buyValue + zone.sellValue;

        const buyPercent = totalZoneValue
            ? zone.buyValue / totalZoneValue * 100
            : 0;

        const sellPercent = totalZoneValue
            ? zone.sellValue / totalZoneValue * 100
            : 0;

        const approach = evidence.approach;

        const totalApproachValue =
            approach.buyValue + approach.sellValue;

        const approachBuyPercent = totalApproachValue
            ? approach.buyValue / totalApproachValue * 100
            : 0;

        const approachSellPercent = totalApproachValue
            ? approach.sellValue / totalApproachValue * 100
            : 0;

        const direction = strategy.direction;

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

        const metrics = [

            {
                label: "الحكم الاستراتيجي",
                value: verdictTitle,
                tone: verdictTone,
                detail: "تقييم توافق الأدلة مع سيناريو الصفقة"
            },

            {
                label: "اتجاه الصفقة",
                value: directionName(direction),
                tone: direction === "long" ? "buy" : "sell"
            },

            {
                label: "السعر المرجعي",
                value: formatPrice(data.referencePrice.price),
                tone: "blue",
                detail: "آخر تنفيذ في الفترة المختارة"
            },

            {
                label: "حالة المنطقة",
                value: position.status,
                tone: position.location === "inside"
                    ? "buy"
                    : position.crossed
                        ? "sell"
                        : "gold"
            },

            {
                label: "تنفيذات داخل المنطقة",
                value: formatNumber(zone.count),
                tone: "blue"
            },

            {
                label: "قراءة المبادرة",
                value: flow.status,
                tone: flow.tone,
                detail:
                    flow.share === null
                        ? "بيانات غير كافية"
                        : `حصة المبادرة المؤيدة: ${formatPercent(flow.share)}`
            }

        ];

        const sections = [

            buildStrategyVerdictSection(evaluation),

            {
                type: "note",
                title: "كيف نقرأ هذا الحكم؟",

                text:
                    "الحكم الاستراتيجي يقارن الأدلة التاريخية المتاحة مع اتجاه الصفقة ومنطقة الدخول. " +
                    "التأييد يعني أن بعض الأدلة تدعم السيناريو، والتعارض يعني وجود أدلة تستحق الحذر، " +
                    "والمختلط يعني وجود إشارات في اتجاهات مختلفة، وغير الكافي يعني أن البيانات لا تسمح بحكم واضح. " +
                    "ولا تعني أي نتيجة أن الصفقة ممنوعة أو أن نجاحها مضمون."
            },

            {
                type: "note",
                title: "السعر المرجعي وموقع المنطقة",

                text:
                    `السعر المرجعي: ${formatPrice(data.referencePrice.price)}. ` +
                    `وقت آخر تنفيذ: ${formatTime(data.referencePrice.timestamp)}. ` +
                    `الحد الأعلى: ${formatPrice(strategy.zone.upper)}. ` +
                    `الحد الأدنى: ${formatPrice(strategy.zone.lower)}. ` +
                    `الحالة: ${position.status}. ` +
                    `${position.description}.`
            },

            {
                type: "note",
                title: "المسافة إلى منطقة الدخول",

                text:
                    position.distance !== null
                        ? `المسافة إلى أقرب حد: ${formatPrice(position.distance)}. ` +
                          `تعادل ${Number(position.distanceInZoneWidths || 0).toFixed(2)} من عرض المنطقة.`
                        : "لا يمكن حساب المسافة."
            },

            {
                type: "bars",
                title: "ميزان المبادرة داخل منطقة الدخول",

                description:
                    "توزيع قيمة التنفيذات المبادرِة داخل حدود المنطقة فقط.",

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
                title: "قراءة المبادرة داخل المنطقة",

                text:
                    zone.count > 0
                        ? `${flow.status}. ${flow.explanation}`
                        : "لا توجد تنفيذات داخل المنطقة. لا يمكن إصدار حكم عن ضغط المبادرة المباشر."
            },

            {
                type: "bars",
                title: "ميزان المبادرة في ممر الاقتراب",

                description:
                    "التنفيذات الواقعة بين السعر المرجعي ومنطقة الدخول، عندما تكون المنطقة لم تُتجاوز.",

                items: [

                    {
                        label: "شراء مبادر",
                        value: approach.buyValue,
                        display:
                            `${formatMoney(approach.buyValue)} — ${formatPercent(approachBuyPercent)}`,
                        tone: "buy"
                    },

                    {
                        label: "بيع مبادر",
                        value: approach.sellValue,
                        display:
                            `${formatMoney(approach.sellValue)} — ${formatPercent(approachSellPercent)}`,
                        tone: "sell"
                    }

                ]
            },

            {
                type: "note",
                title: "قراءة ممر الاقتراب",

                text:
                    position.crossed
                        ? "بدأت العينة وانتهت على جانبين مختلفين من المنطقة؛ لا يمكن الجزم بالمسار الذي سلكه السعر اعتماداً على هاتين النقطتين فقط."
                        : position.location === "inside"
                            ? "السعر داخل المنطقة؛ قراءة التنفيذات المباشرة أهم من ممر خارجي."
                            : `${report.approachFlow.status}. ${report.approachFlow.explanation}`
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
                    "آخر 15 نافذة نشطة متاحة في العينة. قد تفصل بينها دقائق بلا تنفيذات.",

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
                    `الحكم الصادر عن المحرك: ${verdictTitle}. ` +
                    `${evaluation?.explanation || ""} ` +
                    `حلل المحرك ${formatNumber(market.totalTrades)} تنفيذ خلال الفترة المختارة. ` +
                    `السعر المرجعي ${formatPrice(data.referencePrice.price)}، ` +
                    `وحالة المنطقة: ${position.status}. ` +
                    `قراءة المبادرة داخل المنطقة: ${flow.status}. ` +
                    `قراءة الممر: ${report.approachFlow.status}. ` +
                    "هذا تقييم للأدلة المتاحة وليس احتمالاً لنجاح الصفقة أو أمراً بالدخول أو الامتناع عنها. " +
                    "الرادار مستشار للتحليل والتأكيد فقط، والقرار النهائي يبقى للمتداول."
            }

        ];

        renderDashboard({

            title: "🧠 المحلل الاستراتيجي",

            symbol: market.symbol,

            subtitle:
                `تحليل ${directionName(direction)} — ` +
                "تقييم الأدلة حول منطقة Order Block",

            metrics,

            sections

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

