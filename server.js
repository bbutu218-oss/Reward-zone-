const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dns = require('dns');
const crypto = require('crypto');

try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) {}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());
app.use(express.static(__dirname));

const MONGO_URI = "mongodb+srv://bbutu218_db_user:9RnyfbrEBzNaZlYX@cluster0.gq1rmfz.mongodb.net/?appName=Cluster0";
const generateUID = () => Math.floor(100000 + Math.random() * 900000).toString();

const userSchema = new mongoose.Schema({
    uid: { type: String, unique: true, default: generateUID },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 500 }, 
    winningsBalance: { type: Number, default: 0 }, 
    rewardCoins: { type: Number, default: 0 }, 
    referredBy: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const gameResultSchema = new mongoose.Schema({
    timerType: { type: String, default: '30s' }, 
    period: { type: String, required: true, unique: true },
    number: { type: Number, required: true },
    color: { type: String, required: true },
    size: { type: String },
    createdAt: { type: Date, default: Date.now }
});
const GameResult = mongoose.model('GameResult', gameResultSchema);

const betSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timerType: { type: String, default: '30s' },
    period: String, betType: String, betValue: String, amount: Number,
    status: { type: String, default: 'pending' }, 
    payout: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const Bet = mongoose.model('Bet', betSchema);

const manualOverrideSchema = new mongoose.Schema({
    period: { type: String, required: true, unique: true },
    number: { type: Number, required: true },
    used: { type: Boolean, default: false }
});
const ManualOverride = mongoose.model('ManualOverride', manualOverrideSchema);

const depositSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: Number, transactionId: String,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', depositSchema);

const withdrawalSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: Number, accountHolderName: String, upiId: String,
    bankName: String, accountNumber: String, ifsc: String, mobile: String,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// Permanent QR Code Schema
const qrCodeSchema = new mongoose.Schema({
    identifier: { type: String, unique: true, default: 'default_qr' },
    imageBase64: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now }
});
const QrCode = mongoose.model('QrCode', qrCodeSchema);

const ADMIN_NUMBERS = ["8093361993", "+918093361993", "918093361993"];

async function setupAdminAccount() {
    try {
        let adminUser = await User.findOne({ phone: "8093361993" });
        if (!adminUser) {
            adminUser = new User({ phone: "8093361993", password: "123123", balance: 1000000, winningsBalance: 500000, rewardCoins: 50050 });
            await adminUser.save();
        }
    } catch (err) {}
}

function getPeriodCodeForTime(timerType, timestamp = Date.now()) {
    const now = new Date(timestamp);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const elapsedSeconds = Math.floor((now.getTime() - startOfDay) / 1000);
    let intervalSeconds = 30, gamePrefix = '1';
    if (timerType === '60s' || timerType === '1m') { intervalSeconds = 60; gamePrefix = '2'; }
    else if (timerType === '3m') { intervalSeconds = 180; gamePrefix = '3'; }
    else if (timerType === '5m') { intervalSeconds = 300; gamePrefix = '5'; }
    const periodNumber = Math.floor(elapsedSeconds / intervalSeconds) + 1;
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${gamePrefix}${String(periodNumber).padStart(5, '0')}`;
}

const gameStates = {
    '30s': { countdown: 30, isBettingOpen: true, period: '', startTime: 0 },
    '60s': { countdown: 60, isBettingOpen: true, period: '', startTime: 0 },
    '3m':  { countdown: 180, isBettingOpen: true, period: '', startTime: 0 },
    '5m':  { countdown: 300, isBettingOpen: true, period: '', startTime: 0 }
};

app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, refUid } = req.body;
        if (await User.findOne({ phone })) return res.status(400).json({ success: false, message: "User already exists!" });
        const newUser = new User({ phone, password, balance: 5, winningsBalance: 0, rewardCoins: 500, referredBy: refUid || null });
        if (refUid) await User.findOneAndUpdate({ uid: refUid }, { $inc: { rewardCoins: 500 } });
        await newUser.save();
        res.json({ success: true, message: "Registration successful!" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await User.findOne({ phone, password });
        if (!user) return res.status(400).json({ success: false, message: "Invalid phone or password!" });
        const isAdmin = ADMIN_NUMBERS.includes(phone);
        res.json({ success: true, message: "Login successful!", userId: user._id, isAdmin, user: { _id: user._id, uid: user.uid, phone: user.phone, balance: user.balance, winningsBalance: user.winningsBalance, rewardCoins: user.rewardCoins, isAdmin } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { phone, newPassword } = req.body;
        const user = await User.findOne({ phone });
        if (!user) return res.status(404).json({ success: false, message: "User not found!" });
        user.password = newPassword;
        await user.save();
        res.json({ success: true, message: "Password updated successfully!" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/user/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        res.json({ success: true, balance: user.balance, winningsBalance: user.winningsBalance, rewardCoins: user.rewardCoins, isAdmin: ADMIN_NUMBERS.includes(user.phone), user });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/user/mobile/:mobile', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.mobile });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        res.json({ success: true, isAdmin: ADMIN_NUMBERS.includes(user.phone), user });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/convert-coins', async (req, res) => {
    try {
        const { userId, coins } = req.body;
        if (!coins || coins < 10000) return res.status(400).json({ success: false, message: "Minimum conversion limit is 10,000 coins!" });
        const user = await User.findById(userId);
        if (!user || user.rewardCoins < coins) return res.status(400).json({ success: false, message: "Insufficient Reward Coins balance!" });
        const addedMoney = coins / 100;
        user.rewardCoins -= coins;
        user.winningsBalance += addedMoney;
        await user.save();
        res.json({ success: true, message: `Successfully converted ${coins} Coins to ₹${addedMoney} winnings!` });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Save QR Code API (Permanent Storage)
app.post('/api/admin/save-qr', async (req, res) => {
    try {
        const { imageBase64 } = req.body;
        if (!imageBase64) return res.status(400).json({ success: false, message: "QR image data missing!" });
        await QrCode.findOneAndUpdate({ identifier: 'default_qr' }, { imageBase64, updatedAt: Date.now() }, { upsert: true, new: true });
        res.json({ success: true, message: "✅ QR Code updated and saved permanently!" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Get QR Code API
app.get('/api/get-qr', async (req, res) => {
    try {
        const qrDoc = await QrCode.findOne({ identifier: 'default_qr' });
        if (!qrDoc) return res.json({ success: false, message: "No QR found" });
        res.json({ success: true, imageBase64: qrDoc.imageBase64 });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/deposit', async (req, res) => {
    try {
        const { userId, amount, transactionId } = req.body;
        await new Deposit({ userId, amount, transactionId }).save();
        res.json({ success: true, message: "Deposit request submitted successfully!" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, amount, password, ...details } = req.body;
        const user = await User.findById(userId);
        if (!user || user.password !== password) return res.status(400).json({ success: false, message: "Incorrect password or user not found!" });
        if (Number(amount) < 110 || user.winningsBalance < Number(amount)) return res.status(400).json({ success: false, message: "Invalid amount or insufficient winnings!" });
        user.winningsBalance -= Number(amount);
        await user.save();
        await new Withdrawal({ userId, amount, ...details }).save();
        res.json({ success: true, message: "Withdrawal request submitted successfully!" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/transactions/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        res.json({
            success: true,
            deposits: await Deposit.find({ userId }).sort({ createdAt: -1 }),
            withdrawals: await Withdrawal.find({ userId }).sort({ createdAt: -1 }),
            bets: await Bet.find({ userId }).sort({ createdAt: -1 }).limit(50)
        });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/requests', async (req, res) => {
    try {
        res.json({
            success: true,
            deposits: await Deposit.find().populate('userId', 'uid phone').sort({ createdAt: -1 }),
            withdrawals: await Withdrawal.find().populate('userId', 'uid phone').sort({ createdAt: -1 })
        });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/action', async (req, res) => {
    try {
        const { type, id, action } = req.body;
        if (type === 'deposit') {
            const dep = await Deposit.findById(id);
            if (dep && action === 'approve' && dep.status === 'pending') {
                dep.status = 'approved'; await dep.save();
                await User.findByIdAndUpdate(dep.userId, { $inc: { balance: dep.amount } });
            } else if (dep) { dep.status = action; await dep.save(); }
        } else if (type === 'withdrawal') {
            const wit = await Withdrawal.findById(id);
            if (wit && action === 'reject' && wit.status === 'pending') {
                wit.status = 'rejected'; await wit.save();
                await User.findByIdAndUpdate(wit.userId, { $inc: { winningsBalance: wit.amount } });
            } else if (wit) { wit.status = action; await wit.save(); }
        }
        res.json({ success: true, message: "Action executed successfully!" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/set-result', async (req, res) => {
    try {
        const { period, number } = req.body;
        await ManualOverride.findOneAndUpdate({ period }, { number: Number(number), used: false }, { upsert: true, new: true });
        res.json({ success: true, message: `Manual override set for period ${period}` });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/game-history/:timerType', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const total = await GameResult.countDocuments({ timerType: req.params.timerType });
        const history = await GameResult.find({ timerType: req.params.timerType }).sort({ _id: -1 }).skip((page - 1) * 10).limit(10);
        res.json({ success: true, history, totalPages: Math.ceil(total / 10) });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/bet', async (req, res) => {
    try {
        const { userId, timerType = '30s', period, betType, betValue, amount } = req.body;
        if (!gameStates[timerType] || !gameStates[timerType].isBettingOpen || gameStates[timerType].countdown <= 5) {
            return res.status(400).json({ success: false, message: "Betting closed for this period!" });
        }
        const user = await User.findById(userId);
        if (!user || (user.balance + user.winningsBalance) < Number(amount)) {
            return res.status(400).json({ success: false, message: "Insufficient balance!" });
        }
        let deduct = Number(amount);
        if (user.balance >= deduct) user.balance -= deduct;
        else { let rem = deduct - user.balance; user.balance = 0; user.winningsBalance -= rem; }
        await user.save();
        await new Bet({ userId, timerType, period, betType, betValue, amount }).save();
        res.json({ success: true, message: "Bet successfully added!", newBalance: user.balance, newWinnings: user.winningsBalance });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

async function getGameOutcome(period, timerType) {
    const override = await ManualOverride.findOne({ period, used: false });
    let randomNum;
    if (override) { randomNum = override.number; override.used = true; await override.save(); }
    else {
        const hash = crypto.createHash('sha256').update(period + "_" + timerType + "_yarwin_sync").digest('hex');
        randomNum = parseInt(hash.substring(0, 8), 16) % 10;
    }
    return { number: randomNum, color: [2, 4, 6, 8].includes(randomNum) ? 'red' : ([0, 5].includes(randomNum) ? 'violet' : 'green'), size: randomNum >= 5 ? 'big' : 'small' };
}

async function processBetsForPeriod(period, timerType, outcome) {
    try {
        for (const bet of await Bet.find({ period, timerType, status: 'pending' })) {
            let isWin = false, mult = 0;
            if (bet.betType === 'size' && bet.betValue === outcome.size) { isWin = true; mult = 1.9; }
            else if (bet.betType === 'color' && bet.betValue === outcome.color) { isWin = true; mult = (outcome.color === 'violet' ? 2 : 1.9); }
            else if (bet.betType === 'number' && Number(bet.betValue) === outcome.number) { isWin = true; mult = 9; }
            
            if (isWin) {
                bet.status = 'win'; bet.payout = bet.amount * mult; await bet.save();
                await User.findByIdAndUpdate(bet.userId, { $inc: { winningsBalance: bet.payout } });
            } else { bet.status = 'loss'; await bet.save(); }
        }
    } catch (e) {}
}

function startTimerLoop(timerType, intervalSeconds) {
    const state = gameStates[timerType], intervalMs = intervalSeconds * 1000;
    const initTimer = () => {
        const now = Date.now(), startOfDay = new Date(new Date(now).setHours(0,0,0,0)).getTime();
        state.startTime = startOfDay + (Math.floor((now - startOfDay) / intervalMs) * intervalMs);
        state.countdown = Math.max(0, intervalSeconds - Math.floor((now - state.startTime) / 1000));
        state.period = getPeriodCodeForTime(timerType, state.startTime);
        state.isBettingOpen = state.countdown > 5;
    };
    initTimer();

    setInterval(async () => {
        try {
            const now = Date.now();
            let countdown = intervalSeconds - Math.floor((now - state.startTime) / 1000);
            if (countdown <= 0 || now >= state.startTime + intervalMs) {
                const oldPeriod = state.period;
                state.startTime += intervalMs;
                countdown = intervalSeconds - Math.floor((now - state.startTime) / 1000);
                const newPeriod = getPeriodCodeForTime(timerType, state.startTime);
                const outcome = await getGameOutcome(oldPeriod, timerType);
                if (!await GameResult.findOne({ period: oldPeriod })) {
                    await new GameResult({ timerType, period: oldPeriod, ...outcome }).save();
                }
                await processBetsForPeriod(oldPeriod, timerType, outcome);
                io.emit(`gameResult_${timerType}`, { period: oldPeriod, ...outcome });
                state.period = newPeriod; state.isBettingOpen = true;
                io.emit(`bettingStatus_${timerType}`, { isOpen: true, period: state.period });
            }
            if (countdown <= 5 && state.isBettingOpen) {
                state.isBettingOpen = false;
                io.emit(`bettingStatus_${timerType}`, { isOpen: false, period: state.period });
            }
            state.countdown = countdown;
            io.emit(`timerTick_${timerType}`, { countdown: state.countdown, isBettingOpen: state.isBettingOpen, period: state.period });
        } catch (e) {}
    }, 1000);
}

mongoose.connect(MONGO_URI).then(async () => {
    await setupAdminAccount();
    [['30s', 30], ['60s', 60], ['3m', 180], ['5m', 300]].forEach(([t, sec]) => startTimerLoop(t, sec));
});

io.on('connection', (socket) => {
    ['30s', '60s', '3m', '5m'].forEach(type => {
        socket.emit(`timerTick_${type}`, { countdown: gameStates[type].countdown, isBettingOpen: gameStates[type].isBettingOpen, period: gameStates[type].period });
    });
});

server.listen(process.env.PORT || 5000);
