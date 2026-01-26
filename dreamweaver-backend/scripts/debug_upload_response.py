import requests
import json
import os

UPLOAD_API_ENDPOINT = os.getenv("UPLOAD_API_ENDPOINT", "https://wzcz9axnlj.execute-api.eu-north-1.amazonaws.com/prod/upload")
UPLOAD_API_KEY = os.getenv("UPLOAD_API_KEY", "G8sCSLZumv4sUHc6NqqWC18MwHEdlB1D4GhGavM5")

def check_response():
    print("Requesting presigned URL...")
    payload = {"fileName": "debug_test.jpg", "contentType": "image/jpeg"}
    headers = {"x-api-key": UPLOAD_API_KEY}
    
    try:
        resp = requests.post(UPLOAD_API_ENDPOINT, json=payload, headers=headers, timeout=30)
        print(f"Status: {resp.status_code}")
        
        data = resp.json()
        print("\n👇 FULL API RESPONSE 👇")
        print(json.dumps(data, indent=4))
        print("👆 ----------------- 👆")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_response()
