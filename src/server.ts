import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 4173;
const page = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hanayorina</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf7f8;color:#352c34;font:16px system-ui,sans-serif}main{padding:2rem;text-align:center}h1{font-size:2.5rem;margin:0 0 .5rem}p{color:#746772}</style></head>
<body><main><h1>Hanayorina</h1><p>Проект запущен. Основа на TypeScript готова к развитию.</p></main></body></html>`;

const server = createServer((request, response) => {
  if (request.url !== "/" || (request.method !== "GET" && request.method !== "HEAD")) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(request.method === "HEAD" ? undefined : page);
});
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use. Close the other application and retry.` : error.message);
  process.exitCode = 1;
});
server.listen(port, host, () => console.log(`Hanayorina: http://${host}:${port}`));
