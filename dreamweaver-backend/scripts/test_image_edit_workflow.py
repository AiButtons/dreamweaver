#!/usr/bin/env python3
"""
Test script for image editing with file upload.

Tests the complete workflow:
1. Upload an image
2. Edit it using Qwen Edit model
3. Verify the output
"""

import sys
import requests
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()

API_BASE = "http://localhost:8000"

def test_image_edit_workflow():
    """Test image editing with uploaded file."""
    print("=" * 80)
    print("🧪 Testing Image Edit Workflow")
    print("=" * 80)
    
    # Find test image
    test_files = [
        "test_outputs/multi_view_test/multi_view_result.jpg",
        "test_outputs/gpt_image_test/test_1_0.png",
    ]
    
    test_image = None
    for file_path in test_files:
        if Path(file_path).exists():
            test_image = file_path
            break
    
    if not test_image:
        print("\n⚠️  No test images found")
        return
    
    print(f"\n📄 Test Image: {test_image}")
    
    # Read image as base64
    import base64
    with open(test_image, 'rb') as f:
        img_bytes = f.read()
        b64_data = base64.b64encode(img_bytes).decode('utf-8')
        data_uri = f"data:image/jpeg;base64,{b64_data}"
    
    print(f"   Size: {len(img_bytes) / 1024:.2f} KB")
    print(f"   Base64 length: {len(b64_data)} chars")
    
    # Test Edit Request
    print(f"\n🎨 Testing Image Edit...")
    print(f"   Model: zennah-qwen-edit")
    print(f"   Prompt: Add dramatic sunset lighting")
    
    payload = {
        "prompt": "Add dramatic sunset lighting and warm orange tones",
        "model_id": "zennah-qwen-edit",
        "image": data_uri,
        "extra_params": {
            "n_steps": 30,
            "guidance_scale": 6.0,
            "seed": 42
        }
    }
    
    try:
        print(f"\n🚀 Sending edit request...")
        print(f"   → {API_BASE}/api/image/edit")
        
        response = requests.post(
            f"{API_BASE}/api/image/edit",
            json=payload,
            timeout=180
        )
        
        print(f"\n📡 Response:")
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"   ✅ Edit successful!")
            print(f"   Images: {len(data.get('images', []))}")
            
            # Save edited image
            if data.get('images') and data['images'][0].get('b64_json'):
                output_path = Path("test_outputs/image_edit_test/edited_result.jpg")
                output_path.parent.mkdir(parents=True, exist_ok=True)
                
                b64_img = data['images'][0]['b64_json']
                img_data = base64.b64decode(b64_img)
                
                with open(output_path, 'wb') as f:
                    f.write(img_data)
                
                print(f"\n💾 Saved edited image:")
                print(f"   {output_path.absolute()}")
        else:
            print(f"   ❌ Error:")
            print(f"   {response.text[:500]}")
            
    except requests.Timeout:
        print(f"\n⏱️  Request timed out (180s)")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


def test_multiview_workflow():
    """Test multi-view generation with uploaded file."""
    print("\n" + "=" * 80)
    print("🧪 Testing Multi-View Workflow")
    print("=" * 80)
    
    # Find test image
    test_files = [
        "test_outputs/multi_view_test/multi_view_result.jpg",
        "test_outputs/gpt_image_test/test_1_0.png",
    ]
    
    test_image = None
    for file_path in test_files:
        if Path(file_path).exists():
            test_image = file_path
            break
    
    if not test_image:
        print("\n⚠️  No test images found")
        return
    
    print(f"\n📄 Test Image: {test_image}")
    
    # Read image as base64
    import base64
    with open(test_image, 'rb') as f:
        img_bytes = f.read()
        b64_data = base64.b64encode(img_bytes).decode('utf-8')
        data_uri = f"data:image/jpeg;base64,{b64_data}"
    
    print(f"   Size: {len(img_bytes) / 1024:.2f} KB")
    
    # Test Multi-View Request
    print(f"\n📐 Testing Multi-View Generation...")
    print(f"   Model: zennah-qwen-multiview")
    print(f"   Prompt: Professional photography angles")
    
    payload = {
        "prompt": "<sks> professional photography, multiple angles, consistent lighting",
        "model_id": "zennah-qwen-multiview",
        "image": data_uri,
        "extra_params": {
            "n_steps": 45,
            "guidance_scale": 6.0,
            "seed": 42
        }
    }
    
    try:
        print(f"\n🚀 Sending multi-view request...")
        print(f"   → {API_BASE}/api/image/edit")
        
        response = requests.post(
            f"{API_BASE}/api/image/edit",
            json=payload,
            timeout=180
        )
        
        print(f"\n📡 Response:")
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"   ✅ Multi-view successful!")
            print(f"   Images: {len(data.get('images', []))}")
            
            # Save result
            if data.get('images') and data['images'][0].get('b64_json'):
                output_path = Path("test_outputs/multiview_test/multiview_result.jpg")
                output_path.parent.mkdir(parents=True, exist_ok=True)
                
                b64_img = data['images'][0]['b64_json']
                img_data = base64.b64decode(b64_img)
                
                with open(output_path, 'wb') as f:
                    f.write(img_data)
                
                print(f"\n💾 Saved multi-view result:")
                print(f"   {output_path.absolute()}")
        else:
            print(f"   ❌ Error:")
            print(f"   {response.text[:500]}")
            
    except requests.Timeout:
        print(f"\n⏱️  Request timed out (180s)")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    print("\n🎯 Image Edit & Multi-View Test Suite\n")
    
    test_image_edit_workflow()
    test_multiview_workflow()
    
    print("\n" + "=" * 80)
    print("✅ Test Suite Complete")
    print("=" * 80)
