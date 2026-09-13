import sys
from PIL import Image

img_path = '/home/can/.gemini/antigravity/brain/e1d32d2e-5782-49bc-a8fc-33a279e0f3eb/.user_uploaded/media_1789291530115.jpg'
try:
    img = Image.open(img_path).convert('RGB')
    print(f"Image loaded: {img.width}x{img.height}")
except Exception as e:
    print(e)
