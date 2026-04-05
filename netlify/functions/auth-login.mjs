import bcrypt from "bcryptjs";
import { signJwt, jsonResponse, errorResponse, handleOptions } from "./lib/auth.mjs";
import { getUserStore } from "./lib/store.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return handleOptions();

  try {
    const { email, password } = await req.json();
    const store = getUserStore();

    const ref = await store.get(`email:${email.toLowerCase()}`, { type: "json" });
    if (!ref) return errorResponse("Invalid credentials", 400);

    const user = await store.get(`id:${ref.userId}`, { type: "json" });
    if (!user) return errorResponse("Invalid credentials", 400);

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return errorResponse("Invalid credentials", 400);

    const token = signJwt({ id: user.id, email: user.email });
    return jsonResponse({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    return errorResponse(err.message);
  }
};

export const config = { path: "/auth/login", method: "POST" };
