import sys

def parse_txt():
    img_data = {}
    width, height = 0, 0
    with open('/tmp/img.txt', 'r') as f:
        lines = f.readlines()
        header = lines[0]
        # # ImageMagick pixel enumeration: 576,1024,255,gray
        parts = header.split(' ')[4].split(',')
        width = int(parts[0])
        height = int(parts[1])
        
        for line in lines[1:]:
            # 0,0: (37)  #252525  gray(37)
            coord, rest = line.split(':')
            x_str, y_str = coord.split(',')
            x = int(x_str)
            y = int(y_str)
            
            # extract the brightness value
            val_start = rest.find('(') + 1
            val_end = rest.find(')')
            val = int(rest[val_start:val_end])
            img_data[(x,y)] = val
            
    return width, height, img_data

width, height, img_data = parse_txt()

searchWidth = int(width * 0.3)

def getBrightness(x, y):
    return img_data.get((x,y), 255)

print(f"Image: {width}x{height}, searching 0 to {searchWidth}")

# Periodicity scores
per_scores = []
for x in range(searchWidth):
    darkEntries = []
    wasDark = False
    for y in range(int(height * 0.05), int(height * 0.95), 2):
        brightness = getBrightness(x, y)
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

# Let's also look at raw transition scores
raw_scores = []
for x in range(searchWidth):
    transitions = 0
    wasDark = False
    for y in range(int(height * 0.05), int(height * 0.95), 3):
        brightness = getBrightness(x, y)
        isDark = brightness < 120
        if isDark != wasDark:
            transitions += 1
            wasDark = isDark
    raw_scores.append((x, transitions))

raw_scores.sort(key=lambda item: item[1], reverse=True)
print("\nRaw scores Top 10:")
for i in range(10):
    print(raw_scores[i])

