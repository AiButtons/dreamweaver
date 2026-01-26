#!/usr/bin/env python3
"""
Debug script to test the image generation endpoint and see what's being returned.

This script makes a direct request to the backend API and prints the full response
to help debug image display issues.
"""

import requests
import json
from pprint import pprint

# API endpoint
API_URL = "http://localhost:8000/api/image/generate"

# Test payload
payload = {
    "prompt": "A beautiful sunset over the ocean",
    "model_id": "zennah-image-gen",
    "azimuth": 0,
    "elevation": 0,
    "distance": 1.0,
    "camera_id": "arriflex-16sr",
    "lens_id": "cooke-s4",
    "focal_length": 35,
    "aperture": "f/11",
    "aspect_ratio": "16:9",
    "batch_size": 1,
    "quality": "standard",
    "n_steps": 25,  # Use fewer steps for faster testing
    "guidance_scale": 8.0,
    "seed": 42,
}

print("=" * 80)
print("🧪 Image Generation Endpoint Debug Script")
print("=" * 80)
print(f"\n📍 Testing: {API_URL}")
print(f"\n📋 Request Payload:")
print(json.dumps(payload, indent=2))

try:
    print(f"\n🚀 Sending request...")
    response = requests.post(API_URL, json=payload, timeout=120)
    
    print(f"\n📡 Response Status: {response.status_code}")
    print(f"📊 Content Type: {response.headers.get('content-type', 'unknown')}")
    
    if response.status_code == 200:
        data = response.json()
        
        print(f"\n✅ Success! Response structure:")
        print("-" * 80)
        
        # Print top-level keys
        print(f"\n🔑 Top-level keys: {list(data.keys())}")
        
        # Print full response (but truncate b64_json if present)
        print(f"\n📦 Full Response:")
        data_copy = json.loads(json.dumps(data))  # Deep copy
        
        if "images" in data_copy:
            print(f"\n🖼️  Images array ({len(data_copy['images'])} image(s)):")
            for i, img in enumerate(data_copy["images"]):
                print(f"\n  Image {i + 1}:")
                print(f"    Keys: {list(img.keys())}")
                
                # Show url
                if "url" in img:
                    print(f"    url: {img['url']}")
                
                # Show b64_json (truncated)
                if "b64_json" in img:
                    if img["b64_json"]:
                        b64_len = len(img["b64_json"])
                        print(f"    b64_json: <{b64_len} characters>")
                        print(f"    b64_json (first 100): {img['b64_json'][:100]}...")
                    else:
                        print(f"    b64_json: null or empty")
                
                # Show revised_prompt
                if "revised_prompt" in img:
                    print(f"    revised_prompt: {img['revised_prompt']}")
        
        # Show other fields
        print(f"\n📋 Other fields:")
        for key in data_copy.keys():
            if key != "images":
                print(f"  {key}: {data_copy[key]}")
        
        # Diagnostic checks
        print(f"\n🔍 Diagnostic Checks:")
        has_url = any(img.get("url") for img in data.get("images", []))
        has_b64 = any(img.get("b64_json") for img in data.get("images", []))
        
        if has_url:
            print(f"  ✅ At least one image has a URL")
        else:
            print(f"  ❌ No images have URLs")
            
        if has_b64:
            print(f"  ✅ At least one image has base64 data")
        else:
            print(f"  ❌ No images have base64 data")
        
        if not has_url and not has_b64:
            print(f"\n  ⚠️  WARNING: No image data found! This will cause display issues.")
        
    else:
        print(f"\n❌ Error Response:")
        try:
            error_data = response.json()
            pprint(error_data, indent=2)
        except:
            print(response.text)
            
except requests.Timeout:
    print(f"\n⏱️  Timeout! Request took longer than 120 seconds.")
except requests.RequestException as e:
    print(f"\n❌ Request failed: {e}")
except Exception as e:
    print(f"\n❌ Unexpected error: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 80)
