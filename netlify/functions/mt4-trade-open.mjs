import { verifyMt4Key, jsonResponse, errorResponse, handleOptions } from "./lib/auth.mjs";
import { getAccountStore, getTradeStore, getUserStore, generateId } from "./lib/store.mjs";
import { sendTelegramToUser } from "./lib/telegram.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return handleOptions();
  if (!verifyMt4Key(req)) return errorResponse("Invalid MT4 API key", 401);

  try {
    const { accountNumber, userId, ticket, pair, type, lots, entryPrice, stopLoss, takeProfit, mode } = await req.json();

    const accountStore = getAccountStore();
    const lookup = await accountStore.get(`lookup:${userId}:${accountNumber}`, { type: "json" });
    if (!lookup) return errorResponse("Account not found", 404);

    const tradeStore = getTradeStore();
    const tradeId = generateId();
    const trade = {
      id: tradeId,
      userId,
      accountId: lookup.accountId,
      ticket,
      pair,
      type,
      lots,
      entryPrice,
      stopLoss,
      takeProfit,
      closePrice: null,
      profit: 0,
      status: "open",
      mode: mode || "TREND",
      openTime: new Date().toISOString(),
      closeTime: null,
    };

    await tradeStore.setJSON(`id:${tradeId}`, trade);
    await tradeStore.setJSON(`ticket:${userId}:${ticket}`, { tradeId });

    // Add to account's trade list
    const listKey = `byaccount:${lookup.accountId}`;
    const existing = await tradeStore.get(listKey, { type: "json" });
    const tradeIds = existing?.tradeIds || [];
    tradeIds.push(tradeId);
    await tradeStore.setJSON(listKey, { tradeIds });

    const emoji = type === "BUY" ? "\ud83d\udcc8" : "\ud83d\udcc9";
    const userStore = getUserStore();
    await sendTelegramToUser(userStore, userId,
      `${emoji} *Trade Opened*\nPair: *${pair}* | ${type}\nEntry: ${entryPrice} | Lots: ${lots}\nSL: ${stopLoss} | TP: ${takeProfit}\nMode: ${mode || "TREND"}`
    );

    return jsonResponse({ success: true, trade });
  } catch (err) {
    return errorResponse(err.message);
  }
};

export const config = { path: "/mt4/trade/open", method: "POST" };
