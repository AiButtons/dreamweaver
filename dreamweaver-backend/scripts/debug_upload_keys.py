import requests
import json
import os

UPLOAD_API_ENDPOINT = os.getenv("UPLOAD_API_ENDPOINT", "https://wzcz9axnlj.execute-api.eu-north-1.amazonaws.com/prod/upload")
UPLOAD_API_KEY = os.getenv("UPLOAD_API_KEY", "G8sCSLZumv4sUHc6NqqWC18MwHEdlB1D4GhGavM5")

def check_keys():
    try:
        resp = requests.post(UPLOAD_API_ENDPOINT, json={"fileName": "x.jpg","contentType": "image/jpeg"}, headers={"x-api-key": UPLOAD_API_KEY}, timeout=30)
        data = resp.json()
        print("API Response Keys:")
        for k in data.keys():
            print(f"- {k}")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_keys()
