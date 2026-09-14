          const numRows = block.endQuestion - block.startQuestion + 1;

          if (block.topLeft && block.topRight && block.bottomLeft && block.bottomRight) {
            // YENİ SİSTEM: 4 Köşe Noktası ile Bilinear Interpolation
            const tl = { x: (block.topLeft.x / 1000) * img.width, y: (block.topLeft.y / 1000) * img.height };
            const tr = { x: (block.topRight.x / 1000) * img.width, y: (block.topRight.y / 1000) * img.height };
            const bl = { x: (block.bottomLeft.x / 1000) * img.width, y: (block.bottomLeft.y / 1000) * img.height };
            const br = { x: (block.bottomRight.x / 1000) * img.width, y: (block.bottomRight.y / 1000) * img.height };

            for (let q = 0; q < numRows; q++) {
              const qNum = block.startQuestion + q;
              const tY = numRows > 1 ? q / (numRows - 1) : 0;
              
              // Satırın sol ve sağ sınırlarını (ilk ve son şık) enterpolasyon ile bul
              let leftX = tl.x + tY * (bl.x - tl.x);
              let leftY = tl.y + tY * (bl.y - tl.y);
              let rightX = tr.x + tY * (br.x - tr.x);
              let rightY = tr.y + tY * (br.y - tr.y);

              // ──── MİKRO-HİZALAMA (Kırmızı Ağırlık Merkezi) ────
              // LLM koordinatları 5-10 piksel hatalı olabilir. Satırdaki kırmızı mürekkebin merkezine kilitlenelim!
              let sumY = 0, sumMassY = 0;
              let sumX = 0, sumMassX = 0;
              const winR = Math.floor(nominalBubbleSize); 
              for(let dy = -winR; dy <= winR; dy++) {
                  for(let dx = -winR; dx <= winR; dx++) {
                      // Satırdaki 5 şıkkın etrafını tara
                      let isNearBubble = false;
                      for(let col = 0; col < 5; col++) {
                          const tX = col / 4.0;
                          const cx = leftX + tX * (rightX - leftX);
                          const cy = leftY + tX * (rightY - leftY);
                          
                          const px = Math.floor(cx) + dx;
                          const py = Math.floor(cy) + dy;
                          
                          if (px < 0 || px >= img.width || py < 0 || py >= img.height) continue;
                          
                          const idx = (py * img.width + px) * 4;
                          const r_val = imageData.data[idx];
                          const g_val = imageData.data[idx+1];
                          const b_val = imageData.data[idx+2];
                          const redness = r_val - Math.max(g_val, b_val);
                          
                          if (redness > 20) {
                              sumX += dx * redness;
                              sumY += dy * redness;
                              sumMassY += redness;
                              sumMassX += redness;
                          }
                      }
                  }
              }
              
              if (sumMassY > 150) {
                  const yShift = sumY / sumMassY;
                  const xShift = sumX / sumMassX;
                  // Satırı kaydır ki kırmızı balonlara tam otursun
                  leftY += yShift;
                  rightY += yShift;
                  leftX += xShift;
                  rightX += xShift;
              }
              // ──────────────────────────────────────────────────────────

              const darknessScores: { option: string; score: number }[] = [];

              for (let col = 0; col < 5; col++) {
                const tX = col / 4.0;
                const cx = leftX + tX * (rightX - leftX);
                const cy = leftY + tX * (rightY - leftY);

                const bx = cx - nominalBubbleSize / 2;
                const by = cy - nominalBubbleSize / 2;

                ctx.strokeStyle = "rgba(0, 0, 255, 0.7)";
                ctx.strokeRect(bx, by, nominalBubbleSize, nominalBubbleSize);

                darknessScores.push({
                  option: options[col],
                  score: getAverageDarkness(imageData, bx, by, nominalBubbleSize, nominalBubbleSize),
                });
              }

              // Skor analizi
              const sorted = [...darknessScores].sort((a, b) => b.score - a.score);
              const darkest = sorted[0];
              const secondDarkest = sorted[1];
              let sumOthers = 0;
              for (let i = 1; i < 5; i++) sumOthers += sorted[i].score;
              const avgOther = sumOthers / 4;

              let selectedOption: string | null = null;
              if (darkest.score > 25 && darkest.score > avgOther * 1.6) {
                if (secondDarkest.score > darkest.score * 0.8 && secondDarkest.score > 35) {
                  selectedOption = "X";
                } else {
                  selectedOption = darkest.option;
                }
              }

              catResult.questions.push({
                questionNumber: qNum,
                answer: selectedOption,
              });
            }
          } else {
            // ESKİ SİSTEM: Kırmızı Histogram + Row Anchors
          // DİKEY YERLEŞİM: LLM'in dikey (Y) tahminine en yakın zamanlama çizgisini bul.
          // Mikro arama YAPMIYORUZ! LLM ne dediyse O.
          let bestStartIdx = 0;
          if (block.startY !== undefined) {
            const pixelStartY = (block.startY / 1000) * img.height;
            let minDist = 999999;
            const searchRange = Math.max(30, rowAnchors.length);
            for (let i = -searchRange; i < searchRange * 2; i++) {
              const anch = getAnchor(i);
              const dist = Math.abs(anch.left.y - pixelStartY);
              if (dist < minDist) {
                minDist = dist;
                bestStartIdx = i;
              }
            }
          } else {
            bestStartIdx = Math.min(0, rowAnchors.length - numRows);
          }

          const roughCX = ((block.columnXCenter || 0) / 1000) * img.width;
          const roughCenterT = (roughCX - avgLX) / avgRowLen;
          
          let bestScore = -1;
          let bestCenterT = roughCenterT;
          let bestGapT = gapT;
          
          const searchRadT = 0.08;
          for(let tOff = -searchRadT; tOff <= searchRadT; tOff += 0.002) {
              const testCenterT = roughCenterT + tOff;
              for(let gapScale = 1.0; gapScale <= 1.35; gapScale += 0.02) {
                  const testGapT = gapT * gapScale;
                  let score = 0;
                  
                  for(let col = -2; col <= 2; col++) {
                      const t = testCenterT + col * testGapT;
                      const bin = Math.max(0, Math.min(BINS - 1, Math.floor(t * BINS)));
                      score += smoothedRed[bin];
                  }
                  
                  score -= Math.abs(tOff) * 100;
                  
                  if(score > bestScore) {
                      bestScore = score;
                      bestCenterT = testCenterT;
                      bestGapT = testGapT;
                  }
              }
          }

          const startIdx = bestStartIdx;

          for (let q = 0; q < numRows; q++) {
            const mIdx = startIdx + q;
            const qNum = block.startQuestion + q;
            const anch = getAnchor(mIdx);
            const L = { ...anch.left };
            const R = { ...anch.right };

            let sumY = 0;
            let sumMass = 0;
            const winY = Math.floor(nominalBubbleSize);
            for(let dy = -winY; dy <= winY; dy++) {
                const py = Math.floor(L.y) + dy;
                if (py < 0 || py >= img.height) continue;
                
                let rowRed = 0;
                for(let col = 0; col < 5; col++) {
                    const t = bestCenterT + (col - 2) * bestGapT;
                    const px = Math.floor(L.x + t * (R.x - L.x));
                    if (px < 0 || px >= img.width) continue;
                    
                    for(let dx = -3; dx <= 3; dx++) {
                        const px_dx = px + dx;
                        if (px_dx < 0 || px_dx >= img.width) continue;
                        const idx = (py * img.width + px_dx) * 4;
                        const r_val = imageData.data[idx];
                        const g_val = imageData.data[idx+1];
                        const b_val = imageData.data[idx+2];
                        const redness = r_val - Math.max(g_val, b_val);
                        if (redness > 20) rowRed += redness;
                    }
                }
                sumY += dy * rowRed;
                sumMass += rowRed;
            }
            
            if (sumMass > 150) {
                const yShift = sumY / sumMass;
                L.y += yShift;
                R.y += yShift;
            }

            const darknessScores: { option: string; score: number }[] = [];

            for (let col = 0; col < 5; col++) {
              const t = bestCenterT + (col - 2) * bestGapT;
              
              const cx = L.x + t * (R.x - L.x);
              const cy = L.y + t * (R.y - L.y);

              const bx = cx - nominalBubbleSize / 2;
              const by = cy - nominalBubbleSize / 2;

              ctx.strokeRect(bx, by, nominalBubbleSize, nominalBubbleSize);

              darknessScores.push({
                option: options[col],
                score: getAverageDarkness(imageData, bx, by, nominalBubbleSize, nominalBubbleSize),
              });
            }

            const sorted = [...darknessScores].sort((a, b) => b.score - a.score);
            const darkest = sorted[0];
            const secondDarkest = sorted[1];
            let sumOthers = 0;
            for (let i = 1; i < 5; i++) sumOthers += sorted[i].score;
            const avgOther = sumOthers / 4;

            let selectedOption: string | null = null;
            if (darkest.score > 25 && darkest.score > avgOther * 1.6) {
              if (secondDarkest.score > darkest.score * 0.8 && secondDarkest.score > 35) {
                selectedOption = "X";
              } else {
                selectedOption = darkest.option;
              }
            }

            catResult.questions.push({
              questionNumber: qNum,
              answer: selectedOption,
            });
          }
          }
