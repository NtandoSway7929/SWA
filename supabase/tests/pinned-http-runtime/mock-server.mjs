import fs from "node:fs";
import tls from "node:tls";

const server = tls.createServer({
  key: fs.readFileSync("/certs/server.key"),
  cert: fs.readFileSync("/certs/server.crt"),
}, (socket) => {
  let request = "";
  let replied = false;

  socket.on("data", (chunk) => {
    if (replied) return;
    request += chunk.toString("utf8");
    if (!request.includes("\r\n\r\n")) return;
    replied = true;

    const lines = request.split("\r\n");
    const [method, path] = lines[0].split(" ");
    const header = (name) => {
      const line = lines.find((item) => item.toLowerCase().startsWith(name.toLowerCase() + ":"));
      return line ? line.slice(name.length + 1).trim() : "";
    };
    const url = new URL(path, "https://municipaldata.treasury.gov.za");
    const observation = {
      servername: socket.servername ?? null,
      method,
      path,
      hostHeader: header("Host"),
      acceptEncoding: header("Accept-Encoding"),
    };

    let payload;
    if (url.pathname.endsWith("/members/demarcation")) {
      payload = {
        status: "ok",
        total_member_count: 1,
        data: [{ "demarcation.code": "JHB" }],
      };
    } else if (url.pathname.endsWith("/members/amount_type")) {
      payload = {
        status: "ok",
        total_member_count: 1,
        data: [{ "amount_type.code": "ACT" }],
      };
    } else if (url.pathname.endsWith("/members/item")) {
      payload = {
        status: "ok",
        total_member_count: 1,
        data: [{ "item.code": "0200" }],
      };
    } else if (url.pathname === "/api/cubes/incexp_v2/facts") {
      payload = {
        status: "ok",
        page: 1,
        page_size: 25,
        total_fact_count: 1,
        fields: ["amount"],
        data: [{
          amount: 1250,
          transport_probe: observation,
        }],
      };
    } else {
      payload = { status: "error", message: "Unexpected mock route" };
    }

    const body = JSON.stringify(payload);
    socket.end(
      "HTTP/1.1 200 OK\r\n" +
      "Content-Type: application/json\r\n" +
      "Content-Length: " + Buffer.byteLength(body) + "\r\n" +
      "Connection: close\r\n\r\n" +
      body,
    );
  });
});
server.listen(443, "0.0.0.0", () => console.log("pinned HTTP adapter mock TLS server listening on 443"));
