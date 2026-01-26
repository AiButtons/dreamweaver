#!/usr/bin/env python3
"""
Test script for GPT Image 1.5 (gpt-image-1) using OpenAI Python SDK.

Tests the exact API format and verifies OPENAI_API_KEY works correctly.
"""

import os
import sys
from pathlib import Path
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
API_KEY = os.getenv("OPENAI_API_KEY")
OUTPUT_DIR = Path("test_outputs/gpt_image_test")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def test_gpt_image_generation():
    """Test GPT Image 1.5 generation with various configurations."""
    print("=" * 80)
    print("🧪 Testing GPT Image 1.5 API")
    print("=" * 80)
    
    # Check API key
    if not API_KEY:
        print("\n❌ ERROR: OPENAI_API_KEY not found in environment!")
        print("   Please set your OpenAI API key in .env file")
        sys.exit(1)
    
    print(f"\n✅ API Key found: {API_KEY[:20]}...")
    
    # Initialize client
    print(f"\n🔑 Initializing OpenAI client...")
    client = OpenAI(api_key=API_KEY)
    
    # Test configurations
    test_cases = [
        {
            "name": "Basic Generation",
            "params": {
                "model": "gpt-image-1.5",
                "prompt": "A serene mountain landscape at sunset",
                "n": 1,
            }
        },
        {
            "name": "With Size Parameter",
            "params": {
                "model": "gpt-image-1.5",
                "prompt": "A modern coffee shop interior",
                "n": 1,
                "size": "1024x1024",
            }
        },
        {
            "name": "With Quality Parameter",
            "params": {
                "model": "gpt-image-1.5",
                "prompt": "A futuristic cityscape",
                "n": 1,
                "quality": "high",
            }
        },
        {
            "name": "Auto Size",
            "params": {
                "model": "gpt-image-1.5",
                "prompt": "A beautiful tropical beach",
                "n": 1,
                "size": "auto",
            }
        },
    ]
    
    for i, test_case in enumerate(test_cases, 1):
        print(f"\n{'='*80}")
        print(f"Test {i}/{len(test_cases)}: {test_case['name']}")
        print(f"{'='*80}")
        
        print(f"\n📋 Parameters:")
        for key, value in test_case['params'].items():
            print(f"  {key}: {value}")
        
        try:
            print(f"\n🚀 Sending request to OpenAI...")
            
            # Make API call
            response = client.images.generate(**test_case['params'])
            
            print(f"\n✅ Success! Response received")
            print(f"📊 Response Details:")
            print(f"  Created: {response.created}")
            print(f"  Data items: {len(response.data)}")
            
            # Process each image
            for idx, image_data in enumerate(response.data):
                print(f"\n  Image {idx + 1}:")
                
                # Check what format we got
                if hasattr(image_data, 'url') and image_data.url:
                    print(f"    Format: URL")
                    print(f"    URL: {image_data.url[:80]}...")
                    
                elif hasattr(image_data, 'b64_json') and image_data.b64_json:
                    print(f"    Format: Base64")
                    b64_len = len(image_data.b64_json)
                    print(f"    Base64 length: {b64_len} characters")
                    print(f"    Preview: {image_data.b64_json[:100]}...")
                    
                    # Save base64 image
                    import base64
                    img_bytes = base64.b64decode(image_data.b64_json)
                    output_path = OUTPUT_DIR / f"test_{i}_{idx}.png"
                    with open(output_path, 'wb') as f:
                        f.write(img_bytes)
                    print(f"    Saved to: {output_path}")
                    
                else:
                    print(f"    ⚠️  Unknown format - no URL or base64 data")
                
                # Check for revised prompt
                if hasattr(image_data, 'revised_prompt') and image_data.revised_prompt:
                    print(f"    Revised prompt: {image_data.revised_prompt[:100]}...")
            
            print(f"\n✅ Test '{test_case['name']}' PASSED")
            
            # Success - no need to test more
            print(f"\n🎉 GPT Image 1.5 is working correctly!")
            print(f"\n📝 Recommendations:")
            print(f"  - Model ID is correct: 'gpt-image-1'")
            print(f"  - Response format: {('Base64' if hasattr(response.data[0], 'b64_json') else 'URL')}")
            print(f"  - Size parameter: {'auto' if 'auto' in str(test_case['params'].get('size')) else 'required'}")
            break
            
        except Exception as e:
            print(f"\n❌ Test '{test_case['name']}' FAILED")
            print(f"   Error: {type(e).__name__}: {str(e)}")
            
            # Show detailed error info
            if hasattr(e, 'response'):
                print(f"   Status Code: {e.response.status_code if hasattr(e.response, 'status_code') else 'N/A'}")
            
            import traceback
            print(f"\n   Full traceback:")
            traceback.print_exc()
            
            # Continue to next test
            continue
    
    print("\n" + "=" * 80)

if __name__ == "__main__":
    test_gpt_image_generation()
