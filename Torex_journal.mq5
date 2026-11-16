//+------------------------------------------------------------------+
//|                                                Torex_journal.mq5 |
//|                                    Copyright 2026, Cossa Trading |
//+------------------------------------------------------------------+
#property copyright "Cossa Trading Corp"
#property version   "1.00"
#property strict

// --- INPUTS ---
input string HostIP = "127.0.0.1"; // IP do Bridge / NestJS
input int    HostPort = 3001;      // Porta TCP
input string AppToken = "YOUR_TOKEN_HERE"; // Token de Autenticação
input datetime StartDate = 0;      // Importar trades a partir de (0 = Tudo)

// --- CONSTANTS ---
#define ID_AUTH_REQUEST    1
#define ID_AUTH_RESPONSE   2
#define ID_TRADE_DATA      4
#define ID_ERROR_RESPONSE  5

int Socket = INVALID_HANDLE;
bool Authenticated = false;
bool HistorySent = false;

// --- HELPER CLASSES ---
class ProtoBuilder {
private:
   uchar buffer[];
public:
   void Clear() { ArrayResize(buffer, 0); }

   void AddByte(uchar b) {
      int size = ArraySize(buffer);
      ArrayResize(buffer, size + 1);
      buffer[size] = b;
   }

   void Append(const uchar &data[]) {
      int old = ArraySize(buffer);
      int add = ArraySize(data);
      if(add <= 0) return;
      ArrayResize(buffer, old + add);
      for(int i=0;i<add;i++) buffer[old + i] = data[i];
   }

   void WriteVarInt(ulong value) {
      while(true) {
         if((value & ~0x7F) == 0) { AddByte((uchar)value); return; }
         AddByte((uchar)((value & 0x7F) | 0x80));
         value >>= 7;
      }
   }

   void WriteString(int fieldNumber, string value) {
      WriteVarInt((ulong)((fieldNumber << 3) | 2));
      uchar strBytes[];
      int n = StringToCharArray(value, strBytes, 0, WHOLE_ARRAY, CP_UTF8);
      if(n > 0 && strBytes[n-1] == 0) ArrayResize(strBytes, n-1);
      WriteVarInt((ulong)ArraySize(strBytes));
      Append(strBytes);
   }

   void CopyTo(uchar &out[]) {
      int n = ArraySize(buffer);
      ArrayResize(out, n);
      for(int i=0;i<n;i++) out[i] = buffer[i];
   }
};

string EscapeJSON(string s) {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\n", "\\n");
   StringReplace(s, "\r", "\\r");
   StringReplace(s, "\t", "\\t");
   return s;
}

// --- NETWORK ---
void CloseConnection() {
   if(Socket != INVALID_HANDLE) {
      SocketClose(Socket);
      Socket = INVALID_HANDLE;
   }
   Authenticated = false;
}

void SendPacket(int msgId, uchar &payload[]) {
   if(Socket == INVALID_HANDLE) return;
   
   int size = ArraySize(payload);
   uchar header[5];
   header[0] = (uchar)msgId;
   header[1] = (uchar)(size & 0xFF);
   header[2] = (uchar)((size >> 8) & 0xFF);
   header[3] = (uchar)((size >> 16) & 0xFF);
   header[4] = (uchar)((size >> 24) & 0xFF);
   
   if(SocketSend(Socket, header, 5) != 5) {
      Print("❌ Falha ao enviar Header");
      CloseConnection();
      return;
   }
   
   if(size > 0) {
      if(SocketSend(Socket, payload, size) != size) {
         Print("❌ Falha ao enviar Payload");
         CloseConnection();
         return;
      }
   }
}

void SendAuth() {
   Print("🔒 Autenticando com token...");
   ProtoBuilder pb;
   pb.WriteString(1, AppToken);
   uchar payload[];
   pb.CopyTo(payload);
   SendPacket(ID_AUTH_REQUEST, payload);
}

void SendHistory() {
   if(!Authenticated) return;
   if(HistorySent) return;

   Print("📥 Preparando histórico de trades...");
   
   // Select History
   if(!HistorySelect(StartDate, TimeCurrent())) {
      Print("❌ Falha no HistorySelect: ", GetLastError());
      return;
   }

   long serverOffsetSec = (long)(TimeCurrent() - TimeGMT());
   int total = HistoryDealsTotal();
   int importCount = 0;

   string json = "[";
   bool first = true;

   ulong outTickets[];
   for(int i = 0; i < total; i++) {
      ulong tk = HistoryDealGetTicket(i);
      if(tk > 0) {
         long entry = HistoryDealGetInteger(tk, DEAL_ENTRY);
         long dType = HistoryDealGetInteger(tk, DEAL_TYPE);
         if((entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_INOUT || entry == DEAL_ENTRY_OUT_BY) &&
            (dType == DEAL_TYPE_BUY || dType == DEAL_TYPE_SELL)) {
            int sz = ArraySize(outTickets);
            ArrayResize(outTickets, sz + 1);
            outTickets[sz] = tk;
         }
      }
   }

   int outCount = ArraySize(outTickets);
   for(int idx = 0; idx < outCount; idx++) {
      HistorySelect(StartDate, TimeCurrent() + 86400);
      ulong ticket = outTickets[idx];
      if(ticket > 0) {
         double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT);
         double closePrice = HistoryDealGetDouble(ticket, DEAL_PRICE);
         double openPrice = closePrice;
         long closeTimeSrv = HistoryDealGetInteger(ticket, DEAL_TIME);
         long openTimeSrv = closeTimeSrv;
         long dealType = HistoryDealGetInteger(ticket, DEAL_TYPE);
         string tradeDir = (dealType == DEAL_TYPE_SELL) ? "BUY" : "SELL";
         double totalComm = HistoryDealGetDouble(ticket, DEAL_COMMISSION) + HistoryDealGetDouble(ticket, DEAL_FEE);
         double swapVal = HistoryDealGetDouble(ticket, DEAL_SWAP);
         long posId = HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
         string sym = HistoryDealGetString(ticket, DEAL_SYMBOL);
         double vol = HistoryDealGetDouble(ticket, DEAL_VOLUME);
         string commStr = EscapeJSON(HistoryDealGetString(ticket, DEAL_COMMENT));
         long magicNum = HistoryDealGetInteger(ticket, DEAL_MAGIC);

         if(posId > 0 && HistorySelectByPosition(posId)) {
            int pTotal = HistoryDealsTotal();
            for(int p = 0; p < pTotal; p++) {
               ulong inTk = HistoryDealGetTicket(p);
               if(inTk > 0 && HistoryDealGetInteger(inTk, DEAL_ENTRY) == DEAL_ENTRY_IN) {
                  openPrice = HistoryDealGetDouble(inTk, DEAL_PRICE);
                  openTimeSrv = HistoryDealGetInteger(inTk, DEAL_TIME);
                  long inType = HistoryDealGetInteger(inTk, DEAL_TYPE);
                  tradeDir = (inType == DEAL_TYPE_BUY) ? "BUY" : "SELL";
                  totalComm += HistoryDealGetDouble(inTk, DEAL_COMMISSION) + HistoryDealGetDouble(inTk, DEAL_FEE);
                  break;
               }
            }
         }

         long openTimeUtcMs = (openTimeSrv - serverOffsetSec) * 1000;
         long closeTimeUtcMs = (closeTimeSrv - serverOffsetSec) * 1000;

         if(!first) json += ",";

         json += StringFormat(
            "{"
            "\"ticket\":%I64d,"
            "\"symbol\":\"%s\","
            "\"type\":\"%s\","
            "\"volume\":%.2f,"
            "\"open_price\":%.5f,"
            "\"close_price\":%.5f,"
            "\"profit\":%.2f,"
            "\"commission\":%.2f,"
            "\"swap\":%.2f,"
            "\"open_time\":%I64d,"
            "\"close_time\":%I64d,"
            "\"comment\":\"%s\","
            "\"magic\":%I64d"
            "}",
            posId > 0 ? posId : (long)ticket,
            sym,
            tradeDir,
            vol,
            openPrice,
            closePrice,
            profit,
            totalComm,
            swapVal,
            openTimeUtcMs,
            closeTimeUtcMs,
            commStr,
            magicNum
         );

         first = false;
         importCount++;
      }
   }
   json += "]";
   
   if(importCount > 0) {
      PrintFormat("📤 Enviando %d trades para o servidor...", importCount);
      
      ProtoBuilder pb;
      pb.WriteString(1, json); // Field 1: JSON Array
      
      uchar payload[];
      pb.CopyTo(payload);
      SendPacket(ID_TRADE_DATA, payload); // ID 4 for Trade Data
      
      Print("✅ Dados enviados com sucesso!");
   } else {
      Print("⚠️ Nenhum trade encontrado para importar.");
   }
   
   HistorySent = true;
}

string MapCalendarCategory(const MqlCalendarEvent &evt) {
   if(evt.type == CALENDAR_TYPE_HOLIDAY || evt.sector == CALENDAR_SECTOR_HOLIDAYS)
      return "HOLIDAY";
   switch(evt.sector) {
      case CALENDAR_SECTOR_JOBS:       return "EMPLOYMENT";
      case CALENDAR_SECTOR_PRICES:     return "INFLATION";
      case CALENDAR_SECTOR_MONEY:      return "INTEREST_RATE";
      case CALENDAR_SECTOR_GDP:        return "GDP";
      case CALENDAR_SECTOR_BUSINESS:   return "MANUFACTURING";
      case CALENDAR_SECTOR_CONSUMER:   return "CONSUMER";
      case CALENDAR_SECTOR_HOUSING:    return "HOUSING";
      case CALENDAR_SECTOR_TRADE:      return "TRADE";
      case CALENDAR_SECTOR_GOVERNMENT:
      case CALENDAR_SECTOR_TAXES:      return "GOVERNMENT";
      case CALENDAR_SECTOR_MARKET:     return "CENTRAL_BANK";
      default:                         return "OTHER";
   }
}

string FormatCalendarUnit(const MqlCalendarEvent &evt) {
   string mult = "";
   switch(evt.multiplier) {
      case CALENDAR_MULTIPLIER_THOUSANDS: mult = "K"; break;
      case CALENDAR_MULTIPLIER_MILLIONS:  mult = "M"; break;
      case CALENDAR_MULTIPLIER_BILLIONS:  mult = "B"; break;
      case CALENDAR_MULTIPLIER_TRILLIONS: mult = "T"; break;
      default: break;
   }
   string unitPart = "";
   switch(evt.unit) {
      case CALENDAR_UNIT_PERCENT: unitPart = "%"; break;
      case CALENDAR_UNIT_USD:     unitPart = "$"; break;
      case CALENDAR_UNIT_BARREL:  unitPart = "bbl"; break;
      default: break;
   }
   if(mult != "" && unitPart != "") return mult + " " + unitPart;
   if(mult != "") return mult;
   return unitPart;
}

bool WriteCalendarJsonAtomic(const string targetName, const string &payload, int extraFlags) {
   string tmpName = targetName + ".tmp";
   int handle = FileOpen(tmpName, FILE_WRITE | FILE_TXT | FILE_ANSI | extraFlags, '\t', CP_UTF8);
   if(handle == INVALID_HANDLE) return false;
   FileWriteString(handle, payload);
   FileClose(handle);
   return FileMove(tmpName, extraFlags, targetName, extraFlags | FILE_REWRITE);
}

void ExportEconomicCalendarToFile() {
   datetime nowSrv = TimeTradeServer();
   if(nowSrv <= 0) nowSrv = TimeCurrent();
   datetime nowGmt = TimeGMT();
   if(nowSrv <= 0) nowSrv = nowGmt;
   long serverOffsetSec = (nowSrv > 0 && nowGmt > 0)
      ? (long)(MathRound((double)(nowSrv - nowGmt) / 60.0) * 60.0)
      : 0;

   MqlCalendarValue values[];
   datetime fromDate = nowSrv - 7 * 86400;
   datetime toDate   = nowSrv + 14 * 86400;
   if(!CalendarValueHistory(values, fromDate, toDate)) return;

   int total = ArraySize(values);
   if(total <= 0) return;

   string json = "[";
   bool first = true;
   int exported = 0;

   for(int i = 0; i < total && exported < 2500; i++) {
      MqlCalendarEvent evt;
      MqlCalendarCountry country;
      if(!CalendarEventById(values[i].event_id, evt)) continue;
      if(!CalendarCountryById(evt.country_id, country)) continue;

      bool isHoliday = (evt.type == CALENDAR_TYPE_HOLIDAY || evt.sector == CALENDAR_SECTOR_HOLIDAYS);
      if(evt.importance == CALENDAR_IMPORTANCE_NONE && !isHoliday) continue;

      string impact = "MEDIUM";
      if(evt.importance == CALENDAR_IMPORTANCE_HIGH) impact = "HIGH";
      else if(evt.importance == CALENDAR_IMPORTANCE_LOW || evt.importance == CALENDAR_IMPORTANCE_NONE) impact = "LOW";

      int digits = (int)MathMin(MathMax((int)evt.digits, 0), 4);
      string actualStr   = values[i].HasActualValue()   ? DoubleToString(values[i].GetActualValue(), digits)   : "";
      string forecastStr = values[i].HasForecastValue() ? DoubleToString(values[i].GetForecastValue(), digits) : "";
      string prevStr     = values[i].HasPreviousValue() ? DoubleToString(values[i].GetPreviousValue(), digits) : "";
      string category    = MapCalendarCategory(evt);
      string unitStr     = FormatCalendarUnit(evt);

      if(!first) json += ",";
      json += StringFormat(
         "{\"externalId\":\"%I64u\",\"title\":\"%s\",\"currency\":\"%s\",\"country\":\"%s\",\"eventDate\":%I64d,\"impact\":\"%s\",\"category\":\"%s\",\"unit\":\"%s\",\"actual\":\"%s\",\"forecast\":\"%s\",\"previous\":\"%s\"}",
         values[i].id,
         EscapeJSON(evt.name),
         EscapeJSON(country.currency),
         EscapeJSON(country.name),
         ((long)values[i].time - serverOffsetSec) * 1000,
         impact,
         category,
         EscapeJSON(unitStr),
         actualStr,
         forecastStr,
         prevStr
      );
      first = false;
      exported++;
   }
   json += "]";

   bool okLocal  = WriteCalendarJsonAtomic("torex_economic_calendar.json", json, 0);
   bool okCommon = WriteCalendarJsonAtomic("torex_economic_calendar.json", json, FILE_COMMON);
   if(okLocal || okCommon) {
      PrintFormat("📅 Calendário Econômico MT5 exportado (%d eventos, local=%s, common=%s)", exported, okLocal ? "OK" : "ERR", okCommon ? "OK" : "ERR");
   }
}

// --- ENTRY POINTS ---

int OnInit() {
   Print("🚀 Torex Import EA Iniciado...");
   ExportEconomicCalendarToFile();
   EventSetTimer(600); // Atualiza e exporta novas notícias do Calendário Econômico a cada 10 minutos (600s)
   
   Socket = SocketCreate();
   if(Socket == INVALID_HANDLE) {
      Print("❌ Falha ao criar Socket: ", GetLastError());
      return INIT_FAILED;
   }
   
   if(!SocketConnect(Socket, HostIP, HostPort, 3000)) {
      Print("❌ Falha ao conectar em ", HostIP, ":", HostPort);
      Print("   Verifique se o backend está rodando e se URLs estão permitidas em Tools > Options > Expert Advisors");
      return INIT_FAILED;
   }
   
   Print("✅ Conectado ao servidor TCP. Autenticando...");
   SendAuth();
   
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {
   EventKillTimer();
   CloseConnection();
   Print("⏹️ Torex Import EA Parado.");
}

void OnTimer() {
   ExportEconomicCalendarToFile();
}

void OnTick() {
   if(Socket == INVALID_HANDLE) return;
   
   // Check for data
   uint readable = SocketIsReadable(Socket);
   if(readable > 0) {
      uchar buffer[];
      int received = SocketRead(Socket, buffer, readable, 0);
      if(received > 0) {
         int msgId = buffer[0];
         
         if(msgId == ID_AUTH_RESPONSE) {
            Authenticated = true;
            Print("🔓 Autenticação realizada com sucesso!");
            SendHistory();
         } 
         else if(msgId == ID_ERROR_RESPONSE) {
            string errorInfo = "Erro Desconhecido";
            if(received > 5) errorInfo = CharArrayToString(buffer, 5, WHOLE_ARRAY, CP_UTF8);
            Print("⛔ Erro do Servidor: ", errorInfo);
            ExpertRemove();
         }
      }
   }
   
   // Keep alive if needed, but for import usually one-off is enough. 
   // We will keep running to allow user to see logs, but won't spam.
}