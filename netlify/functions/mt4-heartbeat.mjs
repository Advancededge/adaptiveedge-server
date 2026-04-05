import { verifyMt4Key, jsonResponse, errorResponse, handleOptions } from "./lib/auth.mjs";
import { getAccountStore, generateId } from "./lib/store.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return handleOptions();
  if (!verifyMt4Key(req)) return errorResponse("Invalid MT4 API key", 401);

  try {
    const {
      accountNumber, broker, balance, equity, profit,
      dailyPnl, dailyLossPct, drawdown, winRate,
      consecutiveLosses, openTrades, marketCondition, userId,
    } = await req.json();

    const store = getAccountStore();
    const lookupKey = `lookup:${userId}:${accountNumber}`;
    let lookup = await store.get(lookupKey, { type: "json" });

    let account;
    if (!lookup) {
      const accountId = generateId();
      account = {
        id: accountId,
        userId,
        accountNumber,
        broker,
        balance,
        equity,
        profit,
        dailyPnl,
        dailyLossPct,
        drawdown,
        winRate,
        consecutiveLosses,
        openTrades,
        botActive: true,
        marketCondition,
        lastUpdate: new Date().toISOString(),
        settings: {
          riskPercent: 1.5,
          maxDailyLoss: 5.0,
          maxDrawdown: 15.0,
          maxTrades: 3,
          trendMode: true,
          scalpMode: true,
          notifications: true,
        },
      };

      await store.setJSON(`id:${accountId}`, account);
      await store.setJSON(lookupKey, { accountId });

      // Add to user's account list
      const userListKey = `byuser:${userId}`;
      const existing = await store.get(userListKey, { type: "json" });
      const accountIds = existing?.accountIds || [];
      accountIds.push(accountId);
      await store.setJSON(userListKey, { accountIds });

      console.log(`New account registered: ${accountNumber}`);
    } else {
      account = await store.get(`id:${lookup.accountId}`, { type: "json" });
      if (account) {
        Object.assign(account, {
          balance, equity, profit, dailyPnl, dailyLossPct,
          drawdown, winRate, consecutiveLosses, openTrades,
          marketCondition, lastUpdate: new Date().toISOString(),
        });
        await store.setJSON(`id:${lookup.accountId}`, account);
      }
    }

    return jsonResponse({
      success: true,
      settings: account?.settings,
      botActive: account?.botActive,
    });
  } catch (err) {
    return errorResponse(err.message);
  }
};

export const config = { path: "/mt4/heartbeat", method: "POST" };
