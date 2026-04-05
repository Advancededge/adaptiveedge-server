import { verifyMt4Key, jsonResponse, errorResponse, handleOptions } from "./lib/auth.mjs";
import { getUserStore } from "./lib/store.mjs";
import { sendTelegramToUser } from "./lib/telegram.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return handleOptions();
  if (!verifyMt4Key(req)) return errorResponse("Invalid MT4 API key", 401);

  try {
    const { userId, type, message } = await req.json();

    const alertEmojis = {
      daily_limit: "\u26a0\ufe0f",
      drawdown: "\ud83d\udea8",
      streak: "\ud83d\udcc9",
      paused: "\u26d4",
      resumed: "\u2705",
      be_hit: "\ud83d\udd12",
      trail_active: "\ud83c\udfc3",
    };

    const emoji = alertEmojis[type] || "\u2139\ufe0f";
    const userStore = getUserStore();
    await sendTelegramToUser(userStore, userId, `${emoji} *AdaptiveEdge Alert*\n${message}`);

    return jsonResponse({ success: true });
  } catch (err) {
    return errorResponse(err.message);
  }
};

export const config = { path: "/mt4/alert", method: "POST" };
