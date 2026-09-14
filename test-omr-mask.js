import fs from 'fs';
import { createCanvas, loadImage } from 'canvas';

async function run() {
  const imgPath = '/home/can/.gemini/antigravity/brain/e1d32d2e-5782-49bc-a8fc-33a279e0f3eb/.user_uploaded/media_1789373148803.jpg';
  const image = await loadImage(imgPath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, image.width, image.height);
  const width = image.width;
  const height = image.height;
  
  console.log(`Image size: ${width}x${height}`);

  const validMask = new Uint8Array(width * height);
  const maxW = Math.floor(width * 0.25);
  
  let totalRuns = 0;
  for (let y = 0; y < height; y++) {
    let runStart = -1;
    for (let x = 0; x < maxW; x++) {
      const idx = (y * width + x) * 4;
      const brightness = (imageData.data[idx] + imageData.data[idx+1] + imageData.data[idx+2]) / 3;
      const isDark = brightness < 120;
      
      if (isDark && runStart === -1) {
        runStart = x;
      } else if (!isDark && runStart !== -1) {
        const runW = x - runStart;
        if (runW > width * 0.01 && runW < width * 0.1) {
          for (let k = runStart; k < x; k++) validMask[y * width + k] = 1;
          totalRuns++;
        }
        runStart = -1;
      }
    }
  }

  console.log(`Total valid runs in mask: ${totalRuns}`);

  const columnScores = [];
  const minSearchX = Math.floor(width * 0.01);
  
  for (let x = minSearchX; x < maxW; x++) {
    const darkEntries = [];
    let wasDark = false;
    for (let y = Math.floor(height * 0.02); y < height * 0.98; y++) {
      const isDark = validMask[y * width + x] === 1;
      if (isDark && !wasDark) {
        let yEnd = y;
        while(yEnd < height && validMask[yEnd * width + x] === 1) yEnd++;
        darkEntries.push(Math.floor((y + yEnd - 1) / 2));
        wasDark = true;
      } else if (!isDark) {
        wasDark = false;
      }
    }

    if (darkEntries.length < 5) continue;

    const gaps = [];
    for (let i = 1; i < darkEntries.length; i++) gaps.push(darkEntries[i] - darkEntries[i - 1]);
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medGap = sortedGaps[Math.floor(sortedGaps.length / 2)];

    if (medGap < height * 0.01) continue;

    let periodicCount = 0;
    for (const g of gaps) {
      if (Math.abs(g - medGap) < medGap * 0.35) periodicCount++;
    }

    columnScores.push({ x, score: periodicCount, medGap, entries: darkEntries });
  }

  console.log(`Valid columns found: ${columnScores.length}`);
  if (columnScores.length > 0) {
    const best = columnScores.reduce((a, b) => (a.score > b.score ? a : b));
    console.log(`Best column score: ${best.score}, marks: ${best.entries.length}, median gap: ${best.medGap}`);
  }
}
run();
