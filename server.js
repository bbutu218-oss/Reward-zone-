const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dns = require('dns');
const crypto = require('crypto');

try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (error) {
    console.log("DNS setting error:", error);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// MongoDB Connection
const MONGO_URI = "mongodb://14sunilsunil3_db_user:7rbOaftd6JUrR9vm@ac-qrcqjqf-shard-00-00.xawbmz2.mongodb.net:27017,ac-qrcqjqf-shard-00-01.xawbmz2.mongodb.net:27017,ac-qrcqjqf-shard-00-02.xawbmz2.mongodb.net:27017/?ssl=true&replicaSet=atlas-ouku4a-shard-0&authSource=admin&appName=Cluster0";

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("Connected to MongoDB successfully!");
}).catch(err => {
    console.error("MongoDB connection error:", err);
});

// Helper function to generate unique UID
function generateUID() {
    return 'UID-' + Math.floor(100000 + Math.random() * 900000);
}

// User Schema
const userSchema = new mongoose.Schema({
    uid: { type: String, unique: true, default: generateUID },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 500 },
    rewardCoins: { type: Number, default: 0 }, 
    referredBy: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Game Result Schema
const gameResultSchema = new mongoose.Schema({
    timerType: { type: String, default: '30s' }, 
    period: { type: String, required: true, unique: true },
    number: { type: Number, required: true },
    color: { type: String, required: true },
    size: { type: String },
    createdAt: { type: Date, default: Date.now }
});
const GameResult = mongoose.model('GameResult', gameResultSchema);

// Bet Schema
const betSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timerType: { type: String, default: '30s' },
    period: String,
    betType: String, 
    betValue: String, 
    amount: Number,
    status: { type: String, default: 'pending' }, 
    payout: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const Bet = mongoose.model('Bet', betSchema);

// Manual Override Schema
const manualOverrideSchema = new mongoose.Schema({
    period: { type: String, required: true, unique: true },
    number: { type: Number, required: true },
    used: { type: Boolean, default: false }
});
const ManualOverride = mongoose.model('ManualOverride', manualOverrideSchema);

// Deposit Schema
const depositSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: Number,
    transactionId: String,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', depositSchema);

// Withdrawal Schema
const withdrawalSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: Number,
    accountHolderName: String,
    upiId: String,
    bankName: String,
    accountNumber: String,
    ifsc: String,
    mobile: String,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// --- ADMIN CONFIGURATION ---
const ADMIN_NUMBERS = ["8093361993", "+918093361993", "918093361993"];

// Auto-create or Update Admin Account on startup
async function setupAdminAccount() {
    try {
        const adminPhone = "8093361993";
        const adminPassword = "123123";

        let adminUser = await User.findOne({ phone: adminPhone });
        if (!adminUser) {
            adminUser = new User({
                phone: adminPhone,
                password: adminPassword,
                balance: 1000000,
                rewardCoins: 50000
            });
            await adminUser.save();
            console.log(`Admin account auto-created for ${adminPhone}`);
        } else {
            adminUser.password = adminPassword;
            await adminUser.save();
            console.log(`Admin password updated to default for ${adminPhone}`);
        }
    } catch (err) {
        console.error("Admin setup error:", err.message);
    }
}
mongoose.connection.once('open', () => {
    setupAdminAccount();
});

// Period Code Generator Setup
const periodCounters = { '30s': 1000, '60s': 2000, '3m': 3000, '5m': 5000 };

function generatePeriodCode(timerType) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    let key = timerType === '60s' ? '1m' : timerType;
    if (!periodCounters[key]) periodCounters[key] = 1000;
    periodCounters[key]++;
    
    let gamePrefix = '1';
    if (key === '1m') gamePrefix = '2';
    if (timerType === '3m') gamePrefix = '3';
    if (timerType === '5m') gamePrefix = '5';

    return `${year}${month}${day}${gamePrefix}${periodCounters[key]}`;
}

const gameStates = {
    '30s': { countdown: 30, isBettingOpen: true, period: generatePeriodCode('30s') },
    '60s': { countdown: 60, isBettingOpen: true, period: generatePeriodCode('60s') },
    '3m':  { countdown: 180, isBettingOpen: true, period: generatePeriodCode('3m') },
    '5m':  { countdown: 300, isBettingOpen: true, period: generatePeriodCode('5m') }
};

// --- AUTH & USER ROUTES ---

app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, refUid } = req.body;
        const existingUser = await User.findOne({ phone });
        if (existingUser) return res.status(400).json({ success: false, message: "User already exists!" });

        const newUser = new User({ 
            phone, 
            password, 
            balance: 500, 
            rewardCoins: 0,
            referredBy: refUid || null 
        });

        if (refUid) {
            await User.findOneAndUpdate({ uid: refUid }, { $inc: { rewardCoins: 500 } });
        }

        await newUser.save();
        res.json({ success: true, message: "Registration successful!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await User.findOne({ phone, password });
        if (!user) return res.status(400).json({ success: false, message: "Invalid phone or password!" });

        const isAdmin = ADMIN_NUMBERS.includes(phone);

        res.json({ 
            success: true, 
            message: "Login successful!", 
            userId: user._id, 
            balance: user.balance,
            rewardCoins: user.rewardCoins,
            isAdmin: isAdmin,
            user: { 
                _id: user._id, 
                uid: user.uid,
                phone: user.phone, 
                balance: user.balance, 
                rewardCoins: user.rewardCoins,
                isAdmin: isAdmin
            } 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Reset / Change Password Endpoint
app.post('/api/reset-password', async (req, res) => {
    try {
        const { phone, newPassword } = req.body;
        const user = await User.findOne({ phone });
        if (!user) return res.status(404).json({ success: false, message: "User not found!" });

        user.password = newPassword;
        await user.save();

        res.json({ success: true, message: "Password updated successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/user/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        const isAdmin = ADMIN_NUMBERS.includes(user.phone);
        res.json({ success: true, balance: user.balance, rewardCoins: user.rewardCoins, isAdmin, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/user/mobile/:mobile', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.mobile });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        const isAdmin = ADMIN_NUMBERS.includes(user.phone);
        res.json({ success: true, isAdmin, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- COIN CONVERSION & REWARDS ---

app.post('/api/convert-coins', async (req, res) => {
    try {
        const { userId, coins } = req.body;
        if (!coins || coins < 10000) {
            return res.status(400).json({ success: false, message: "Minimum conversion limit is 10,000 coins!" });
        }

        const user = await User.findById(userId);
        if (!user || user.rewardCoins < coins) {
            return res.status(400).json({ success: false, message: "Insufficient Reward Coins balance!" });
        }

        const addedMoney = coins / 100;
        user.rewardCoins -= coins;
        user.balance += addedMoney;
        await user.save();

        res.json({ success: true, message: `Successfully converted ${coins} Coins to ₹${addedMoney}!` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- DEPOSIT & WITHDRAWAL ---

app.post('/api/deposit', async (req, res) => {
    try {
        const { userId, amount, transactionId } = req.body;
        const deposit = new Deposit({ userId, amount, transactionId });
        await deposit.save();
        res.json({ success: true, message: "Deposit request submitted successfully! Manual review pending." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, amount, password, accountHolderName, upiId, bankName, accountNumber, ifsc, mobile } = req.body;
        const user = await User.findById(userId);
        
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        if (user.password !== password) return res.status(400).json({ success: false, message: "Incorrect password!" });
        if (user.balance < amount) return res.status(400).json({ success: false, message: "Insufficient balance!" });

        user.balance -= Number(amount);
        await user.save();

        const withdrawal = new Withdrawal({ userId, amount, accountHolderName, upiId, bankName, accountNumber, ifsc, mobile });
        await withdrawal.save();

        res.json({ success: true, message: "Withdrawal request submitted successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/transactions/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const deposits = await Deposit.find({ userId }).sort({ createdAt: -1 });
        const withdrawals = await Withdrawal.find({ userId }).sort({ createdAt: -1 });
        const bets = await Bet.find({ userId }).sort({ createdAt: -1 }).limit(50);
        res.json({ success: true, deposits, withdrawals, bets });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- ADMIN PANEL ---

app.get('/api/admin/requests', async (req, res) => {
    try {
        const deposits = await Deposit.find().populate('userId', 'phone').sort({ createdAt: -1 });
        const withdrawals = await Withdrawal.find().populate('userId', 'phone').sort({ createdAt: -1 });
        res.json({ success: true, deposits, withdrawals });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/action', async (req, res) => {
    try {
        const { type, id, action } = req.body;
        if (type === 'deposit') {
            const dep = await Deposit.findById(id);
            if (!dep) return res.status(404).json({ success: false, message: "Deposit not found" });
            if (action === 'approve' && dep.status === 'pending') {
                dep.status = 'approved';
                await dep.save();
                await User.findByIdAndUpdate(dep.userId, { $inc: { balance: dep.amount } });
            } else {
                dep.status = action;
                await dep.save();
            }
        } else if (type === 'withdrawal') {
            const wit = await Withdrawal.findById(id);
            if (!wit) return res.status(404).json({ success: false, message: "Withdrawal not found" });
            if (action === 'reject' && wit.status === 'pending') {
                wit.status = 'rejected';
                await wit.save();
                await User.findByIdAndUpdate(wit.userId, { $inc: { balance: wit.amount } });
            } else {
                wit.status = action;
                await wit.save();
            }
        }
        res.json({ success: true, message: "Action executed successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/set-result', async (req, res) => {
    try {
        const { period, number } = req.body;
        await ManualOverride.findOneAndUpdate(
            { period },
            { number: Number(number), used: false },
            { upsert: true, new: true }
        );
        res.json({ success: true, message: `Manual override set for period ${period}` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- GAME LOGIC & BETTING ---

app.get('/api/game-history/:timerType', async (req, res) => {
    try {
        const { timerType } = req.params;
        const history = await GameResult.find({ timerType }).sort({ _id: -1 }).limit(20);
        res.json({ success: true, history });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/bet', async (req, res) => {
    try {
        const { userId, timerType = '30s', period, betType, betValue, amount } = req.body;
        
        if (!gameStates[timerType] || !gameStates[timerType].isBettingOpen || gameStates[timerType].countdown <= 5) {
            return res.status(400).json({ success: false, message: "Betting is closed for this period (Last 5s)!" });
        }

        const user = await User.findById(userId);
        if (!user || user.balance < Number(amount)) {
            return res.status(400).json({ success: false, message: "Insufficient balance or user not found!" });
        }

        user.balance -= Number(amount);
        await user.save();

        const newBet = new Bet({ userId, timerType, period, betType, betValue, amount });
        await newBet.save();

        res.json({ success: true, message: "Bet placed successfully!", newBalance: user.balance });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

async function getGameOutcome(period, timerType) {
    const override = await ManualOverride.findOne({ period, used: false });
    let randomNum;

    if (override) {
        randomNum = override.number;
        override.used = true;
        await override.save();
    } else {
        const hash = crypto.createHash('sha256').update(period + timerType).digest('hex');
        randomNum = parseInt(hash.substring(0, 8), 16) % 10;
    }

    let color = 'green';
    if ([2, 4, 6, 8].includes(randomNum)) color = 'red';
    else if ([0, 5].includes(randomNum)) color = 'violet';
    const size = randomNum >= 5 ? 'big' : 'small';

    return { number: randomNum, color, size };
}

async function processBetsForPeriod(period, timerType, outcome) {
    try {
        const pendingBets = await Bet.find({ period, timerType, status: 'pending' });

        for (const bet of pendingBets) {
            let isWin = false;
            let multiplier = 0;

            if (bet.betType === 'color' && bet.betValue === outcome.color) {
                isWin = true;
                multiplier = outcome.color === 'violet' ? 4.5 : 2;
            } else if (bet.betType === 'size' && bet.betValue === outcome.size) {
                isWin = true;
                multiplier = 1.9;
            } else if (bet.betType === 'number' && Number(bet.betValue) === outcome.number) {
                isWin = true;
                multiplier = 9;
            }

            if (isWin) {
                const winnings = bet.amount * multiplier;
                bet.status = 'win';
                bet.payout = winnings;
                await bet.save();
                await User.findByIdAndUpdate(bet.userId, { $inc: { balance: winnings } });
            } else {
                bet.status = 'loss';
                await bet.save();
            }
        }
    } catch (err) {
        console.error(`Error processing bets:`, err);
    }
}

function startTimerLoop(timerType, intervalSeconds) {
    setInterval(async () => {
        try {
            const state = gameStates[timerType];
            state.countdown--;

            if (state.countdown === 5) {
                state.isBettingOpen = false;
                io.emit(`bettingStatus_${timerType}`, { isOpen: false, period: state.period });
            }

            if (state.countdown <= 0) {
                const currentPeriod = state.period;
                const outcome = await getGameOutcome(currentPeriod, timerType);

                const existingResult = await GameResult.findOne({ period: currentPeriod });
                if (!existingResult) {
                    const gameResult = new GameResult({
                        timerType, period: currentPeriod, number: outcome.number, color: outcome.color, size: outcome.size
                    });
                    await gameResult.save();
                }

                await processBetsForPeriod(currentPeriod, timerType, outcome);

                io.emit(`gameResult_${timerType}`, {
                    period: currentPeriod, number: outcome.number, color: outcome.color, size: outcome.size
                });

                state.period = generatePeriodCode(timerType);
                state.countdown = intervalSeconds;
                state.isBettingOpen = true;

                io.emit(`bettingStatus_${timerType}`, { isOpen: true, period: state.period });
            }

            io.emit(`timerTick_${timerType}`, { 
                countdown: state.countdown, isBettingOpen: state.isBettingOpen, period: state.period 
            });
        } catch (err) {
            console.log(`Loop error:`, err.message);
        }
    }, 1000);
}

startTimerLoop('30s', 30);
startTimerLoop('60s', 60);
startTimerLoop('3m', 180);
startTimerLoop('5m', 300);

io.on('connection', (socket) => {
    ['30s', '60s', '3m', '5m'].forEach(type => {
        socket.emit(`timerTick_${type}`, { 
            countdown: gameStates[type].countdown, isBettingOpen: gameStates[type].isBettingOpen, period: gameStates[type].period 
        });
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
