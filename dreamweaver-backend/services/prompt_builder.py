"""Prompt building service for visual parameters."""

from typing import Dict

# Camera angle mappings (from the Gradio script)
AZIMUTH_MAP: Dict[int, str] = {
    0: "front view",
    45: "front-right quarter view",
    90: "right side view",
    135: "back-right quarter view",
    180: "back view",
    225: "back-left quarter view",
    270: "left side view",
    315: "front-left quarter view",
}

ELEVATION_MAP: Dict[int, str] = {
    -30: "low-angle shot",
    0: "eye-level shot",
    30: "elevated shot",
    60: "high-angle shot",
}

DISTANCE_MAP: Dict[float, str] = {
    0.6: "close-up",
    1.0: "medium shot",
    1.4: "wide shot",
}

# Camera equipment mappings
CAMERA_MAP: Dict[str, str] = {
    "arriflex-16sr": "shot on Arriflex 16SR",
    "arri-alexa": "shot on ARRI ALEXA",
    "red-v-raptor": "shot on RED V-RAPTOR",
    "sony-venice": "shot on Sony VENICE",
    "panavision-millennium": "shot on Panavision Millennium",
}

LENS_MAP: Dict[str, str] = {
    "panavision-c-series": "with Panavision C-Series anamorphic lens",
    "cooke-s4": "with Cooke S4/i lens",
    "zeiss-master-prime": "with Zeiss Master Prime lens",
    "arri-master-anamorphic": "with ARRI Master Anamorphic lens",
}


def snap_to_nearest(value: float, options: list) -> float:
    """Snap a value to the nearest option."""
    return min(options, key=lambda x: abs(x - value))


def build_camera_prompt(azimuth: float, elevation: float, distance: float) -> str:
    """Build camera angle prompt from visual parameters."""
    az_snapped = int(snap_to_nearest(azimuth, list(AZIMUTH_MAP.keys())))
    el_snapped = int(snap_to_nearest(elevation, list(ELEVATION_MAP.keys())))
    dist_snapped = snap_to_nearest(distance, list(DISTANCE_MAP.keys()))
    
    az_name = AZIMUTH_MAP[az_snapped]
    el_name = ELEVATION_MAP[el_snapped]
    dist_name = DISTANCE_MAP[dist_snapped]
    
    return f"<sks> {az_name} {el_name} {dist_name}"


def build_equipment_prompt(
    camera_id: str,
    lens_id: str,
    focal_length: int,
    aperture: str,
) -> str:
    """Build camera equipment prompt."""
    parts = []
    
    if camera_id in CAMERA_MAP:
        parts.append(CAMERA_MAP[camera_id])
    
    if lens_id in LENS_MAP:
        parts.append(LENS_MAP[lens_id])
    
    parts.append(f"{focal_length}mm")
    parts.append(aperture)
    
    return ", ".join(parts)


def build_full_prompt(
    user_prompt: str,
    azimuth: float = 0,
    elevation: float = 0,
    distance: float = 1.0,
    camera_id: str | None = None,
    lens_id: str | None = None,
    focal_length: int = 35,
    aperture: str = "f/11",
) -> str:
    """Build full prompt from all visual parameters."""
    parts = []
    
    if user_prompt:
        parts.append(user_prompt)
    
    # Camera angle
    camera_prompt = build_camera_prompt(azimuth, elevation, distance)
    parts.append(camera_prompt)
    
    # Equipment (optional)
    if camera_id and lens_id:
        equipment_prompt = build_equipment_prompt(camera_id, lens_id, focal_length, aperture)
        parts.append(equipment_prompt)
    
    return ". ".join(parts)
