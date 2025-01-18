from fastapi import FastAPI, File, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import cv2
import numpy as np
import mediapipe as mp
from math import degrees, atan2
from fastapi.middleware.cors import CORSMiddleware
import os
from io import BytesIO
from PIL import Image
from pydantic import BaseModel

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Get the absolute path to the frontend directory
# When running in Docker, the frontend will be in /app/frontend
if os.path.exists("/app/frontend"):
    frontend_dir = "/app/frontend"
else:
    # For local development
    frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")

# Create a sub-application for API routes
api_app = FastAPI()

# Add this class for request validation
class ConfigUpdate(BaseModel):
    right_min_angle: int
    right_max_angle: int
    left_min_angle: int
    left_max_angle: int

class PostureConfig:
    def __init__(self):
        # Right side range (negative angles)
        self.right_min_angle = -80
        self.right_max_angle = -63
        # Left side range (positive angles)
        self.left_min_angle = 80
        self.left_max_angle = 115

config = PostureConfig()

@api_app.get("/config")
async def get_config():
    return {
        "right_min_angle": config.right_min_angle,
        "right_max_angle": config.right_max_angle,
        "left_min_angle": config.left_min_angle,
        "left_max_angle": config.left_max_angle
    }

@api_app.post("/process-image")
async def process_image(file: UploadFile = File(...)):
    contents = await file.read()
    image = Image.open(BytesIO(contents))
    img = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    
    # Convert image to RGB
    imgRGB = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    
    # Process the image and detect pose
    results = pose.process(imgRGB)
    
    if results.pose_landmarks:
        try:
            # Calculate neck angles
            angles = calculate_neck_angles(results.pose_landmarks.landmark)
            
            # Check posture
            posture_result = check_posture(angles)
            
            # Convert landmarks to list for JSON serialization
            landmarks = []
            for landmark in results.pose_landmarks.landmark:
                landmarks.append({
                    'x': landmark.x,
                    'y': landmark.y,
                    'z': landmark.z,
                    'visibility': landmark.visibility
                })
            
            return {
                "angles": posture_result["angles"],
                "status": posture_result["status"],
                "is_good": posture_result["is_good"],
                "landmarks": landmarks
            }
        except ValueError as e:
            return {"error": str(e)}
    else:
        return {"error": "No pose detected"}

# Initialize MediaPipe Pose
mp_pose = mp.solutions.pose
pose = mp_pose.Pose()
mp_draw = mp.solutions.drawing_utils

def calculate_neck_angles(landmarks):
    # Calculate right side angle
    right_shoulder = (landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER.value].x,
                     landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER.value].y)
    right_ear = (landmarks[mp_pose.PoseLandmark.RIGHT_EAR.value].x,
                 landmarks[mp_pose.PoseLandmark.RIGHT_EAR.value].y)
    
    # Calculate left side angle
    left_shoulder = (landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value].x,
                    landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value].y)
    left_ear = (landmarks[mp_pose.PoseLandmark.LEFT_EAR.value].x,
                landmarks[mp_pose.PoseLandmark.LEFT_EAR.value].y)
    
    # Calculate angles for both sides
    right_angle = degrees(atan2(right_ear[1] - right_shoulder[1], 
                               right_ear[0] - right_shoulder[0]))
    left_angle = degrees(atan2(left_ear[1] - left_shoulder[1], 
                              left_ear[0] - left_shoulder[0])) * -1
    
    # Calculate visibility scores
    right_visibility = min(landmarks[mp_pose.PoseLandmark.RIGHT_EAR.value].visibility,
                         landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER.value].visibility)
    left_visibility = min(landmarks[mp_pose.PoseLandmark.LEFT_EAR.value].visibility,
                        landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value].visibility)
    
    angles = {}
    if right_visibility > 0.5:
        angles['right'] = right_angle  # No need to multiply by -1 anymore
    if left_visibility > 0.5:
        angles['left'] = left_angle
    
    if not angles:
        raise ValueError("No clear view of neck angle")
    
    return angles

def check_posture(angles):
    is_good = True
    bad_angles = []
    
    if 'right' in angles:
        right_angle = angles['right']
        if not (config.right_min_angle <= right_angle <= config.right_max_angle):
            is_good = False
            bad_angles.append('right')
    
    if 'left' in angles:
        left_angle = angles['left']
        if not (config.left_min_angle <= left_angle <= config.left_max_angle):
            is_good = False
            bad_angles.append('left')
    
    if is_good:
        return {
            "status": "Good Posture",
            "is_good": True,
            "angles": angles
        }
    else:
        # Customize message based on number of bad angles
        if len(bad_angles) > 1:
            status = "Bad Posture! Please sit straight and fix your back posture"
        else:
            status = "Bad Posture! Please fix your neck angle"
        
        return {
            "status": status,
            "is_good": False,
            "angles": angles
        }

# Mount the API routes under /api
app.mount("/api", api_app)

# Verify frontend directory exists
if not os.path.exists(frontend_dir):
    raise RuntimeError(f"Frontend directory not found at: {frontend_dir}")

# Serve static files
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend") 