const fs = require('fs');
let code = fs.readFileSync('/home/can/Projeler/optikOkuyucu/src/utils/omr.ts', 'utf8');
code = code.replace(`            catResult.questions.push({
              questionNumber: qNum,
              answer: selectedOption,
          }
            catResult.questions.push({ questionNumber: qNum, answer: selectedOption });
          }
        }`, `            catResult.questions.push({
              questionNumber: qNum,
              answer: selectedOption,
            });
          }
        }
        `);
fs.writeFileSync('/home/can/Projeler/optikOkuyucu/src/utils/omr.ts', code);
