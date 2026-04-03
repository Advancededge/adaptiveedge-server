// ============================================================
//   AdaptiveEdge Pro — Backend Server
//   Built for Josh Soule
//   Stack: Node.js + Express + MongoDB + Telegram Bot
//   Supports: Multi-client, REST API, Telegram notifications
// ============================================================

const express    = require("express");
const mongoose   = require("mongoose");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const TelegramBot = require("node-telegram-bot-api");
const cors       = require("cors");
const helmet     = require("helmet");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(helmet());

// ============================================================
// DATABASE CONNECTION
// ============================================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));

// ============================================================
// TELEGRAM BOT SETUP
// ============================================================
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (msg.text === "/start") {
    bot.sendMessage(chatId,
      `👋 Welcome to *AdaptiveEdge Pro*\n\n` +
      `Your chat ID is: \`${chatId}\`\n\n` +
      `Add this to your account to receive trade notifications.`,
      { parse_mode: "Markdown" }
    );
  }
  if (msg.text === "/status") {
    bot.sendMessage(chatId, "📊 Use the app to check your live status.", { parse_mode: "Markdown" });
  }
});

// ============================================================
// SCHEMAS
// ============================================================

// User (client account)
const userSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  email:         { type: String, required: true, unique: true },
  password:      { type: String, required: true },
  telegramChatId:{ type: String, default: null },
  createdAt:     { type: Date, default: Date.now },
  plan:          { type: String, default: "basic" }, // basic | pro
});
const User = mongoose.model("User", userSchema);

// MT4 Account (linked to user)
const accountSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  accountNumber: { type: String, required: true },
  broker:        { type: String, default: "Unknown" },
  balance:       { type: Number, default: 0 },
  equity:        { type: Number, default: 0 },
  profit:        { type: Number, default: 0 },
  dailyPnl:      { type: Number, default: 0 },
  dailyLossPct:  { type: Number, default: 0 },
  drawdown:      { type: Number, default: 0 },
  winRate:       { type: Number, default: 0 },
  consecutiveLosses: { type: Number, default: 0 },
  openTrades:    { type: Number, default: 0 },
  botActive:     { type: Boolean, default: true },
  marketCondition: { type: String, default: "Unknown" },
  lastUpdate:    { type: Date, default: Date.now },
  settings: {
    riskPercent:    { type: Number, default: 1.5 },
    maxDailyLoss:   { type: Number, default: 5.0 },
    maxDrawdown:    { type: Number, default: 15.0 },
    maxTrades:      { type: Number, default: 3 },
    trendMode:      { type: Boolean, default: true },
    scalpMode:      { type: Boolean, default: true },
    notifications:  { type: Boolean, default: true },
  }
});
const Account = mongoose.model("Account", accountSchema);

// Trade record
const tradeSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  accountId:  { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
  ticket:     { type: Number, required: true },
  pair:       { type: String, required: true },
  type:       { type: String, enum: ["BUY", "SELL"], required: true },
  lots:       { type: Number, required: true },
  entryPrice: { type: Number, required: true },
  stopLoss:   { type: Number, default: 0 },
  takeProfit: { type: Number, default: 0 },
  closePrice: { type: Number, default: null },
  profit:     { type: Number, default: 0 },
  status:     { type: String, enum: ["open", "closed"], default: "open" },
  mode:       { type: String, default: "TREND" }, // TREND or SCALP
  openTime:   { type: Date, default: Date.now },
  closeTime:  { type: Date, default: null },
});
const Trade = mongoose.model("Trade", tradeSchema);

// ============================================================
// MIDDLEWARE — JWT Auth
// ============================================================
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
};

// MT4 EA auth — uses account number + a shared API key
const mt4Middleware = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== process.env.MT4_API_KEY) {
    return res.status(401).json({ error: "Invalid MT4 API key" });
  }
  next();
};

// ============================================================
// TELEGRAM HELPER
// ============================================================
const sendTelegram = async (userId, message) => {
  try {
    const user = await User.findById(userId);
    if (user?.telegramChatId) {
      await bot.sendMessage(user.telegramChatId, message, { parse_mode: "Markdown" });
    }
  } catch (err) {
    console.error("Telegram error:", err.message);
  }
};

// ============================================================
// AUTH ROUTES
// ============================================================

// POST /auth/register
app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "All fields required" });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: "Email already registered" });

    const hashed = await bcrypt.hash(password, 12);
    const user   = await User.create({ name, email, password: hashed });
    const token  = jwt.sign({ id: user._id, email }, process.env.JWT_SECRET, { expiresIn: "30d" });

    res.json({ token, user: { id: user._id, name, email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/login
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Invalid credentials" });

    const token = jwt.sign({ id: user._id, email }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user._id, name: user.name, email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /auth/telegram — link Telegram chat ID
app.patch("/auth/telegram", authMiddleware, async (req, res) => {
  try {
    const { telegramChatId } = req.body;
    await User.findByIdAndUpdate(req.user.id, { telegramChatId });
    res.json({ success: true, message: "Telegram linked successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ACCOUNT ROUTES (App → Server)
// ============================================================

// GET /accounts — get all accounts for logged in user
app.get("/accounts", authMiddleware, async (req, res) => {
  try {
    const accounts = await Account.find({ userId: req.user.id });
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /accounts/:id — get single account
app.get("/accounts/:id", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({ _id: req.params.id, userId: req.user.id });
    if (!account) return res.status(404).json({ error: "Account not found" });
    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /accounts/:id/settings — update bot settings from app
app.patch("/accounts/:id/settings", authMiddleware, async (req, res) => {
  try {
    const { settings } = req.body;
    const account = await Account.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: { settings } },
      { new: true }
    );
    if (!account) return res.status(404).json({ error: "Account not found" });

    await sendTelegram(req.user.id,
      `⚙️ *Settings Updated*\n` +
      `Risk: ${settings.riskPercent}% | Max Daily Loss: ${settings.maxDailyLoss}%\n` +
      `Max Drawdown: ${settings.maxDrawdown}%`
    );

    res.json({ success: true, account });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /accounts/:id/override — pause or resume bot from app
app.patch("/accounts/:id/override", authMiddleware, async (req, res) => {
  try {
    const { botActive } = req.body;
    const account = await Account.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { botActive },
      { new: true }
    );
    if (!account) return res.status(404).json({ error: "Account not found" });

    const statusMsg = botActive
      ? "✅ *Bot Resumed* — Trading is now active."
      : "⛔ *Bot Paused* — Manual override activated from app.";

    await sendTelegram(req.user.id, statusMsg);
    res.json({ success: true, botActive, account });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MT4 BRIDGE ROUTES (MT4 EA → Server)
// ============================================================

// POST /mt4/heartbeat — EA pings server every tick with account data
app.post("/mt4/heartbeat", mt4Middleware, async (req, res) => {
  try {
    const {
      accountNumber, broker, balance, equity, profit,
      dailyPnl, dailyLossPct, drawdown, winRate,
      consecutiveLosses, openTrades, marketCondition, userId
    } = req.body;

    let account = await Account.findOne({ accountNumber, userId });

    if (!account) {
      // Auto-create account on first heartbeat
      account = await Account.create({
        userId, accountNumber, broker, balance, equity, profit,
        dailyPnl, dailyLossPct, drawdown, winRate,
        consecutiveLosses, openTrades, marketCondition,
        lastUpdate: new Date()
      });
      console.log(`✅ New account registered: ${accountNumber}`);
    } else {
      await Account.findByIdAndUpdate(account._id, {
        balance, equity, profit, dailyPnl, dailyLossPct,
        drawdown, winRate, consecutiveLosses, openTrades,
        marketCondition, lastUpdate: new Date()
      });
    }

    // Return current settings so EA can sync them
    const updated = await Account.findById(account._id);
    res.json({ success: true, settings: updated.settings, botActive: updated.botActive });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /mt4/trade/open — EA reports new trade opened
app.post("/mt4/trade/open", mt4Middleware, async (req, res) => {
  try {
    const { accountNumber, userId, ticket, pair, type, lots, entryPrice, stopLoss, takeProfit, mode } = req.body;

    const account = await Account.findOne({ accountNumber, userId });
    if (!account) return res.status(404).json({ error: "Account not found" });

    const trade = await Trade.create({
      userId, accountId: account._id, ticket, pair, type,
      lots, entryPrice, stopLoss, takeProfit, mode
    });

    const emoji = type === "BUY" ? "📈" : "📉";
    await sendTelegram(userId,
      `${emoji} *Trade Opened*\n` +
      `Pair: *${pair}* | ${type}\n` +
      `Entry: ${entryPrice} | Lots: ${lots}\n` +
      `SL: ${stopLoss} | TP: ${takeProfit}\n` +
      `Mode: ${mode}`
    );

    res.json({ success: true, trade });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /mt4/trade/close — EA reports trade closed
app.post("/mt4/trade/close", mt4Middleware, async (req, res) => {
  try {
    const { ticket, closePrice, profit, userId } = req.body;

    const trade = await Trade.findOneAndUpdate(
      { ticket, userId },
      { closePrice, profit, status: "closed", closeTime: new Date() },
      { new: true }
    );

    if (!trade) return res.status(404).json({ error: "Trade not found" });

    const emoji  = profit >= 0 ? "✅" : "❌";
    const result = profit >= 0 ? "WIN" : "LOSS";
    await sendTelegram(userId,
      `${emoji} *Trade Closed — ${result}*\n` +
      `Pair: *${trade.pair}* | ${trade.type}\n` +
      `Entry: ${trade.entryPrice} → Close: ${closePrice}\n` +
      `P&L: *${profit >= 0 ? "+" : ""}$${profit.toFixed(2)}*`
    );

    res.json({ success: true, trade });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /mt4/alert — EA sends risk alerts (daily limit, drawdown, streak)
app.post("/mt4/alert", mt4Middleware, async (req, res) => {
  try {
    const { userId, type, message } = req.body;

    const alertEmojis = {
      "daily_limit":  "⚠️",
      "drawdown":     "🚨",
      "streak":       "📉",
      "paused":       "⛔",
      "resumed":      "✅",
      "be_hit":       "🔒",
      "trail_active": "🏃",
    };

    const emoji = alertEmojis[type] || "ℹ️";
    await sendTelegram(userId, `${emoji} *AdaptiveEdge Alert*\n${message}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// TRADE HISTORY ROUTES (App → Server)
// ============================================================

// GET /trades/:accountId — get trade history for account
app.get("/trades/:accountId", authMiddleware, async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    const filter = { accountId: req.params.accountId, userId: req.user.id };
    if (status) filter.status = status;

    const trades = await Trade.find(filter)
      .sort({ openTime: -1 })
      .limit(parseInt(limit));

    // Calculate stats
    const closed = trades.filter(t => t.status === "closed");
    const wins   = closed.filter(t => t.profit > 0).length;
    const totalPnl = closed.reduce((a, t) => a + t.profit, 0);

    res.json({
      trades,
      stats: {
        total:    closed.length,
        wins,
        losses:   closed.length - wins,
        winRate:  closed.length > 0 ? ((wins / closed.length) * 100).toFixed(1) : 0,
        totalPnl: totalPnl.toFixed(2),
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ADMIN ROUTES (Josh's dashboard)
// ============================================================

// GET /admin/stats — overview of all clients
app.get("/admin/stats", authMiddleware, async (req, res) => {
  try {
    // Simple admin check — in production use a role field
    const user = await User.findById(req.user.id);
    if (user.email !== process.env.ADMIN_EMAIL)
      return res.status(403).json({ error: "Admin only" });

    const totalUsers    = await User.countDocuments();
    const totalAccounts = await Account.countDocuments();
    const activeBots    = await Account.countDocuments({ botActive: true });
    const totalTrades   = await Trade.countDocuments();
    const allAccounts   = await Account.find().populate("userId", "name email");

    res.json({ totalUsers, totalAccounts, activeBots, totalTrades, accounts: allAccounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date(), version: "1.0.0" });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 AdaptiveEdge Pro server running on port ${PORT}`);
});
