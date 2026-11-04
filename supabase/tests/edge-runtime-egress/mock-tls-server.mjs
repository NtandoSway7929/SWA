import fs from "node:fs";
import tls from "node:tls";

const server = tls.createServer(
  {
    key: fs.readFileSync("/certs/server.key"),
    cert: fs.readFileSync("/certs/server.crt"),
  },
  (socket) => {
    let request = "";
    socket.on("data", (chunk) => {
      request += chunk.toString("utf8");
      if (!request.includes("\r\n\r\n")) return;

      const requestLine = request.split("\r\n", 1)[0];
      const hostLine = request.split("\r\n").find((line) => /^host:/i.test(line)) ?? "";
      const hostHeader = hostLine.split(":", 2).slice(1).join(":").trim();
      const body = JSON.stringify({
        servername: socket.servername ?? null,
        requestLine,
        hostHeader,
      });
      socket.end(
        "HTTP/1.1 200 OK\r\n" +
        "Content-Type: application/json\r\n" +
        \`Content-Length: \${Buffer.byteLength(body)}\r\n\` +
        "Connection: close\r\n\r\n" +
        body,
      );
    });
  },
);

server.listen(8443, "0.0.0.0", () => {
  console.log("local mock TLS server listening on 8443");
});
