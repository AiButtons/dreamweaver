#!/usr/bin/env python3
"""
Test script that follows the correct workflow:
1. Upload image using file_upload API to get S3 URL
2. Send image_url to Qwen Edit endpoint
"""

import sys
import requests
import base64
import jwt
from pathlib import Path
from datetime import datetime, timedelta

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
import os
load_dotenv()

# Configuration
API_KEY = os.getenv("MODAL_API_KEY", "7fa21cb6-2ffd-4788-85f1-e8a2176bbe04")
QWEN_EDIT_ENDPOINT = "https://zennah--zennah-image-edit-multi-angle-model-edit-inference.modal.run"

# Upload API
UPLOAD_API_ENDPOINT = os.getenv("UPLOAD_API_ENDPOINT", "https://wzcz9axnlj.execute-api.eu-north-1.amazonaws.com/prod/upload")
UPLOAD_API_KEY = os.getenv("UPLOAD_API_KEY", "G8sCSLZumv4sUHc6NqqWC18MwHEdlB1D4GhGavM5")


def generate_jwt_token():
    """Generate JWT token for Modal API."""
    return jwt.encode(
        {'iat': datetime.utcnow(), 'exp': datetime.utcnow() + timedelta(hours=24)},
        API_KEY,
        'HS256'
    )


def upload_image_to_s3(file_path_or_bytes, filename="image.jpg"):
    """
    Upload image using the presigned URL API.
    Returns the public S3 URL.
    """
    print(f"\n📤 Uploading image to S3...")
    
    # Step 1: Get presigned URL from API Gateway
    payload = {
        "fileName": filename,
        "contentType": "image/jpeg"
    }
    headers = {
        "x-api-key": UPLOAD_API_KEY,
        "Content-Type": "application/json"
    }
    
    response = requests.post(UPLOAD_API_ENDPOINT, json=payload, headers=headers, timeout=30)
    response.raise_for_status()
    data = response.json()
    
    upload_url = data["uploadUrl"]
    bucket = data["bucket"]
    key = data["key"]
    
    print(f"   ✅ Got presigned URL")
    print(f"   Bucket: {bucket}")
    print(f"   Key: {key}")
    
    # Step 2: Upload file to S3
    if isinstance(file_path_or_bytes, (str, Path)):
        with open(file_path_or_bytes, 'rb') as f:
            file_data = f.read()
    else:
        file_data = file_path_or_bytes
    
    upload_response = requests.put(
        upload_url,
        data=file_data,
        headers={"Content-Type": "image/jpeg"},
        timeout=120
    )
    upload_response.raise_for_status()
    
    # Build public URL
    public_url = f"https://{bucket}.s3.eu-north-1.amazonaws.com/{key}"
    print(f"   ✅ Upload successful!")
    print(f"   URL: {public_url}")
    
    return public_url


def test_qwen_edit_with_upload():
    """Test the complete workflow: upload image, then edit."""
    print("=" * 80)
    print("🧪 Testing Qwen Edit with Upload Workflow")
    print("=" * 80)
    
    # Find a test image
    test_files = [
        "test_outputs/multi_view_test/multi_view_result.jpg",
        "test_outputs/gpt_image_test/test_1_0.png",
        "test_outputs/product_ad_v7",  # Look for any image here
    ]
    
    test_image = None
    for file_path in test_files:
        path = Path(file_path)
        if path.exists():
            if path.is_dir():
                # Find first jpg/png in directory
                for img in path.glob("*.jpg"):
                    test_image = img
                    break
                if not test_image:
                    for img in path.glob("*.png"):
                        test_image = img
                        break
            else:
                test_image = path
            break
    
    if not test_image:
        print("\n⚠️  No test images found!")
        print("   Creating a test image...")
        # Create minimal test image
        from PIL import Image
        test_image = Path("test_outputs/test_edit_image.jpg")
        test_image.parent.mkdir(parents=True, exist_ok=True)
        img = Image.new('RGB', (512, 512), color='blue')
        img.save(test_image, 'JPEG')
    
    print(f"\n📄 Test Image: {test_image}")
    print(f"   Size: {test_image.stat().st_size / 1024:.2f} KB")
    
    # Step 1: Upload to S3
    try:
        image_url = upload_image_to_s3(test_image, "test_edit.jpg")
    except Exception as e:
        print(f"\n❌ Upload failed: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # Step 2: Call Qwen Edit endpoint directly
    print(f"\n🎨 Calling Qwen Edit endpoint...")
    token = generate_jwt_token()
    
    payload = {
        "image_url": image_url,
        "prompt": "<sks> dramatic sunset lighting, warm orange tones",
        "n_steps": 45,
        "guidance_scale": 6.0,
        "seed": 42
    }
    
    print(f"   Endpoint: {QWEN_EDIT_ENDPOINT}")
    print(f"   Payload: {payload}")
    
    try:
        response = requests.post(
            QWEN_EDIT_ENDPOINT,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=180
        )
        
        print(f"\n📡 Response:")
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 200:
            # Save result
            output_path = Path("test_outputs/edit_workflow_test/edited_result.jpg")
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            with open(output_path, 'wb') as f:
                f.write(response.content)
            
            print(f"\n✅ SUCCESS!")
            print(f"   Saved to: {output_path.absolute()}")
            print(f"   Size: {output_path.stat().st_size / 1024:.2f} KB")
        else:
            print(f"\n❌ FAILED")
            print(f"   Error: {response.text[:500]}")
            
    except requests.Timeout:
        print(f"\n⏱️  Request timed out (180s)")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    test_qwen_edit_with_upload()
    
    print("\n" + "=" * 80)
    print("✅ Test Complete")
    print("=" * 80)
