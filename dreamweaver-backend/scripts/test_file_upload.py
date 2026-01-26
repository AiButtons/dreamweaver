#!/usr/bin/env python3
"""
Test script for file upload utility.

Tests uploading images via the file upload API.
"""

import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from utils.file_upload import upload_file, upload_base64
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def test_file_upload():
    """Test uploading an existing file."""
    print("=" * 80)
    print("🧪 Testing File Upload")
    print("=" * 80)
    
    # Find a test image
    test_files = [
        "test_outputs/multi_view_test/multi_view_result.jpg",
        "test_outputs/gpt_image_test/test_1_0.png",
    ]
    
    test_file = None
    for file_path in test_files:
        if Path(file_path).exists():
            test_file = file_path
            break
    
    if not test_file:
        print("\n⚠️  No test files found. Skipping file upload test.")
        return
    
    print(f"\n📄 Test File: {test_file}")
    print(f"   Size: {Path(test_file).stat().st_size / 1024:.2f} KB")
    
    try:
        print(f"\n🚀 Uploading file...")
        url = upload_file(test_file, "test_upload.jpg")
        
        print(f"\n✅ Upload Successful!")
        print(f"   URL: {url}")
        
    except Exception as e:
        print(f"\n❌ Upload Failed: {e}")
        import traceback
        traceback.print_exc()


def test_base64_upload():
    """Test uploading base64-encoded data."""
    print("\n" + "=" * 80)
    print("🧪 Testing Base64 Upload")
    print("=" * 80)
    
    # Create a simple test image (1x1 red pixel PNG)
    b64_data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    
    print(f"\n📊 Base64 Data Length: {len(b64_data)} characters")
    
    try:
        print(f"\n🚀 Uploading base64 image...")
        url = upload_base64(b64_data, "test_base64.png")
        
        print(f"\n✅ Upload Successful!")
        print(f"   URL: {url}")
        
    except Exception as e:
        print(f"\n❌ Upload Failed: {e}")
        import traceback
        traceback.print_exc()


def test_data_uri_upload():
    """Test uploading data URI (with prefix)."""
    print("\n" + "=" * 80)
    print("🧪 Testing Data URI Upload")
    print("=" * 80)
    
    # Data URI with prefix
    data_uri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    
    print(f"\n📊 Data URI Length: {len(data_uri)} characters")
    
    try:
        print(f"\n🚀 Uploading data URI...")
        url = upload_base64(data_uri, "test_data_uri.png")
        
        print(f"\n✅ Upload Successful!")
        print(f"   URL: {url}")
        
    except Exception as e:
        print(f"\n❌ Upload Failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    print("\n🎯 File Upload API Test Suite\n")
    
    test_file_upload()
    test_base64_upload()
    test_data_uri_upload()
    
    print("\n" + "=" * 80)
    print("✅ Test Suite Complete")
    print("=" * 80)
