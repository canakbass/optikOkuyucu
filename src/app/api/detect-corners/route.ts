import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: Request) {
  try {
    const { image } = await req.json();
    if (!image) return NextResponse.json({ error: 'Image missing.' }, { status: 400 });

    const imageB64 = image.split(',')[1];
    
    const prompt = `
    This is a photo of an optical mark reader (OMR) form.
    Find the 4 outermost corners of the main printed frame/grid on the paper.
    If there is a border enclosing all the content, find its 4 corners.
    Return ONLY a JSON object with 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'.
    Coordinates must be between 0 and 1000 (representing parts per thousand of width and height).
    
    {
      "topLeft": { "x": 50, "y": 60 },
      "topRight": { "x": 950, "y": 70 },
      "bottomLeft": { "x": 40, "y": 960 },
      "bottomRight": { "x": 970, "y": 950 }
    }
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [
        { role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: imageB64 } }] }
      ],
      config: { responseMimeType: 'application/json', temperature: 0.1 }
    });

    const text = response.text || '';
    const json = JSON.parse(text);
    return NextResponse.json(json);
  } catch (error: any) {
    console.error("Corner detection error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
