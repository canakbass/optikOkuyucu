const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');

async function analyze() {
  const img = await loadImage('/home/can/.gemini/antigravity/brain/e1d32d2e-5782-49bc-a8fc-33a279e0f3eb/.user_uploaded/media_1789330857351.jpg');
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  const width = imageData.width;
  const height = imageData.height;
  const searchWidth = Math.floor(width * 0.3);
  
  let bestX_raw = 0;
  let maxScore_raw = 0;
  let maxScores = [];

  for (let x = 0; x < searchWidth; x++) {
      let transitions = 0;
      let wasDark = false;
      for (let y = Math.floor(height * 0.05); y < height * 0.95; y += 3) {
          const idx = (y * width + x) * 4;
          const brightness = (imageData.data[idx] + imageData.data[idx+1] + imageData.data[idx+2]) / 3;
          const isDark = brightness < 120;
          if (isDark !== wasDark) {
              transitions++;
              wasDark = isDark;
          }
      }
      maxScores.push({x, score: transitions});
      if (transitions > maxScore_raw) {
          maxScore_raw = transitions;
          bestX_raw = x;
      }
  }
  
  maxScores.sort((a,b) => b.score - a.score);
  console.log("Raw transition top 5:");
  console.log(maxScores.slice(0, 5));

  let bestX_per = 0;
  let maxScore_per = 0;
  let maxScores_per = [];

  for (let x = 0; x < searchWidth; x++) {
      const darkEntries = [];
      let wasDark = false;
      for (let y = Math.floor(height * 0.05); y < height * 0.95; y += 2) {
          const idx = (y * width + x) * 4;
          const brightness = (imageData.data[idx] + imageData.data[idx+1] + imageData.data[idx+2]) / 3;
          const isDark = brightness < 120;
          if (isDark && !wasDark) {
              darkEntries.push(y);
          }
          wasDark = isDark;
      }
      
      let periodicCount = 0;
      let medGap = 0;
      if (darkEntries.length >= 5) {
          const gaps = [];
          for (let i = 1; i < darkEntries.length; i++) {
              gaps.push(darkEntries[i] - darkEntries[i-1]);
          }
          const sortedGaps = [...gaps].sort((a, b) => a - b);
          medGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
          for (const g of gaps) {
              if (Math.abs(g - medGap) < medGap * 0.35) periodicCount++;
          }
      }
      
      maxScores_per.push({x, score: periodicCount, gaps: darkEntries.length, medGap});
      if (periodicCount > maxScore_per) {
          maxScore_per = periodicCount;
          bestX_per = x;
      }
  }
  
  maxScores_per.sort((a,b) => b.score - a.score);
  console.log("Periodicity top 5:");
  console.log(maxScores_per.slice(0, 5));
}

analyze().catch(console.error);
