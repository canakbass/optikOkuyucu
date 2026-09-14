const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');

async function main() {
    const img = await loadImage('/home/can/.gemini/antigravity/brain/e1d32d2e-5782-49bc-a8fc-33a279e0f3eb/.user_uploaded/media_1789374706794.jpg');
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, img.width, img.height);
    
    // Pick a line in the middle of the image
    const y = Math.floor(img.height / 2);
    let out = [];
    for(let x = 0; x < img.width; x += 10) {
        const idx = (y * img.width + x) * 4;
        const r = imgData.data[idx];
        const g = imgData.data[idx+1];
        const b = imgData.data[idx+2];
        const redness = r - Math.max(g, b);
        if (redness > 20) {
            out.push(`x=${x}: R=${r}, G=${g}, B=${b}, red=${redness}`);
        }
    }
    console.log(`Found ${out.length} red pixels on row ${y}.`);
    console.log(out.slice(0, 10).join('\n'));
}
main();
