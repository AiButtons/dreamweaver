import requests
from PIL import Image
from io import BytesIO

URL = "https://fileuploadstack-uploadbucketd2c1da78-c8fkggm2y16d.s3.eu-north-1.amazonaws.com/uploads/input_image.jpg"

print(f"Testing URL: {URL}")
try:
    resp = requests.get(URL, timeout=10)
    print(f"Status: {resp.status_code}")
    print(f"Content-Type: {resp.headers.get('Content-Type')}")
    print(f"Size: {len(resp.content)} bytes")
    
    if resp.status_code == 200:
        img = Image.open(BytesIO(resp.content))
        print(f"Image Format: {img.format}")
        print(f"Image Size: {img.size}")
        print("✅ Image is valid and accessible")
    else:
        print("❌ Failed to download")
except Exception as e:
    print(f"❌ Error: {e}")
