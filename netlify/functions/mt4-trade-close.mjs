import { verifyMt4Key, jsonResponse, errorResponse, handleOptions } from "./lib/auth.mjs";
import { getTradeStore, getUserStore } from "./lib/store.mjs";
import { sendTelegramToUser } from "./lib/telegram.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return handleOptions();
  if (!verifyMt4Key(req)) return errorResponse("Invalid MT4 API key", 401);

  try {
    const { ticket, closePrice, profit, userId } = await req.json();

    const tradeStore = getTradeStore();
    const ticketLookup = await tradeStore.get(`ticket:${userId}:${ticket}`, { type: "json" });
    if (!ticketLookup) return errorResponse("Trade not found", 404);

    const trade = await tradeStore.get(`id:${ticketLookup.tradeId}`, { type: "json" });
    if (!trade) return errorResponse("Trade not found", 404);

    trade.closePrice = closePrice;
    trade.profit = profit;
    trade.status = "closed";
    trade.closeTime = new Date().toISOString();
    await tradeStore.setJSON(`id:${ticketLookup.tradeId}`, trade);

    const emoji = profit >= 0 ? "\u2705" : "\u274c";
    const result = profit >= 0 ? "WIN" : "LOSS";
    const userStore = getUserStore();
    await sendTelegramToUser(userStore, userId,
      `${emoji} *Trade Closed \u2014 ${result}*\nPair: *${trade.pair}* | ${trade.type}\nEntry: ${trade.entryPrice} \u2192 Close: ${closePrice}\nP&L: *${profit >= 0 ? "+" : ""}$${profit.toFixed(2)}*`
    );

    return jsonResponse({ success: true, trade });
  } catch (err) {
    return errorResponse(err.message);
  }
};

export const config = { path: "/mt4/trade/close", method: "POST" };
