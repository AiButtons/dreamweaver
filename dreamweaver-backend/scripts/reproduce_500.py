#!/usr/bin/env python3
"""
Reproduction script for the 500 Internal Server Error.
Tests the exact payload that failed in the UI to isolate the issue.
"""

import requests
import jwt
import os
from datetime import datetime, timedelta
import json

# Configuration
QWEN_EDIT_ENDPOINT = "https://zennah--zennah-image-edit-multi-angle-model-edit-inference.modal.run"
API_KEY = os.getenv("MODAL_API_KEY", "7fa21cb6-2ffd-4788-85f1-e8a2176bbe04")

# The exact image URL from the failure log
FAILING_IMAGE_URL = "https://fileuploadstack-uploadbucketd2c1da78-c8fkggm2y16d.s3.eu-north-1.amazonaws.com/uploads/input_image.jpg"
# A known working image URL from test script
WORKING_IMAGE_URL = "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=512"

def generate_jwt_token():
    return jwt.encode(
        {'iat': datetime.utcnow(), 'exp': datetime.utcnow() + timedelta(hours=24)},
        API_KEY,
        'HS256'
    )

def test_payload(name, payload):
    print(f"\n🧪 Testing: {name}")
    print(f"   Payload: {json.dumps(payload, indent=2)}")
    
    token = generate_jwt_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(
            QWEN_EDIT_ENDPOINT,
            json=payload,
            headers=headers,
            timeout=120
        )
        
        print(f"   📡 Status: {response.status_code}")
        if response.status_code == 200:
            print("   ✅ Success")
            return True
        else:
            print(f"   ❌ Failed: {response.text[:200]}")
            return False
            
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False

def run_tests():
    print("🚀 Starting Reproduction Tests")
    
    # 1. Exact Failing Payload
    failing_payload = {
        'image_url': FAILING_IMAGE_URL,
        'prompt': '<sks> front view eye-level shot Place 3 guards in front of the door',
        'n_steps': 35,
        'guidance_scale': 8,
        'seed': 42,
        'lora_scale': 0.9,
        'max_sequence_length': 512
    }
    
    # 2. Adjusted Payload (Values from working test_qwen_edit.py)
    # n_steps=40, guidance_scale=4.0
    adjusted_payload = failing_payload.copy()
    adjusted_payload['n_steps'] = 40
    adjusted_payload['guidance_scale'] = 4.0
    
    # 3. Working Image + Failing Params (Isolate Image)
    iso_image_payload = failing_payload.copy()
    iso_image_payload['image_url'] = WORKING_IMAGE_URL
    
    # 4. Working Image + Adjusted Params (Control)
    control_payload = adjusted_payload.copy()
    control_payload['image_url'] = WORKING_IMAGE_URL
    
    print("\n--- Test 1: Exact Replication ---")
    if test_payload("Failing Params + Failing Image", failing_payload):
        print("   Note: If this succeeds, the issue might be intermittent or local env related.")
    
    print("\n--- Test 2: Parameter Adjustment (Guidance 8->4, Steps 35->40) ---")
    test_payload("Adjusted Params + Failing Image", adjusted_payload)
    
    print("\n--- Test 3: Image Isolation (Use Unsplash Image) ---")
    test_payload("Failing Params + Working Image", iso_image_payload)

if __name__ == "__main__":
    run_tests()
