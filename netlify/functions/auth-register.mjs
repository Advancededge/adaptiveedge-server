import bcrypt from "bcryptjs";
import { signJwt, jsonResponse, errorResponse, handleOptions } from "./lib/auth.mjs";
import { getUserStore, generateId } from "./lib/store.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return handleOptions();

  try {
    const { name, email, password } = await req.json();
    if (!name || !email || !password) {
      return errorResponse("All fields required", 400);
    }

    const store = getUserStore();
    const existingRef = await store.get(`email:${email.toLowerCase()}`, { type: "json" });
    if (existingRef) return errorResponse("Email already registered", 400);

    const hashed = await bcrypt.hash(password, 12);
    const userId = generateId();
    const user = {
      id: userId,
      name,
      email: email.toLowerCase(),
      password: hashed,
      telegramChatId: null,
      plan: "basic",
      createdAt: new Date().toISOString(),
    };

    await store.setJSON(`id:${userId}`, user);
    await store.setJSON(`email:${email.toLowerCase()}`, { userId });

    const token = signJwt({ id: userId, email: email.toLowerCase() });
    return jsonResponse({ token, user: { id: userId, name, email: email.toLowerCase() } });
  } catch (err) {
    return errorResponse(err.message);
  }
};

export const config = { path: "/auth/register", method: "POST" };
