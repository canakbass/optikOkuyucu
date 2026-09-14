import cv2
import numpy as np

img = cv2.imread('/home/can/.gemini/antigravity/brain/e1d32d2e-5782-49bc-a8fc-33a279e0f3eb/.user_uploaded/media_1789373148803.jpg')
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
height, width = gray.shape

print(f"Image: {width}x{height}")

# Print the first 20 pixels of row 200 to 220
print("Sample of raw pixels at left edge (x=0 to x=30, y=200 to 220):")
for y in range(200, 221):
    row_str = ""
    for x in range(30):
        val = gray[y, x]
        if val < 100: row_str += "#"
        elif val < 140: row_str += "x"
        elif val < 200: row_str += "."
        else: row_str += " "
    print(f"Y={y:3d}: {row_str}")

# Find actual timing mark candidate runs
runs = []
for y in range(50, height-50, 10):
    run_start = -1
    for x in range(100):
        if gray[y, x] < 130:
            if run_start == -1: run_start = x
        else:
            if run_start != -1:
                runs.append((y, run_start, x, x - run_start))
                run_start = -1
print("\nSample of dark runs found in left 100px:")
for r in runs[:30]:
    if r[3] > 5:
        print(f"Y={r[0]}: run from X={r[1]} to {r[2]} (width {r[3]})")
