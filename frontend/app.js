let config = loadConfig();

function loadConfig() {
    const storedConfig = localStorage.getItem('postureConfig');
    if (storedConfig) {
        try {
            return JSON.parse(storedConfig);
        } catch (e) {
            console.error('Error loading stored config:', e);
            return null;
        }
    }
    return null;
}

function saveConfigToStorage() {
    try {
        localStorage.setItem('postureConfig', JSON.stringify(config));
        console.log('Configuration saved to storage');
    } catch (e) {
        console.error('Error saving config to storage:', e);
    }
}

let badPostureStartTime = null;
let lastAlertTime = null;
const ALERT_THRESHOLD = 10000; // 10 seconds in milliseconds
const cameraOverlay = document.querySelector('.camera-overlay');
let alertsEnabled = true;
const toggleAlertBtn = document.getElementById('toggleAlert');

async function startWebcam() {
    const video = document.getElementById('video');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            cameraOverlay.classList.add('hidden');
        };
    } catch (error) {
        console.error('Error accessing webcam:', error);
        cameraOverlay.textContent = 'Error accessing camera';
    }
}

async function sendFrame() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const context = canvas.getContext('2d');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const frame = canvas.toDataURL('image/jpeg');
    const blob = await (await fetch(frame)).blob();
    const formData = new FormData();
    formData.append('file', blob, 'frame.jpg');
    
    try {
        const response = await fetch('/api/process-image', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        updateUI(data);
    } catch (error) {
        console.error('Error sending frame:', error);
    }
}

function updateUI(data) {
    const statusElement = document.getElementById('status');
    const angleElement = document.getElementById('angle');
    const timerElement = document.getElementById('timer');
    const videoContainer = document.querySelector('.video-container');
    
    if (data.error) {
        statusElement.textContent = `Status: ${data.error}`;
        statusElement.className = 'status-message';
        videoContainer.className = 'video-container';  // Reset shadow
        return;
    }
    
    // Update status with appropriate styling
    statusElement.textContent = data.status;
    statusElement.className = 'status-message ' + (data.is_good ? 'good-posture' : 'bad-posture');
    
    // Update video container shadow
    videoContainer.className = 'video-container ' + 
        (data.is_good ? 'good-posture-shadow' : 'bad-posture-shadow');

    // Display both angles if available
    let angleText = 'Neck Angles: ';
    if (data.angles.right !== undefined) {
        angleText += `Right: ${data.angles.right.toFixed(2)}°`;
    }
    if (data.angles.left !== undefined) {
        if (data.angles.right !== undefined) angleText += ' | ';
        angleText += `Left: ${data.angles.left.toFixed(2)}°`;
    }
    angleElement.textContent = angleText;
    
    // Draw pose markers if landmarks are available
    if (data.landmarks) {
        drawPoseMarkers(data.landmarks);
    }
    
    if (!data.is_good) {
        if (!badPostureStartTime) {
            badPostureStartTime = Date.now();
        }
        
        const duration = Math.floor((Date.now() - badPostureStartTime) / 1000);
        timerElement.textContent = `Bad Posture Time: ${duration}s`;
        timerElement.classList.remove('hidden');
        
        if (duration >= config.alertInterval / 1000) {
            if (!lastAlertTime || (Date.now() - lastAlertTime) >= config.alertInterval) {
                playAlert();
                lastAlertTime = Date.now();
            }
        }
    } else {
        badPostureStartTime = null;
        timerElement.classList.add('hidden');
    }
}

function playAlert() {
    if (!alertsEnabled) return;
    const audio = new Audio('sounds/soft-alert.mp3');
    audio.play().catch(e => console.log('Error playing sound:', e));
}

function drawPoseMarkers(landmarks) {
    const canvas = document.getElementById('pose-canvas');
    const ctx = canvas.getContext('2d');
    const video = document.getElementById('video');
    
    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Clear previous drawings
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw landmarks
    landmarks.forEach((landmark, index) => {
        if (landmark.visibility > 0.5) {
            ctx.beginPath();
            ctx.arc(
                landmark.x * canvas.width,
                landmark.y * canvas.height,
                3,
                0,
                2 * Math.PI
            );
            ctx.fillStyle = '#00FF00';
            ctx.fill();
        }
    });
    
    // Draw connections (simplified version - you can add more connections as needed)
    drawConnections(ctx, landmarks, canvas.width, canvas.height);
}

function drawConnections(ctx, landmarks, width, height) {
    // Define some basic connections (you can add more)
    const connections = [
        // Shoulders
        [11, 12],
        // Right arm
        [11, 13],
        [13, 15],
        // Left arm
        [12, 14],
        [14, 16],
        // Right ear to shoulder
        [8, 12],
        // Left ear to shoulder
        [7, 11]
    ];
    
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 2;
    
    connections.forEach(([i, j]) => {
        const start = landmarks[i];
        const end = landmarks[j];
        
        if (start.visibility > 0.5 && end.visibility > 0.5) {
            ctx.beginPath();
            ctx.moveTo(start.x * width, start.y * height);
            ctx.lineTo(end.x * width, end.y * height);
            ctx.stroke();
        }
    });
}

document.getElementById('saveConfig').addEventListener('click', () => {
    const rightMinAngle = parseInt(document.getElementById('rightMinAngle').value);
    const rightMaxAngle = parseInt(document.getElementById('rightMaxAngle').value);
    const leftMinAngle = parseInt(document.getElementById('leftMinAngle').value);
    const leftMaxAngle = parseInt(document.getElementById('leftMaxAngle').value);
    const alertInterval = parseInt(document.getElementById('alertInterval').value) * 1000;

    if (rightMinAngle >= rightMaxAngle || leftMinAngle >= leftMaxAngle) {
        alert('Minimum angles must be less than maximum angles');
        return;
    }

    if (rightMaxAngle > 0 || rightMinAngle > 0) {
        alert('Right side angles must be negative');
        return;
    }

    if (leftMaxAngle < 0 || leftMinAngle < 0) {
        alert('Left side angles must be positive');
        return;
    }

    config.rightMinAngle = rightMinAngle;
    config.rightMaxAngle = rightMaxAngle;
    config.leftMinAngle = leftMinAngle;
    config.leftMaxAngle = leftMaxAngle;
    config.alertInterval = alertInterval;
    
    // Save to local storage
    saveConfigToStorage();
    
});

document.getElementById('startBtn').addEventListener('click', async () => {
    const button = document.getElementById('startBtn');
    button.disabled = true;
    button.textContent = 'Starting...';
    
    await startWebcam();
    setInterval(sendFrame, 1000);
    
    button.textContent = 'Detection Running';
});

async function getInitialConfig() {
    try {
        const response = await fetch('/api/config');
        const defaultConfig = await response.json();
        
        // Load stored config if it exists
        const storedConfig = loadConfig();
        
        // Use stored config or default from backend
        config = storedConfig || {
            rightMinAngle: defaultConfig.right_min_angle,
            rightMaxAngle: defaultConfig.right_max_angle,
            leftMinAngle: defaultConfig.left_min_angle,
            leftMaxAngle: defaultConfig.left_max_angle,
            alertInterval: 10000 // Keep alert interval as fixed value or add to backend
        };
        
        // Update input fields with current config
        document.getElementById('rightMinAngle').value = config.rightMinAngle;
        document.getElementById('rightMaxAngle').value = config.rightMaxAngle;
        document.getElementById('leftMinAngle').value = config.leftMinAngle;
        document.getElementById('leftMaxAngle').value = config.leftMaxAngle;
        document.getElementById('alertInterval').value = config.alertInterval / 1000;
    } catch (error) {
        console.error('Error fetching initial config:', error);
    }
}

document.addEventListener('DOMContentLoaded', getInitialConfig);

// Add a reset button to HTML
document.getElementById('resetConfig').addEventListener('click', async () => {
    try {
        // Get default config from backend
        const response = await fetch('/api/config');
        const defaultConfig = await response.json();
        
        // Update config object with default values
        config = {
            rightMinAngle: defaultConfig.right_min_angle,
            rightMaxAngle: defaultConfig.right_max_angle,
            leftMinAngle: defaultConfig.left_min_angle,
            leftMaxAngle: defaultConfig.left_max_angle,
            alertInterval: 10000
        };
        
        // Update UI
        document.getElementById('rightMinAngle').value = config.rightMinAngle;
        document.getElementById('rightMaxAngle').value = config.rightMaxAngle;
        document.getElementById('leftMinAngle').value = config.leftMinAngle;
        document.getElementById('leftMaxAngle').value = config.leftMaxAngle;
        document.getElementById('alertInterval').value = config.alertInterval / 1000;
        
        // Clear stored config
        localStorage.removeItem('postureConfig');
        
        console.log('Reset to default configuration');
    } catch (error) {
        console.error('Error resetting configuration:', error);
    }
});

toggleAlertBtn.addEventListener('click', () => {
    alertsEnabled = !alertsEnabled;
    toggleAlertBtn.classList.toggle('disabled');
    toggleAlertBtn.innerHTML = alertsEnabled ? 
        '<span class="alert-icon">🔔</span> Alerts Enabled' : 
        '<span class="alert-icon">🔕</span> Alerts Disabled';
}); 