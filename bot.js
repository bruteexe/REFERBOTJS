const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const express = require('express');

// ==================== CONFIGURATION (from environment variables) ====================
const CONFIG = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    ADMIN_ID: parseInt(process.env.ADMIN_ID),
    BOT_USERNAME: process.env.BOT_USERNAME,
    CHANNELS: ['@brutetest'],                    // channels to join
    CHANNELS_ON_CHECK: ['@brutetest'],           // channels to verify
    WELCOME_BONUS: 1,                            // coins
    PER_REFERRAL_BONUS: 2,                       // coins
    MIN_WITHDRAW_LIMIT: 20,                      // coins
};

// Check required environment variables
if (!CONFIG.BOT_TOKEN || !CONFIG.ADMIN_ID || !CONFIG.BOT_USERNAME) {
    console.error('Missing required env: BOT_TOKEN, ADMIN_ID, BOT_USERNAME');
    process.exit(1);
}

// ==================== MONGODB CONNECTION ====================
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error('MONGODB_URI environment variable not set');
    process.exit(1);
}

let db;
let usersCollection;

async function connectToDatabase() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('referral_bot');
    usersCollection = db.collection('users');
    await usersCollection.createIndex({ pending_referrer: 1 });
    console.log('Connected to MongoDB Atlas');
}

// ==================== DATABASE FUNCTIONS ====================
async function getUserData(userId) {
    const key = userId.toString();
    let user = await usersCollection.findOne({ _id: key });
    if (!user) {
        const newUser = {
            _id: key,
            balance: CONFIG.WELCOME_BONUS,
            withdraw_step: 'none',
            pending_withdraw_amount: 0,
            pending_withdraw_upi: '',
            pending_referrer: 0,
            referral_credited: false,
            createdAt: new Date()
        };
        await usersCollection.insertOne(newUser);
        return newUser;
    }
    return user;
}

async function updateUserData(userId, updateFields) {
    const key = userId.toString();
    await usersCollection.updateOne(
        { _id: key },
        { $set: updateFields }
    );
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
    if (CONFIG.CHANNELS_ON_CHECK.length === 0) return true;
    for (const channel of CONFIG.CHANNELS_ON_CHECK) {
        try {
            const member = await bot.getChatMember(channel, userId);
            const status = member.status;
            if (!['member', 'administrator', 'creator'].includes(status)) return false;
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
    try {
        const userData = await getUserData(userId);
        const pending = userData.pending_withdraw_amount;
        if (pending <= 0) {
            await bot.sendMessage(CONFIG.ADMIN_ID, 'No pending withdrawal for this user.');
            return;
        }
        await updateUserData(userId, { pending_withdraw_amount: 0, pending_withdraw_upi: '' });
        await bot.sendMessage(userId, boldSerif(`✅ 𝐘𝐨𝐮𝐫 𝐰𝐢𝐭𝐡𝐝𝐫𝐚𝐰𝐚𝐥 𝐨𝐟 ${pending} 𝐜𝐨𝐢𝐧𝐬 𝐡𝐚𝐬 𝐛𝐞𝐞𝐧 𝐚𝐩𝐩𝐫𝐨𝐯𝐞𝐝.`));
        await bot.sendMessage(CONFIG.ADMIN_ID, `Withdrawal approved for user ${userId} (${pending} coins).`);
        console.log(`Approved withdrawal for ${userId}: ${pending} coins`);
    } catch (err) {
        console.error('approveWithdrawal error:', err);
        await bot.sendMessage(CONFIG.ADMIN_ID, `Error: ${err.message}`);
    }
}

async function rejectWithdrawal(userId, bot) {
    try {
        const userData = await getUserData(userId);
        const pending = userData.pending_withdraw_amount;
        if (pending <= 0) {
            await bot.sendMessage(CONFIG.ADMIN_ID, 'No pending withdrawal for this user.');
            return;
        }
        const newBalance = (userData.balance || 0) + pending;
        await updateUserData(userId, {
            balance: newBalance,
            pending_withdraw_amount: 0,
            pending_withdraw_upi: ''
        });
        await bot.sendMessage(userId, boldSerif(`❌ 𝐘𝐨𝐮𝐫 𝐰𝐢𝐭𝐡𝐝𝐫𝐚𝐰𝐚𝐥 𝐨𝐟 ${pending} 𝐜𝐨𝐢𝐧𝐬 𝐡𝐚𝐬 𝐛𝐞𝐞𝐧 𝐫𝐞𝐣𝐞𝐜𝐭𝐞𝐝. 𝐀𝐦𝐨𝐮𝐧𝐭 𝐫𝐞𝐟𝐮𝐧𝐝𝐞𝐝.`));
        await bot.sendMessage(CONFIG.ADMIN_ID, `Withdrawal rejected for user ${userId} (${pending} coins refunded).`);
        console.log(`Rejected withdrawal for ${userId}: ${pending} coins`);
    } catch (err) {
        console.error('rejectWithdrawal error:', err);
        await bot.sendMessage(CONFIG.ADMIN_ID, `Error: ${err.message}`);
    }
}

// ==================== EXPRESS WEBHOOK SERVER ====================
const app = express();
app.use(express.json());

// ---------- ADSGRAM REWARD WEBHOOK (GET) ----------
app.get('/api/adsgram-reward', async (req, res) => {
    const { userId } = req.query;
    const rewardAmount = 1; // coins per ad

    if (!userId) {
        console.error('❌ AdsGram reward missing userId');
        return res.status(400).send('Missing userId');
    }

    try {
        const userData = await getUserData(userId);
        userData.balance += rewardAmount;
        await updateUserData(userId, userData);
        console.log(`✅ AdsGram rewarded user ${userId}: +${rewardAmount} coin(s). New balance: ${userData.balance}`);
        res.status(200).send('OK');
    } catch (err) {
        console.error('Error processing AdsGram reward:', err);
        res.status(500).send('Internal Server Error');
    }
});

// ---------- TADDY WEBHOOK (POST) ----------
const TADDY_WEBHOOK_SECRET = process.env.TADDY_WEBHOOK_SECRET;
if (!TADDY_WEBHOOK_SECRET) {
    console.warn('⚠️ TADDY_WEBHOOK_SECRET not set – Taddy webhooks will be rejected');
}

app.post('/api/taddy-webhook', async (req, res) => {
    const signature = req.headers['x-taddy-webhook-secret'];
    if (!signature || signature !== TADDY_WEBHOOK_SECRET) {
        console.error('❌ Invalid Taddy webhook signature');
        return res.status(401).send('Invalid signature');
    }

    const { userId, event } = req.body;
    const rewardAmount = 1;

    if (event === 'ad_view_through' && userId) {
        try {
            const userData = await getUserData(userId);
            userData.balance += rewardAmount;
            await updateUserData(userId, userData);
            console.log(`✅ Taddy rewarded user ${userId}: +${rewardAmount} coin(s). New balance: ${userData.balance}`);
            res.status(200).send('OK');
        } catch (err) {
            console.error('Error processing Taddy reward:', err);
            res.status(500).send('Internal Server Error');
        }
    } else {
        // Acknowledge other events
        res.status(200).send('OK');
    }
});

// Health check
app.get('/', (req, res) => {
    res.send('Bot is running');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Webhook server listening on port ${PORT}`);
});

// ==================== TELEGRAM BOT (Polling) ====================
const bot = new TelegramBot(CONFIG.BOT_TOKEN, { polling: true });

// ==================== COMMAND: /start ====================
bot.onText(/\/start(?:\s+ref_(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name;
    const referrerIdStr = match[1] ? match[1] : null;
    console.log(`/start from ${chatId}, referrer: ${referrerIdStr}`);

    let userData = await getUserData(chatId);
    const isNew = userData.createdAt && (new Date() - new Date(userData.createdAt) < 5000);

    if (isNew) {
        console.log(`New user: ${chatId}`);
        await bot.sendMessage(chatId, boldSerif(`🎉 𝐂𝐨𝐧𝐠𝐫𝐚𝐭𝐬, 𝐘𝐨𝐮 𝐫𝐞𝐜𝐞𝐢𝐯𝐞𝐝 ${CONFIG.WELCOME_BONUS} 𝐜𝐨𝐢𝐧(𝐬) 𝐚𝐬 𝐰𝐞𝐥𝐜𝐨𝐦𝐞 𝐛𝐨𝐧𝐮𝐬.`));

        if (referrerIdStr && referrerIdStr !== chatId.toString()) {
            const referrerId = parseInt(referrerIdStr);
            const referrerExists = await usersCollection.findOne({ _id: referrerId.toString() });
            if (referrerExists) {
                await updateUserData(chatId, { pending_referrer: referrerId });
                console.log(`Pending referrer set for ${chatId}: ${referrerId}`);
            }
        }
    } else {
        await bot.sendMessage(chatId, boldSerif('👋 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 𝐛𝐚𝐜𝐤!'));
    }

    // Build inline keyboard for channel joining
    const inlineKeyboard = [];
    for (const ch of CONFIG.CHANNELS) {
        inlineKeyboard.push([{ text: `↗️ Join ${ch}`, url: `https://t.me/${ch.substring(1)}` }]);
    }
    inlineKeyboard.push([{ text: '✅ Joined', callback_data: '/joined' }]);

    const welcomeText = boldSerif(
        '𝐖𝐞𝐥𝐜𝐨𝐦𝐞 𝐭𝐨 𝐨𝐮𝐫 𝐛𝐨𝐭!\n\n' +
        '👨‍💻 𝐑𝐞𝐟𝐞𝐫 & 𝐞𝐚𝐫𝐧 𝐜𝐨𝐢𝐧𝐬, 𝐰𝐚𝐭𝐜𝐡 𝐚𝐝𝐬, 𝐚𝐧𝐝 𝐰𝐢𝐭𝐡𝐝𝐫𝐚𝐰.\n\n' +
        '⬇️ 𝐁𝐞𝐟𝐨𝐫𝐞 𝐭𝐡𝐚𝐭, 𝐣𝐨𝐢𝐧 𝐭𝐡𝐞 𝐜𝐡𝐚𝐧𝐧𝐞𝐥 𝐛𝐞𝐥𝐨𝐰:'
    );
    await bot.sendMessage(chatId, welcomeText, { reply_markup: { inline_keyboard: inlineKeyboard } });

    await updateUserData(chatId, { withdraw_step: 'none' });
});

// ==================== CALLBACK: /joined ====================
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.from.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    console.log(`Callback from ${chatId}: ${data}`);

    if (data === '/joined') {
        const allJoined = await checkUserJoinedChannels(chatId, bot);
        if (allJoined) {
            await bot.deleteMessage(chatId, messageId);
            await sendNormalKeyboard(chatId, bot);
            await bot.sendMessage(chatId, boldSerif('💁‍♂ 𝐖𝐞𝐥𝐜𝐨𝐦𝐞! 𝐑𝐞𝐟𝐞𝐫 & 𝐄𝐚𝐫𝐧 𝐜𝐨𝐢𝐧𝐬.'));

            const userData = await getUserData(chatId);
            const pendingReferrer = userData.pending_referrer;
            if (!userData.referral_credited && pendingReferrer && pendingReferrer !== chatId) {
                const referrerData = await getUserData(pendingReferrer);
                if (referrerData) {
                    const newBalance = (referrerData.balance || 0) + CONFIG.PER_REFERRAL_BONUS;
                    await updateUserData(pendingReferrer, { balance: newBalance });
                    await updateUserData(chatId, { referral_credited: true, pending_referrer: 0 });
                    const firstName = callbackQuery.from.first_name;
                    await bot.sendMessage(pendingReferrer, `➤ New Referral: ${firstName}\n${CONFIG.PER_REFERRAL_BONUS} coins added to your balance`);
                    console.log(`Referral credited: ${pendingReferrer} got ${CONFIG.PER_REFERRAL_BONUS} coins from ${chatId}`);
                }
            }
        } else {
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Join all channels first!', show_alert: true });
        }
    }
});

// ==================== TEXT MESSAGE HANDLER ====================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text) return;
    console.log(`Message from ${chatId}: ${text}`);

    // Admin commands
    if (chatId === CONFIG.ADMIN_ID && (text.startsWith('/approve_withdraw') || text.startsWith('/reject_withdraw'))) {
        const parts = text.split(' ');
        if (parts.length < 2) {
            await bot.sendMessage(CONFIG.ADMIN_ID, 'Usage: /approve_withdraw <user_id> or /reject_withdraw <user_id>');
            return;
        }
        const userId = parseInt(parts[1]);
        if (text.startsWith('/approve_withdraw')) {
            await approveWithdrawal(userId, bot);
        } else {
            await rejectWithdrawal(userId, bot);
        }
        return;
    }

    // Ignore if user hasn't started
    const userData = await getUserData(chatId);
    if (!userData) return;

    const withdrawStep = userData.withdraw_step;

    // Withdrawal amount input
    if (withdrawStep === 'awaiting_amount') {
        const amount = parseInt(text);
        if (isNaN(amount)) {
            await bot.sendMessage(chatId, '‼️ Please enter a valid number of coins.');
            return;
        }
        if (amount < CONFIG.MIN_WITHDRAW_LIMIT) {
            await bot.sendMessage(chatId, `⚠️ Minimum withdrawal is ${CONFIG.MIN_WITHDRAW_LIMIT} coins.`);
            return;
        }
        if (amount > userData.balance) {
            await bot.sendMessage(chatId, `⚠️ You don't have enough balance. Your balance is ${userData.balance} coins.`);
            return;
        }
        await updateUserData(chatId, {
            pending_withdraw_amount: amount,
            withdraw_step: 'awaiting_upi'
        });
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
            await updateUserData(chatId, { withdraw_step: 'none', pending_withdraw_amount: 0 });
            await sendNormalKeyboard(chatId, bot);
            return;
        }
        const newBalance = userData.balance - amount;
        await updateUserData(chatId, {
            balance: newBalance,
            pending_withdraw_upi: upi,
            withdraw_step: 'none'
        });
        const adminMsg = `💸 *Withdrawal Request*\nUser ID: \`${chatId}\`\nAmount: ${amount} coins\nUPI: \`${upi}\`\n\nUse /approve_withdraw ${chatId} to approve\nUse /reject_withdraw ${chatId} to reject`;
        await bot.sendMessage(CONFIG.ADMIN_ID, adminMsg, { parse_mode: 'Markdown' });
        await bot.sendMessage(chatId, `⏳ Your withdrawal request of ${amount} coins has been sent to admin. Please wait for approval.`);
        await sendNormalKeyboard(chatId, bot);
        return;
    }

    // Main menu buttons (no ad button here – ads are in mini‑app only)
    switch (text) {
        case '💰 Balance':
            await bot.sendMessage(chatId, boldSerif(`💵 𝐘𝐨𝐮𝐫 𝐁𝐚𝐥𝐚𝐧𝐜𝐞: ${userData.balance} 𝐜𝐨𝐢𝐧𝐬`));
            break;
        case '🔗 Referral':
            const link = `https://t.me/${CONFIG.BOT_USERNAME}?start=ref_${chatId}`;
            const referralText = boldSerif('🔗 𝐘𝐨𝐮𝐫 𝐫𝐞𝐟𝐞𝐫𝐫𝐚𝐥 𝐥𝐢𝐧𝐤:\n') +
                link + '\n\n' +
                boldSerif(`🔰 𝐎𝐧 𝐞𝐚𝐜𝐡 𝐫𝐞𝐟𝐞𝐫𝐫𝐚𝐥 𝐲𝐨𝐮 𝐰𝐢𝐥𝐥 𝐫𝐞𝐜𝐞𝐢𝐯𝐞 ${CONFIG.PER_REFERRAL_BONUS} 𝐜𝐨𝐢𝐧𝐬`);
            await bot.sendMessage(chatId, referralText);
            break;
        case '💸 Withdraw':
            if (userData.balance < CONFIG.MIN_WITHDRAW_LIMIT) {
                await bot.sendMessage(chatId, boldSerif(`⚠️ 𝐌𝐢𝐧𝐢𝐦𝐮𝐦 𝐰𝐢𝐭𝐡𝐝𝐫𝐚𝐰𝐚𝐥 𝐢𝐬 ${CONFIG.MIN_WITHDRAW_LIMIT} 𝐜𝐨𝐢𝐧𝐬.`));
                return;
            }
            await updateUserData(chatId, { withdraw_step: 'awaiting_amount', pending_withdraw_amount: 0 });
            await bot.sendMessage(chatId, `💰 Enter the number of coins you want to withdraw (min ${CONFIG.MIN_WITHDRAW_LIMIT}):`);
            break;
        default:
            await sendNormalKeyboard(chatId, bot);
    }
});

// ==================== START BOT ====================
connectToDatabase().then(() => {
    console.log('Bot is ready and listening for messages');
}).catch(err => {
    console.error('Failed to connect to database:', err);
    process.exit(1);
});
