//+------------------------------------------------------------------+
//|                                            TorexCalendarSync.mq5 |
//|                                    Copyright 2026, Cossa Trading |
//|     Headless EA for automated MT5 Economic Calendar JSON export  |
//+------------------------------------------------------------------+
#property copyright "Cossa Trading Corp"
#property version   "1.00"
#property strict

input int DaysBack           = 7;    // Dias anteriores para histórico
input int DaysForward        = 14;   // Dias futuros para agenda
input int RefreshIntervalSec = 300;  // Intervalo regular de atualização (segundos)
input int MaxEventsExport    = 2500; // Limite máximo de segurança por exportação

bool InitialExportDone = false;
int  CurrentTimerSec   = 0;

string EscapeJSON(string s) {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\n", "\\n");
   StringReplace(s, "\r", "\\r");
   StringReplace(s, "\t", "\\t");
   return s;
}

string MapSectorToCategory(const MqlCalendarEvent &evt) {
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

bool WriteJsonFileAtomic(const string targetName, const string &payload, int extraFlags) {
   string tmpName = targetName + ".tmp";
   int handle = FileOpen(tmpName, FILE_WRITE | FILE_TXT | FILE_ANSI | extraFlags, '\t', CP_UTF8);
   if(handle == INVALID_HANDLE) {
      Print("❌ Falha ao abrir arquivo temporário (", tmpName, ", flags=", extraFlags, "): ", GetLastError());
      return false;
   }
   uint written = FileWriteString(handle, payload);
   FileClose(handle);
   if(written == 0 && StringLen(payload) > 0) {
      Print("❌ Falha ao escrever JSON no arquivo ", tmpName);
      return false;
   }
   if(!FileMove(tmpName, extraFlags, targetName, extraFlags | FILE_REWRITE)) {
      Print("❌ Falha ao mover arquivo atômico para ", targetName, ": ", GetLastError());
      return false;
   }
   return true;
}

int ExportCalendarJson() {
   datetime nowSrv = TimeTradeServer();
   if(nowSrv <= 0) nowSrv = TimeCurrent();
   datetime nowGmt = TimeGMT();
   if(nowSrv <= 0) nowSrv = nowGmt;
   long serverOffsetSec = (nowSrv > 0 && nowGmt > 0)
      ? (long)(MathRound((double)(nowSrv - nowGmt) / 60.0) * 60.0)
      : 0;

   MqlCalendarValue values[];
   datetime fromDate = nowSrv - DaysBack * 86400;
   datetime toDate   = nowSrv + DaysForward * 86400;

   ResetLastError();
   if(!CalendarValueHistory(values, fromDate, toDate)) {
      int err = GetLastError();
      Print("⚠️ CalendarValueHistory indisponível no momento (err=", err, ")");
      return -1;
   }

   int total = ArraySize(values);
   if(total <= 0) {
      Print("⚠️ CalendarValueHistory retornou 0 eventos para o período.");
      return 0;
   }

   string json = "[";
   bool first = true;
   int exported = 0;

   for(int i = 0; i < total && exported < MaxEventsExport; i++) {
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

      string category = MapSectorToCategory(evt);
      string unitStr  = FormatCalendarUnit(evt);
      long eventUtcMs = ((long)values[i].time - serverOffsetSec) * 1000;

      if(!first) json += ",";
      json += StringFormat(
         "{\"externalId\":\"%I64u\",\"title\":\"%s\",\"currency\":\"%s\",\"country\":\"%s\",\"eventDate\":%I64d,\"impact\":\"%s\",\"category\":\"%s\",\"unit\":\"%s\",\"actual\":\"%s\",\"forecast\":\"%s\",\"previous\":\"%s\"}",
         values[i].id,
         EscapeJSON(evt.name),
         EscapeJSON(country.currency),
         EscapeJSON(country.name),
         eventUtcMs,
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

   bool okLocal  = WriteJsonFileAtomic("torex_economic_calendar.json", json, 0);
   bool okCommon = WriteJsonFileAtomic("torex_economic_calendar.json", json, FILE_COMMON);

   if(okLocal || okCommon) {
      PrintFormat("📅 TorexCalendarSync: %d/%d eventos exportados (local=%s, common=%s)",
         exported, total, okLocal ? "OK" : "ERR", okCommon ? "OK" : "ERR");
   }
   return exported;
}

void EnsureTimer(int seconds) {
   if(CurrentTimerSec == seconds) return;
   EventKillTimer();
   if(EventSetTimer(seconds)) {
      CurrentTimerSec = seconds;
   }
}

int OnInit() {
   Print("🚀 TorexCalendarSync EA Iniciado (headless calendar exporter)...");
   int count = ExportCalendarJson();
   if(count > 0) {
      InitialExportDone = true;
      EnsureTimer(MathMax(60, RefreshIntervalSec));
   } else {
      InitialExportDone = false;
      EnsureTimer(15); // Aguarda download inicial do calendário pelo terminal MT5
   }
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {
   EventKillTimer();
   CurrentTimerSec = 0;
   Print("⏹️ TorexCalendarSync EA Parado.");
}

void OnTimer() {
   int count = ExportCalendarJson();
   if(count > 0 && !InitialExportDone) {
      InitialExportDone = true;
      EnsureTimer(MathMax(60, RefreshIntervalSec));
   }
}

void OnTick() {
   // Não depende de ticks; sincronização controlada via OnTimer().
}
//+------------------------------------------------------------------+
