import {WebSocket, WebSocketServer} from 'ws'
import {wsArcjet} from "../../arcjet.js";

function sendJson(socket, payload){
    if(socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify(payload));
}

function broadcast(wss, payload){
    for (const client of wss.clients) {
        if(client.readyState !== WebSocket.OPEN) continue;

        client.send(JSON.stringify(payload));
    }
}

function rejectUpgrade(socket, statusCode, statusText, reason) {
    socket.write(
        `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
        'Connection: close\r\n' +
        'Content-Type: text/plain\r\n' +
        `\r\n${reason}`
    );
    socket.destroy();
}

export function attachWebSocketServer(server) {
    const wss = new WebSocketServer({ noServer: true, path: '/ws', maxPayload: 1024 * 1024 });

    server.on('upgrade', async (req, socket, head) => {
        if (!wss.shouldHandle(req)) return;

        if (wsArcjet) {
            try {
                const decision = await wsArcjet.protect(req);

                if (decision.isDenied()) {
                    if (decision.reason.isRateLimit()) {
                        rejectUpgrade(socket, 429, 'Too Many Requests', 'Rate Limit exceeded');
                    } else {
                        rejectUpgrade(socket, 403, 'Forbidden', 'Access Denied');
                    }
                    return;
                }
            } catch (e) {
                console.error('WS connection error', e);
                socket.destroy();
                return;
            }
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    });

    wss.on('connection', (socket) => {
        socket.isAlive = true;
        socket.on('pong', () => {socket.isAlive = true; });

        sendJson(socket, { type: 'welcome' });

        socket.on('error', console.error);
    });

    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', () => clearInterval(interval));

    function broadcastMatchCreated(match) {
        broadcast(wss, {type: 'match_created', data: match});
    }
    return { broadcastMatchCreated }
}

