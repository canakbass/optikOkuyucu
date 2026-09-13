const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  try {
    const imagePath = '/home/can/.gemini/antigravity/brain/e1d32d2e-5782-49bc-a8fc-33a279e0f3eb/.user_uploaded/media_1789291530115.jpg';
    const imageB64 = fs.readFileSync(imagePath, { encoding: 'base64' });

    const prompt = `
    Analyze this OMR sheet. 
    Find the main grids containing the answer bubbles.
    Return a JSON array where each object has:
    - categoryName: The name of the category (e.g. "GENEL YETENEK")
    - numQuestions: Total questions in this grid (e.g. 60)
    - numOptions: Options per question (e.g. 5 for A,B,C,D,E)
    - boundingBox: [ymin, xmin, ymax, xmax] coordinates normalized to 0-1000 for the grid of bubbles.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: imageB64 } }
          ]
        }
      ],
      config: { responseMimeType: 'application/json' }
    });

    console.log(response.text);
  } catch (e) {
    console.error(e);
  }
}
run();
