const fs = require('fs');
let code = fs.readFileSync('/home/can/Projeler/optikOkuyucu/src/app/page.tsx', 'utf8');

// Replace everything between try { and setResult(finalResult) with the new OpenCV flow
let newFlow = `    try {
      if (!answerKeyImage) throw new Error("Cevap anahtarı eksik.");

      // 1. Read Answer Key Text via LLM
      const akRes = await fetch('/api/read-answer-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: answerKeyImage }),
      });
      if (!akRes.ok) {
        const errorData = await akRes.json().catch(() => ({}));
        throw new Error(errorData.error || \`Cevap anahtarı okunamadı (HTTP \${akRes.status})\`);
      }
      const answerKeyDataJSON = await akRes.json();
      const answerKeyData = answerKeyDataJSON.categories; // OMRResult[]

      // 2. Process Student Image using Pure OpenCV Mathematical Logic!
      // This automatically finds the paper, flattens it, finds bubbles, and groups them.
      const studentProcessResult = await processOMRImageCV(base64, answerKeyData);
      const studentData = studentProcessResult.data;
      setDebugImage(studentProcessResult.debugImageBase64);

      // 3. Grade the results
      const finalResult = gradeOMR(answerKeyData, studentData);`;

code = code.replace(/try\s*\{[\s\S]*const finalResult = gradeOMR\(answerKeyData, studentData\);/, newFlow);

// Import processOMRImageCV
code = code.replace("import { processOMRImage, gradeOMR, LayoutMap } from '@/utils/omr';", "import { gradeOMR, LayoutMap } from '@/utils/omr';\nimport { processOMRImageCV } from '@/utils/omr_cv';");

fs.writeFileSync('/home/can/Projeler/optikOkuyucu/src/app/page.tsx', code);
