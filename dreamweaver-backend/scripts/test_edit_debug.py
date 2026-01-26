#!/usr/bin/env python3
"""
Test script for image edit endpoint debugging.
Tests the /api/image/edit endpoint with a sample image.
"""

import requests
import base64
import json
from pathlib import Path

# Configuration - update port as needed
API_BASE = "http://localhost:8001"
EDIT_ENDPOINT = f"{API_BASE}/api/image/edit"

def create_test_image():
    """Create a simple test image (1x1 red pixel PNG)."""
    # Minimal valid PNG
    png_data = bytes([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,  # IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  # 1x1 pixels
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,  # IDAT chunk
        0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
        0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x18, 0xDD,
        0x8D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,  # IEND chunk
        0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
    ])
    return base64.b64encode(png_data).decode('utf-8')

def test_edit_endpoint():
    """Test the image edit endpoint."""
    print("=" * 80)
    print("🧪 Testing Image Edit Endpoint")
    print(f"   Endpoint: {EDIT_ENDPOINT}")
    print("=" * 80)
    
    # Create test image
    b64_image = create_test_image()
    data_uri = f"data:image/png;base64,{b64_image}"
    
    print(f"\n📊 Test Image:")
    print(f"   Base64 length: {len(b64_image)} chars")
    print(f"   Data URI length: {len(data_uri)} chars")
    
    # Test payload
    payload = {
        "prompt": "Add sunset lighting",
        "model_id": "zennah-qwen-edit",
        "image": data_uri,
        "extra_params": {
            "n_steps": 30,
            "guidance_scale": 6.0,
            "seed": 42
        }
    }
    
    print(f"\n📤 Request Payload:")
    print(f"   prompt: {payload['prompt']}")
    print(f"   model_id: {payload['model_id']}")
    print(f"   image: {payload['image'][:50]}...")
    print(f"   extra_params: {payload['extra_params']}")
    
    try:
        print(f"\n🚀 Sending POST request...")
        response = requests.post(
            EDIT_ENDPOINT,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=120
        )
        
        print(f"\n📡 Response:")
        print(f"   Status: {response.status_code}")
        print(f"   Headers: {dict(response.headers)}")
        
        try:
            data = response.json()
            print(f"\n📦 Response Body:")
            # Pretty print, but truncate base64 data
            data_str = json.dumps(data, indent=2)
            if len(data_str) > 2000:
                print(f"   {data_str[:2000]}...")
            else:
                print(f"   {data_str}")
        except:
            print(f"\n📦 Response Text:")
            print(f"   {response.text[:2000]}")
        
        if response.status_code == 200:
            print(f"\n✅ SUCCESS!")
        else:
            print(f"\n❌ FAILED - Status {response.status_code}")
            
    except requests.Timeout:
        print(f"\n⏱️  Request timed out (120s)")
    except requests.ConnectionError as e:
        print(f"\n🔌 Connection error: {e}")
        print(f"   Is the server running on {API_BASE}?")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


def test_endpoint_exists():
    """Check if the endpoint exists with OPTIONS request."""
    print("\n" + "=" * 80)
    print("🔍 Checking Endpoint Availability")
    print("=" * 80)
    
    try:
        response = requests.options(EDIT_ENDPOINT, timeout=5)
        print(f"   OPTIONS status: {response.status_code}")
        print(f"   Allowed methods: {response.headers.get('allow', 'N/A')}")
        return True
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False


if __name__ == "__main__":
    print("\n🎯 Image Edit Endpoint Debug Test\n")
    
    if test_endpoint_exists():
        test_edit_endpoint()
    else:
        print("\n⚠️  Endpoint not reachable. Check if server is running.")
    
    print("\n" + "=" * 80)
    print("✅ Test Complete")
    print("=" * 80)
