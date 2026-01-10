"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { CameraState } from "@/types";

// Constants
const CENTER = new THREE.Vector3(0, 0.75, 0);
const BASE_DISTANCE = 1.6;
const AZIMUTH_RADIUS = 2.0;
const ELEVATION_RADIUS = 1.5;

const AZIMUTH_STEPS = [0, 45, 90, 135, 180, 225, 270, 315];
const ELEVATION_STEPS = [-30, 0, 30, 60];
const DISTANCE_STEPS = [0.6, 1.0, 1.4];

const AZIMUTH_NAMES: Record<number, string> = {
    0: "front view",
    45: "front-right quarter view",
    90: "right side view",
    135: "back-right quarter view",
    180: "back view",
    225: "back-left quarter view",
    270: "left side view",
    315: "front-left quarter view",
};

const ELEVATION_NAMES: Record<string, string> = {
    "-30": "low-angle shot",
    "0": "eye-level shot",
    "30": "elevated shot",
    "60": "high-angle shot",
};

const DISTANCE_NAMES: Record<string, string> = {
    "0.6": "close-up",
    "1": "medium shot",
    "1.4": "wide shot",
};

function snapToNearest(value: number, steps: number[]): number {
    return steps.reduce((prev, curr) =>
        Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
    );
}

function buildPrompt(azimuth: number, elevation: number, distance: number): string {
    const azSnap = snapToNearest(azimuth, AZIMUTH_STEPS);
    const elSnap = snapToNearest(elevation, ELEVATION_STEPS);
    const distSnap = snapToNearest(distance, DISTANCE_STEPS);
    const distKey = distSnap === 1 ? "1" : distSnap.toFixed(1);
    return `<sks> ${AZIMUTH_NAMES[azSnap]} ${ELEVATION_NAMES[String(elSnap)]} ${DISTANCE_NAMES[distKey]}`;
}

// Drag state
interface DragState {
    active: boolean;
    type: "azimuth" | "elevation" | "distance" | null;
    startY: number;
    startDistance: number;
    startAzimuth: number; // Store starting azimuth to prevent jump
    startMouseAngle: number; // Store starting mouse angle
}

// Handle component
interface HandleProps {
    position: THREE.Vector3;
    color: string;
    emissiveColor: string;
    type: "azimuth" | "elevation" | "distance";
    dragState: DragState;
    onDragStart: (type: "azimuth" | "elevation" | "distance", startY: number, startMouseAngle: number) => void;
}

function Handle({ position, color, emissiveColor, type, dragState, onDragStart }: HandleProps) {
    const meshRef = useRef<THREE.Mesh>(null);
    const [hovered, setHovered] = useState(false);
    const { gl, size } = useThree();
    const isActive = dragState.active && dragState.type === type;

    const handlePointerDown = useCallback(
        (e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            // Calculate initial mouse angle for azimuth
            const rect = gl.domElement.getBoundingClientRect();
            const relX = (e.nativeEvent.clientX - rect.left) / rect.width;
            const relY = (e.nativeEvent.clientY - rect.top) / rect.height;
            const mouseAngle = Math.atan2(relX - 0.5, relY - 0.55);
            onDragStart(type, e.nativeEvent.clientY, mouseAngle);
            gl.domElement.style.cursor = "grabbing";
        },
        [onDragStart, type, gl]
    );

    return (
        <mesh
            ref={meshRef}
            position={position}
            onPointerDown={handlePointerDown}
            onPointerEnter={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                setHovered(true);
                if (!dragState.active) gl.domElement.style.cursor = "grab";
            }}
            onPointerLeave={() => {
                setHovered(false);
                if (!dragState.active) gl.domElement.style.cursor = "default";
            }}
            scale={hovered || isActive ? 1.3 : 1}
        >
            <sphereGeometry args={[0.12, 32, 32]} />
            <meshStandardMaterial
                color={color}
                emissive={emissiveColor}
                emissiveIntensity={hovered || isActive ? 1 : 0.5}
                metalness={0.3}
                roughness={0.4}
            />
        </mesh>
    );
}

// Camera model
function CameraModel({ position, lookAtTarget }: { position: THREE.Vector3; lookAtTarget: THREE.Vector3 }) {
    const groupRef = useRef<THREE.Group>(null);
    useFrame(() => {
        if (groupRef.current) {
            groupRef.current.position.copy(position);
            groupRef.current.lookAt(lookAtTarget);
        }
    });
    return (
        <group ref={groupRef}>
            <mesh>
                <boxGeometry args={[0.25, 0.18, 0.32]} />
                <meshStandardMaterial color="#6699cc" metalness={0.5} roughness={0.3} />
            </mesh>
            <mesh position={[0, 0, 0.22]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.07, 0.09, 0.15, 16]} />
                <meshStandardMaterial color="#6699cc" metalness={0.5} roughness={0.3} />
            </mesh>
        </group>
    );
}

function AzimuthRing() {
    return (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
            <torusGeometry args={[AZIMUTH_RADIUS, 0.025, 16, 64]} />
            <meshStandardMaterial color="#00ff88" emissive="#00ff88" emissiveIntensity={0.3} />
        </mesh>
    );
}

function ElevationArc() {
    const points = useMemo(() => {
        const pts: [number, number, number][] = [];
        for (let i = 0; i <= 32; i++) {
            const angle = THREE.MathUtils.degToRad(-30 + (90 * i) / 32);
            pts.push([-0.6, ELEVATION_RADIUS * Math.sin(angle) + CENTER.y, ELEVATION_RADIUS * Math.cos(angle)]);
        }
        return pts;
    }, []);
    return <Line points={points} color="#ff69b4" lineWidth={3} />;
}

function ImagePlane({ imageUrl }: { imageUrl?: string }) {
    const meshRef = useRef<THREE.Mesh>(null);
    const [texture, setTexture] = useState<THREE.Texture | null>(null);

    useEffect(() => {
        if (imageUrl) {
            const loader = new THREE.TextureLoader();
            loader.load(imageUrl, (tex) => {
                tex.minFilter = THREE.LinearFilter;
                tex.magFilter = THREE.LinearFilter;
                setTexture(tex);
            });
        } else {
            setTexture(null);
        }
    }, [imageUrl]);

    const placeholderTexture = useMemo(() => {
        if (typeof document === "undefined") return null;
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = "#3a3a4a";
        ctx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = "#ffcc99";
        ctx.beginPath();
        ctx.arc(128, 128, 80, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.arc(100, 110, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(156, 110, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(128, 130, 35, 0.2, Math.PI - 0.2);
        ctx.stroke();
        return new THREE.CanvasTexture(canvas);
    }, []);

    const displayTexture = texture || placeholderTexture;

    return (
        <mesh ref={meshRef} position={CENTER}>
            <planeGeometry args={[1, 1]} />
            {displayTexture && <meshBasicMaterial map={displayTexture} side={THREE.DoubleSide} />}
        </mesh>
    );
}

function DistanceLine({ start, end }: { start: THREE.Vector3; end: THREE.Vector3 }) {
    const points = useMemo(
        () => [[start.x, start.y, start.z], [end.x, end.y, end.z]] as [number, number, number][],
        [start, end]
    );
    return <Line points={points} color="#ffa500" lineWidth={2} />;
}

function CameraControlScene({
    state,
    imageUrl,
    dragState,
    onDragStart,
}: {
    state: CameraState;
    onChange: (state: CameraState) => void;
    imageUrl?: string;
    dragState: DragState;
    onDragStart: (type: "azimuth" | "elevation" | "distance", startY: number, startMouseAngle: number) => void;
}) {
    const distance = BASE_DISTANCE * state.distance;
    const azRad = THREE.MathUtils.degToRad(state.azimuth);
    const elRad = THREE.MathUtils.degToRad(state.elevation);

    const cameraPosition = useMemo(
        () => new THREE.Vector3(
            distance * Math.sin(azRad) * Math.cos(elRad),
            distance * Math.sin(elRad) + CENTER.y,
            distance * Math.cos(azRad) * Math.cos(elRad)
        ),
        [distance, azRad, elRad]
    );

    const azimuthHandlePosition = useMemo(
        () => new THREE.Vector3(AZIMUTH_RADIUS * Math.sin(azRad), 0.05, AZIMUTH_RADIUS * Math.cos(azRad)),
        [azRad]
    );

    const elevationHandlePosition = useMemo(
        () => new THREE.Vector3(-0.6, ELEVATION_RADIUS * Math.sin(elRad) + CENTER.y, ELEVATION_RADIUS * Math.cos(elRad)),
        [elRad]
    );

    const orangeDist = distance - 0.4;
    const distanceHandlePosition = useMemo(
        () => new THREE.Vector3(
            orangeDist * Math.sin(azRad) * Math.cos(elRad),
            orangeDist * Math.sin(elRad) + CENTER.y,
            orangeDist * Math.cos(azRad) * Math.cos(elRad)
        ),
        [orangeDist, azRad, elRad]
    );

    return (
        <>
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 10, 5]} intensity={0.6} />
            <gridHelper args={[6, 12, "#333333", "#222222"]} />
            <ImagePlane imageUrl={imageUrl} />
            <CameraModel position={cameraPosition} lookAtTarget={CENTER} />
            <AzimuthRing />
            <Handle position={azimuthHandlePosition} color="#00ff88" emissiveColor="#00ff88" type="azimuth" dragState={dragState} onDragStart={onDragStart} />
            <ElevationArc />
            <Handle position={elevationHandlePosition} color="#ff69b4" emissiveColor="#ff69b4" type="elevation" dragState={dragState} onDragStart={onDragStart} />
            <DistanceLine start={cameraPosition} end={CENTER} />
            <Handle position={distanceHandlePosition} color="#ffa500" emissiveColor="#ffa500" type="distance" dragState={dragState} onDragStart={onDragStart} />
        </>
    );
}

interface CameraControl3DProps {
    value: CameraState;
    onChange: (state: CameraState) => void;
    imageUrl?: string;
    className?: string;
    compact?: boolean;
}

export function CameraControl3D({ value, onChange, imageUrl, className, compact = false }: CameraControl3DProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [localState, setLocalState] = useState(value);
    const [dragState, setDragState] = useState<DragState>({
        active: false,
        type: null,
        startY: 0,
        startDistance: 1,
        startAzimuth: 0,
        startMouseAngle: 0,
    });

    useEffect(() => {
        if (!dragState.active) {
            setLocalState(value);
        }
    }, [value, dragState.active]);

    const handleDragStart = useCallback((type: "azimuth" | "elevation" | "distance", startY: number, startMouseAngle: number) => {
        setDragState({
            active: true,
            type,
            startY,
            startDistance: localState.distance,
            startAzimuth: localState.azimuth,
            startMouseAngle,
        });
    }, [localState.distance, localState.azimuth]);

    useEffect(() => {
        if (!dragState.active || !containerRef.current) return;

        const container = containerRef.current;
        const rect = container.getBoundingClientRect();

        const handleMouseMove = (e: MouseEvent) => {
            const relX = (e.clientX - rect.left) / rect.width;
            const relY = (e.clientY - rect.top) / rect.height;

            if (dragState.type === "azimuth") {
                // Calculate current mouse angle and delta from start
                const currentMouseAngle = Math.atan2(relX - 0.5, relY - 0.55);
                const deltaAngle = currentMouseAngle - dragState.startMouseAngle;
                // Apply delta to starting azimuth (prevents jump)
                let newAzimuth = dragState.startAzimuth + THREE.MathUtils.radToDeg(deltaAngle);
                // Normalize to 0-360
                while (newAzimuth < 0) newAzimuth += 360;
                while (newAzimuth >= 360) newAzimuth -= 360;
                setLocalState((prev) => ({ ...prev, azimuth: newAzimuth }));
            } else if (dragState.type === "elevation") {
                const elevation = THREE.MathUtils.clamp(
                    THREE.MathUtils.mapLinear(relY, 0.8, 0.2, -30, 60),
                    -30,
                    60
                );
                setLocalState((prev) => ({ ...prev, elevation }));
            } else if (dragState.type === "distance") {
                const deltaY = (e.clientY - dragState.startY) / 200;
                const newDistance = THREE.MathUtils.clamp(
                    dragState.startDistance - deltaY,
                    0.6,
                    1.4
                );
                setLocalState((prev) => ({ ...prev, distance: newDistance }));
            }
        };

        const handleMouseUp = () => {
            const snapped: CameraState = {
                azimuth: snapToNearest(localState.azimuth, AZIMUTH_STEPS),
                elevation: snapToNearest(localState.elevation, ELEVATION_STEPS),
                distance: snapToNearest(localState.distance, DISTANCE_STEPS),
            };
            setLocalState(snapped);
            onChange(snapped);
            setDragState({ active: false, type: null, startY: 0, startDistance: 1, startAzimuth: 0, startMouseAngle: 0 });
            document.body.style.cursor = "default";
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [dragState, localState, onChange]);

    return (
        <div className={`flex flex-col ${className || ""}`}>
            <div
                ref={containerRef}
                className={`relative w-full rounded-xl overflow-hidden bg-[#1a1a1a] ${compact ? "aspect-[16/10]" : "aspect-[4/3]"}`}
            >
                <Canvas
                    camera={{ position: [3.5, 2.5, 3.5], fov: 45, near: 0.1, far: 1000 }}
                    onCreated={({ camera }) => camera.lookAt(0, 0.75, 0)}
                >
                    <CameraControlScene
                        state={localState}
                        onChange={onChange}
                        imageUrl={imageUrl}
                        dragState={dragState}
                        onDragStart={handleDragStart}
                    />
                </Canvas>

                <div className="absolute top-3 left-3 flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#00ff88]" />
                        Azimuth
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#ff69b4]" />
                        Elevation
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#ffa500]" />
                        Distance
                    </span>
                </div>
            </div>

            <div className="mt-2 text-center">
                <span className="inline-block bg-black/80 px-4 py-2 rounded-lg font-mono text-xs text-primary">
                    {buildPrompt(localState.azimuth, localState.elevation, localState.distance)}
                </span>
            </div>
        </div>
    );
}

export { buildPrompt, snapToNearest, AZIMUTH_STEPS, ELEVATION_STEPS, DISTANCE_STEPS };
