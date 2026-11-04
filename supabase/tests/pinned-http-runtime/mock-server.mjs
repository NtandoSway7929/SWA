import fs from "node:fs";
import tls from "node:tls";

const server = tls.createServer({
  key: fs.readFileSync("/certs/server.key"),
  cert: fs.readFileSync("/certs/server.crt"),
}, (socket) => {
  let request = "";
  socket.on("data", (chunk) => {
    request += chunk.toString("utf8");
    if (!request.includes("\r\n\r\n")) return;

    const lines = request.split("\r\n");
    const [method, path] = lines[0].split(" ");
    const header = (name) => {
      const line = lines.find((item) => item.toLowerCase().startsWith(name.toLowerCase() + ":"));
      return line ? line.slice(name.length + 1).trim() : "";
    };
    const body = JSON.stringify({
      servername: socket.servername ?? null,
      method,
      path,
      hostHeader: header("Host"),
      acceptEncoding: header("Accept-Encoding"),
    });

    socket.end(
      "HTTP/1.1 200 OK\r\n" +
      "Content-Type: application/json\r\n" +
      "Content-Length: " + Buffer.byteLength(body) + "\r\n" +
      "Connection: close\r\n\r\n" +
      body,
    );
  });
});
server.listen(443, "0.0.0.0", () => console.log("pinned HTTP mock TLS server listening on 443"));
