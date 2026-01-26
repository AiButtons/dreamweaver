#!/usr/bin/env python3
"""
Test script that combines:
1. File Upload (via API Gateway presigned URL)
2. Qwen Image Edit (using the uploaded URL)

This verifies if the uploaded URL is accessible to the Qwen endpoint.
"""

import requests
import jwt
import os
import json
from datetime import datetime, timedelta
from pathlib import Path
from PIL import Image
from io import BytesIO

# =============================================================================
# Configuration
# =============================================================================

# Qwen Edit Endpoint
QWEN_EDIT_ENDPOINT = "https://zennah--zennah-image-edit-multi-angle-model-edit-inference.modal.run"
MODAL_API_KEY = os.getenv("MODAL_API_KEY", "7fa21cb6-2ffd-4788-85f1-e8a2176bbe04")

# File Upload API
UPLOAD_API_ENDPOINT = os.getenv("UPLOAD_API_ENDPOINT", "https://wzcz9axnlj.execute-api.eu-north-1.amazonaws.com/prod/upload")
UPLOAD_API_KEY = os.getenv("UPLOAD_API_KEY", "G8sCSLZumv4sUHc6NqqWC18MwHEdlB1D4GhGavM5")

# Test Parameters
TEST_PROMPT = "<sks> front view eye-level shot medium shot"
OUTPUT_DIR = Path("test_outputs/upload_edit_verification")

# =============================================================================
# Helper Functions
# =============================================================================

def generate_jwt_token():
    """Generate JWT token for Modal API."""
    return jwt.encode(
        {'iat': datetime.utcnow(), 'exp': datetime.utcnow() + timedelta(hours=24)},
        MODAL_API_KEY,
        'HS256'
    )

def create_test_image(path):
    """Create a simple test image if none exists."""
    print(f"🎨 Creating test image: {path}...")
    img = Image.new('RGB', (1024, 1024), color='teal')
    # Add some text or shapes so it's not plain
    from PIL import ImageDraw
    draw = ImageDraw.Draw(img)
    draw.rectangle([256, 256, 768, 768], fill='orange')
    img.save(path, "JPEG", quality=90)
    return path

def upload_image_to_s3(file_path):
    """Upload image using presigned URL API."""
    print(f"\n📤 Uploading {file_path.name} to S3...")
    
    # 1. Get Presigned URL
    payload = {"fileName": file_path.name, "contentType": "image/jpeg"}
    headers = {"x-api-key": UPLOAD_API_KEY}
    
    try:
        resp = requests.post(UPLOAD_API_ENDPOINT, json=payload, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        
        upload_url = data['uploadUrl']
        download_url = data.get('downloadUrl')
        bucket = data['bucket']
        key = data['key']
        
        if not download_url:
             download_url = f"https://{bucket}.s3.eu-north-1.amazonaws.com/{key}"
        
        print(f"   ✅ Got presigned URL")
        
    except Exception as e:
        print(f"   ❌ Failed to get presigned URL: {e}")
        raise

    # 2. Upload Content
    try:
        with open(file_path, 'rb') as f:
            file_data = f.read()
            
        put_headers = {"Content-Type": "image/jpeg"}
        
        upload_resp = requests.put(upload_url, data=file_data, headers=put_headers, timeout=60)
        upload_resp.raise_for_status()
        
        print(f"   ✅ Upload successful!")
        print(f"   URL: {download_url}")
        return download_url
        
    except Exception as e:
        print(f"   ❌ Failed to upload to S3: {e}")
        raise

def run_qwen_edit(image_url):
    """Call Qwen Edit endpoint with the uploaded URL."""
    print(f"\n🤖 Calling Qwen Edit Endpoint...")
    
    token = generate_jwt_token()
    
    payload = {
        "image_url": image_url,
        "prompt": TEST_PROMPT,
        "n_steps": 35,
        "guidance_scale": 6.0,
        "seed": 42,
        "lora_scale": 0.9,
        "max_sequence_length": 512
    }
    
    print(f"   Endpoint: {QWEN_EDIT_ENDPOINT}")
    print(f"   Payload: {json.dumps(payload, indent=2)}")
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    try:
        resp = requests.post(QWEN_EDIT_ENDPOINT, json=payload, headers=headers, timeout=120)
        print(f"   📡 Status: {resp.status_code}")
        
        if resp.status_code == 200:
            print(f"   ✅ Edit Successful!")
            
            output_path = OUTPUT_DIR / f"result_{int(datetime.now().timestamp())}.jpg"
            with open(output_path, 'wb') as f:
                f.write(resp.content)
            print(f"   💾 Saved to: {output_path}")
            return True
        else:
            print(f"   ❌ Edit Failed")
            print(f"   Error: {resp.text}")
            return False
            
    except Exception as e:
        print(f"   ❌ Request Error: {e}")
        return False

# =============================================================================
# Main Execution
# =============================================================================

if __name__ == "__main__":
    print("🚀 Starting Upload & Edit Integration Test")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    try:
        # 1. Create Test Image
        test_img_path = OUTPUT_DIR / "test_input.jpg"
        create_test_image(test_img_path)
        
        # 2. Upload to S3
        uploaded_url = upload_image_to_s3(test_img_path)
        
        # 3. Verify Accessibility (Self-check with requests)
        print("\n🔍 Verifying URL Accessibility (from local)...")
        r = requests.get(uploaded_url)
        print(f"   Status: {r.status_code}")
        if r.status_code == 200:
            print("   ✅ Local access OK (Public)")
        elif r.status_code == 403:
            print("   ⚠️  Local access FORBIDDEN (Private) - Expect Failure")
        else:
            print(f"   ⚠️  Local access status: {r.status_code}")
            
        # 4. Run Edit
        success = run_qwen_edit(uploaded_url)
        
        if success:
            print("\n🎉 Test PASSED: Full workflow operational!")
        else:
            print("\n❌ Test FAILED: Workflow broken (likely due to private URL)")
            
    except Exception as e:
        print(f"\n❌ Test Aborted: {e}")
