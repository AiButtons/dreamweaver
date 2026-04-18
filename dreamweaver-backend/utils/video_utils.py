
from typing import Tuple

def get_dimensions(aspect_ratio: str, strict_64: bool = False) -> Tuple[int, int]:
    """
    Maps aspect ratio strings to width/height dimensions.
    Based on common video standards roughly equating to 720p/HD area.

    LTX-2 works with dimensions divisible by 32.
    LTX-2.3 requires dimensions divisible by 64 (pass strict_64=True).
    """
    if strict_64:
        # LTX-2.3: all values divisible by 64
        mapping = {
            "1:1": (1024, 1024),
            "3:4": (896, 1152),
            "4:3": (1152, 896),
            "16:9": (1536, 1024),   # docs default for LTX-2.3
            "9:16": (768, 1024),
            "21:9": (1536, 640),
            "2:3": (832, 1280),
            "3:2": (1280, 832),
        }
        return mapping.get(aspect_ratio, (1536, 1024))

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


def get_ltx23_num_frames(duration_sec: str) -> int:
    """
    LTX-2.3 requires num_frames to satisfy 8k+1 (9, 17, 25, 65, 121, 257, ...).
    Maps a duration to the nearest valid frame count at 24fps.
    Reference values from docs: 65 ≈ 2.7s, 121 ≈ 5s, 257 ≈ 10.7s.
    """
    try:
        seconds = float(duration_sec)
    except (TypeError, ValueError):
        seconds = 5.0

    if seconds <= 3:
        return 65
    if seconds <= 6:
        return 121
    if seconds <= 8:
        return 193
    return 257


def align_frames_8k_plus_1(num_frames: int) -> int:
    """Round an arbitrary frame count to the nearest 8k+1 valid value."""
    if num_frames < 9:
        return 9
    # Round down to nearest 8-multiple, then add 1
    return ((num_frames - 1) // 8) * 8 + 1

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
