import math
from PIL import Image

def test():
    img = Image.open("/home/can/.gemini/antigravity/brain/e1d32d2e-5782-49bc-a8fc-33a279e0f3eb/.user_uploaded/media_1789330857351.jpg")
    img = img.convert("RGB")
    width, height = img.size
    
    searchWidth = int(width * 0.3)
    
    print(f"Image: {width}x{height}, searching 0 to {searchWidth}")
    
    # 1. Raw transitions
    raw_scores = []
    for x in range(searchWidth):
        transitions = 0
        wasDark = False
        for y in range(int(height * 0.05), int(height * 0.95), 3):
            r, g, b = img.getpixel((x, y))
            brightness = (r + g + b) / 3.0
            isDark = brightness < 120
            if isDark != wasDark:
                transitions += 1
                wasDark = isDark
        raw_scores.append((x, transitions))
        
    raw_scores.sort(key=lambda item: item[1], reverse=True)
    print("Raw transitions Top 5:")
    print(raw_scores[:5])
    
    # 2. Periodicity scores
    per_scores = []
    for x in range(searchWidth):
        darkEntries = []
        wasDark = False
        for y in range(int(height * 0.05), int(height * 0.95), 2):
            r, g, b = img.getpixel((x, y))
            brightness = (r + g + b) / 3.0
            isDark = brightness < 120
            if isDark and not wasDark:
                darkEntries.append(y)
            wasDark = isDark
            
        if len(darkEntries) < 5:
            per_scores.append((x, 0, len(darkEntries), 0))
            continue
            
        gaps = []
        for i in range(1, len(darkEntries)):
            gaps.append(darkEntries[i] - darkEntries[i-1])
            
        sortedGaps = sorted(gaps)
        medGap = sortedGaps[len(sortedGaps) // 2]
        
        periodicCount = sum(1 for g in gaps if abs(g - medGap) < medGap * 0.35)
        per_scores.append((x, periodicCount, len(darkEntries), medGap))
        
    per_scores.sort(key=lambda item: item[1], reverse=True)
    print("\nPeriodicity scores Top 10:")
    for i in range(10):
        print(per_scores[i])

test()
