//+------------------------------------------------------------------+
//|                                          AdaptiveEdgeBridge.mq4  |
//|                                         AdaptiveEdge MT4 Bridge  |
//|                                                                   |
//|  PURPOSE:                                                         |
//|    Monitors the MT4 account for trades opened/closed by          |
//|    ICT-BOT-V3 and forwards them to the AdaptiveEdge Railway      |
//|    backend in real-time.  Also sends periodic heartbeats with    |
//|    live account stats and applies settings/botActive flags that  |
//|    come back in the heartbeat response.                          |
//|                                                                   |
//|  SETUP:                                                           |
//|    1. Attach to any chart (EURUSD H1 recommended).               |
//|    2. Fill in the EA inputs below (UserId, ApiKey, ServerUrl).   |
//|    3. Enable "Allow WebRequest" in MT4 Tools → Options →         |
//|       Expert Advisors and add the server URL to the list.        |
//|    4. Compile and attach.  Check the Experts log for status.     |
//+------------------------------------------------------------------+
#property copyright "AdaptiveEdge"
#property version   "1.10"
#property strict

//--- Input parameters
input string   UserId          = "";                                                    // Your AdaptiveEdge user ID
input string   ApiKey          = "";                                                    // MT4_API_KEY from Railway variables
input string   ServerUrl       = "https://adaptiveedge-server-production.up.railway.app"; // Backend base URL
input string   BotComment      = "ICT-BOT-V3";                                         // OrderComment prefix to watch
input int      HeartbeatSecs   = 30;                                                    // Heartbeat interval (seconds)
input bool     VerboseLog      = true;                                                  // Print debug info to Experts log

//--- Account constants (hard-coded as a safety cross-check)
#define ACCOUNT_NUMBER  79232151
#define BROKER_NAME     "XMGlobal-Demo"

//--- Internal state
datetime g_lastHeartbeat  = 0;
int      g_knownTickets[];   // tickets we have already reported as open
int      g_knownCount     = 0;

//--- Risk / settings received from server (applied on next heartbeat response)
double   g_riskPercent        = 1.5;
double   g_maxDailyLoss       = 5.0;
double   g_maxDrawdown        = 15.0;
int      g_maxTrades          = 3;
bool     g_trendMode          = true;
bool     g_scalpMode          = true;
bool     g_botActive          = true;

//+------------------------------------------------------------------+
//| Utility: log only when VerboseLog is on                          |
//+------------------------------------------------------------------+
void Log(string msg)
{
   if (VerboseLog)
      Print("[AdaptiveEdgeBridge] ", msg);
}

//+------------------------------------------------------------------+
//| Utility: check whether a ticket is already in g_knownTickets     |
//+------------------------------------------------------------------+
bool IsKnown(int ticket)
{
   for (int i = 0; i < g_knownCount; i++)
      if (g_knownTickets[i] == ticket) return true;
   return false;
}

//+------------------------------------------------------------------+
//| Utility: add a ticket to g_knownTickets                          |
//+------------------------------------------------------------------+
void AddKnown(int ticket)
{
   ArrayResize(g_knownTickets, g_knownCount + 1);
   g_knownTickets[g_knownCount] = ticket;
   g_knownCount++;
}

//+------------------------------------------------------------------+
//| Utility: remove a ticket from g_knownTickets                     |
//+------------------------------------------------------------------+
void RemoveKnown(int ticket)
{
   for (int i = 0; i < g_knownCount; i++)
   {
      if (g_knownTickets[i] == ticket)
      {
         // Shift remaining elements left
         for (int j = i; j < g_knownCount - 1; j++)
            g_knownTickets[j] = g_knownTickets[j + 1];
         g_knownCount--;
         ArrayResize(g_knownTickets, g_knownCount);
         return;
      }
   }
}

//+------------------------------------------------------------------+
//| Utility: map MT4 order type integer to string                    |
//+------------------------------------------------------------------+
string OrderTypeStr(int ot)
{
   if (ot == OP_BUY)       return "BUY";
   if (ot == OP_SELL)      return "SELL";
   if (ot == OP_BUYLIMIT)  return "BUY_LIMIT";
   if (ot == OP_SELLLIMIT) return "SELL_LIMIT";
   if (ot == OP_BUYSTOP)   return "BUY_STOP";
   if (ot == OP_SELLSTOP)  return "SELL_STOP";
   return "UNKNOWN";
}

//+------------------------------------------------------------------+
//| Utility: derive a simple mode label from the comment string      |
//|  ICT-BOT-V3 comments are expected to contain "TREND" or "SCALP" |
//+------------------------------------------------------------------+
string DeriveMode(string comment)
{
   if (StringFind(comment, "SCALP") >= 0) return "SCALP";
   if (StringFind(comment, "TREND") >= 0) return "TREND";
   return "TREND";   // default
}

//+------------------------------------------------------------------+
//| Utility: build a minimal JSON string (no external library)       |
//+------------------------------------------------------------------+
string EscapeJson(string s)
{
   // Escape backslash and double-quote for safe JSON embedding
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return s;
}

//+------------------------------------------------------------------+
//| Core HTTP POST helper                                            |
//|  Returns the HTTP response body, or "" on failure.              |
//+------------------------------------------------------------------+
string HttpPost(string endpoint, string jsonBody)
{
   string url     = ServerUrl + endpoint;
   string headers = "Content-Type: application/json\r\nx-api-key: " + ApiKey + "\r\n";
   char   postData[];
   char   result[];
   string resultHeaders;

   StringToCharArray(jsonBody, postData, 0, StringLen(jsonBody));

   int timeout = 10000; // 10 s
   int res = WebRequest("POST", url, headers, timeout, postData, result, resultHeaders);

   if (res == -1)
   {
      int err = GetLastError();
      Print("[AdaptiveEdgeBridge] WebRequest error ", err,
            " on ", endpoint,
            " — ensure the URL is whitelisted in Tools → Options → Expert Advisors");
      return "";
   }

   string body = CharArrayToString(result, 0, ArraySize(result));
   Log("POST " + endpoint + " → HTTP " + IntegerToString(res) + " | " + body);
   return body;
}

//+------------------------------------------------------------------+
//| Parse a boolean field from a flat JSON response string           |
//|  e.g. ParseJsonBool("{\"botActive\":false,...}", "botActive")    |
//+------------------------------------------------------------------+
bool ParseJsonBool(string json, string key, bool defaultVal)
{
   string search = "\"" + key + "\":";
   int pos = StringFind(json, search);
   if (pos < 0) return defaultVal;
   pos += StringLen(search);
   // Skip whitespace
   while (pos < StringLen(json) && StringGetCharacter(json, pos) == ' ') pos++;
   string sub = StringSubstr(json, pos, 5);
   if (StringFind(sub, "true") == 0)  return true;
   if (StringFind(sub, "false") == 0) return false;
   return defaultVal;
}

//+------------------------------------------------------------------+
//| Parse a double field from a flat JSON response string            |
//+------------------------------------------------------------------+
double ParseJsonDouble(string json, string key, double defaultVal)
{
   string search = "\"" + key + "\":";
   int pos = StringFind(json, search);
   if (pos < 0) return defaultVal;
   pos += StringLen(search);
   while (pos < StringLen(json) && StringGetCharacter(json, pos) == ' ') pos++;
   // Read until delimiter
   string num = "";
   for (int i = pos; i < StringLen(json); i++)
   {
      ushort c = StringGetCharacter(json, i);
      if (c == ',' || c == '}' || c == ' ' || c == '\n' || c == '\r') break;
      num += ShortToString(c);
   }
   if (StringLen(num) == 0) return defaultVal;
   return StringToDouble(num);
}

//+------------------------------------------------------------------+
//| Parse an integer field from a flat JSON response string          |
//+------------------------------------------------------------------+
int ParseJsonInt(string json, string key, int defaultVal)
{
   return (int)ParseJsonDouble(json, key, (double)defaultVal);
}

//+------------------------------------------------------------------+
//| Apply settings object received inside the heartbeat response     |
//|  The server returns: { "settings": { riskPercent, ... },         |
//|                        "botActive": true }                       |
//+------------------------------------------------------------------+
void ApplyServerResponse(string json)
{
   // botActive lives at the top level
   g_botActive = ParseJsonBool(json, "botActive", g_botActive);

   // settings fields are nested — locate the "settings" sub-object
   int settingsPos = StringFind(json, "\"settings\":");
   if (settingsPos >= 0)
   {
      int braceOpen = StringFind(json, "{", settingsPos + 11);
      if (braceOpen >= 0)
      {
         int braceClose = StringFind(json, "}", braceOpen);
         if (braceClose > braceOpen)
         {
            string settings = StringSubstr(json, braceOpen, braceClose - braceOpen + 1);
            g_riskPercent  = ParseJsonDouble(settings, "riskPercent",  g_riskPercent);
            g_maxDailyLoss = ParseJsonDouble(settings, "maxDailyLoss", g_maxDailyLoss);
            g_maxDrawdown  = ParseJsonDouble(settings, "maxDrawdown",  g_maxDrawdown);
            g_maxTrades    = ParseJsonInt   (settings, "maxTrades",    g_maxTrades);
            g_trendMode    = ParseJsonBool  (settings, "trendMode",    g_trendMode);
            g_scalpMode    = ParseJsonBool  (settings, "scalpMode",    g_scalpMode);
            Log(StringFormat("Settings applied — risk:%.2f maxDailyLoss:%.2f maxDD:%.2f maxTrades:%d trendMode:%s scalpMode:%s botActive:%s",
                g_riskPercent, g_maxDailyLoss, g_maxDrawdown, g_maxTrades,
                g_trendMode ? "true" : "false",
                g_scalpMode ? "true" : "false",
                g_botActive ? "true" : "false"));
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Compute daily P&L by summing today's closed-trade profits        |
//+------------------------------------------------------------------+
double CalcDailyPnl()
{
   double pnl = 0;
   datetime dayStart = StringToTime(TimeToString(TimeCurrent(), TIME_DATE));
   int total = OrdersHistoryTotal();
   for (int i = 0; i < total; i++)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      if (OrderCloseTime() >= dayStart)
         pnl += OrderProfit() + OrderSwap() + OrderCommission();
   }
   return pnl;
}

//+------------------------------------------------------------------+
//| Compute win-rate from today's closed trades (0-100)              |
//+------------------------------------------------------------------+
double CalcWinRate()
{
   int wins = 0, total = 0;
   datetime dayStart = StringToTime(TimeToString(TimeCurrent(), TIME_DATE));
   int hist = OrdersHistoryTotal();
   for (int i = 0; i < hist; i++)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      if (OrderCloseTime() < dayStart) continue;
      if (OrderType() > OP_SELL) continue; // skip pending
      total++;
      if (OrderProfit() > 0) wins++;
   }
   if (total == 0) return 0;
   return (double)wins / total * 100.0;
}

//+------------------------------------------------------------------+
//| Compute max consecutive losses today                             |
//+------------------------------------------------------------------+
int CalcConsecutiveLosses()
{
   int streak = 0, maxStreak = 0;
   datetime dayStart = StringToTime(TimeToString(TimeCurrent(), TIME_DATE));
   int hist = OrdersHistoryTotal();
   for (int i = 0; i < hist; i++)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      if (OrderCloseTime() < dayStart) continue;
      if (OrderType() > OP_SELL) continue;
      if (OrderProfit() < 0) { streak++; if (streak > maxStreak) maxStreak = streak; }
      else streak = 0;
   }
   return maxStreak;
}

//+------------------------------------------------------------------+
//| Detect market condition from current spread / volatility         |
//|  Simple heuristic: wide spread → VOLATILE, else TRENDING         |
//+------------------------------------------------------------------+
string DetectMarketCondition()
{
   double spread = MarketInfo(Symbol(), MODE_SPREAD);
   if (spread > 30) return "VOLATILE";
   return "TRENDING";
}

//+------------------------------------------------------------------+
//| Send heartbeat to /mt4/heartbeat                                 |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   double balance   = AccountBalance();
   double equity    = AccountEquity();
   double profit    = AccountProfit();
   double dailyPnl  = CalcDailyPnl();
   double drawdown  = (balance > 0) ? (balance - equity) / balance * 100.0 : 0;
   double dailyLossPct = (balance > 0) ? -dailyPnl / balance * 100.0 : 0;
   if (dailyLossPct < 0) dailyLossPct = 0; // positive value means loss
   double winRate   = CalcWinRate();
   int    consLoss  = CalcConsecutiveLosses();
   int    openTrades = OrdersTotal();
   string mktCond   = DetectMarketCondition();

   string json = StringFormat(
      "{"
      "\"accountNumber\":%d,"
      "\"broker\":\"%s\","
      "\"userId\":\"%s\","
      "\"balance\":%.2f,"
      "\"equity\":%.2f,"
      "\"profit\":%.2f,"
      "\"dailyPnl\":%.2f,"
      "\"dailyLossPct\":%.4f,"
      "\"drawdown\":%.4f,"
      "\"winRate\":%.2f,"
      "\"consecutiveLosses\":%d,"
      "\"openTrades\":%d,"
      "\"marketCondition\":\"%s\""
      "}",
      ACCOUNT_NUMBER,
      BROKER_NAME,
      EscapeJson(UserId),
      balance, equity, profit,
      dailyPnl, dailyLossPct, drawdown,
      winRate, consLoss, openTrades,
      EscapeJson(mktCond)
   );

   string resp = HttpPost("/mt4/heartbeat", json);
   if (StringLen(resp) > 0)
      ApplyServerResponse(resp);
}

//+------------------------------------------------------------------+
//| Report a newly opened trade to /mt4/trade/open                   |
//+------------------------------------------------------------------+
void ReportTradeOpen(int ticket)
{
   if (!OrderSelect(ticket, SELECT_BY_TICKET)) return;

   string typeStr  = OrderTypeStr(OrderType());
   string modeStr  = DeriveMode(OrderComment());
   string comment  = EscapeJson(OrderComment());
   string symbol   = EscapeJson(OrderSymbol());

   string json = StringFormat(
      "{"
      "\"accountNumber\":%d,"
      "\"broker\":\"%s\","
      "\"userId\":\"%s\","
      "\"ticket\":%d,"
      "\"pair\":\"%s\","
      "\"type\":\"%s\","
      "\"lots\":%.2f,"
      "\"entryPrice\":%.5f,"
      "\"stopLoss\":%.5f,"
      "\"takeProfit\":%.5f,"
      "\"mode\":\"%s\""
      "}",
      ACCOUNT_NUMBER,
      BROKER_NAME,
      EscapeJson(UserId),
      ticket,
      symbol,
      typeStr,
      OrderLots(),
      OrderOpenPrice(),
      OrderStopLoss(),
      OrderTakeProfit(),
      modeStr
   );

   string resp = HttpPost("/mt4/trade/open", json);
   if (StringFind(resp, "\"success\":true") >= 0)
   {
      AddKnown(ticket);
      Log(StringFormat("Trade open reported — ticket:%d %s %s %.2f lots @ %.5f",
          ticket, symbol, typeStr, OrderLots(), OrderOpenPrice()));
   }
   else
   {
      Print("[AdaptiveEdgeBridge] WARNING: trade open report failed for ticket ", ticket, " — ", resp);
   }
}

//+------------------------------------------------------------------+
//| Report a closed trade to /mt4/trade/close                        |
//+------------------------------------------------------------------+
void ReportTradeClose(int ticket)
{
   if (!OrderSelect(ticket, SELECT_BY_TICKET, MODE_HISTORY)) return;

   double closePrice = OrderClosePrice();
   double profit     = OrderProfit() + OrderSwap() + OrderCommission();

   string json = StringFormat(
      "{"
      "\"userId\":\"%s\","
      "\"ticket\":%d,"
      "\"closePrice\":%.5f,"
      "\"profit\":%.2f"
      "}",
      EscapeJson(UserId),
      ticket,
      closePrice,
      profit
   );

   string resp = HttpPost("/mt4/trade/close", json);
   if (StringFind(resp, "\"success\":true") >= 0)
   {
      RemoveKnown(ticket);
      Log(StringFormat("Trade close reported — ticket:%d closePrice:%.5f profit:%.2f",
          ticket, closePrice, profit));
   }
   else
   {
      Print("[AdaptiveEdgeBridge] WARNING: trade close report failed for ticket ", ticket, " — ", resp);
   }
}

//+------------------------------------------------------------------+
//| Send an alert to /mt4/alert                                      |
//+------------------------------------------------------------------+
void SendAlert(string alertType, string message)
{
   string json = StringFormat(
      "{\"userId\":\"%s\",\"type\":\"%s\",\"message\":\"%s\"}",
      EscapeJson(UserId),
      EscapeJson(alertType),
      EscapeJson(message)
   );
   HttpPost("/mt4/alert", json);
}

//+------------------------------------------------------------------+
//| Scan all open orders and detect newly opened ICT-BOT-V3 trades   |
//+------------------------------------------------------------------+
void ScanOpenTrades()
{
   int total = OrdersTotal();
   for (int i = 0; i < total; i++)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if (OrderType() > OP_SELL) continue; // skip pending orders

      // Only track trades placed by ICT-BOT-V3
      if (StringFind(OrderComment(), BotComment) < 0) continue;

      int ticket = OrderTicket();
      if (!IsKnown(ticket))
         ReportTradeOpen(ticket);
   }
}

//+------------------------------------------------------------------+
//| Scan history for trades that were open but are now closed        |
//+------------------------------------------------------------------+
void ScanClosedTrades()
{
   // Build a temporary list of tickets that are still open
   int openTickets[];
   int openCount = 0;
   int total = OrdersTotal();
   for (int i = 0; i < total; i++)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      ArrayResize(openTickets, openCount + 1);
      openTickets[openCount] = OrderTicket();
      openCount++;
   }

   // Any ticket in g_knownTickets that is no longer open has been closed
   for (int k = g_knownCount - 1; k >= 0; k--)
   {
      int kt = g_knownTickets[k];
      bool stillOpen = false;
      for (int j = 0; j < openCount; j++)
         if (openTickets[j] == kt) { stillOpen = true; break; }

      if (!stillOpen)
         ReportTradeClose(kt);
   }
}

//+------------------------------------------------------------------+
//| Guard: validate required inputs before doing anything            |
//+------------------------------------------------------------------+
bool ValidateInputs()
{
   if (StringLen(UserId) == 0)
   {
      Alert("[AdaptiveEdgeBridge] ERROR: UserId input is empty. Please set your AdaptiveEdge user ID.");
      return false;
   }
   if (StringLen(ApiKey) == 0)
   {
      Alert("[AdaptiveEdgeBridge] ERROR: ApiKey input is empty. Please set the MT4_API_KEY from Railway.");
      return false;
   }
   if (AccountNumber() != ACCOUNT_NUMBER)
   {
      Print(StringFormat("[AdaptiveEdgeBridge] WARNING: Running on account %d, expected %d. Continuing anyway.",
            AccountNumber(), ACCOUNT_NUMBER));
   }
   return true;
}

//+------------------------------------------------------------------+
//| EA initialisation                                                |
//+------------------------------------------------------------------+
int OnInit()
{
   if (!ValidateInputs()) return INIT_PARAMETERS_INCORRECT;

   Print(StringFormat("[AdaptiveEdgeBridge] v1.10 started — account:%d broker:%s server:%s",
         AccountNumber(), AccountCompany(), ServerUrl));
   Print(StringFormat("[AdaptiveEdgeBridge] Watching for comment prefix: \"%s\" | heartbeat every %ds",
         BotComment, HeartbeatSecs));

   // Seed known tickets from currently open trades so we don't
   // double-report trades that were already open before the EA started.
   int total = OrdersTotal();
   for (int i = 0; i < total; i++)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if (OrderType() > OP_SELL) continue;
      if (StringFind(OrderComment(), BotComment) < 0) continue;
      AddKnown(OrderTicket());
      Log("Pre-existing trade seeded (not re-reported): ticket " + IntegerToString(OrderTicket()));
   }

   // Fire an immediate heartbeat so the account registers right away
   SendHeartbeat();
   g_lastHeartbeat = TimeCurrent();

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| EA de-initialisation                                             |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   Print("[AdaptiveEdgeBridge] Stopped. Reason code: ", reason);
}

//+------------------------------------------------------------------+
//| Main tick handler — called on every new price tick               |
//+------------------------------------------------------------------+
void OnTick()
{
   // 1. Detect newly opened ICT-BOT-V3 trades
   ScanOpenTrades();

   // 2. Detect trades that have been closed since last tick
   ScanClosedTrades();

   // 3. Periodic heartbeat
   if (TimeCurrent() - g_lastHeartbeat >= HeartbeatSecs)
   {
      SendHeartbeat();
      g_lastHeartbeat = TimeCurrent();

      // Guard: alert if daily loss limit is breached
      double balance  = AccountBalance();
      double dailyPnl = CalcDailyPnl();
      if (balance > 0 && (-dailyPnl / balance * 100.0) >= g_maxDailyLoss)
      {
         SendAlert("daily_limit",
            StringFormat("Daily loss limit of %.1f%% reached. Bot paused.", g_maxDailyLoss));
      }

      // Guard: alert if drawdown limit is breached
      double equity   = AccountEquity();
      double drawdown = (balance > 0) ? (balance - equity) / balance * 100.0 : 0;
      if (drawdown >= g_maxDrawdown)
      {
         SendAlert("drawdown",
            StringFormat("Max drawdown of %.1f%% reached (current: %.2f%%).", g_maxDrawdown, drawdown));
      }
   }
}

//+------------------------------------------------------------------+
//| Trade event handler — fires immediately when an order changes    |
//|  (MT4 build 600+)                                                |
//+------------------------------------------------------------------+
void OnTrade()
{
   ScanOpenTrades();
   ScanClosedTrades();
}
//+------------------------------------------------------------------+
