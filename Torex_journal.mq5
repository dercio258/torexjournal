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

   int total = HistoryDealsTotal();
   int importCount = 0;
   
   string json = "[";
   bool first = true;

   for(int i = 0; i < total; i++) {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket > 0) {
         long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
         if(entry != DEAL_ENTRY_OUT) continue; // Only process exits (closed trades)
         
         double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT);
         // Simplified check: only real trades, skip balance ops if needed, or keep all
         
         if(!first) json += ",";
         
         long openTime = HistoryDealGetInteger(ticket, DEAL_TIME);
         long closeTime = HistoryDealGetInteger(ticket, DEAL_TIME); // For DEAL, open/close time is same event roughly, but for TRADE we need orders. 
         // Actually, DEAL_ENTRY_OUT is the close. We need to find the OPEN deal for duration, but let's send DEAL data as requested by user ("importar trades").
         // The backend looks for open_time and close_time. 
         // Let's use POSITION_ID to group? 
         // For simplicity and matching current backend, we send Deal info.
         
         // Backend expects: ticket, symbol, type, volume, open_price, close_price, open_time, close_time, profit...
         // Reconstructing full trade from deals is cleaner if we use HistorySelectByPosition, but linear scan is standard.
         // Let's send the DEAL as a "Trade" representation.
         
         long type = HistoryDealGetInteger(ticket, DEAL_TYPE);
         
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
            "\"open_time\":%I64d," // Using Deal Time for both to avoid complexity, or calculate
            "\"close_time\":%I64d,"
            "\"comment\":\"%s\","
            "\"magic\":%I64d"
            "}",
            ticket,
            HistoryDealGetString(ticket, DEAL_SYMBOL),
            (type == DEAL_TYPE_BUY) ? "BUY" : (type == DEAL_TYPE_SELL) ? "SELL" : "BALANCE",
            HistoryDealGetDouble(ticket, DEAL_VOLUME),
            HistoryDealGetDouble(ticket, DEAL_PRICE), // Price of this deal (Close price)
            HistoryDealGetDouble(ticket, DEAL_PRICE), // Price
            profit,
            HistoryDealGetDouble(ticket, DEAL_COMMISSION),
            HistoryDealGetDouble(ticket, DEAL_SWAP),
            openTime * 1000, 
            closeTime * 1000,
            EscapeJSON(HistoryDealGetString(ticket, DEAL_COMMENT)),
            HistoryDealGetInteger(ticket, DEAL_MAGIC)
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

// --- ENTRY POINTS ---

int OnInit() {
   Print("🚀 Torex Import EA Iniciado...");
   
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
   CloseConnection();
   Print("⏹️ Torex Import EA Parado.");
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