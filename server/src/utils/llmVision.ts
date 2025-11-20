import OpenAI from 'openai';
import config from '../config';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    if (!config.llm.apiKey) {
      throw new Error('LLM API Key not configured');
    }
    client = new OpenAI({
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseUrl
    });
  }
  return client;
}

export interface BPResult {
  systolic?: number;
  diastolic?: number;
  heartRate?: number;
}

export async function recognizeWithLLM(imageBuffer: Buffer): Promise<BPResult> {
  const client = getClient();
  const base64Image = imageBuffer.toString('base64');
  const dataUrl = `data:image/jpeg;base64,${base64Image}`;

  try {
    const response = await client.chat.completions.create({
      model: config.llm.model,
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant designed to read numbers from blood pressure monitor screens. 
          Output ONLY a JSON object with the following keys: "systolic" (high pressure), "diastolic" (low pressure), and "heartRate" (pulse). 
          If a value is not visible, omit the key. Do not output markdown code blocks, just the raw JSON string.`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Read the blood pressure numbers from this image." },
            {
              type: "image_url",
              image_url: {
                "url": dataUrl,
              },
            },
          ],
        },
      ],
      max_tokens: 300,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    // Clean up potential markdown formatting
    const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr);

  } catch (error) {
    console.error('LLM Vision Error:', error);
    throw error;
  }
}
