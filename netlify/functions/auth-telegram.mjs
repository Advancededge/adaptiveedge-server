import { verifyJwt, jsonResponse, errorResponse, handleOptions } from "./lib/auth.mjs";
import { getUserStore } from "./lib/store.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return handleOptions();

  const decoded = verifyJwt(req);
  if (!decoded) return errorResponse("No token provided", 401);

  try {
    const { telegramChatId } = await req.json();
    const store = getUserStore();

    const user = await store.get(`id:${decoded.id}`, { type: "json" });
    if (!user) return errorResponse("User not found", 404);

    user.telegramChatId = telegramChatId;
    await store.setJSON(`id:${decoded.id}`, user);

    return jsonResponse({ success: true, message: "Telegram linked successfully" });
  } catch (err) {
    return errorResponse(err.message);
  }
};

export const config = { path: "/auth/telegram", method: "PATCH" };
