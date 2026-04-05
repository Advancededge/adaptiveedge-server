import { verifyJwt, jsonResponse, errorResponse, handleOptions } from "./lib/auth.mjs";
import { getAccountStore, getUserStore } from "./lib/store.mjs";
import { sendTelegramToUser } from "./lib/telegram.mjs";

export default async (req, context) => {
  if (req.method === "OPTIONS") return handleOptions();

  const decoded = verifyJwt(req);
  if (!decoded) return errorResponse("No token provided", 401);

  try {
    const { settings } = await req.json();
    const store = getAccountStore();
    const accountId = context.params.id;

    const account = await store.get(`id:${accountId}`, { type: "json" });
    if (!account || account.userId !== decoded.id) {
      return errorResponse("Account not found", 404);
    }

    account.settings = { ...account.settings, ...settings };
    await store.setJSON(`id:${accountId}`, account);

    const userStore = getUserStore();
    await sendTelegramToUser(userStore, decoded.id,
      `\u2699\ufe0f *Settings Updated*\nRisk: ${settings.riskPercent}% | Max Daily Loss: ${settings.maxDailyLoss}%\nMax Drawdown: ${settings.maxDrawdown}%`
    );

    return jsonResponse({ success: true, account });
  } catch (err) {
    return errorResponse(err.message);
  }
};

export const config = { path: "/accounts/:id/settings", method: "PATCH" };
