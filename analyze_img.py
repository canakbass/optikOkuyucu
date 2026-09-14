import cv2
import sys

img_path = sys.argv[1]
img = cv2.imread(img_path)
if img is None:
    print("Could not read image")
    sys.exit(1)

h, w = img.shape[:2]
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
_, thresh = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY_INV)
contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

print(f"Image {w}x{h}")
print(f"Total contours: {len(contours)}")

# Sort contours by area
contours = sorted(contours, key=cv2.contourArea, reverse=True)
for i in range(min(5, len(contours))):
    x,y,w,h = cv2.boundingRect(contours[i])
    area = cv2.contourArea(contours[i])
    print(f"Contour {i}: x={x}, y={y}, w={w}, h={h}, area={area}")

