import { Pool } from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { format } from "path";

dotenv.config();

console.log("DATABASE_URL:", process.env.DATABASE_URL);

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

export async function searchDocumentation(
  prompt: string,
  chatbotID: string
): Promise<{ error: string } | { text: any }[]> {
  console.log("searchDocumentation called!");
  console.log("Prompt:", prompt);
  console.log("Chatbot ID:", chatbotID);
  try {
    // Initialize Google AI model
    const googleai = new GoogleGenerativeAI(process.env.API_KEY as string).getGenerativeModel({
      model: "text-embedding-004",
    });

    // Clean up the prompt
    prompt = prompt.replace(/\n/g, " ");
    
    const result = await googleai.embedContent(prompt);
    const embedding = result.embedding.values;
    console.log("Original embedding size:", embedding.length);
    console.log("Original embedding:", embedding);


    // Prepare query for cosine similarity search
    const query = `
    SELECT topic, text
    FROM "embeddings"
    WHERE "chatbotid" = $1
    ORDER BY embedding <=> '[${embedding}]'
    LIMIT 2;
  `;

  // console.log("Formatted embedding:", formattedEmbedding);


    const client = await pool.connect();


    if (!client) {
      throw new Error("Failed to connect to the database.");
    }
    console.log("Connected to database!");
    console.log("Query:", query);
    try {
      const res = await client.query(query, [chatbotID]);


      console.log("Query result:", res);
      if (res.rows.length === 0) {
        return { error: "No matching documentation found." };
      }

      const results = res.rows.map((row) => ({ text: row.text }));
      return results;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("An error occurred:", error);
    return { error: "An unexpected error occurred." };
  }
}
