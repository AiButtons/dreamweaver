import requests
import jwt
import os
import base64
from datetime import datetime, timedelta
from io import BytesIO
from PIL import Image

QWEN_EDIT_ENDPOINT = "https://zennah--zennah-image-edit-multi-angle-model-edit-inference.modal.run"
API_KEY = os.getenv("MODAL_API_KEY", "7fa21cb6-2ffd-4788-85f1-e8a2176bbe04")

def generate_jwt_token():
    return jwt.encode(
        {'iat': datetime.utcnow(), 'exp': datetime.utcnow() + timedelta(hours=24)},
        API_KEY,
        'HS256'
    )

def test_data_uri_support():
    print("Creating tiny test image...")
    img = Image.new('RGB', (64, 64), color='red')
    buf = BytesIO()
    img.save(buf, format='JPEG')
    b64_data = base64.b64encode(buf.getvalue()).decode('utf-8')
    data_uri = f"data:image/jpeg;base64,{b64_data}"
    
    print(f"Data URI length: {len(data_uri)}")
    
    payload = {
        "image_url": data_uri, # Try passing Data URI here
        "prompt": "<sks> front view eye-level shot test",
        "n_steps": 20,
        "guidance_scale": 4.0,
        "seed": 42,
        "lora_scale": 0.9,
        "max_sequence_length": 512
    }
    
    token = generate_jwt_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    print("Sending request with Data URI...")
    try:
        response = requests.post(
            QWEN_EDIT_ENDPOINT,
            json=payload,
            headers=headers,
            timeout=30
        )
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print("✅ SUCCEEDED! Qwen accepts Data URIs.")
        else:
            print(f"❌ Failed: {response.text[:200]}")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    test_data_uri_support()
