const Jimp = require('jimp');

async function test() {
  const img = await Jimp.read('/home/can/.gemini/antigravity/brain/e1d32d2e-5782-49bc-a8fc-33a279e0f3eb/.user_uploaded/media_1789291530115.jpg');
  console.log("Image size:", img.bitmap.width, img.bitmap.height);
}
test();
