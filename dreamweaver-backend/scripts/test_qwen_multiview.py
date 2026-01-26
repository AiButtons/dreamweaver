#!/usr/bin/env python3
"""
Test script for Qwen Multi-View endpoint.

Tests the multi-angle image generation using an Unsplash test image.
"""

import requests
import jwt
import os
from datetime import datetime, timedelta
from pathlib import Path

# Configuration
QWEN_MULTI_ENDPOINT = "https://zennah--zennah-image-edit-multi-angle-model-edit-inference.modal.run"
API_KEY = os.getenv("MODAL_API_KEY", "7fa21cb6-2ffd-4788-85f1-e8a2176bbe04")

# Test image from Unsplash
TEST_IMAGE_URL = "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=1024"

# Output directory
OUTPUT_DIR = Path("test_outputs/multi_view_test")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def generate_jwt_token():
    """Generate JWT token for Modal API authentication."""
    payload = {
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, API_KEY, algorithm='HS256')

def test_multi_view_generation():
    """Test multi-view generation with Unsplash image."""
    print("=" * 80)
    print("🧪 Testing Qwen Multi-View Endpoint")
    print("=" * 80)
    
    print(f"\n📍 Endpoint: {QWEN_MULTI_ENDPOINT}")
    print(f"🖼️  Test Image: {TEST_IMAGE_URL}")
    
    # Generate JWT token
    print(f"\n🔑 Generating JWT token...")
    token = generate_jwt_token()
    
    # Prepare payload
    payload = {
        "image_url": TEST_IMAGE_URL,
        "prompt": "<sks> professional photography, multiple angles, consistent lighting",
        "n_steps": 45,
        "guidance_scale": 6.0,
        "seed": 42
    }
    
    print(f"\n📋 Request Payload:")
    print(f"  image_url: {payload['image_url']}")
    print(f"  prompt: {payload['prompt']}")
    print(f"  n_steps: {payload['n_steps']}")
    print(f"  guidance_scale: {payload['guidance_scale']}")
    print(f"  seed: {payload['seed']}")
    
    # Make request
    print(f"\n🚀 Sending request to Modal...")
    print(f"⏱️  This may take 30-90 seconds...")
    
    try:
        response = requests.post(
            QWEN_MULTI_ENDPOINT,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=180  # 3 minutes
        )
        
        print(f"\n📡 Response Status: {response.status_code}")
        print(f"📊 Content Type: {response.headers.get('content-type', 'unknown')}")
        print(f"📦 Content Length: {len(response.content)} bytes")
        
        if response.status_code == 200:
            # Check content type
            content_type = response.headers.get('content-type', '')
            
            if 'image' in content_type or 'video' in content_type:
                # Save as image/video
                extension = '.jpg' if 'jpeg' in content_type else ('.png' if 'png' in content_type else '.mp4')
                output_path = OUTPUT_DIR / f"multi_view_result{extension}"
                
                with open(output_path, 'wb') as f:
                    f.write(response.content)
                
                print(f"\n✅ Success! Multi-view result saved to:")
                print(f"   {output_path.absolute()}")
                
            elif 'json' in content_type:
                # Parse JSON response
                try:
                    data = response.json()
                    print(f"\n✅ Success! JSON Response:")
                    print(f"   Keys: {list(data.keys())}")
                    
                    if 'images' in data:
                        print(f"   Images: {len(data.get('images', []))} generated")
                    if 'angles' in data:
                        print(f"   Angles: {data.get('angles', [])}")
                    
                    # Save JSON for inspection
                    import json
                    json_path = OUTPUT_DIR / "multi_view_response.json"
                    with open(json_path, 'w') as f:
                        json.dump(data, f, indent=2)
                    print(f"   Full response saved to: {json_path}")
                    
                except Exception as e:
                    print(f"   ⚠️  Could not parse JSON: {e}")
                    print(f"   Raw response: {response.text[:500]}")
            else:
                print(f"\n⚠️  Unexpected content type: {content_type}")
                print(f"   First 200 chars: {response.text[:200]}")
                
        else:
            print(f"\n❌ Error Response:")
            try:
                error_data = response.json()
                print(f"   {error_data}")
            except:
                print(f"   {response.text}")
                
    except requests.Timeout:
        print(f"\n⏱️  Timeout! Request took longer than 3 minutes.")
    except requests.RequestException as e:
        print(f"\n❌ Request failed: {e}")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n" + "=" * 80)

if __name__ == "__main__":
    test_multi_view_generation()
