import { verifyJwt, jsonResponse, errorResponse, handleOptions } from "./lib/auth.mjs";
import { getAccountStore } from "./lib/store.mjs";

export default async (req, context) => {
  if (req.method === "OPTIONS") return handleOptions();

  const decoded = verifyJwt(req);
  if (!decoded) return errorResponse("No token provided", 401);

  try {
    const store = getAccountStore();
    const accountId = context.params.id;

    if (accountId) {
      // GET /accounts/:id
      const account = await store.get(`id:${accountId}`, { type: "json" });
      if (!account || account.userId !== decoded.id) {
        return errorResponse("Account not found", 404);
      }
      return jsonResponse(account);
    }

    // GET /accounts
    const userList = await store.get(`byuser:${decoded.id}`, { type: "json" });
    const accountIds = userList?.accountIds || [];
    const accounts = [];
    for (const id of accountIds) {
      const account = await store.get(`id:${id}`, { type: "json" });
      if (account) accounts.push(account);
    }

    return jsonResponse(accounts);
  } catch (err) {
    return errorResponse(err.message);
  }
};

export const config = { path: ["/accounts", "/accounts/:id"], method: "GET" };
