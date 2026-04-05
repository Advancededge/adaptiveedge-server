export async function sendTelegram(chatId, message) {
  const token = Netlify.env.get("TELEGRAM_TOKEN");
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });
  } catch (err) {
    console.error("Telegram send error:", err.message);
  }
}

export async function sendTelegramToUser(store, userId, message) {
  const user = await store.get(`id:${userId}`, { type: "json" });
  if (user?.telegramChatId) {
    await sendTelegram(user.telegramChatId, message);
  }
}
