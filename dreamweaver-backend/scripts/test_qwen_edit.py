#!/usr/bin/env python3
"""
Test script for Qwen Image Edit 2511 Modal endpoint with Multi-Angle LoRA
"""

import requests
import jwt
import os
from datetime import datetime, timedelta
from pathlib import Path
import json

# Configuration
QWEN_EDIT_ENDPOINT = "https://zennah--zennah-image-edit-multi-angle-model-edit-inference.modal.run"

# Get API key from environment or use default
API_KEY = os.getenv("API_KEY", "7fa21cb6-2ffd-4788-85f1-e8a2176bbe04")

# Test source images 
TEST_IMAGES = {
    # "sample": "https://raw.githubusercontent.com/QwenLM/Qwen-Image/refs/heads/main/assets/readme_en.png",
    "sample": "https://fileuploadstack-uploadbucketd2c1da78-c8fkggm2y16d.s3.eu-north-1.amazonaws.com/uploads/test_input.jpg",
    # Good object images for multi-angle testing
    # "car": "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=512",
    # "sneaker": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=512",
    "sneaker": "https://fileuploadstack-uploadbucketd2c1da78-c8fkggm2y16d.s3.eu-north-1.amazonaws.com/uploads/test_input.jpg",
}

# Test edit prompts - including multi-angle LoRA tests
TEST_EDITS = {
    # Standard edit (no LoRA trigger)
    "standard_edit": {
        "prompt": "Change the background to a snowy mountain",
        "image": "sample",
        "lora_scale": 0.0,  # Disable LoRA for standard edit
    },
    # Multi-angle LoRA tests
    "front_view": {
        "prompt": "<sks> front view eye-level shot medium shot",
        "image": "sneaker",
        "lora_scale": 0.9,
    },
    "right_side": {
        "prompt": "<sks> right side view eye-level shot medium shot",
        "image": "sneaker",
        "lora_scale": 0.9,
    },
    "back_view": {
        "prompt": "<sks> back view eye-level shot medium shot",
        "image": "sneaker",
        "lora_scale": 0.9,
    },
    "high_angle": {
        "prompt": "<sks> front view high-angle shot close-up",
        "image": "sneaker",
        "lora_scale": 0.9,
    },
    "low_angle": {
        "prompt": "<sks> front view low-angle shot wide shot",
        "image": "sneaker",
        "lora_scale": 0.9,
    },
}

def generate_jwt_token(api_key: str) -> str:
    """Generate a JWT token for authentication"""
    return jwt.encode(
        {
            'iat': datetime.utcnow(),
            'exp': datetime.utcnow() + timedelta(hours=24)
        },
        api_key,
        'HS256'
    )

def test_image_edit(
    image_url: str, 
    edit_prompt: str, 
    edit_name: str, 
    lora_scale: float = 0.9,
    save_dir: str = "test_outputs"
):
    """Test the image edit endpoint"""
    print(f"\n{'='*80}")
    print(f"Testing: {edit_name}")
    print(f"{'='*80}")
    
    output_dir = Path(save_dir)
    output_dir.mkdir(exist_ok=True)
    
    token = generate_jwt_token(API_KEY)
    
    payload = {
        "image_url": image_url,
        "prompt": edit_prompt,
        "n_steps": 40,
        "guidance_scale": 4.0,
        "seed": 42,
        "lora_scale": lora_scale,
        "max_sequence_length": 512 
    }
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    print(f"\n📤 Sending request to: {QWEN_EDIT_ENDPOINT}")
    print(f"Source image: {image_url[:60]}...")
    print(f"Prompt: {edit_prompt}")
    print(f"LoRA scale: {lora_scale}")
    
    try:
        response = requests.post(
            QWEN_EDIT_ENDPOINT,
            json=payload,
            headers=headers,
            timeout=600
        )
        
        print(f"\n📥 Response Status: {response.status_code}")
        
        if response.status_code == 200:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"qwen_edit_{edit_name}_{timestamp}.jpg"
            filepath = output_dir / filename
            
            with open(filepath, 'wb') as f:
                f.write(response.content)
            
            print(f"✅ SUCCESS! Saved to: {filepath}")
            print(f"📊 Image size: {len(response.content)} bytes")
            return True
        else:
            print(f"❌ FAILED! Status code: {response.status_code}")
            print(f"Response: {response.text[:500]}")
            return False
            
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return False

def run_all_tests(quick: bool = False):
    print("\n" + "="*80)
    print("🧪 Starting Qwen Edit + Multi-Angle LoRA Tests")
    print("="*80)
    print(f"🔑 Using API Key: {API_KEY[:8]}...{API_KEY[-8:]}")
    
    results = {}
    
    # Select tests to run
    if quick:
        # Just run one standard and one multi-angle test
        tests_to_run = ["standard_edit", "front_view"]
    else:
        tests_to_run = list(TEST_EDITS.keys())
    
    for edit_name in tests_to_run:
        config = TEST_EDITS[edit_name]
        results[edit_name] = test_image_edit(
            image_url=TEST_IMAGES[config["image"]],
            edit_prompt=config["prompt"],
            edit_name=edit_name,
            lora_scale=config["lora_scale"],
        )
    
    print(f"\n{'='*80}")
    print("📊 Test Summary")
    print(f"{'='*80}")
    
    for test_name, passed in results.items():
        status = "✅ PASSED" if passed else "❌ FAILED"
        print(f"{test_name:30s} {status}")
    
    if all(results.values()):
        print("\n🎉 All tests passed!")
        return 0
    else:
        print("\n⚠️  Some tests failed")
        return 1

if __name__ == "__main__":
    import sys
    import argparse
    
    parser = argparse.ArgumentParser(description="Test Qwen Edit Multi-Angle endpoint")
    parser.add_argument("--quick", action="store_true", help="Run quick test (2 tests only)")
    parser.add_argument("--full", action="store_true", help="Run all tests")
    args = parser.parse_args()
    
    quick = not args.full  # Default to quick, unless --full specified
    sys.exit(run_all_tests(quick=quick))
