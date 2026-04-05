import { getStore } from "@netlify/blobs";

export function getUserStore() {
  return getStore({ name: "users", consistency: "strong" });
}

export function getAccountStore() {
  return getStore({ name: "accounts", consistency: "strong" });
}

export function getTradeStore() {
  return getStore({ name: "trades", consistency: "strong" });
}

export function generateId() {
  return crypto.randomUUID();
}
