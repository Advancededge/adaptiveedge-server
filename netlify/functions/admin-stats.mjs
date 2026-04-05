import { verifyJwt, jsonResponse, errorResponse, handleOptions } from "./lib/auth.mjs";
import { getUserStore, getAccountStore, getTradeStore } from "./lib/store.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return handleOptions();

  const decoded = verifyJwt(req);
  if (!decoded) return errorResponse("No token provided", 401);

  try {
    const adminEmail = Netlify.env.get("ADMIN_EMAIL");
    const userStore = getUserStore();
    const user = await userStore.get(`id:${decoded.id}`, { type: "json" });
    if (!user || user.email !== adminEmail) {
      return errorResponse("Admin only", 403);
    }

    // List all users
    const { blobs: userBlobs } = await userStore.list({ prefix: "id:" });
    const users = [];
    for (const blob of userBlobs) {
      const u = await userStore.get(blob.key, { type: "json" });
      if (u) users.push(u);
    }

    // List all accounts
    const accountStore = getAccountStore();
    const { blobs: accountBlobs } = await accountStore.list({ prefix: "id:" });
    const accounts = [];
    let activeBots = 0;
    for (const blob of accountBlobs) {
      const acc = await accountStore.get(blob.key, { type: "json" });
      if (acc) {
        const owner = users.find((u) => u.id === acc.userId);
        accounts.push({
          ...acc,
          userName: owner?.name,
          userEmail: owner?.email,
        });
        if (acc.botActive) activeBots++;
      }
    }

    // Count trades
    const tradeStore = getTradeStore();
    const { blobs: tradeBlobs } = await tradeStore.list({ prefix: "id:" });

    return jsonResponse({
      totalUsers: users.length,
      totalAccounts: accounts.length,
      activeBots,
      totalTrades: tradeBlobs.length,
      accounts,
    });
  } catch (err) {
    return errorResponse(err.message);
  }
};

export const config = { path: "/admin/stats", method: "GET" };
