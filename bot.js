const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const http = require('http');

// ==================== CONFIGURATION ====================
const CONFIG = {
    BOT_TOKEN: '8373867092:AAGdhIUllnFiW6D18WFm5cIoT-B91HFdAes',
    ADMIN_ID: 8597801059,
    BOT_USERNAME: 'refertoearn_inr_bot',
    CHANNELS: ['@brutetest'],
    CHANNELS_ON_CHECK: ['@brutetest'],
    WELCOME_BONUS: 1,
    PER_REFERRAL_BONUS: 2,
    MIN_WITHDRAW_LIMIT: 20
};

// ==================== DATA STORAGE ====================
const DATA_FILE = 'data.json';
let db = {};

function loadDatabase() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        } else {
            db = {};
            saveDatabase();
        }
    } catch (err) {
        db = {};
    }
}

function saveDatabase() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function getUserData(userId) {
    const key = userId.toString();
    if (!db[key]) {
        db[key] = {
            balance: CONFIG.WELCOME_BONUS,
            wait_for_ans: 'no',
            withdraw_step: 'none',
            pending_withdraw_amount: 0,
            pending_withdraw_upi: '',
            pending_referrer: 0,
            referral_credited: false
        };
        saveDatabase();
    }
    return db[key];
}

function updateUserData(userId, data) {
    db[userId.toString()] = data;
    saveDatabase();
}

// ==================== BOLD SERIF FONT ====================
function boldSerif(text) {
    const map = {
        'A':'𝐀','B':'𝐁','C':'𝐂','D':'𝐃','E':'𝐄','F':'𝐅','G':'𝐆','H':'𝐇','I':'𝐈',
        'J':'𝐉','K':'𝐊','L':'𝐋','M':'𝐌','N':'𝐍','O':'𝐎','P':'𝐏','Q':'𝐐','R':'𝐑',
        'S':'𝐒','T':'𝐓','U':'𝐔','V':'𝐕','W':'𝐖','X':'𝐗','Y':'𝐘','Z':'𝐙',
        'a':'𝐚','b':'𝐛','c':'𝐜','d':'𝐝','e':'𝐞','f':'𝐟','g':'𝐠','h':'𝐡','i':'𝐢',
        'j':'𝐣','k':'𝐤','l':'𝐥','m':'𝐦','n':'𝐧','o':'𝐨','p':'𝐩','q':'𝐪','r':'𝐫',
        's':'𝐬','t':'𝐭','u':'𝐮','v':'𝐯','w':'𝐰','x':'𝐱','y':'𝐲','z':'𝐳'
    };
    return text.split('').map(ch => map[ch] || ch).join('');
}

// ==================== HELPER FUNCTIONS ====================
async function checkUserJoinedChannels(userId, bot) {
    for (const channel of CONFIG.CHANNELS_ON_CHECK) {
        try {
            const member = await bot.getChatMember(channel, userId);
            const status = member.status;
            if (!['member', 'administrator', 'creator'].includes(status)) {
                return false;
            }
        } catch (err) {
            return false;
        }
    }
    return true;
}

async function sendNormalKeyboard(chatId, bot) {
    const keyboard = {
        keyboard: [
            ['💰 Balance', '🔗 Referral'],
            ['💸 Withdraw']
        ],
        resize_keyboard: true
    };
    await bot.sendMessage(chatId, boldSerif('🏘 𝐌𝐚𝐢𝐧 𝐌𝐞𝐧𝐮'), { reply_markup: keyboard });
}

// ==================== ADMIN COMMANDS ====================
async function approveWithdrawal(userId, bot) {
    const userData = getUserData(userId);
    const pending = userData.pending_withdraw_amount;
    if (pending <= 0) {
        await bot.sendMessage(CONFIG.ADMIN_ID, 'No pending withdrawal for this user.');
        return;
    }
    userData.pending_withdraw_amount = 0;
    userData.pending_withdraw_upi = '';
    updateUserData(userId, userData);
    await bot.sendMessage(userId, boldSerif(`✅ 𝐘𝐨𝐮𝐫 𝐰𝐢𝐭𝐡𝐝𝐫𝐚𝐰𝐚𝐥 𝐨𝐟 ₹${pending} 𝐡𝐚𝐬 𝐛𝐞𝐞𝐧 𝐚𝐩𝐩𝐫𝐨𝐯𝐞𝐝 𝐚𝐧𝐝 𝐬𝐞𝐧𝐭 𝐭𝐨 𝐲𝐨𝐮𝐫 𝐔𝐏𝐈.`));
    await bot.sendMessage(CONFIG.ADMIN_ID, `Withdrawal approved for user ${userId} (₹${pending}).`);
}

async function rejectWithdrawal(userId, bot) {
    const userData = getUserData(userId);
    const pending = userData.pending_withdraw_amount;
    if (pending <= 0) {
        await bot.sendMessage(CONFIG.ADMIN_ID, 'No pending withdrawal for this user.');
        return;
    }
    userData.balance += pending;
    userData.pending_withdraw_amount = 0;
    userData.pending_withdraw_upi = '';
    updateUserData(userId, userData);
    await bot.sendMessage(userId, boldSerif(`❌ 𝐘𝐨𝐮𝐫 𝐰𝐢𝐭𝐡𝐝𝐫𝐚𝐰𝐚𝐥 𝐫𝐞𝐪𝐮𝐞𝐬𝐭 𝐨𝐟 ₹${pending} 𝐡𝐚𝐬 𝐛𝐞𝐞𝐧 𝐫𝐞𝐣𝐞𝐜𝐭𝐞𝐝. 𝐀𝐦𝐨𝐮𝐧𝐭 𝐫𝐞𝐟𝐮𝐧𝐝𝐞𝐝.`));
    await bot.sendMessage(CONFIG.ADMIN_ID, `Withdrawal rejected for user ${userId} (₹${pending} refunded).`);
}

// ==================== BOT INITIALIZATION ====================
const bot = new TelegramBot(CONFIG.BOT_TOKEN, { polling: true });
loadDatabase();
console.log('Bot started successfully!');

// Simple HTTP server to satisfy Render's port requirement
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running');
});
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

// ==================== COMMAND: /start ====================
bot.onText(/\/start(?:\s+ref_(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name;
    const referrerIdStr = match[1] ? match[1] : null;

    let userData = getUserData(chatId);
    const isNew = !db[chatId.toString()];

    if (isNew) {
        userData = getUserData(chatId);
        await bot.sendMessage(chatId, boldSerif(`🎉 𝐂𝐨𝐧𝐠𝐫𝐚𝐭𝐬, 𝐘𝐨𝐮 𝐫𝐞𝐜𝐞𝐢𝐯𝐞𝐝 ₹${CONFIG.WELCOME_BONUS} 𝐰𝐞𝐥𝐜𝐨𝐦𝐞 𝐛𝐨𝐧𝐮𝐬.`));

        if (referrerIdStr && referrerIdStr !== chatId.toString()) {
            const referrerId = parseInt(referrerIdStr);
            if (db[referrerId]) {
                userData.pending_referrer = referrerId;
                updateUserData(chatId, userData);
            }
        }
    } else {
        await bot.sendMessage(chatId, boldSerif('👋 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 𝐛𝐚𝐜𝐤!'));
    }

    // Build inline keyboard for channels
    const inlineKeyboard = [];
    for (const ch of CONFIG.CHANNELS) {
        inlineKeyboard.push([{ text: `↗️ Join ${ch}`, url: `https://t.me/${ch.substring(1)}` }]);
    }
    inlineKeyboard.push([{ text: '✅ Joined', callback_data: '/joined' }]);

    const welcomeText = boldSerif(
        '𝐖𝐞𝐥𝐜𝐨𝐦𝐞 𝐭𝐨 𝐨𝐮𝐫 𝐛𝐨𝐭!\n\n' +
        '👨‍💻 𝐑𝐞𝐟𝐞𝐫 & 𝐞𝐚𝐫𝐧 𝐫𝐮𝐩𝐞𝐞𝐬 𝐚𝐧𝐝 𝐰𝐢𝐭𝐡𝐝𝐫𝐚𝐰 𝐭𝐨 𝐔𝐏𝐈.\n\n' +
        '⬇️ 𝐁𝐞𝐟𝐨𝐫𝐞 𝐭𝐡𝐚𝐭, 𝐣𝐨𝐢𝐧 𝐭𝐡𝐞 𝐜𝐡𝐚𝐧𝐧𝐞𝐥 𝐛𝐞𝐥𝐨𝐰:'
    );
    await bot.sendMessage(chatId, welcomeText, { reply_markup: { inline_keyboard: inlineKeyboard } });

    userData.wait_for_ans = 'no';
    userData.withdraw_step = 'none';
    updateUserData(chatId, userData);
});

// ==================== CALLBACK: /joined ====================
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.from.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;

    if (data === '/joined') {
        const allJoined = await checkUserJoinedChannels(chatId, bot);
        if (allJoined) {
            await bot.deleteMessage(chatId, messageId);
            await sendNormalKeyboard(chatId, bot);
            await bot.sendMessage(chatId, boldSerif('💁‍♂ 𝐖𝐞𝐥𝐜𝐨𝐦𝐞! 𝐑𝐞𝐟𝐞𝐫 & 𝐄𝐚𝐫𝐧 𝐑𝐮𝐩𝐞𝐞𝐬.'));

            const userData = getUserData(chatId);
            const pendingReferrer = userData.pending_referrer;
            if (!userData.referral_credited && pendingReferrer && pendingReferrer !== chatId) {
                const referrerData = getUserData(pendingReferrer);
                if (referrerData) {
                    referrerData.balance += CONFIG.PER_REFERRAL_BONUS;
                    updateUserData(pendingReferrer, referrerData);
                    userData.referral_credited = true;
                    userData.pending_referrer = 0;
                    updateUserData(chatId, userData);
                    const firstName = callbackQuery.from.first_name;
                    await bot.sendMessage(pendingReferrer, `➤ New Referral: ${firstName}\n₹${CONFIG.PER_REFERRAL_BONUS} added to your balance`);
                }
            }
        } else {
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'You haven\'t joined all required channels. Please join and try again.', show_alert: true });
        }
    }
    // Reset pending withdrawal state if any
    const userData = getUserData(chatId);
    if (userData.wait_for_ans === 'yes') {
        userData.wait_for_ans = 'no';
        updateUserData(chatId, userData);
    }
});

// ==================== TEXT MESSAGE HANDLER ====================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text) return;

    // Admin commands
    if (chatId === CONFIG.ADMIN_ID && text.startsWith('/approve_withdraw')) {
        const parts = text.split(' ');
        if (parts.length >= 2) {
            const userId = parseInt(parts[1]);
            await approveWithdrawal(userId, bot);
        } else {
            await bot.sendMessage(CONFIG.ADMIN_ID, 'Usage: /approve_withdraw <user_id>');
        }
        return;
    }
    if (chatId === CONFIG.ADMIN_ID && text.startsWith('/reject_withdraw')) {
        const parts = text.split(' ');
        if (parts.length >= 2) {
            const userId = parseInt(parts[1]);
            await rejectWithdrawal(userId, bot);
        } else {
            await bot.sendMessage(CONFIG.ADMIN_ID, 'Usage: /reject_withdraw <user_id>');
        }
        return;
    }

    // Ignore if user hasn't started
    if (!db[chatId.toString()]) return;

    const userData = getUserData(chatId);
    const withdrawStep = userData.withdraw_step;

    // Withdrawal amount input
    if (withdrawStep === 'awaiting_amount') {
        const amount = parseFloat(text);
        if (isNaN(amount)) {
            await bot.sendMessage(chatId, '‼️ Please enter a valid number.');
            return;
        }
        if (amount < CONFIG.MIN_WITHDRAW_LIMIT) {
            await bot.sendMessage(chatId, `⚠️ Minimum withdrawal amount is ₹${CONFIG.MIN_WITHDRAW_LIMIT}.`);
            return;
        }
        if (amount > userData.balance) {
            await bot.sendMessage(chatId, `⚠️ You don't have enough balance. Your balance is ₹${userData.balance}.`);
            return;
        }
        userData.pending_withdraw_amount = amount;
        userData.withdraw_step = 'awaiting_upi';
        updateUserData(chatId, userData);
        await bot.sendMessage(chatId, '🆙 Now send your UPI address:');
        return;
    }

    // UPI input
    if (withdrawStep === 'awaiting_upi') {
        const upi = text;
        if (!/^[\w.-]+@[\w.-]+$/.test(upi)) {
            await bot.sendMessage(chatId, '‼️ Invalid UPI address. Please enter a valid UPI (e.g., name@bank).');
            return;
        }
        const amount = userData.pending_withdraw_amount;
        if (amount > userData.balance) {
            await bot.sendMessage(chatId, '⚠️ Your balance changed. Please start withdrawal again.');
            userData.withdraw_step = 'none';
            userData.pending_withdraw_amount = 0;
            updateUserData(chatId, userData);
            await sendNormalKeyboard(chatId, bot);
            return;
        }
        userData.balance -= amount;
        userData.pending_withdraw_upi = upi;
        userData.withdraw_step = 'none';
        updateUserData(chatId, userData);
        const adminMsg = `💸 *Withdrawal Request*\nUser ID: \`${chatId}\`\nAmount: ₹${amount}\nUPI: \`${upi}\`\n\nUse /approve_withdraw ${chatId} to approve\nUse /reject_withdraw ${chatId} to reject`;
        await bot.sendMessage(CONFIG.ADMIN_ID, adminMsg, { parse_mode: 'Markdown' });
        await bot.sendMessage(chatId, `⏳ Your withdrawal request of ₹${amount} has been sent to admin. Please wait for approval.`);
        await sendNormalKeyboard(chatId, bot);
        return;
    }

    // Main menu buttons
    switch (text) {
        case '💰 Balance':
            await bot.sendMessage(chatId, boldSerif(`💵 𝐘𝐨𝐮𝐫 𝐁𝐚𝐥𝐚𝐧𝐜𝐞 𝐢𝐬: ₹${userData.balance}`));
            break;
        case '🔗 Referral':
            const link = `https://t.me/${CONFIG.BOT_USERNAME}?start=ref_${chatId}`;
            const referralText = boldSerif('🔗 𝐘𝐨𝐮𝐫 𝐫𝐞𝐟𝐞𝐫𝐫𝐚𝐥 𝐥𝐢𝐧𝐤:\n') +
                link + '\n\n' +
                boldSerif(`🔰 𝐎𝐧 𝐞𝐚𝐜𝐡 𝐫𝐞𝐟𝐞𝐫𝐫𝐚𝐥 𝐲𝐨𝐮 𝐰𝐢𝐥𝐥 𝐫𝐞𝐜𝐞𝐢𝐯𝐞 ₹${CONFIG.PER_REFERRAL_BONUS}`);
            await bot.sendMessage(chatId, referralText);
            break;
        case '💸 Withdraw':
            if (userData.balance < CONFIG.MIN_WITHDRAW_LIMIT) {
                await bot.sendMessage(chatId, boldSerif(`⚠️ 𝐌𝐢𝐧𝐢𝐦𝐮𝐦 𝐰𝐢𝐭𝐡𝐝𝐫𝐚𝐰𝐚𝐥 𝐚𝐦𝐨𝐮𝐧𝐭 𝐢𝐬 ₹${CONFIG.MIN_WITHDRAW_LIMIT}.`));
                return;
            }
            userData.withdraw_step = 'awaiting_amount';
            userData.pending_withdraw_amount = 0;
            updateUserData(chatId, userData);
            await bot.sendMessage(chatId, `💰 Enter the amount you want to withdraw (min ₹${CONFIG.MIN_WITHDRAW_LIMIT}):`);
            break;
        default:
            await sendNormalKeyboard(chatId, bot);
    }
});
