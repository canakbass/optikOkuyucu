import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function list() {
  try {
    const models = await ai.models.list();
    for (const m of models) {
      if (m.name.includes('flash') || m.name.includes('gemini-3') || m.name.includes('gemini-4')) {
        console.log(m.name);
      }
    }
  } catch (e) { console.error(e); }
}
list();
