const net = require("net");
const WebSocket = require("ws");

const LOCAL_PORT = 5001; // EA should connect here (127.0.0.1:5001)
const WS_URL = "ws://localhost:3000"; // Pointing to Local NestJS Backend

let ws;
let clients = new Set();

function connectWS() {
    console.log(`[bridge] Connecting to ${WS_URL}...`);
    ws = new WebSocket(WS_URL, {
        headers: { "x-bridge-token": "BRIDGE_SECRET_123" },
    });

    ws.on("open", () => console.log("[bridge] WS connected to Backend"));
    ws.on("close", () => {
        console.log("[bridge] WS disconnected, retrying in 2s...");
        setTimeout(connectWS, 2000);
    });
    ws.on("error", (e) => console.log("[bridge] WS error:", e.message));

    // Server → MT5 (Forwarding)
    ws.on("message", (data) => {
        for (const c of clients) {
            try { c.write(data); } catch (err) {
                console.error("Error writing to client:", err.message);
            }
        }
    });
}

connectWS();

// MT5 → Server (TCP Listener)
const tcpServer = net.createServer((socket) => {
    console.log("[bridge] MT5 Client connected via TCP");
    clients.add(socket);

    socket.on("data", (data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data); // Forward binary data as-is
        } else {
            console.warn("[bridge] WS not ready, dropping packet");
        }
    });

    socket.on("close", () => {
        console.log("[bridge] MT5 Client disconnected");
        clients.delete(socket);
    });

    socket.on("error", (err) => {
        console.error("[bridge] TCP Socket error:", err.message);
        clients.delete(socket);
    });
});

tcpServer.listen(LOCAL_PORT, "127.0.0.1", () => {
    console.log("[bridge] TCP Bridge listening on 127.0.0.1:" + LOCAL_PORT);
});
