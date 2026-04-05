import { jsonResponse, handleOptions } from "./lib/auth.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return handleOptions();

  return jsonResponse({
    status: "ok",
    time: new Date().toISOString(),
    version: "1.0.0",
    platform: "netlify",
  });
};

export const config = { path: "/health", method: "GET" };
