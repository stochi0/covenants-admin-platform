import fs from "node:fs";
import path from "node:path";
import express from "express";

import { app } from "./app.js";
const port = Number(process.env.PORT ?? 8787);

const clientDir = path.resolve(process.cwd(), "dist/client");

if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
