import express from "express";
import cors from "cors";
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import multer from "multer";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from 'dotenv';
dotenv.config();
const __filename = fileURLToPath(import.meta.url);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage() });
const history = {};
const userId = "default";
const token = process.env.API_KEY;
const model = "gpt-4o";
const client = ModelClient(
  "https://models.inference.ai.azure.com",
  new AzureKeyCredential(token)
);

//automatic prompt of img file//
async function analyzeImage(buffer, filename) {
  try {
    const base64Image = buffer.toString("base64");
    const mimeType =
      filename.endsWith(".jpg") || filename.endsWith(".jpeg")
        ? "image/jpeg"
        : "image/png";
    const response = await client.path("/chat/completions").post({
      body: {
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Describe this image (${filename}) in detail.` },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                },
              },
            ],
          },
        ],
      },
    });

    if (isUnexpected(response)) {
      console.error("Vision API response error:", response.body);
      throw new Error(response.body?.error?.message || "Unknown vision API error");
    }
    const content = response.body.choices?.[0]?.message?.content?.trim() || "";
    return content || `[No description returned for ${filename}]`;
  } catch (err) {
    console.error("Image analysis failed:", err);
    return `[Image analysis failed for ${filename}]`;
  }
}

app.post("/api/chat", upload.array("file"), async (req, res) => {
  const userMessage = req.body?.message || "";

  const files = req.files;
  const timestamp = new Date().toISOString();

  console.log('\n=== Chat Request ===');
  console.log(`Time: ${timestamp}`);
  console.log('User:', userMessage);

  if (!history[userId]) history[userId] = [
    { role: "system", content: "You are a helpful AI assistant." }
  ];

  let aiPrompt = userMessage;
  history[userId].push({ role: "user", content: aiPrompt });
  const includeServerFile = req.body?.includeServerFile === 'true' || req.body?.includeServerFile === '1';
  if (includeServerFile) {
    try {
      const serverFileContent = fs.readFileSync(__filename, 'utf8');
      console.log(`Including server file: ${__filename}`);
      console.log('Server file content (first 200 chars):', serverFileContent.slice(0, 200));
      aiPrompt += `\n\n[Server file: ${__filename}]\n${serverFileContent}`;
    } catch (readErr) {
      console.error('Failed to read server file:', readErr);
    }

  }

  if (files && files.length > 0) {

    const textFiles = [];
    const imageFiles = [];

    for (const file of files) {
      if (file.mimetype.startsWith('image/')) imageFiles.push(file);
      else textFiles.push(file);
    }


    const imageAnalyses = await Promise.all(
      imageFiles.map(async (file) => {
        const result = await analyzeImage(file.buffer, file.originalname);
        console.log(`Image analyzed: ${file.originalname}`);
        return `[Image file: ${file.originalname}]\n${result}`;
      })
    );


    if (imageAnalyses.length > 0) {
      const imgContent = imageAnalyses.join("\n\n");
      aiPrompt += "\n\n" + imgContent;
      history[userId].push({ role: "user", content: imgContent });
    }

    for (const file of textFiles) {
     const fileContent = file.buffer.toString("utf8");
        console.log("Text file content (first 200 chars):", fileContent.slice(0, 200));
        const textFileEntry = `[File uploaded: ${file.originalname}]\nContent:\n${fileContent}`;
        aiPrompt += "\n\n" + textFileEntry;
        history[userId].push({ role: "user", content: textFileEntry });
      }
  }

  const createfile = req.body?.createfile === 'true' || req.body?.createfile === '1';


  // Ai Reply Industry //
  try {
    const response = await client.path("/chat/completions").post({
      body: {
        messages: history[userId],
        model: model
      }
    });

    if (isUnexpected(response)) throw response.body.error;

    let aiReply = response.body.choices[0].message.content || "";

    history[userId].push({ role: "assistant", content: aiReply });

    aiReply = aiReply.replace(/mistral ai team/gi, "MaLan-Ai Team");
    const languageMap = [
      { regex: /(const|let|var|function|class|import|console\.log)/, label: "javascript" },
      { regex: /(<\!DOCTYPE html|<html|<head|<body)/, label: "html" },
      { regex: /(def |print\(|import |class )/, label: "python" },
      { regex: /(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)/i, label: "sql" },
    ];
    const isCodeLike = /[{}();=]|^\s{4,}/m.test(aiReply);
    if (!/```[\s\S]*?```/.test(aiReply) && isCodeLike) {
      let detected = false;
      for (let lang of languageMap) {
        if (lang.regex.test(aiReply)) {
          aiReply = lang.label + "\n" + aiReply + "\n";
          detected = true;
          break;
        }
      }
      if (!detected) aiReply = "\n" + aiReply + "\n";
    }

    aiReply = aiReply
      .split("\n")
      .map(line => line.length > 80 ? line.match(/.{1,80}(?:\s|$)/g).join("\n") : line)
      .join("\n");

    console.log('AI:', aiReply);
    if (createfile && aiReply) {
      const fileName = `Malan-Ai.txt`;
      fs.writeFileSync(fileName, aiReply, "utf8");
      console.log(`File created: ${fileName}`);

      return res.json({
        file: {
          name: fileName,
          url: `http://localhost:4200/download/${fileName}`,
        },
      });
    }

    res.json({ reply: aiReply });

  } catch (err) {
    console.error('\nError:', err);
    res.status(500).json({ error: "AI request failed" });
  }
});

app.get("/download/:filename", (req, res) => {
  const filePath = `./${req.params.filename}`;
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

export default app;