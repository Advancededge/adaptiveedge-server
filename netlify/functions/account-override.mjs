import { verifyJwt, jsonResponse, errorResponse, handleOptions } from "./lib/auth.mjs";
import { getAccountStore, getUserStore } from "./lib/store.mjs";
import { sendTelegramToUser } from "./lib/telegram.mjs";

export default async (req, context) => {
  if (req.method === "OPTIONS") return handleOptions();

  const decoded = verifyJwt(req);
  if (!decoded) return errorResponse("No token provided", 401);

  try {
    const { botActive } = await req.json();
    const store = getAccountStore();
    const accountId = context.params.id;

    const account = await store.get(`id:${accountId}`, { type: "json" });
    if (!account || account.userId !== decoded.id) {
      return errorResponse("Account not found", 404);
    }

    account.botActive = botActive;
    await store.setJSON(`id:${accountId}`, account);

    const statusMsg = botActive
      ? "\u2705 *Bot Resumed* \u2014 Trading is now active."
      : "\u26d4 *Bot Paused* \u2014 Manual override activated from app.";

    const userStore = getUserStore();
    await sendTelegramToUser(userStore, decoded.id, statusMsg);

    return jsonResponse({ success: true, botActive, account });
  } catch (err) {
    return errorResponse(err.message);
  }
};

export const config = { path: "/accounts/:id/override", method: "PATCH" };
