export async function processOMRImageCV(base64Data: string, answerKeyCategories: any[]): Promise<{ data: any[], debugImageBase64: string }> {
  return new Promise((resolve, reject) => {
    const checkCV = setInterval(() => {
      // @ts-ignore
      const cv = window.cv;
      if (typeof window !== 'undefined' && cv && cv.Mat) {
        clearInterval(checkCV);
        runCVLogic(cv);
      }
    }, 100);

    function runCVLogic(cv: any) {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(img, 0, 0);

          // @ts-ignore
          let src = cv.imread(canvas);
          // @ts-ignore
          let gray = new cv.Mat();
          // @ts-ignore
          cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
          
          // --- 1. FIND DOCUMENT OUTLINE AND DESKEW ---
          // @ts-ignore
          let blurred = new cv.Mat();
          // @ts-ignore
          cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
          
          // @ts-ignore
          let edges = new cv.Mat();
          // @ts-ignore
          cv.Canny(blurred, edges, 75, 200);

          // @ts-ignore
          let contours = new cv.MatVector();
          // @ts-ignore
          let hierarchy = new cv.Mat();
          // @ts-ignore
          cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

          // Sort contours by area
          let docContour = null;
          let maxArea = 0;
          for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            // @ts-ignore
            let area = cv.contourArea(cnt);
            if (area > 50000) { 
              // @ts-ignore
              let peri = cv.arcLength(cnt, true);
              // @ts-ignore
              let approx = new cv.Mat();
              // @ts-ignore
              cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
              if (approx.rows === 4 && area > maxArea) {
                docContour = approx;
                maxArea = area;
              } else {
                approx.delete();
              }
            }
          }

          let warped = new cv.Mat();
          const targetW = 1000;
          const targetH = 1414;

          if (docContour) {
            // Reorder points: TL, TR, BR, BL
            let pts = [];
            for (let i=0; i<4; i++) {
                pts.push({x: docContour.data32S[i*2], y: docContour.data32S[i*2+1]});
            }
            pts.sort((a,b) => a.y - b.y);
            let top = pts.slice(0, 2).sort((a,b) => a.x - b.x);
            let bottom = pts.slice(2, 4).sort((a,b) => a.x - b.x);
            let ordered = [top[0], top[1], bottom[1], bottom[0]]; // TL, TR, BR, BL

            // @ts-ignore
            let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [ordered[0].x, ordered[0].y, ordered[1].x, ordered[1].y, ordered[2].x, ordered[2].y, ordered[3].x, ordered[3].y]);
            // @ts-ignore
            let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, targetW, 0, targetW, targetH, 0, targetH]);
            
            // @ts-ignore
            let M = cv.getPerspectiveTransform(srcTri, dstTri);
            // @ts-ignore
            cv.warpPerspective(src, warped, M, new cv.Size(targetW, targetH));
            
            srcTri.delete(); dstTri.delete(); M.delete(); docContour.delete();
          } else {
            // Fallback: If no document frame found, just resize (assume photo is pre-cropped)
            // @ts-ignore
            cv.resize(src, warped, new cv.Size(targetW, targetH));
          }

          // --- 2. FIND BUBBLES ---
          // Convert warped image to grayscale
          // @ts-ignore
          let wGray = new cv.Mat();
          // @ts-ignore
          cv.cvtColor(warped, wGray, cv.COLOR_RGBA2GRAY, 0);

          // Thresholding to find circles
          // @ts-ignore
          let thresh = new cv.Mat();
          // @ts-ignore
          cv.adaptiveThreshold(wGray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 21, 10);
          
          // Find contours on thresholded image
          // @ts-ignore
          let bContours = new cv.MatVector();
          // @ts-ignore
          let bHierarchy = new cv.Mat();
          // @ts-ignore
          cv.findContours(thresh, bContours, bHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
          
          let bubbles = [];
          for (let i = 0; i < bContours.size(); ++i) {
            let cnt = bContours.get(i);
            // @ts-ignore
            let area = cv.contourArea(cnt);
            // Ignore noise
            if (area > 150 && area < 1500) {
              // Check circularity
              // @ts-ignore
              let peri = cv.arcLength(cnt, true);
              let circularity = 4 * Math.PI * (area / (peri * peri));
              
              if (circularity > 0.6) {
                // @ts-ignore
                let M = cv.moments(cnt);
                let cx = M.m10 / M.m00;
                let cy = M.m01 / M.m00;
                // @ts-ignore
                let rect = cv.boundingRect(cnt);
                
                bubbles.push({ x: cx, y: cy, w: rect.width, h: rect.height, area: area, cnt: cnt });
              }
            }
          }

          // Group bubbles into questions (horizontal groups of 5)
          bubbles.sort((a, b) => a.y - b.y); // Sort by Y
          let rows = [];
          let currentRow = [bubbles[0]];
          
          for (let i = 1; i < bubbles.length; i++) {
            if (Math.abs(bubbles[i].y - currentRow[0].y) < 15) { // Same row threshold
              currentRow.push(bubbles[i]);
            } else {
              rows.push(currentRow);
              currentRow = [bubbles[i]];
            }
          }
          if (currentRow.length > 0) rows.push(currentRow);

          // We only care about rows that have exactly 5 bubbles (A,B,C,D,E)
          let validQuestions = [];
          for (let row of rows) {
              // Sort horizontally
              row.sort((a, b) => a.x - b.x);
              // Split into groups of 5 if they are close
              let qGroups = [];
              let curGroup = [row[0]];
              for (let i = 1; i < row.length; i++) {
                  if (Math.abs(row[i].x - row[i-1].x) < 40) { // Gap between options
                      curGroup.push(row[i]);
                  } else {
                      qGroups.push(curGroup);
                      curGroup = [row[i]];
                  }
              }
              if (curGroup.length > 0) qGroups.push(curGroup);

              for (let g of qGroups) {
                  if (g.length === 5) {
                      validQuestions.push(g);
                  }
              }
          }

          // Now we have a list of all 5-option questions.
          // Sort them by Columns (X) then by Rows (Y).
          // We can find columns by looking at the average X of the first bubble in each question.
          validQuestions.sort((a,b) => a[0].x - b[0].x);
          
          let columns = [];
          let currentCol = [validQuestions[0]];
          for (let i = 1; i < validQuestions.length; i++) {
              if (Math.abs(validQuestions[i][0].x - currentCol[0][0].x) < 50) { // Same column threshold
                  currentCol.push(validQuestions[i]);
              } else {
                  columns.push(currentCol);
                  currentCol = [validQuestions[i]];
              }
          }
          if (currentCol.length > 0) columns.push(currentCol);

          // Sort each column internally by Y
          for (let col of columns) {
              col.sort((a,b) => a[0].y - b[0].y);
          }

          // Read the filled status
          const optionsLabel = ['A', 'B', 'C', 'D', 'E'];
          let finalResults = [];

          let colIndex = 0;
          // Match columns to AnswerKey categories (assuming AnswerKey has Categories)
          // E.g. Category 1 -> Column 0, Category 2 -> Column 1...
          for (let akCat of answerKeyCategories) {
              let catCol = columns[colIndex];
              if (!catCol) break; // Student form missing columns?

              let catQuestions = [];
              for (let q = 0; q < Math.min(catCol.length, akCat.questions.length); q++) {
                  let bubbleGroup = catCol[q];
                  
                  // Find the darkest bubble
                  let darkestScore = -1;
                  let selectedIdx = -1;
                  
                  for (let opt = 0; opt < 5; opt++) {
                      let bub = bubbleGroup[opt];
                      // Calculate darkness inside the bubble
                      let mask = new cv.Mat.zeros(warped.rows, warped.cols, cv.CV_8UC1);
                      cv.circle(mask, new cv.Point(bub.x, bub.y), bub.w/2 - 2, new cv.Scalar(255), -1);
                      let mean = cv.mean(wGray, mask);
                      // Since image is grayscale, darker is lower value. We invert for 'score'
                      let darkness = 255 - mean[0]; 
                      
                      // Draw for debug
                      cv.circle(warped, new cv.Point(bub.x, bub.y), bub.w/2, new cv.Scalar(0,255,0,255), 2);
                      
                      if (darkness > darkestScore) {
                          darkestScore = darkness;
                          selectedIdx = opt;
                      }
                      mask.delete();
                  }

                  // Threshold to ensure it's actually filled
                  let ans = null;
                  if (darkestScore > 120) { // Adjust threshold as needed
                      ans = optionsLabel[selectedIdx];
                      // Highlight the chosen one
                      let chosenBub = bubbleGroup[selectedIdx];
                      cv.circle(warped, new cv.Point(chosenBub.x, chosenBub.y), chosenBub.w/2, new cv.Scalar(255,0,0,255), -1);
                  }

                  catQuestions.push({
                      questionNumber: akCat.questions[q].questionNumber,
                      answer: ans
                  });
              }

              finalResults.push({
                  categoryName: akCat.categoryName,
                  questions: catQuestions
              });
              
              colIndex++;
          }

          cv.imshow(canvas, warped);

          // Cleanup
          src.delete(); gray.delete(); blurred.delete(); edges.delete(); 
          contours.delete(); hierarchy.delete(); warped.delete();
          wGray.delete(); thresh.delete(); bContours.delete(); bHierarchy.delete();

          resolve({ data: finalResults, debugImageBase64: canvas.toDataURL("image/jpeg", 0.8) });

        } catch (e) {
          reject(e);
        }
      };
      img.onerror = reject;
      img.src = base64Data;
    }
  });
}
