#!/usr/bin/env python3
"""
🎬 Product Ad Pipeline v7 (Cinematic Physics + Exponential Ramps)

Updates:
- 🔭 FRAMING: Enforced "Waist-Up / Close-Up" to stop distant wide shots.
- 🎥 MOTION: "Anchor + Action" prompts force CAMERA motion, keeping subject STILL.
- 🏎️ SPEED: Quadratic FFmpeg curve for true "Slow -> Fast" acceleration.
- 🇮🇳 SUBJECT: High-fidelity Indian model in luxury studio.
"""

import requests
import jwt
import os
import subprocess
import time
import boto3
from botocore.config import Config
from datetime import datetime, timedelta
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import argparse
import uuid

# =============================================================================
# Configuration
# =============================================================================

IMAGE_GEN_ENDPOINT = "https://zennah--zennah-image-gen-model-image-inference.modal.run"
QWEN_EDIT_ENDPOINT = "https://zennah--zennah-image-edit-multi-angle-model-edit-inference.modal.run"
LTX2_ENDPOINT = "https://zennah--zennah-3d-model-generate.modal.run"

API_KEY = os.getenv("API_KEY", "7fa21cb6-2ffd-4788-85f1-e8a2176bbe04")
S3_BUCKET = os.getenv("S3_BUCKET", "temp-cache-57623")
S3_REGION = os.getenv("S3_REGION", "eu-north-1")
S3_PREFIX = "pipeline_assets"

BASE_OUTPUT_DIR = Path("test_outputs/product_ad_v7")
MAX_WORKERS = 4 

# =============================================================================
# 🎨 Updated Prompts (Forced Close-Ups)
# =============================================================================

# Added "Waist-up", "Macro" to force closer framing
PRODUCT_IMAGE_PROMPT = """
Waist-up close-up portrait, ultra-luxury fashion photography. 
A stunning elegant Indian woman with long flowing hair, wearing a high-end black designer evening gown. 
She is holding a pair of Nike Air Jordan 1 Retro High OG sneakers in her hands at chest level. 
Two majestic ball pythons are gently coiled around her shoulders. 
Background is a rich, dark, classy studio setting with subtle golden bokeh and rim lighting. 
Cinematic, 8k, photorealistic, sharp focus, expensive aesthetic, macro details.
""".strip().replace("\n", " ")

# Angles now explicitly ask for "Close-up" to maintain framing
ANGLES_TO_GENERATE = [
    "<sks> front view eye-level close-up",      
    "<sks> left side view 45-degree angle close-up",  
    "<sks> right side view 45-degree angle close-up", 
]

# =============================================================================
# S3 & Helpers
# =============================================================================

def upload_to_s3(file_path_or_bytes, filename):
    config = Config(region_name=S3_REGION, retries={'max_attempts': 3, 'mode': 'adaptive'})
    client = boto3.client('s3', config=config)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    key = f"{S3_PREFIX}/{timestamp}/{str(uuid.uuid4())[:6]}_{filename}"
    
    if isinstance(file_path_or_bytes, (str, Path)):
        with open(file_path_or_bytes, 'rb') as f: body = f.read()
    else:
        body = file_path_or_bytes

    client.put_object(Bucket=S3_BUCKET, Key=key, Body=body, ContentType="image/jpeg", ACL='public-read')
    return f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com/{key}"

def generate_jwt_token():
    return jwt.encode({'iat': datetime.utcnow(), 'exp': datetime.utcnow() + timedelta(hours=24)}, API_KEY, 'HS256')

# =============================================================================
# Core Tasks
# =============================================================================

def generate_initial_image(output_dir):
    print(f"   📸 Generating Master Image (Close-Up)...")
    token = generate_jwt_token()
    # 1024x1024 often yields better portraits, cropped later, but sticking to 1024x768 for video safety
    payload = {"prompt": PRODUCT_IMAGE_PROMPT, "width": 1024, "height": 768, "n_steps": 35, "guidance_scale": 8.0}
    
    resp = requests.post(IMAGE_GEN_ENDPOINT, json=payload, headers={"Authorization": f"Bearer {token}"})
    if resp.status_code != 200: raise Exception(f"Image Gen Failed: {resp.text}")
    
    path = output_dir / "00_master.jpg"
    with open(path, 'wb') as f: f.write(resp.content)
    return path, upload_to_s3(path, "master.jpg")

def generate_angle_views(master_url, output_dir):
    print(f"   📐 Generating Consistent Close-Up Angles...")
    results = {"original": master_url} 
    
    def _task(prompt):
        token = generate_jwt_token()
        # High guidance + "Close-up" keywords to prevent zooming out
        payload = {"image_url": master_url, "prompt": prompt, "n_steps": 45, "guidance_scale": 6.0, "seed": 42}
        resp = requests.post(QWEN_EDIT_ENDPOINT, json=payload, headers={"Authorization": f"Bearer {token}"})
        if resp.status_code == 200:
            name = "wide" if "wide" in prompt else ("left" if "left" in prompt else "right")
            path = output_dir / f"angle_{name}.jpg"
            with open(path, 'wb') as f: f.write(resp.content)
            return name, upload_to_s3(path, f"angle_{name}.jpg")
        return None, None

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(_task, p) for p in ANGLES_TO_GENERATE]
        for f in as_completed(futures):
            key, url = f.result()
            if key: 
                results[key] = url
                print(f"      ✅ Generated: {key}")
    return results

def generate_video_clip(task):
    idx, name, start_url, end_url, prompt, output_dir = task
    print(f"   🎬 [{name}] Generating Raw Clip...")
    
    token = generate_jwt_token()
    payload = {
        "image_urls": [start_url, end_url],
        "prompt": prompt,
        # Negative prompt explicitly forbids bad framing
        "negative_prompt": "full body shot, wide shot, distant, rotation of subject, spinning person, morphing, distortion",
        "num_frames": 97, # ~4 seconds
        "frame_rate": 24,
        "width": 1024,
        "height": 768,
        "guidance_scale": 3.0, 
        "seed": 42 + idx
    }
    
    try:
        resp = requests.post(LTX2_ENDPOINT, json=payload, headers={"Authorization": f"Bearer {token}"}, timeout=900)
        if resp.status_code == 200:
            path = output_dir / f"raw_{name}.mp4"
            with open(path, 'wb') as f: f.write(resp.content)
            return idx, path
        else:
            print(f"      ❌ [{name}] Failed: {resp.text}")
    except Exception as e:
        print(f"      ❌ [{name}] Error: {e}")
    return idx, None

# =============================================================================
# Video Processing (Exponential Speed Ramp)
# =============================================================================

def apply_speed_ramp(input_path, output_path, duration=4.0):
    """
    Applies a Quadratic Speed Ramp (Exponential feel).
    Formula: setpts = PTS * (1 - 0.7 * (T/Duration)^2)
    Result: Starts at 1.0x speed -> Ends at ~3.3x speed (Fast punch).
    """
    print(f"   ⚡ Ramping: {input_path.name}")
    
    # Quadratic acceleration curve
    # At T=0, Mult=1.0 (Normal speed)
    # At T=4, Mult=0.3 (3.3x speed)
    filter_complex = f"[0:v]trim=start_frame=1,setpts='PTS * (1 - 0.7 * (T/{duration})^2)'[v]"
    
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-filter_complex", filter_complex,
        "-map", "[v]", 
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        str(output_path)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return output_path

# =============================================================================
# Pipeline Execution
# =============================================================================

def run():
    print("🚀 Starting Pipeline v7 (Cinematic Physics)")
    output_dir = BASE_OUTPUT_DIR / datetime.now().strftime('%Y%m%d_%H%M%S')
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # 1. Assets
    master_path, master_url = generate_initial_image(output_dir)
    angles = generate_angle_views(master_url, output_dir)
    
    # 2. Define Clips (Anchor + Action Prompts)
    # Explicitly telling the subject to stay still ("Statue") while camera moves.
    clips_config = [
        (0, "01_dolly_in", angles.get("wide"), angles.get("original"), 
         "Close-up portrait. Subject is motionless like a statue. Camera dollies in smoothly from mid-shot to close-up."),
        (1, "02_orbit_left", angles.get("original"), angles.get("left"), 
         "Close-up portrait. Subject remains perfectly still. Camera orbits 45-degrees to the left. Parallax background."),
        (2, "03_orbit_return", angles.get("left"), angles.get("original"), 
         "Close-up portrait. Subject remains perfectly still. Camera orbits back to center view."),
        (3, "04_orbit_right", angles.get("original"), angles.get("right"), 
         "Close-up portrait. Subject remains perfectly still. Camera orbits 45-degrees to the right.")
    ]
    
    # 3. Generate
    print(f"\n   📹 Rendering {len(clips_config)} clips...")
    raw_paths = [None] * len(clips_config)
    
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        valid_tasks = [c + (output_dir,) for c in clips_config if c[2] and c[3]]
        futures = [executor.submit(generate_video_clip, task) for task in valid_tasks]
        for future in as_completed(futures):
            idx, path = future.result()
            if path: raw_paths[idx] = path

    # 4. Ramp & Merge
    print("\n   ⚡ Applying Exponential Speed Ramps...")
    ramped_paths = []
    
    for path in raw_paths:
        if path:
            ramped_path = output_dir / path.name.replace("raw_", "ramped_")
            try:
                apply_speed_ramp(path, ramped_path)
                ramped_paths.append(ramped_path)
            except Exception as e:
                print(f"      ⚠️ Error ramping {path.name}: {e}")

    if ramped_paths:
        list_path = output_dir / "files.txt"
        with open(list_path, 'w') as f:
            for p in ramped_paths: f.write(f"file '{p.absolute()}'\n")
            
        final_path = output_dir / "final_ad_v7.mp4"
        subprocess.run([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_path),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(final_path)
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        print(f"\n✅ SUCCESS! Video saved to:\n   {final_path}")
    else:
        print("\n❌ Failed to generate video.")

if __name__ == "__main__":
    run()