import express from "express";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/api/hello", (_req, res) => res.json({ hello: "world" }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API listening on http://0.0.0.0:${PORT}`);
});