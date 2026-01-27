
from typing import Tuple

def get_dimensions(aspect_ratio: str) -> Tuple[int, int]:
    """
    Maps aspect ratio strings to width/height dimensions.
    Based on common video standards roughly equating to 720p/HD area.
    """
    # Base dimension reference: ~1280x720 (0.9MP)
    # LTX2 works well with dimensions divisible by 32
    
    mapping = {
        "1:1": (1024, 1024),
        "3:4": (896, 1184),
        "4:3": (1184, 896),
        "16:9": (1280, 704), # 1280x720 is 16:9, rounded to 32 multiple
        "9:16": (704, 1280),
        "21:9": (1536, 640),
        "2:3": (832, 1248),
        "3:2": (1248, 832),
    }
    return mapping.get(aspect_ratio, (1280, 704)) # Default to 16:9

def get_frames_from_duration(duration_sec: str) -> int:
    """
    Maps duration in seconds to number of frames.
    LTX2 typically generates at 24fps.
    """
    try:
        seconds = int(duration_sec)
    except ValueError:
        seconds = 5
        
    # LTX2 typically generates in blocks. 
    # ~4-5s is usually 97 frames (standard for this model family)
    # 5s * 24fps = 120 frames
    # 10s * 24fps = 240 frames
    # LTX-2 usually needs (frame * 8) + 1 or similar latent alignment, 
    # but strictly following user request of 10s -> ~241 frames.
    
    if seconds <= 5:
        return 97 # Standard 4s generation + 1 frame (approx)
    elif seconds <= 10:
        return 241 # ~10 seconds
    else:
        return 97 # Default fallback

def get_camera_prompt(movement: str) -> str:
    """
    Returns high-quality conditioning prompts for camera movements.
    """
    movement = movement.lower().strip()
    
    prompts = {
        "static": "static camera, tripod shot, no movement",
        "handheld": "handheld camera movement, slight shake, realistic documentary style",
        "zoom-out": "slow zoom out, pulling back from subject, revealing more background",
        "zoom-in": "slow zoom in, pushing towards subject, cinematic tension",
        "camera-follows": "tracking shot, camera follows subject, keeping subject in focus",
        "pan-left": "smooth pan left, camera rotating left axis, establishing shot",
        "pan-right": "smooth pan right, camera rotating right axis, establishing shot",
        "tilt-up": "tilt up, camera looking upwards, revealing height",
        "tilt-down": "tilt down, camera looking downwards",
        "dolly-in": "dolly in, physical camera moves forward, parallax effect",
        "dolly-out": "dolly out, physical camera moves backward, parallax effect",
        "orbit": "orbiting camera, 360 degree view, circling around subject, smooth arc",
    }
    
    return prompts.get(movement, "")
