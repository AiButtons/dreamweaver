import requests
import json

API_URL = "http://127.0.0.1:8001/api/video"

def test_video_generation():
    # Test 1: Veo 3.1 (Google)
    print("\n--- Testing Veo 3.1 Generation ---\n")
    payload_veo = {
        "prompt": "Test Veo 3.1 generation",
        "model_id": "veo-3.1",
        "aspect_ratio": "16:9",
        "duration": "5"
    }
    
    try:
        response = requests.post(f"{API_URL}/generate", json=payload_veo)
        if response.status_code == 200:
            print("✅ Veo 3.1 Success (Mock):", response.json())
        else:
            print("❌ Veo 3.1 Failed:", response.status_code, response.text)
    except Exception as e:
        print(f"❌ Veo 3.1 Request Error: {e}")

    # Test 2: LTX-2 (Standard)
    print("\n--- Testing LTX-2 Generation ---\n") 
    payload_ltx = {
        "prompt": "Test LTX-2 generation",
        "negative_prompt": "full body shot, wide shot, distant, rotation of subject, spinning person, morphing, distortion",
        "model_id": "ltx-2",
        "start_image": "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?ixlib=rb-4.0.3&auto=format&fit=crop&w=1024&q=80", # Valid URL
        "end_image": "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?ixlib=rb-4.0.3&auto=format&fit=crop&w=1024&q=80", # Valid URL
        "aspect_ratio": "16:9",
        "duration": "5",
        "audio_enabled": True, 
        "slow_motion": True
    }
    
    try:
        response = requests.post(f"{API_URL}/generate", json=payload_ltx)
        if response.status_code == 200:
            print("✅ LTX-2 Success:", response.json())
        else:
            print("❌ LTX-2 Failed:", response.status_code, response.text)
    except Exception as e:
        print(f"❌ LTX-2 Request Error: {e}")


if __name__ == "__main__":
    test_video_generation()
