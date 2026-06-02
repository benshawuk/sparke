// Minimal RFC6455 WebSocket client over a raw TCP socket, so we can set the
// Origin header that Chrome's DevTools endpoint requires. Text frames only,
// which is all CDP uses. No dependencies.
import net from "node:net";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

export function connect(wsUrl) {
  const u = new URL(wsUrl);
  const emitter = new EventEmitter();
  const key = crypto.randomBytes(16).toString("base64");
  const sock = net.connect(Number(u.port), u.hostname);

  let handshakeDone = false;
  let buf = Buffer.alloc(0);

  sock.on("connect", () => {
    const path = u.pathname + (u.search || "");
    sock.write(
      `GET ${path} HTTP/1.1\r\n` +
        `Host: ${u.host}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `Origin: http://${u.host}\r\n\r\n`
    );
  });

  sock.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!handshakeDone) {
      const idx = buf.indexOf("\r\n\r\n");
      if (idx === -1) return;
      const header = buf.slice(0, idx).toString();
      if (process.env.WSDEBUG) console.error("HANDSHAKE:\n" + header);
      if (!/^HTTP\/1\.1 101/.test(header)) {
        emitter.emit("error", new Error("handshake failed: " + header.split("\r\n")[0]));
        sock.end();
        return;
      }
      buf = buf.slice(idx + 4);
      handshakeDone = true;
      emitter.emit("open");
    }
    // Parse frames.
    for (;;) {
      if (buf.length < 2) break;
      const b0 = buf[0];
      const b1 = buf[1];
      const opcode = b0 & 0x0f;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) break;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) break;
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      if (buf.length < offset + len) break;
      const payload = buf.slice(offset, offset + len);
      buf = buf.slice(offset + len);
      if (opcode === 0x8) {
        emitter.emit("close");
        sock.end();
        return;
      }
      if (opcode === 0x1 || opcode === 0x0) emitter.emit("message", payload.toString("utf8"));
    }
  });

  sock.on("error", (e) => emitter.emit("error", e));
  // Always keep a default error listener so a socket reset never crashes the
  // process via an unhandled 'error' event.
  emitter.on("error", () => {});
  sock.on("close", () => emitter.emit("close"));

  emitter.send = (text) => {
    const data = Buffer.from(text, "utf8");
    const mask = crypto.randomBytes(4);
    let header;
    if (data.length < 126) {
      header = Buffer.from([0x81, 0x80 | data.length]);
    } else if (data.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(data.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(data.length), 2);
    }
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    sock.write(Buffer.concat([header, mask, masked]));
  };
  emitter.close = () => sock.end();
  return emitter;
}
