import jwt from "jsonwebtoken";

const JWT_SECRET = () => Netlify.env.get("JWT_SECRET");
const MT4_API_KEY = () => Netlify.env.get("MT4_API_KEY");

export function verifyJwt(req) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.split(" ")[1];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET());
  } catch {
    return null;
  }
}

export function signJwt(payload) {
  return jwt.sign(payload, JWT_SECRET(), { expiresIn: "30d" });
}

export function verifyMt4Key(req) {
  const apiKey = req.headers.get("x-api-key");
  return apiKey === MT4_API_KEY();
}

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  };
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export function errorResponse(message, status = 500) {
  return jsonResponse({ error: message }, status);
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
