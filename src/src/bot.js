require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const db = require("./database");

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);

if (!TOKEN) {
    throw new Error("BOT_TOKEN تنظیم نشده");
}

if (!ADMIN_ID) {
    throw new Error("ADMIN_ID تنظیم نشده");
}

const bot = new TelegramBot(TOKEN, {
    polling: true
});

const sessions = new Map();

function money(value) {
    return new Intl.NumberFormat("fa-IR").format(value);
}

function isAdmin(id) {
    return Number(id) === ADMIN_ID;
}

function mainMenu() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: "🛒 خرید کانفیگ",
                        callback_data: "products"
                    }
                ],
                [
                    {
                        text: "📦 سفارش‌های من",
                        callback_data: "orders"
                    }
                ]
            ]
        }
    };
}

bot.onText(/^\/start$/, async (msg) => {

    db.prepare(`
        INSERT INTO users(id, username, first_name)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
        username=excluded.username,
        first_name=excluded.first_name
    `).run(
        msg.from.id,
        msg.from.username || "",
        msg.from.first_name || ""
    );

    await bot.sendMessage(
        msg.chat.id,
        "👋 به فروشگاه کانفیگ خوش آمدی.",
        mainMenu()
    );
});

bot.onText(/^\/admin$/, async (msg) => {

    if (!isAdmin(msg.from.id)) {
        return bot.sendMessage(
            msg.chat.id,
            "⛔ دسترسی ندارید."
        );
    }

    await bot.sendMessage(
        msg.chat.id,
        `👨‍💻 پنل مدیریت

دستورات:

/products
نمایش محصولات

/stock
نمایش موجودی

/addconfig ID CONFIG
افزودن کانفیگ`
    );
});

bot.onText(/^\/products$/, async (msg) => {

    if (!isAdmin(msg.from.id)) return;

    const products = db.prepare(`
        SELECT * FROM products
        ORDER BY id
    `).all();

    const text = products.map(p =>
        `ID: ${p.id}
📦 ${p.name}
💰 ${money(p.price)} تومان`
    ).join("\n\n");

    await bot.sendMessage(
        msg.chat.id,
        text || "محصولی وجود ندارد."
    );
});

bot.onText(/^\/stock$/, async (msg) => {

    if (!isAdmin(msg.from.id)) return;

    const products = db.prepare(`
        SELECT
            p.id,
            p.name,
            COUNT(c.id) AS stock
        FROM products p
        LEFT JOIN configs c
            ON c.product_id = p.id
            AND c.sold = 0
        GROUP BY p.id
    `).all();

    const text = products.map(p =>
        `ID ${p.id} | ${p.name} | موجودی: ${p.stock}`
    ).join("\n");

    await bot.sendMessage(
        msg.chat.id,
        `📊 موجودی:\n\n${text || "خالی"}`
    );
});

bot.onText(
    /^\/addconfig\s+(\d+)\s+([\s\S]+)$/i,
    async (msg, match) => {

        if (!isAdmin(msg.from.id)) return;

        const productId = Number(match[1]);
        const config = match[2].trim();

        const product = db.prepare(`
            SELECT *
            FROM products
            WHERE id = ?
        `).get(productId);

        if (!product) {
            return bot.sendMessage(
                msg.chat.id,
                "❌ محصول پیدا نشد."
            );
        }

        db.prepare(`
            INSERT INTO configs(product_id, config)
            VALUES (?, ?)
        `).run(productId, config);

        await bot.sendMessage(
            msg.chat.id,
            "✅ کانفیگ به موجودی اضافه شد."
        );
    }
);

bot.on("callback_query", async (query) => {

    const chatId = query.message.chat.id;
    const data = query.data;

    await bot.answerCallbackQuery(query.id).catch(() => {});

    // نمایش محصولات
    if (data === "products") {

        const products = db.prepare(`
            SELECT
                p.*,
                COUNT(c.id) AS stock
            FROM products p
            LEFT JOIN configs c
                ON c.product_id = p.id
                AND c.sold = 0
            WHERE p.active = 1
            GROUP BY p.id
        `).all();

        const buttons = products.map(p => [
            {
                text: `${p.name} - ${money(p.price)} تومان`,
                callback_data: `buy:${p.id}`
            }
        ]);

        return bot.sendMessage(
            chatId,
            "🛒 پلن موردنظر را انتخاب کن:",
            {
                reply_markup: {
                    inline_keyboard: buttons
                }
            }
        );
    }

    // خرید
    if (data.startsWith("buy:")) {

        const productId = Number(data.split(":")[1]);

        const product = db.prepare(`
            SELECT *
            FROM products
            WHERE id = ?
            AND active = 1
        `).get(productId);

        if (!product) {
            return bot.sendMessage(
                chatId,
                "❌ محصول پیدا نشد."
            );
        }

        const stock = db.prepare(`
            SELECT COUNT(*) AS count
            FROM configs
            WHERE product_id = ?
            AND sold = 0
        `).get(productId).count;

        if (stock === 0) {
            return bot.sendMessage(
                chatId,
                "❌ این محصول فعلاً موجود نیست."
            );
        }

        const result = db.prepare(`
            INSERT INTO orders(user_id, product_id)
            VALUES (?, ?)
        `).run(chatId, productId);

        const orderId = result.lastInsertRowid;

        sessions.set(chatId, orderId);

        await bot.sendMessage(
            chatId,
`🧾 سفارش #${orderId}

📦 ${product.name}

💰 مبلغ:
${money(product.price)} تومان

💳 شماره کارت:
${process.env.CARD_NUMBER}

👤 صاحب کارت:
${process.env.CARD_HOLDER}

بعد از پرداخت، عکس رسید را همین‌جا ارسال کن.`
        );

        return;
    }

    // سفارش‌های کاربر
    if (data === "orders") {

        const orders = db.prepare(`
            SELECT
                o.id,
                o.status,
                p.name
            FROM orders o
            JOIN products p
                ON p.id = o.product_id
            WHERE o.user_id = ?
            ORDER BY o.id DESC
            LIMIT 10
        `).all(chatId);

        if (!orders.length) {
            return bot.sendMessage(
                chatId,
                "📦 هنوز سفارشی نداری."
            );
        }

        const statuses = {
            waiting_receipt: "منتظر رسید",
            pending: "در انتظار بررسی",
            paid: "تأیید شده",
            rejected: "رد شده"
        };

        const text = orders.map(o =>
            `#${o.id} | ${o.name} | ${statuses[o.status]}`
        ).join("\n");

        return bot.sendMessage(
            chatId,
            text
        );
    }

    // تایید سفارش
    if (data.startsWith("approve:")) {

        if (!isAdmin(chatId)) return;

        const orderId = Number(data.split(":")[1]);

        const order = db.prepare(`
            SELECT *
            FROM orders
            WHERE id = ?
        `).get(orderId);

        if (!order || order.status !== "pending") {
            return bot.sendMessage(
                chatId,
                "❌ سفارش قابل تأیید نیست."
            );
        }

        const config = db.prepare(`
            SELECT *
            FROM configs
            WHERE product_id = ?
            AND sold = 0
            LIMIT 1
        `).get(order.product_id);

        if (!config) {
            return bot.sendMessage(
                chatId,
                "❌ موجودی تمام شده است."
            );
        }

        db.prepare(`
            UPDATE configs
            SET sold = 1
            WHERE id = ?
        `).run(config.id);

        db.prepare(`
            UPDATE orders
            SET status = 'paid',
                config_id = ?
            WHERE id = ?
        `).run(config.id, orderId);

        await bot.sendMessage(
            order.user_id,
`✅ پرداخت سفارش #${orderId} تأیید شد.

🔐 کانفیگ شما:

${config.config}`
        );

        return bot.sendMessage(
            chatId,
            "✅ سفارش تأیید شد."
        );
    }

    // رد سفارش
    if (data.startsWith("reject:")) {

        if (!isAdmin(chatId)) return;

        const orderId = Number(data.split(":")[1]);

        const order = db.prepare(`
            SELECT *
            FROM orders
            WHERE id = ?
        `).get(orderId);

        if (!order) return;

        db.prepare(`
            UPDATE orders
            SET status = 'rejected'
            WHERE id = ?
        `).run(orderId);

        await bot.sendMessage(
            order.user_id,
            `❌ رسید سفارش #${orderId} رد شد.`
        );

        await bot.sendMessage(
            chatId,
            "❌ سفارش رد شد."
        );
    }
});

// دریافت رسید
bot.on("photo", async (msg) => {

    const orderId = sessions.get(msg.chat.id);

    if (!orderId) return;

    const order = db.prepare(`
        SELECT
            o.*,
            p.name,
            p.price
        FROM orders o
        JOIN products p
            ON p.id = o.product_id
        WHERE o.id = ?
    `).get(orderId);

    if (!order) return;

    const photo =
        msg.photo[msg.photo.length - 1];

    db.prepare(`
        UPDATE orders
        SET status = 'pending',
            receipt_id = ?
        WHERE id = ?
    `).run(photo.file_id, orderId);

    sessions.delete(msg.chat.id);

    await bot.sendPhoto(
        ADMIN_ID,
        photo.file_id,
        {
            caption:
`🧾 رسید جدید

🆔 سفارش: #${orderId}

👤 کاربر:
${msg.from.username
    ? "@" + msg.from.username
    : msg.from.id}

📦 محصول:
${order.name}

💰 مبلغ:
${money(order.price)} تومان`,
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "✅ تأیید",
                            callback_data: `approve:${orderId}`
                        },
                        {
                            text: "❌ رد",
                            callback_data: `reject:${orderId}`
                        }
                    ]
                ]
            }
        }
    );

    await bot.sendMessage(
        msg.chat.id,
        "✅ رسید دریافت شد. منتظر بررسی ادمین باش."
    );
});

bot.on("polling_error", (error) => {
    console.error(error.message);
});

console.log("🤖 Telegram Config Shop Started");
