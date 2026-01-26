#!/usr/bin/env python3
"""
Modal Endpoints Test Script

Tests the Modal API endpoints to verify:
- JWT token generation
- Image generation endpoint
- Qwen multi-angle edit endpoint
- Response formats
- Error handling
"""

import os
import sys
import jwt
import requests
import json
from datetime import datetime, timedelta
from pathlib import Path

# Add parent directory to path to import from providers
sys.path.insert(0, str(Path(__file__).parent.parent))

# Configuration
IMAGE_GEN_ENDPOINT = "https://zennah--zennah-image-gen-model-image-inference.modal.run"
QWEN_EDIT_ENDPOINT = "https://zennah--zennah-image-edit-multi-angle-model-edit-inference.modal.run"
API_KEY = os.getenv("MODAL_API_KEY", "7fa21cb6-2ffd-4788-85f1-e8a2176bbe04")

OUTPUT_DIR = Path("test_outputs/modal_api_tests")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def generate_jwt_token():
    """Generate JWT token for Modal API authentication."""
    payload = {
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(payload, API_KEY, algorithm='HS256')
    print(f"✅ JWT Token generated (expires in 24h)")
    return token


def test_image_generation():
    """Test image generation endpoint."""
    print("\n" + "="*60)
    print("TEST 1: Image Generation Endpoint")
    print("="*60)
    
    token = generate_jwt_token()
    
    # Test payload
    payload = {
        "prompt": "A stunning portrait of an elegant woman in a studio setting, cinematic lighting, 8k, photorealistic",
        "width": 1024,
        "height": 768,
        "n_steps": 25,  # Use fewer steps for testing
        "guidance_scale": 8.0
    }
    
    print(f"\n📋 Request Payload:")
    print(json.dumps(payload, indent=2))
    
    try:
        print(f"\n🚀 Sending request to: {IMAGE_GEN_ENDPOINT}")
        response = requests.post(
            IMAGE_GEN_ENDPOINT,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=300  # 5 min timeout
        )
        
        print(f"\n📡 Response Status: {response.status_code}")
        print(f"📊 Content Type: {response.headers.get('content-type', 'unknown')}")
        print(f"📦 Content Length: {len(response.content)} bytes")
        
        if response.status_code == 200:
            # Save the image
            output_path = OUTPUT_DIR / "test_image_gen.jpg"
            with open(output_path, 'wb') as f:
                f.write(response.content)
            print(f"\n✅ Image saved to: {output_path}")
            
            # Try to get image dimensions
            try:
                from PIL import Image
                img = Image.open(output_path)
                print(f"🖼️  Image dimensions: {img.size[0]}x{img.size[1]}")
                print(f"🎨 Image mode: {img.mode}")
            except ImportError:
                print("ℹ️  Install Pillow to see image dimensions: pip install pillow")
            
            return True
        else:
            print(f"\n❌ Error: {response.text}")
            return False
            
    except Exception as e:
        print(f"\n❌ Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False


def test_qwen_edit():
    """Test Qwen multi-angle edit endpoint."""
    print("\n" + "="*60)
    print("TEST 2: Qwen Multi-Angle Edit Endpoint")
    print("="*60)
    
    # First, we need a source image - use the one from image gen test
    source_image_path = OUTPUT_DIR / "test_image_gen.jpg"
    
    if not source_image_path.exists():
        print(f"❌ Source image not found. Run image generation test first.")
        return False
    
    # Upload to S3 or use a public URL
    # For now, we'll skip this test as it requires S3 upload
    print(f"\n⚠️  Qwen edit requires image_url (S3 upload)")
    print(f"ℹ️  This test would:")
    print(f"   1. Upload source image to S3")
    print(f"   2. Call Qwen endpoint with image_url")
    print(f"   3. Generate different angle views")
    print(f"\n📋 Example payload:")
    
    example_payload = {
        "image_url": "https://example.s3.amazonaws.com/image.jpg",
        "prompt": "<sks> left side view 45-degree angle close-up",
        "n_steps": 45,
        "guidance_scale": 6.0,
        "seed": 42
    }
    print(json.dumps(example_payload, indent=2))
    
    return None  # Skip for now


def test_parameter_variations():
    """Test image generation with different parameter values."""
    print("\n" + "="*60)
    print("TEST 3: Parameter Variations")
    print("="*60)
    
    variations = [
        {"name": "draft", "n_steps": 15, "guidance_scale": 6.0},
        {"name": "pro", "n_steps": 35, "guidance_scale": 8.0},
        {"name": "creative", "n_steps": 25, "guidance_scale": 4.0},
        {"name": "literal", "n_steps": 25, "guidance_scale": 10.0},
    ]
    
    token = generate_jwt_token()
    base_prompt = "A cinematic portrait, professional lighting"
    
    results = []
    
    for var in variations:
        print(f"\n🧪 Testing: {var['name']}")
        print(f"   Steps: {var['n_steps']}, Guidance: {var['guidance_scale']}")
        
        payload = {
            "prompt": base_prompt,
            "width": 1024,
            "height": 768,
            "n_steps": var["n_steps"],
            "guidance_scale": var["guidance_scale"]
        }
        
        try:
            response = requests.post(
                IMAGE_GEN_ENDPOINT,
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
                timeout=300
            )
            
            if response.status_code == 200:
                output_path = OUTPUT_DIR / f"test_variation_{var['name']}.jpg"
                with open(output_path, 'wb') as f:
                    f.write(response.content)
                print(f"   ✅ Saved: {output_path.name}")
                results.append({"name": var['name'], "success": True})
            else:
                print(f"   ❌ Failed: {response.status_code}")
                results.append({"name": var['name'], "success": False})
                
        except Exception as e:
            print(f"   ❌ Error: {str(e)}")
            results.append({"name": var['name'], "success": False})
    
    # Summary
    print(f"\n📊 Summary:")
    for result in results:
        status = "✅" if result["success"] else "❌"
        print(f"   {status} {result['name']}")
    
    return all(r["success"] for r in results)


def test_jwt_auth():
    """Test JWT authentication."""
    print("\n" + "="*60)
    print("TEST 4: JWT Authentication")
    print("="*60)
    
    # Test with valid token
    print("\n🔑 Testing with valid token...")
    valid_token = generate_jwt_token()
    
    # Decode to verify
    try:
        decoded = jwt.decode(valid_token, API_KEY, algorithms=['HS256'])
        print(f"✅ Token decoded successfully")
        print(f"   Issued at: {datetime.fromtimestamp(decoded['iat'])}")
        print(f"   Expires at: {datetime.fromtimestamp(decoded['exp'])}")
    except Exception as e:
        print(f"❌ Token decode failed: {e}")
        return False
    
    # Test with invalid token (would need to make actual API call)
    print("\nℹ️  Invalid token test would require API call")
    
    return True


def main():
    """Run all tests."""
    print("🧪 Modal API Endpoints Test Suite")
    print(f"📍 API Key configured: {'Yes' if API_KEY else 'No'}")
    print(f"📁 Output directory: {OUTPUT_DIR}")
    
    results = {}
    
    # Run tests
    results["jwt_auth"] = test_jwt_auth()
    results["image_gen"] = test_image_generation()
    results["qwen_edit"] = test_qwen_edit()
    results["param_variations"] = test_parameter_variations()
    
    # Final summary
    print("\n" + "="*60)
    print("📊 FINAL SUMMARY")
    print("="*60)
    
    for test_name, result in results.items():
        if result is None:
            status = "⏭️  SKIPPED"
        elif result:
            status = "✅ PASSED"
        else:
            status = "❌ FAILED"
        print(f"{status} {test_name}")
    
    # Count results
    passed = sum(1 for r in results.values() if r is True)
    failed = sum(1 for r in results.values() if r is False)
    skipped = sum(1 for r in results.values() if r is None)
    
    print(f"\n✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    print(f"⏭️  Skipped: {skipped}")
    
    if failed == 0:
        print("\n🎉 All tests passed!")
    else:
        print("\n⚠️  Some tests failed. Check the output above.")


if __name__ == "__main__":
    main()
