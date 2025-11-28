import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv, { configDotenv } from "dotenv";
import Groq from "groq-sdk";

configDotenv();

const __filename = fileURLToPath(import.meta.url);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage() });
const history = {};
const userId = "default";

const groq = new Groq({ apiKey: process.env.GROK_API_KEY });

// --- System prompt ---
const systemPrompt = `
You are an AI assistant for Malan-AI Chatbot.
Respond neatly and politely.
Do NOT use bold (**), markdown, or other formatting.
Always try to give the best answer.
`;

// --- Chat endpoint ---
app.post("/api/chat", upload.array("file"), async (req, res) => {
  const userMessage = req.body?.message || "";
  const files = req.files || [];
  const createfile = req.body?.createfile === "true" || req.body?.createfile === "1";
  const includeServerFile = req.body?.includeServerFile === "true" || req.body?.includeServerFile === "1";

  // 1️⃣ Initialize user history with system prompt if not already
  if (!history[userId]) {
    history[userId] = [{ role: "system", content: systemPrompt }];
  }

  // 2️⃣ Add user message to history
  history[userId].push({ role: "user", content: userMessage });

  // 3️⃣ Optionally include server source file
  if (includeServerFile) {
    try {
      const serverContent = fs.readFileSync(__filename, "utf8");
      const entry = `[Server file: ${__filename}]\n${serverContent}`;
      history[userId].push({ role: "user", content: entry });
    } catch (err) {
      console.error("Failed to read server file:", err);
    }
  }

  // 4️⃣ Handle uploaded files
  for (const file of files) {
    if (!file.mimetype.startsWith("image/")) {
      const content = file.buffer.toString("utf8");
      const entry = `[File uploaded: ${file.originalname}]\nContent:\n${content}`;
      history[userId].push({ role: "user", content: entry });
    }
  }

  // 5️⃣ Generate AI response
  try {
    const response = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: history[userId],
      max_tokens: 512,
      temperature: 0.7,
      top_p: 0.9,
    });

    const aiReply = response.choices?.[0]?.message?.content || "";
    history[userId].push({ role: "assistant", content: aiReply });

    // 6️⃣ Return reply as JSON or as a file if requested
    if (createfile && aiReply) {
      res.setHeader("Content-Disposition", `attachment; filename="Malan-Ai.txt"`);
      res.setHeader("Content-Type", "text/plain");
      return res.send(aiReply);
    }

    res.json({ reply: aiReply });

  } catch (err) {
    console.error("AI request failed:", err);
    res.status(500).json({ error: "AI request failed" });
  }
});

// --- Start server ---
export default app;