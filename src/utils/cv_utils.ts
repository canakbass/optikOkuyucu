export interface Point { x: number; y: number }

export function getHomography(src: Point[], dst: Point[]): number[] {
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    B.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    B.push(dy);
  }

  for (let i = 0; i < 8; i++) {
    let maxRow = i;
    for (let k = i + 1; k < 8; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    const tmpA = A[i]; A[i] = A[maxRow]; A[maxRow] = tmpA;
    const tmpB = B[i]; B[i] = B[maxRow]; B[maxRow] = tmpB;

    if (Math.abs(A[i][i]) < 1e-10) continue; 

    for (let k = i + 1; k < 8; k++) {
      const c = -A[k][i] / A[i][i];
      for (let j = i; j < 8; j++) {
        if (i === j) A[k][j] = 0;
        else A[k][j] += c * A[i][j];
      }
      B[k] += c * B[i];
    }
  }

  const x = new Array(8).fill(0);
  for (let i = 7; i >= 0; i--) {
    x[i] = B[i];
    for (let k = i + 1; k < 8; k++) {
      x[i] -= A[i][k] * x[k];
    }
    x[i] = x[i] / A[i][i];
  }

  return [x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], 1];
}

export function applyHomography(H: number[], x: number, y: number): Point {
  const w = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w
  };
}

export function warpImage(srcImageData: ImageData, H: number[], width: number, height: number): ImageData {
  const dst = new ImageData(width, height);
  const det = H[0]*(H[4]*H[8] - H[5]*H[7]) - H[1]*(H[3]*H[8] - H[5]*H[6]) + H[2]*(H[3]*H[7] - H[4]*H[6]);
  const invH = [
    (H[4]*H[8] - H[5]*H[7])/det, (H[2]*H[7] - H[1]*H[8])/det, (H[1]*H[5] - H[2]*H[4])/det,
    (H[5]*H[6] - H[3]*H[8])/det, (H[0]*H[8] - H[2]*H[6])/det, (H[2]*H[3] - H[0]*H[5])/det,
    (H[3]*H[7] - H[4]*H[6])/det, (H[1]*H[6] - H[0]*H[7])/det, (H[0]*H[4] - H[1]*H[3])/det
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = applyHomography(invH, x, y);
      const sx = Math.round(p.x);
      const sy = Math.round(p.y);

      const dstIdx = (y * width + x) * 4;
      if (sx >= 0 && sx < srcImageData.width && sy >= 0 && sy < srcImageData.height) {
        const srcIdx = (sy * srcImageData.width + sx) * 4;
        dst.data[dstIdx] = srcImageData.data[srcIdx];
        dst.data[dstIdx+1] = srcImageData.data[srcIdx+1];
        dst.data[dstIdx+2] = srcImageData.data[srcIdx+2];
        dst.data[dstIdx+3] = srcImageData.data[srcIdx+3];
      } else {
        dst.data[dstIdx] = 255; 
        dst.data[dstIdx+1] = 255;
        dst.data[dstIdx+2] = 255;
        dst.data[dstIdx+3] = 255;
      }
    }
  }
  return dst;
}

export async function flattenImageWithLLM(base64: string): Promise<string> {
  const res = await fetch('/api/detect-corners', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Köşe tespiti başarısız (HTTP ${res.status})`);
  }
  const cornersJSON = await res.json();
  const { topLeft, topRight, bottomLeft, bottomRight } = cornersJSON;
  if (!topLeft || !topRight || !bottomLeft || !bottomRight) {
    throw new Error('Geçersiz köşe formatı.');
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return reject(new Error("Canvas 2D alınamadı"));
      ctx.drawImage(img, 0, 0);
      const srcImageData = ctx.getImageData(0, 0, img.width, img.height);

      const srcPts = [
        { x: (topLeft.x / 1000) * img.width, y: (topLeft.y / 1000) * img.height },
        { x: (topRight.x / 1000) * img.width, y: (topRight.y / 1000) * img.height },
        { x: (bottomRight.x / 1000) * img.width, y: (bottomRight.y / 1000) * img.height },
        { x: (bottomLeft.x / 1000) * img.width, y: (bottomLeft.y / 1000) * img.height },
      ];

      // Hedef (Düzeltilmiş) Resim Boyutları (Standart A4 oranı)
      const dstWidth = 1000;
      const dstHeight = 1414;
      const dstPts = [
        { x: 0, y: 0 },
        { x: dstWidth, y: 0 },
        { x: dstWidth, y: dstHeight },
        { x: 0, y: dstHeight }
      ];

      const H = getHomography(srcPts, dstPts);
      const dstImageData = warpImage(srcImageData, H, dstWidth, dstHeight);

      const dstCanvas = document.createElement("canvas");
      dstCanvas.width = dstWidth;
      dstCanvas.height = dstHeight;
      const dstCtx = dstCanvas.getContext("2d");
      if (!dstCtx) return reject(new Error("Dst Canvas 2D alınamadı"));
      dstCtx.putImageData(dstImageData, 0, 0);

      resolve(dstCanvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = (err) => reject(err);
    img.src = base64;
  });
}
