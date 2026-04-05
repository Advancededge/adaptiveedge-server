import { verifyJwt, jsonResponse, errorResponse, handleOptions } from "./lib/auth.mjs";
import { getTradeStore } from "./lib/store.mjs";

export default async (req, context) => {
  if (req.method === "OPTIONS") return handleOptions();

  const decoded = verifyJwt(req);
  if (!decoded) return errorResponse("No token provided", 401);

  try {
    const accountId = context.params.accountId;
    const url = new URL(req.url);
    const statusFilter = url.searchParams.get("status");
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);

    const tradeStore = getTradeStore();
    const tradeList = await tradeStore.get(`byaccount:${accountId}`, { type: "json" });
    const tradeIds = tradeList?.tradeIds || [];

    const allTrades = [];
    for (const id of tradeIds) {
      const trade = await tradeStore.get(`id:${id}`, { type: "json" });
      if (!trade || trade.userId !== decoded.id) continue;
      if (statusFilter && trade.status !== statusFilter) continue;
      allTrades.push(trade);
    }

    // Sort by openTime descending
    allTrades.sort((a, b) => new Date(b.openTime) - new Date(a.openTime));
    const trades = allTrades.slice(0, limit);

    // Calculate stats from closed trades
    const closed = allTrades.filter((t) => t.status === "closed");
    const wins = closed.filter((t) => t.profit > 0).length;
    const totalPnl = closed.reduce((a, t) => a + t.profit, 0);

    return jsonResponse({
      trades,
      stats: {
        total: closed.length,
        wins,
        losses: closed.length - wins,
        winRate: closed.length > 0 ? ((wins / closed.length) * 100).toFixed(1) : 0,
        totalPnl: totalPnl.toFixed(2),
      },
    });
  } catch (err) {
    return errorResponse(err.message);
  }
};

export const config = { path: "/trades/:accountId", method: "GET" };
