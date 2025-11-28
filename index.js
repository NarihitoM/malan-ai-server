import express from "express";
import cors from "cors";
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import multer from "multer";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage() });
const history = {};
const userId = "default";

const token = process.env.APIKEY;
const endpoint = "https://models.github.ai/inference"; 
const model = "openai/gpt-4o";
 const client = ModelClient(endpoint, new AzureKeyCredential(token));

 const aiabout = `You are an Ai that is implement for Malan-Ai Chatbot.
 Act like you are the Malan Ai And respond neat and tidely.
 Do Not Include ** and bold format.
 Respond to user with all your efforts with better reply.
 `
// --- Image analysis helper ---
async function analyzeImage(buffer, filename) {
  try {
    const base64Image = buffer.toString("base64");
    const mimeType = filename.endsWith(".jpg") || filename.endsWith(".jpeg") ? "image/jpeg" : "image/png";

    // Some Azure models may not support base64 data URLs; you may need hosted URLs
    const response = await client.path("/chat/completions").post({
      body: {
        model: model,
        messages: [
          {
            role: "system",
            content: aiabout,
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Describe this image (${filename}) in detail.` },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
            ]
          }
        ]
      }
    });

    if (isUnexpected(response)) {
      console.error("Vision API error:", response.body);
      return `[Image analysis failed for ${filename}]`;
    }

    return response.body.choices?.[0]?.message?.content?.trim() || `[No description returned for ${filename}]`;
  } catch (err) {
    console.error("Image analysis exception:", err);
    return `[Image analysis failed for ${filename}]`;
  }
}

// --- Chat endpoint ---
app.post("/api/chat", upload.array("file"), async (req, res) => {
  const userMessage = req.body?.message || "";
  const files = req.files || [];
  const createfile = req.body?.createfile === 'true' || req.body?.createfile === '1';
  const includeServerFile = req.body?.includeServerFile === 'true' || req.body?.includeServerFile === '1';

  if (!history[userId]) history[userId] = [{ role: "system", content: "You are a helpful AI assistant." }];

  let aiPrompt = userMessage;
  history[userId].push({ role: "user", content: aiPrompt });

  // Optionally include server source file
  if (includeServerFile) {
    try {
      const serverContent = fs.readFileSync(__filename, 'utf8');
      aiPrompt += `\n\n[Server file: ${__filename}]\n${serverContent}`;
      history[userId].push({ role: "user", content: "[Server file included]" });
    } catch (err) {
      console.error("Failed to read server file:", err);
    }
  }

  // --- Handle uploaded files ---
  if (files.length > 0) {
    const textFiles = [];
    const imageFiles = [];

    for (const file of files) {
      if (file.mimetype.startsWith('image/')) imageFiles.push(file);
      else textFiles.push(file);
    }

    // Image analysis
    if (imageFiles.length > 0) {
      const imageAnalyses = await Promise.all(
        imageFiles.map(async file => {
          const result = await analyzeImage(file.buffer, file.originalname);
          console.log(`Image analyzed: ${file.originalname}`);
          return `[Image file: ${file.originalname}]\n${result}`;
        })
      );
      const imgContent = imageAnalyses.join("\n\n");
      aiPrompt += "\n\n" + imgContent;
      history[userId].push({ role: "user", content: imgContent });
    }

    // Text files
    for (const file of textFiles) {
      const content = file.buffer.toString("utf8");
      const entry = `[File uploaded: ${file.originalname}]\nContent:\n${content}`;
      aiPrompt += "\n\n" + entry;
      history[userId].push({ role: "user", content: entry });
    }
  }

  // --- Generate AI response ---
  try {
    console.log("Sending prompt to AI:", aiPrompt.substring(0, 200) + (aiPrompt.length > 200 ? "..." : ""));

    const response = await client.path("/chat/completions").post({
      body: {
        model: model,
        messages: history[userId],
        max_tokens: 512,
        temperature: 0.7,
        top_p: 0.9,
      }
    });

    if (isUnexpected(response)) {
      console.error("AI completion unexpected:", response.body);
      return res.status(500).json({ error: "AI request failed (unexpected response)" });
    }

    let aiReply = response.body.choices?.[0]?.message?.content || "";
    history[userId].push({ role: "assistant", content: aiReply });

    // Auto-format code
    const languageMap = [
      { regex: /(const|let|var|function|class|import|console\.log)/, label: "javascript" },
      { regex: /(<\!DOCTYPE html|<html|<head|<body)/, label: "html" },
      { regex: /(def |print\(|import |class )/, label: "python" },
      { regex: /(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)/i, label: "sql" },
    ];
    const isCodeLike = /[{}();=]|^\s{4,}/m.test(aiReply);
    if (!/```[\s\S]*?```/.test(aiReply) && isCodeLike) {
      let detected = false;
      for (const lang of languageMap) {
        if (lang.regex.test(aiReply)) {
          aiReply = lang.label + "\n" + aiReply + "\n";
          detected = true;
          break;
        }
      }
      if (!detected) aiReply = "\n" + aiReply + "\n";
    }

    // Line wrap
    aiReply = aiReply
      .split("\n")
      .map(line => line.length > 80 ? line.match(/.{1,80}(?:\s|$)/g).join("\n") : line)
      .join("\n");

    console.log("AI Reply:", aiReply.substring(0, 200) + (aiReply.length > 200 ? "..." : ""));

    if (createfile && aiReply) {
      res.setHeader("Content-Disposition", `attachment; filename="Malan-Ai.txt"`);
      res.setHeader("Content-Type", "text/plain");
      return res.send(aiReply);
    }

    res.json({ reply: aiReply });

  } catch (err) {
    console.error("AI request failed exception:", err);
    res.status(500).json({ error: "AI request failed (exception)" });
  }
});


app.listen(5433);