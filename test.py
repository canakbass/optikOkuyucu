from PIL import Image
import numpy as np

img = Image.open('/home/can/.gemini/antigravity/brain/e1d32d2e-5782-49bc-a8fc-33a279e0f3eb/.user_uploaded/media_1789373148803.jpg')
arr = np.array(img)
height, width = arr.shape[:2]

print(f"Image size: {width}x{height}")

# Brightness: average of RGB
brightness = arr.mean(axis=2)
is_dark = brightness < 120

maxW = int(width * 0.25)
valid_mask = np.zeros((height, width), dtype=np.uint8)

total_runs = 0
for y in range(height):
    run_start = -1
    for x in range(maxW):
        if is_dark[y, x] and run_start == -1:
            run_start = x
        elif not is_dark[y, x] and run_start != -1:
            runW = x - run_start
            if width * 0.01 < runW < width * 0.1:
                valid_mask[y, run_start:x] = 1
                total_runs += 1
            run_start = -1

print(f"Total valid runs: {total_runs}")

column_scores = []
min_search_x = int(width * 0.01)

for x in range(min_search_x, maxW):
    dark_entries = []
    was_dark = False
    for y in range(int(height * 0.02), int(height * 0.98)):
        if valid_mask[y, x] == 1:
            if not was_dark:
                y_end = y
                while y_end < height and valid_mask[y_end, x] == 1:
                    y_end += 1
                dark_entries.append((y + y_end - 1) // 2)
                was_dark = True
        else:
            was_dark = False
            
    if len(dark_entries) < 5:
        continue
        
    gaps = [dark_entries[i] - dark_entries[i-1] for i in range(1, len(dark_entries))]
    sorted_gaps = sorted(gaps)
    med_gap = sorted_gaps[len(sorted_gaps)//2]
    
    if med_gap < height * 0.01:
        continue
        
    periodic_count = sum(1 for g in gaps if abs(g - med_gap) < med_gap * 0.35)
    column_scores.append((x, periodic_count, med_gap, dark_entries))

print(f"Valid columns found: {len(column_scores)}")
if column_scores:
    best = max(column_scores, key=lambda item: item[1])
    print(f"Best score: {best[1]}, marks: {len(best[3])}, med_gap: {best[2]}, best_x: {best[0]}")
